import type { Config } from "../config/index.js";
import type { IRepositories } from "../db/repositories/index.js";
import type { ILogger } from "../logger/types.js";
import type { IPublicClient } from "../polymarket/publicClient.js";
import type { NormalizedMarket } from "../polymarket/publicTypes.js";
import { collectWalletTokenCandidates } from "../backtest/walletMirror.js";
import { saveMarketAndOutcomes, syncMarketFeeParams } from "./marketPersist.js";
import type {
  CandidateOutcome,
  IMarketScanner,
  ScanOptions,
  ScanSummary,
} from "./types.js";
import { SKIP_REASONS, type SkipReason } from "./types.js";

export interface WalletMirrorScannerDeps {
  publicClient: IPublicClient;
  repositories: IRepositories;
  config: Config;
  logger: ILogger;
}

function emptySkipCounts(): Record<SkipReason, number> {
  return Object.fromEntries(SKIP_REASONS.map((r) => [r, 0])) as Record<
    SkipReason,
    number
  >;
}

function isCandidateSide(
  side: "YES" | "NO",
  price: number,
  config: Config,
): boolean {
  if (side === "YES") {
    return price >= config.MIN_ENTRY_PRICE && price <= config.MAX_ENTRY_PRICE;
  }
  if (!config.NO_ENTRY_ENABLED) {
    return false;
  }
  return price >= config.NO_MIN_ENTRY_PRICE && price <= config.NO_MAX_ENTRY_PRICE;
}

export function createWalletMirrorScanner(deps: WalletMirrorScannerDeps): IMarketScanner {
  const { publicClient, repositories, config, logger } = deps;

  const walletAddress = config.MIRROR_WALLET?.trim().toLowerCase();
  if (!walletAddress) {
    throw new Error("MIRROR_WALLET is required when wallet mirror scanner is enabled");
  }

  const feeRefreshMs = config.FEE_PARAMS_REFRESH_HOURS * 60 * 60 * 1000;

  const createSnapshot = async (
    marketId: string,
    outcomeId: string,
    tokenId: string,
    price: number,
  ): Promise<void> => {
    const orderBook = await publicClient.getOrderBook(tokenId);

    if (!orderBook) {
      logger.warn({ tokenId }, "Order book unavailable for wallet mirror snapshot");
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

  const scanMarkets = async (_options?: ScanOptions): Promise<ScanSummary> => {
    const skipped = emptySkipCounts();
    const candidates: CandidateOutcome[] = [];
    const feeCache = new Map<string, Date>();
    let marketsScanned = 0;
    let outcomesScanned = 0;

    logger.info(
      { walletAddress, maxItems: config.MIRROR_MAX_ITEMS },
      "Scanning wallet mirror universe",
    );

    const activity = await publicClient.getAllUserActivity(
      walletAddress,
      config.MIRROR_MAX_ITEMS,
    );
    const walletCandidates = collectWalletTokenCandidates(activity);
    const slugCache = new Map<string, NormalizedMarket | null>();

    for (const walletToken of walletCandidates) {
      if (!walletToken.slug) {
        skipped.missing_token += 1;
        continue;
      }

      let normalized = slugCache.get(walletToken.slug);
      if (normalized === undefined) {
        normalized = await publicClient.getMarketBySlug(walletToken.slug);
        slugCache.set(walletToken.slug, normalized);
      }

      if (!normalized) {
        skipped.malformed += 1;
        continue;
      }

      marketsScanned += 1;
      outcomesScanned += normalized.outcomes.length;

      const { market, outcomes } = await saveMarketAndOutcomes(repositories, normalized);

      try {
        await syncMarketFeeParams(
          repositories,
          publicClient,
          market,
          normalized.conditionId,
          feeCache,
          feeRefreshMs,
        );
      } catch (error) {
        logger.warn(
          { conditionId: normalized.conditionId, err: String(error) },
          "Failed to sync fee params for wallet mirror market",
        );
      }

      const outcomeCount = normalized.outcomes.length;
      const matched = normalized.outcomes.find((o) => o.tokenId === walletToken.tokenId);
      if (!matched || matched.price === null) {
        skipped.missing_price += 1;
        continue;
      }

      const side = matched.side;
      if (!isCandidateSide(side, matched.price, config)) {
        if (side === "NO") {
          skipped.no_price_out_of_range += 1;
        } else {
          skipped.price_out_of_range += 1;
        }
        continue;
      }

      const dbOutcome = outcomes.find((o) => o.tokenId === matched.tokenId);
      if (!dbOutcome) {
        skipped.missing_token += 1;
        continue;
      }

      await createSnapshot(market.id, dbOutcome.id, matched.tokenId, matched.price);

      candidates.push({
        marketId: market.id,
        outcomeId: dbOutcome.id,
        tokenId: matched.tokenId,
        question: normalized.question,
        outcomeName: matched.name,
        price: matched.price,
        endDate: normalized.endDate,
        outcomeCount,
        side,
        source: "wallet",
      });
    }

    candidates.sort((a, b) => b.outcomeCount - a.outcomeCount);

    logger.info(
      { walletAddress, candidatesFound: candidates.length, marketsScanned },
      "Wallet mirror scan complete",
    );

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
    scanMarketPage: async () => ({ rawMarkets: [] }),
    evaluateMarket: () => ({
      normalized: null,
      candidates: [],
      skips: {},
    }),
  };
}
