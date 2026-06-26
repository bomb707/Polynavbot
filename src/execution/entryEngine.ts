import type { Signal } from "@prisma/client";

import type { Config } from "../config/index.js";
import { isPaperMode } from "../config/index.js";
import type { IRepositories } from "../db/repositories/index.js";
import type { ILogger } from "../logger/types.js";
import type { IPublicClient } from "../polymarket/publicClient.js";
import type { IPaperTradingEngine } from "../paper/paperTypes.js";
import type { IRiskEngine } from "../risk/riskTypes.js";
import type { CandidateOutcome, IMarketScanner } from "../scanner/types.js";
import type { ILongshotScorer } from "../strategy/longshotScorer.js";
import { buildScoreInput, roundDownShares, toNumber } from "./entryHelpers.js";
import type {
  AcceptedEntry,
  EntryCandidateRecord,
  EntryRejectStage,
  EntryRunOptions,
  IEntryEngine,
  RejectedEntry,
} from "./entryTypes.js";
import { computePassiveBidPrice } from "./passiveBid.js";

export interface EntryEngineDeps {
  config: Config;
  scanner: IMarketScanner;
  scorer: ILongshotScorer;
  riskEngine: IRiskEngine;
  paperTradingEngine: IPaperTradingEngine;
  publicClient: IPublicClient;
  repositories: IRepositories;
  logger: ILogger;
}

export function createEntryEngine(deps: EntryEngineDeps): IEntryEngine {
  const {
    config,
    scanner,
    scorer,
    riskEngine,
    paperTradingEngine,
    publicClient,
    repositories,
    logger,
  } = deps;

  function reject(
    rejected: RejectedEntry[],
    entry: Omit<RejectedEntry, "stage"> & { stage: EntryRejectStage },
    riskReasons: string[],
  ): void {
    rejected.push(entry);
    if (entry.stage === "risk") {
      riskReasons.push(entry.reason);
    }
    logger.debug({ entry }, "Entry rejected");
  }

  function dedupSince(): Date {
    return new Date(Date.now() - config.ENTRY_SIGNAL_DEDUP_MINUTES * 60 * 1000);
  }

  async function resolveSignalForEntry(
    candidate: CandidateOutcome,
    bidPrice: number,
    sizeUsd: number,
    score: number,
    reasons: string[],
  ): Promise<Signal | null> {
    const pendingBuy = await repositories.order.findPendingBuyByTokenId(candidate.tokenId);
    if (pendingBuy) {
      return null;
    }

    const recentSignal = await repositories.signal.findRecentEntrySignal(
      candidate.tokenId,
      dedupSince(),
    );

    if (recentSignal) {
      const hasOrder = await repositories.signal.hasPaperOrder(recentSignal.id);
      if (hasOrder) {
        return null;
      }
      return recentSignal;
    }

    return repositories.signal.create({
      marketId: candidate.marketId,
      outcomeId: candidate.outcomeId,
      tokenId: candidate.tokenId,
      signalType: "LONGSHOT_ENTRY",
      score,
      reason: reasons.join("; "),
      entryPrice: bidPrice,
      suggestedSizeUsd: sizeUsd,
      status: "APPROVED",
    });
  }

  return {
    async run(options?: EntryRunOptions) {
      if (!isPaperMode(config)) {
        throw new Error("entry:paper requires TRADING_MODE=paper");
      }

      await paperTradingEngine.initialize();

      const { scan: providedScan, ...scanOptions } = options ?? {};
      const scan = providedScan ?? (await scanner.scanMarkets(scanOptions));
      const candidates: EntryCandidateRecord[] = [];
      const accepted: AcceptedEntry[] = [];
      const rejected: RejectedEntry[] = [];
      const riskRejectionReasons: string[] = [];
      let totalNotionalUsd = 0;

      for (const candidate of scan.candidates) {
        const market = await repositories.market.findById(candidate.marketId);
        const outcome = await repositories.outcome.findByTokenId(candidate.tokenId);

        if (!market || !outcome) {
          continue;
        }

        const pendingBuy = await repositories.order.findPendingBuyByTokenId(candidate.tokenId);
        if (pendingBuy) {
          reject(
            rejected,
            {
              tokenId: candidate.tokenId,
              question: candidate.question,
              stage: "idempotency",
              reason: "Pending BUY order already exists",
            },
            riskRejectionReasons,
          );
          continue;
        }

        const recentSignal = await repositories.signal.findRecentEntrySignal(
          candidate.tokenId,
          dedupSince(),
        );
        if (recentSignal && (await repositories.signal.hasPaperOrder(recentSignal.id))) {
          reject(
            rejected,
            {
              tokenId: candidate.tokenId,
              question: candidate.question,
              stage: "idempotency",
              reason: "Recent entry signal already has order",
            },
            riskRejectionReasons,
          );
          continue;
        }

        const orderBook = await publicClient.getOrderBook(candidate.tokenId);
        if (!orderBook) {
          reject(
            rejected,
            {
              tokenId: candidate.tokenId,
              question: candidate.question,
              stage: "bid",
              reason: "Order book unavailable",
            },
            riskRejectionReasons,
          );
          continue;
        }

        const scoreResult = scorer.score(
          buildScoreInput(market, outcome, candidate, orderBook),
        );

        candidates.push({
          tokenId: candidate.tokenId,
          question: candidate.question,
          outcomeName: candidate.outcomeName,
          score: scoreResult.score,
          decision: scoreResult.decision,
        });

        if (scoreResult.decision !== "entry_candidate") {
          reject(
            rejected,
            {
              tokenId: candidate.tokenId,
              question: candidate.question,
              stage: "score",
              reason: `Decision: ${scoreResult.decision} (${scoreResult.reasons.join("; ")})`,
            },
            riskRejectionReasons,
          );
          continue;
        }

        const bidResult = computePassiveBidPrice(orderBook, config);
        if ("rejected" in bidResult) {
          reject(
            rejected,
            {
              tokenId: candidate.tokenId,
              question: candidate.question,
              stage: "bid",
              reason: bidResult.reason,
            },
            riskRejectionReasons,
          );
          continue;
        }

        let sizeUsd = scoreResult.suggestedSizeUsd;
        let shares = roundDownShares(sizeUsd / bidResult.bidPrice);
        const notionalFromShares = shares * bidResult.bidPrice;

        if (
          sizeUsd < config.MIN_ORDER_SIZE_USD ||
          shares <= 0 ||
          notionalFromShares < config.MIN_ORDER_SIZE_USD
        ) {
          reject(
            rejected,
            {
              tokenId: candidate.tokenId,
              question: candidate.question,
              stage: "size",
              reason: `Order size $${sizeUsd.toFixed(2)} below minimum $${config.MIN_ORDER_SIZE_USD}`,
            },
            riskRejectionReasons,
          );
          continue;
        }

        const riskResult = await riskEngine.checkOrder({
          marketId: candidate.marketId,
          outcomeId: candidate.outcomeId,
          tokenId: candidate.tokenId,
          side: "BUY",
          limitPrice: bidResult.bidPrice,
          sizeUsd,
          isNewEntry: true,
          spread: orderBook.spread,
          liquidityUsd: toNumber(outcome.liquidity),
          dataUpdatedAt: outcome.updatedAt,
        });

        if (!riskResult.allowed) {
          reject(
            rejected,
            {
              tokenId: candidate.tokenId,
              question: candidate.question,
              stage: "risk",
              reason: riskResult.reason,
            },
            riskRejectionReasons,
          );
          continue;
        }

        if (riskResult.adjustedSizeUsd != null) {
          sizeUsd = riskResult.adjustedSizeUsd;
          shares = roundDownShares(sizeUsd / bidResult.bidPrice);
          if (shares * bidResult.bidPrice < config.MIN_ORDER_SIZE_USD) {
            reject(
              rejected,
              {
                tokenId: candidate.tokenId,
                question: candidate.question,
                stage: "size",
                reason: `Adjusted size $${sizeUsd.toFixed(2)} below minimum`,
              },
              riskRejectionReasons,
            );
            continue;
          }
        }

        const signal = await resolveSignalForEntry(
          candidate,
          bidResult.bidPrice,
          sizeUsd,
          scoreResult.score,
          scoreResult.reasons,
        );

        if (!signal) {
          reject(
            rejected,
            {
              tokenId: candidate.tokenId,
              question: candidate.question,
              stage: "idempotency",
              reason: "Duplicate entry blocked by idempotency guard",
            },
            riskRejectionReasons,
          );
          continue;
        }

        const { order, rejectedReason } = await paperTradingEngine.placeLimitOrder({
          marketId: candidate.marketId,
          outcomeId: candidate.outcomeId,
          tokenId: candidate.tokenId,
          side: "BUY",
          limitPrice: bidResult.bidPrice,
          sizeUsd,
          signalId: signal.id,
          skipRiskCheck: true,
          riskContext: {
            spread: orderBook.spread,
            liquidityUsd: toNumber(outcome.liquidity),
            dataUpdatedAt: outcome.updatedAt,
            isNewEntry: true,
          },
        });

        if (rejectedReason || !order || order.status === "FAILED") {
          await repositories.signal.updateStatus(signal.id, "REJECTED");
          reject(
            rejected,
            {
              tokenId: candidate.tokenId,
              question: candidate.question,
              stage: "order",
              reason: rejectedReason ?? "Order creation failed",
            },
            riskRejectionReasons,
          );
          continue;
        }

        accepted.push({
          tokenId: candidate.tokenId,
          question: candidate.question,
          bidPrice: bidResult.bidPrice,
          sizeUsd,
          shares,
          orderId: order.id,
          signalId: signal.id,
        });
        totalNotionalUsd += sizeUsd;
      }

      return {
        scan,
        candidates,
        accepted,
        rejected,
        totalNotionalUsd: Math.round(totalNotionalUsd * 100) / 100,
        riskRejectionReasons: [...new Set(riskRejectionReasons)],
      };
    },
  };
}
