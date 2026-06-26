import type { Config } from "../config/index.js";
import type { IRepositories } from "../db/repositories/index.js";
import type { SnapshotTokenRef } from "../db/repositories/snapshot.repository.js";
import type { ILogger } from "../logger/types.js";
import type { IPublicClient } from "../polymarket/publicClient.js";
import { toNumber } from "../execution/entryHelpers.js";
import type {
  BacktestConfig,
  BacktestDataset,
  BacktestDataSource,
  BacktestLoadOptions,
  BacktestTokenSeries,
  PriceBar,
} from "./backtestTypes.js";
import { filterBarsInRange } from "./marketState.js";
import { persistMarketForBacktest, resolveWalletTokenRefs } from "./walletMirror.js";

export interface DataLoaderDeps {
  repositories: IRepositories;
  publicClient: IPublicClient;
  logger: ILogger;
  config: BacktestConfig;
  appConfig: Config;
}

function snapshotToBar(snapshot: {
  timestamp: Date;
  tokenId: string;
  marketId: string;
  outcomeId: string;
  price: { toNumber(): number };
  bestBid: { toNumber(): number } | null;
  bestAsk: { toNumber(): number } | null;
  spread: { toNumber(): number } | null;
  liquidity: { toNumber(): number } | null;
}): PriceBar {
  return {
    timestamp: snapshot.timestamp,
    tokenId: snapshot.tokenId,
    marketId: snapshot.marketId,
    outcomeId: snapshot.outcomeId,
    price: snapshot.price.toNumber(),
    bestBid: toNumber(snapshot.bestBid),
    bestAsk: toNumber(snapshot.bestAsk),
    spread: toNumber(snapshot.spread),
    liquidity: toNumber(snapshot.liquidity),
    source: "snapshot",
  };
}

function clobPointToBar(
  point: { timestamp: Date; price: number },
  tokenId: string,
  marketId: string,
  outcomeId: string,
): PriceBar {
  return {
    timestamp: point.timestamp,
    tokenId,
    marketId,
    outcomeId,
    price: point.price,
    bestBid: null,
    bestAsk: null,
    spread: null,
    liquidity: null,
    source: "clob",
  };
}

export function mergePriceBars(snapshots: PriceBar[], clobBars: PriceBar[]): PriceBar[] {
  const byTs = new Map<number, PriceBar>();
  for (const bar of clobBars) {
    byTs.set(bar.timestamp.getTime(), bar);
  }
  for (const bar of snapshots) {
    byTs.set(bar.timestamp.getTime(), bar);
  }
  return [...byTs.values()].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
}

function enrichClobBars(bars: PriceBar[], assumedLiquidityUsd: number): PriceBar[] {
  return bars.map((bar) =>
    bar.source === "clob" && bar.liquidity == null
      ? { ...bar, liquidity: assumedLiquidityUsd }
      : bar,
  );
}

async function resolveTokenRefs(
  deps: DataLoaderDeps,
  start: Date,
  end: Date,
  loadOptions?: BacktestLoadOptions,
  appConfig?: Config,
): Promise<{ refs: SnapshotTokenRef[]; source: BacktestDataSource }> {
  const { repositories, publicClient, logger, config } = deps;

  if (loadOptions?.mirrorWallet) {
    const includeNoTokens =
      loadOptions.includeNoTokens ?? appConfig?.NO_ENTRY_ENABLED ?? false;
    const walletResult = await resolveWalletTokenRefs(
      publicClient,
      repositories,
      logger,
      loadOptions.mirrorWallet,
      loadOptions.mirrorMaxItems ?? appConfig?.MIRROR_MAX_ITEMS ?? 1000,
      { includeNoTokens },
    );
    if (walletResult.refs.length === 0) {
      throw new Error(
        `No tokens resolved from wallet ${loadOptions.mirrorWallet} (skipped NO: ${walletResult.skippedNoTokens}, missing slug: ${walletResult.skippedMissingSlug})`,
      );
    }
    return { refs: walletResult.refs, source: "wallet" };
  }

  const fromSnapshots = await repositories.snapshot.findDistinctTokensInRange(start, end);
  if (fromSnapshots.length > 0) {
    return { refs: fromSnapshots, source: "snapshots" };
  }

  const fromDatabase = await repositories.outcome.findTokenRefsForBacktest(
    start,
    end,
    config.maxMarkets,
  );
  if (fromDatabase.length > 0) {
    logger.info(
      { tokenCount: fromDatabase.length, maxMarkets: config.maxMarkets },
      "No snapshots in backtest range; using stored outcomes",
    );
    return { refs: fromDatabase, source: "database" };
  }

  logger.info(
    { start: start.toISOString(), end: end.toISOString(), maxMarkets: config.maxMarkets },
    "No local backtest data; fetching markets from Gamma API",
  );

  const markets = await publicClient.getBacktestMarkets(start, end, config.maxMarkets);
  const refs: SnapshotTokenRef[] = [];

  for (const market of markets) {
    const marketRefs = await persistMarketForBacktest(repositories, market);
    refs.push(...marketRefs);
  }

  logger.info(
    { marketCount: markets.length, tokenCount: refs.length },
    "Gamma markets persisted for backtest",
  );

  return { refs, source: "gamma" };
}

export function createDataLoader(deps: DataLoaderDeps) {
  const { repositories, publicClient, logger, config } = deps;

  return {
    async loadBacktestDataset(
      start: Date,
      end: Date,
      loadOptions?: BacktestLoadOptions,
    ): Promise<BacktestDataset> {
      const { refs: tokenRefs, source } = await resolveTokenRefs(deps, start, end, loadOptions, deps.appConfig);
      const series: BacktestTokenSeries[] = [];

      for (const ref of tokenRefs) {
        const [market, outcome, snapshots] = await Promise.all([
          repositories.market.findById(ref.marketId),
          repositories.outcome.findByTokenId(ref.tokenId),
          repositories.snapshot.findByTokenInRange(ref.tokenId, start, end),
        ]);

        if (!market || !outcome) {
          continue;
        }

        let bars = snapshots.map(snapshotToBar);

        const startTs = Math.floor(start.getTime() / 1000);
        const endTs = Math.floor(end.getTime() / 1000);
        const clobHistory = await publicClient.getPricesHistory(
          ref.tokenId,
          startTs,
          endTs,
          config.interval,
        );

        const clobBars = clobHistory.map((point) =>
          clobPointToBar(point, ref.tokenId, ref.marketId, ref.outcomeId),
        );

        bars = mergePriceBars(bars, clobBars);
        bars = filterBarsInRange(bars, start, end);

        if (bars.length === 0) {
          continue;
        }

        if (outcome.side !== "YES") {
          const includeNo =
            loadOptions?.includeNoTokens ??
            deps.appConfig.NO_ENTRY_ENABLED;
          if (!includeNo) {
            continue;
          }
        }

        const assumedLiquidity = toNumber(outcome.liquidity) ?? config.minLiquidityUsd;
        bars = enrichClobBars(bars, assumedLiquidity);

        series.push({
          meta: {
            marketId: market.id,
            outcomeId: outcome.id,
            tokenId: outcome.tokenId,
            question: market.question,
            category: market.category,
            endDate: market.endDate,
            active: market.active,
            closed: market.closed,
            archived: market.archived,
            enableOrderBook: market.enableOrderBook,
            outcomeCount: 2,
            liquidityUsd: toNumber(outcome.liquidity) ?? config.minLiquidityUsd,
            volumeUsd: toNumber(outcome.volume),
            outcomeName: outcome.name,
            outcomeSide: outcome.side,
          },
          bars,
        });
      }

      logger.info(
        {
          tokenCount: series.length,
          source,
          mirrorWallet: loadOptions?.mirrorWallet ?? null,
          start: start.toISOString(),
          end: end.toISOString(),
        },
        "Backtest dataset loaded",
      );

      return { start, end, series, source };
    },
  };
}

export function buildTimeline(dataset: BacktestDataset): Map<number, PriceBar[]> {
  const timeline = new Map<number, PriceBar[]>();
  const startMs = dataset.start.getTime();
  const endMs = dataset.end.getTime();

  for (const tokenSeries of dataset.series) {
    for (const bar of tokenSeries.bars) {
      const key = bar.timestamp.getTime();
      if (key < startMs || key > endMs) {
        continue;
      }
      const bucket = timeline.get(key) ?? [];
      bucket.push(bar);
      timeline.set(key, bucket);
    }
  }

  return timeline;
}
