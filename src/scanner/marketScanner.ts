import type { Market, Outcome } from "@prisma/client";

import type { Config } from "../config/index.js";
import type { IRepositories } from "../db/repositories/index.js";
import type { ILogger } from "../logger/types.js";
import { PublicApiError } from "../polymarket/http.js";
import type { IPublicClient } from "../polymarket/publicClient.js";
import type { NormalizedMarket, NormalizedOutcome } from "../polymarket/publicTypes.js";
import { extractLiquidity } from "../polymarket/schemas.js";
import type {
  CandidateOutcome,
  IMarketScanner,
  ScanOptions,
  ScanSummary,
  SkipReason,
} from "./types.js";
import { SKIP_REASONS } from "./types.js";

const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 50;
/** Gamma /markets offset pagination limit; use keyset API beyond this. */
export const GAMMA_MARKETS_MAX_OFFSET = 2000;

function isGammaOffsetLimitError(error: unknown): boolean {
  return (
    error instanceof PublicApiError &&
    error.context.status === 422 &&
    (error.context.body?.includes("offset too large") ?? false)
  );
}

export interface MarketScannerDeps {
  publicClient: IPublicClient;
  repositories: IRepositories;
  config: Config;
  logger: ILogger;
}

export interface EvaluatedCandidate {
  outcome: NormalizedOutcome;
}

export interface EvaluateMarketResult {
  normalized: NormalizedMarket | null;
  candidates: EvaluatedCandidate[];
  skips: Partial<Record<SkipReason, number>>;
}

function emptySkipCounts(): Record<SkipReason, number> {
  return Object.fromEntries(SKIP_REASONS.map((r) => [r, 0])) as Record<
    SkipReason,
    number
  >;
}

function incrementSkip(
  skips: Partial<Record<SkipReason, number>>,
  reason: SkipReason,
  count = 1,
): void {
  skips[reason] = (skips[reason] ?? 0) + count;
}

function mergeSkips(
  target: Record<SkipReason, number>,
  source: Partial<Record<SkipReason, number>>,
): void {
  for (const reason of SKIP_REASONS) {
    target[reason] += source[reason] ?? 0;
  }
}

function daysUntil(date: Date): number {
  const ms = date.getTime() - Date.now();
  return ms / (1000 * 60 * 60 * 24);
}

export function createMarketScanner(deps: MarketScannerDeps): IMarketScanner {
  const { publicClient, repositories, config, logger } = deps;

  const evaluateMarket = (rawMarket: unknown): EvaluateMarketResult => {
    const skips: Partial<Record<SkipReason, number>> = {};
    const normalized = publicClient.normalizeMarket(rawMarket);

    if (!normalized) {
      incrementSkip(skips, "malformed");
      return { normalized: null, candidates: [], skips };
    }

    if (!normalized.active) {
      incrementSkip(skips, "inactive");
      return { normalized, candidates: [], skips };
    }

    if (normalized.closed) {
      incrementSkip(skips, "closed");
      return { normalized, candidates: [], skips };
    }

    if (!normalized.enableOrderBook) {
      incrementSkip(skips, "no_order_book");
      return { normalized, candidates: [], skips };
    }

    if (!normalized.endDate) {
      incrementSkip(skips, "missing_end_date");
      return { normalized, candidates: [], skips };
    }

    if (daysUntil(normalized.endDate) < config.MIN_DAYS_TO_EXPIRY) {
      incrementSkip(skips, "expiry_too_soon");
      return { normalized, candidates: [], skips };
    }

    const liquidity = extractLiquidity(rawMarket);
    if (liquidity < config.MIN_LIQUIDITY_USD) {
      incrementSkip(skips, "low_liquidity");
      return { normalized, candidates: [], skips };
    }

    const candidates: EvaluatedCandidate[] = [];

    for (const outcome of normalized.outcomes) {
      if (outcome.side !== "YES") {
        incrementSkip(skips, "not_yes");
        continue;
      }

      if (!outcome.tokenId) {
        incrementSkip(skips, "missing_token");
        continue;
      }

      if (outcome.price === null) {
        incrementSkip(skips, "missing_price");
        continue;
      }

      if (
        outcome.price < config.MIN_ENTRY_PRICE ||
        outcome.price > config.MAX_ENTRY_PRICE
      ) {
        incrementSkip(skips, "price_out_of_range");
        continue;
      }

      candidates.push({ outcome });
    }

    return { normalized, candidates, skips };
  };

  const saveMarketAndOutcomes = async (
    normalized: NormalizedMarket,
    feeCache: Map<string, Date>,
  ): Promise<{ market: Market; outcomes: Outcome[] }> => {
    const market = await repositories.market.upsertByPolymarketId({
      polymarketMarketId: normalized.polymarketMarketId,
      conditionId: normalized.conditionId,
      question: normalized.question,
      slug: normalized.slug,
      category: normalized.category,
      active: normalized.active,
      closed: normalized.closed,
      archived: normalized.archived,
      enableOrderBook: normalized.enableOrderBook,
      endDate: normalized.endDate,
    });

    await syncMarketFeeParams(market, normalized.conditionId, feeCache);

    const outcomes: Outcome[] = [];
    for (const outcome of normalized.outcomes) {
      const saved = await repositories.outcome.upsertByTokenId({
        marketId: market.id,
        tokenId: outcome.tokenId,
        name: outcome.name,
        side: outcome.side,
        currentPrice: outcome.price,
      });
      outcomes.push(saved);
    }

    return { market, outcomes };
  };

  const feeRefreshMs = config.FEE_PARAMS_REFRESH_HOURS * 60 * 60 * 1000;

  const syncMarketFeeParams = async (
    market: Market,
    conditionId: string,
    feeCache: Map<string, Date>,
  ): Promise<void> => {
    const cachedAt = feeCache.get(conditionId);
    if (cachedAt && Date.now() - cachedAt.getTime() < feeRefreshMs) {
      return;
    }

    if (
      market.feeLastFetchedAt &&
      Date.now() - market.feeLastFetchedAt.getTime() < feeRefreshMs
    ) {
      feeCache.set(conditionId, market.feeLastFetchedAt);
      return;
    }

    try {
      const info = await publicClient.getClobMarketInfo(conditionId);
      if (!info) {
        return;
      }

      await repositories.market.updateFeeParams(market.id, {
        feesEnabled: info.feesEnabled,
        feeRate: info.feeDetails?.feeRate ?? 0,
        feeExponent: info.feeDetails?.feeExponent ?? null,
        takerOnly: info.feeDetails?.takerOnly ?? true,
        makerBaseFeeBps: info.makerBaseFeeBps,
        takerBaseFeeBps: info.takerBaseFeeBps,
        feeCategory: info.feeCategory,
        feeLastFetchedAt: new Date(),
      });

      feeCache.set(conditionId, new Date());
    } catch (error) {
      logger.warn(
        { conditionId, err: error instanceof Error ? error.message : String(error) },
        "Failed to sync market fee params",
      );
    }
  };

  const createSnapshot = async (
    marketId: string,
    outcomeId: string,
    tokenId: string,
    price: number,
  ): Promise<void> => {
    const orderBook = await publicClient.getOrderBook(tokenId);

    if (!orderBook) {
      logger.warn({ tokenId }, "Order book unavailable for snapshot, using gamma price");
    }

    await repositories.snapshot.create({
      marketId,
      outcomeId,
      tokenId,
      price,
      bestBid: orderBook?.bestBid ?? null,
      bestAsk: orderBook?.bestAsk ?? null,
      spread: orderBook?.spread ?? null,
      liquidity: orderBook
        ? orderBook.bids.reduce((sum, b) => sum + b.size, 0) +
          orderBook.asks.reduce((sum, a) => sum + a.size, 0)
        : null,
      volume: null,
    });
  };

  const scanMarketPage = async (
    limit: number,
    offset: number,
  ): Promise<{ rawMarkets: unknown[] }> => {
    // #region agent log
    fetch("http://localhost:7674/ingest/42e99566-2b71-4b77-875a-f5c34280b036", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": "79ebf4",
      },
      body: JSON.stringify({
        sessionId: "79ebf4",
        runId: "pre-fix",
        hypothesisId: "H1",
        location: "marketScanner.ts:scanMarketPage",
        message: "fetching market page",
        data: { limit, offset, exceedsMax: offset >= GAMMA_MARKETS_MAX_OFFSET },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion

    if (offset >= GAMMA_MARKETS_MAX_OFFSET) {
      logger.info(
        { offset, maxOffset: GAMMA_MARKETS_MAX_OFFSET },
        "Gamma offset pagination limit reached, stopping scan",
      );
      return { rawMarkets: [] };
    }

    try {
      const rawMarkets = await publicClient.fetchActiveMarketsRaw({
        limit,
        offset,
      });
      return { rawMarkets };
    } catch (error) {
      if (isGammaOffsetLimitError(error)) {
        // #region agent log
        fetch("http://localhost:7674/ingest/42e99566-2b71-4b77-875a-f5c34280b036", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Debug-Session-Id": "79ebf4",
          },
          body: JSON.stringify({
            sessionId: "79ebf4",
            runId: "pre-fix",
            hypothesisId: "H3",
            location: "marketScanner.ts:scanMarketPage",
            message: "caught gamma offset limit 422",
            data: { offset, status: 422 },
            timestamp: Date.now(),
          }),
        }).catch(() => {});
        // #endregion
        logger.info(
          { offset },
          "Gamma API offset limit reached (422), stopping pagination",
        );
        return { rawMarkets: [] };
      }
      throw error;
    }
  };

  const scanMarkets = async (options: ScanOptions = {}): Promise<ScanSummary> => {
    const limitPerPage = options.limitPerPage ?? DEFAULT_PAGE_SIZE;
    const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;

    const skipped = emptySkipCounts();
    const candidates: CandidateOutcome[] = [];
    const feeCache = new Map<string, Date>();
    let marketsScanned = 0;
    let outcomesScanned = 0;

    for (let page = 0; page < maxPages; page++) {
      const offset = page * limitPerPage;
      const { rawMarkets } = await scanMarketPage(limitPerPage, offset);

      if (rawMarkets.length === 0) {
        break;
      }

      for (const rawMarket of rawMarkets) {
        try {
          const evaluation = evaluateMarket(rawMarket);
          mergeSkips(skipped, evaluation.skips);

          if (!evaluation.normalized) {
            continue;
          }

          marketsScanned += 1;
          outcomesScanned += evaluation.normalized.outcomes.length;

          if (evaluation.candidates.length === 0) {
            continue;
          }

          const { market, outcomes } = await saveMarketAndOutcomes(
            evaluation.normalized,
            feeCache,
          );

          const outcomeCount = evaluation.normalized.outcomes.length;

          for (const { outcome } of evaluation.candidates) {
            const dbOutcome = outcomes.find((o) => o.tokenId === outcome.tokenId);
            if (!dbOutcome || outcome.price === null) {
              continue;
            }

            await createSnapshot(
              market.id,
              dbOutcome.id,
              outcome.tokenId,
              outcome.price,
            );

            candidates.push({
              marketId: market.id,
              outcomeId: dbOutcome.id,
              tokenId: outcome.tokenId,
              question: evaluation.normalized.question,
              outcomeName: outcome.name,
              price: outcome.price,
              endDate: evaluation.normalized.endDate,
              outcomeCount,
            });
          }
        } catch (error) {
          skipped.malformed += 1;
          logger.warn(
            { err: String(error), rawMarketId: (rawMarket as { id?: unknown })?.id },
            "Failed to process market during scan",
          );
        }
      }

      if (rawMarkets.length < limitPerPage) {
        break;
      }
    }

    // #region agent log
    fetch("http://localhost:7674/ingest/42e99566-2b71-4b77-875a-f5c34280b036", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": "79ebf4",
      },
      body: JSON.stringify({
        sessionId: "79ebf4",
        runId: "pre-fix",
        hypothesisId: "H2",
        location: "marketScanner.ts:scanMarkets",
        message: "scan complete",
        data: {
          marketsScanned,
          candidatesFound: candidates.length,
          pagesAttempted: Math.min(maxPages, Math.ceil(GAMMA_MARKETS_MAX_OFFSET / limitPerPage)),
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion

    candidates.sort((a, b) => b.outcomeCount - a.outcomeCount);

    return {
      marketsScanned,
      outcomesScanned,
      candidatesFound: candidates.length,
      skipped,
      candidates,
    };
  };

  return {
    scanMarkets,
    scanMarketPage,
    evaluateMarket,
  };
}

export type { IMarketScanner };
