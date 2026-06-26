import type { IRepositories } from "../db/repositories/index.js";
import type { SnapshotTokenRef } from "../db/repositories/snapshot.repository.js";
import type { ILogger } from "../logger/types.js";
import type { IPublicClient } from "../polymarket/publicClient.js";
import type { NormalizedMarket } from "../polymarket/publicTypes.js";
import { toNumber } from "../execution/entryHelpers.js";
import type { BacktestConfig, BacktestDataset, BacktestTokenSeries, PriceBar } from "./backtestTypes.js";
import { filterBarsInRange } from "./marketState.js";

export interface DataLoaderDeps {
  repositories: IRepositories;
  publicClient: IPublicClient;
  logger: ILogger;
  config: BacktestConfig;
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

async function persistMarketForBacktest(
  repositories: IRepositories,
  normalized: NormalizedMarket,
): Promise<SnapshotTokenRef[]> {
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

  const refs: SnapshotTokenRef[] = [];
  for (const outcome of normalized.outcomes) {
    const saved = await repositories.outcome.upsertByTokenId({
      marketId: market.id,
      tokenId: outcome.tokenId,
      name: outcome.name,
      side: outcome.side,
      currentPrice: outcome.price,
      liquidity: normalized.liquidityUsd,
      volume: normalized.volumeUsd,
    });
    refs.push({
      tokenId: saved.tokenId,
      marketId: market.id,
      outcomeId: saved.id,
    });
  }

  return refs;
}

async function resolveTokenRefs(
  deps: DataLoaderDeps,
  start: Date,
  end: Date,
): Promise<{ refs: SnapshotTokenRef[]; source: "snapshots" | "database" | "gamma" }> {
  const { repositories, publicClient, logger, config } = deps;

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
    async loadBacktestDataset(start: Date, end: Date): Promise<BacktestDataset> {
      const { refs: tokenRefs, source } = await resolveTokenRefs(deps, start, end);
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
          continue;
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
