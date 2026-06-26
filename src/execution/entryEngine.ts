import type { Signal } from "@prisma/client";

import type { Config } from "../config/index.js";
import { isLiveMode } from "../config/index.js";
import type { IRepositories } from "../db/repositories/index.js";
import type { IFeeService } from "../fees/feeTypes.js";
import type { ILogger } from "../logger/types.js";
import type { IPublicClient } from "../polymarket/publicClient.js";
import type { IRiskEngine } from "../risk/riskTypes.js";
import type { CandidateOutcome, IMarketScanner } from "../scanner/types.js";
import type { ILongshotScorer } from "../strategy/longshotScorer.js";
import { buildScoreInput, roundDownShares, toNumber } from "./entryHelpers.js";
import type { IExecutionEngine } from "./executionEngineTypes.js";
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
  executionEngine: IExecutionEngine;
  publicClient: IPublicClient;
  repositories: IRepositories;
  paperTradingEngine: import("../paper/paperTypes.js").IPaperTradingEngine;
  feeService: IFeeService;
  logger: ILogger;
}

export function createEntryEngine(deps: EntryEngineDeps): IEntryEngine {
  const {
    config,
    scanner,
    scorer,
    executionEngine,
    publicClient,
    repositories,
    paperTradingEngine,
    feeService,
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

  async function findPendingBuy(tokenId: string) {
    if (isLiveMode(config)) {
      return repositories.order.findPendingBuyByTokenIdLive(tokenId);
    }
    return repositories.order.findPendingBuyByTokenId(tokenId);
  }

  async function resolveSignalForEntry(
    candidate: CandidateOutcome,
    bidPrice: number,
    sizeUsd: number,
    score: number,
    reasons: string[],
  ): Promise<Signal | null> {
    const pendingBuy = await findPendingBuy(candidate.tokenId);
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
      await executionEngine.initialize();

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

        const pendingBuy = await findPendingBuy(candidate.tokenId);
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

        const sizeUsd = scoreResult.suggestedSizeUsd;
        const shares = roundDownShares(sizeUsd / bidResult.bidPrice);
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

        const feeParams = market
          ? feeService.getMarketFeeParams(market)
          : { feesEnabled: false, feeRate: 0, takerOnly: true, makerBaseFeeBps: 0, takerBaseFeeBps: 0 };
        const liquidityRole = feeService.estimateLiquidityRole({
          side: "BUY",
          limitPrice: bidResult.bidPrice,
          bestBid: orderBook.bestBid,
          bestAsk: orderBook.bestAsk,
        });
        const buyEconomics = feeService.calculateBuyEconomics({
          side: "BUY",
          price: bidResult.bidPrice,
          shares,
          liquidityRole,
          feeParams,
        });

        if (buyEconomics.totalCostUsd > paperTradingEngine.getCashBalance()) {
          await repositories.signal.updateStatus(signal.id, "REJECTED");
          reject(
            rejected,
            {
              tokenId: candidate.tokenId,
              question: candidate.question,
              stage: "order",
              reason: "Insufficient cash balance (including estimated fees)",
            },
            riskRejectionReasons,
          );
          continue;
        }

        const orderResult = await executionEngine.placeBuyLimitOrder({
          marketId: candidate.marketId,
          outcomeId: candidate.outcomeId,
          tokenId: candidate.tokenId,
          limitPrice: bidResult.bidPrice,
          sizeUsd,
          signalId: signal.id,
          isNewEntry: true,
          spread: orderBook.spread,
          liquidityUsd: toNumber(outcome.liquidity),
          dataUpdatedAt: outcome.updatedAt,
        });

        if (orderResult.status === "rejected" || !orderResult.orderId) {
          if (orderResult.rejectedReason) {
            riskRejectionReasons.push(orderResult.rejectedReason);
          }
          await repositories.signal.updateStatus(signal.id, "REJECTED");
          reject(
            rejected,
            {
              tokenId: candidate.tokenId,
              question: candidate.question,
              stage: "order",
              reason: orderResult.rejectedReason ?? "Order creation failed",
            },
            riskRejectionReasons,
          );
          continue;
        }

        accepted.push({
          tokenId: candidate.tokenId,
          question: candidate.question,
          bidPrice: bidResult.bidPrice,
          sizeUsd: orderResult.notionalUsd ?? sizeUsd,
          shares: orderResult.sizeShares ?? shares,
          orderId: orderResult.orderId,
          signalId: signal.id,
        });
        totalNotionalUsd += orderResult.notionalUsd ?? sizeUsd;
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
