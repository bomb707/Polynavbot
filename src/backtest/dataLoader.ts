import type { IRepositories } from "../db/repositories/index.js";
import type { ILogger } from "../logger/types.js";
import type { IPublicClient } from "../polymarket/publicClient.js";
import { toNumber } from "../execution/entryHelpers.js";
import type { BacktestConfig, BacktestDataset, BacktestTokenSeries, PriceBar } from "./backtestTypes.js";

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

export function createDataLoader(deps: DataLoaderDeps) {
  const { repositories, publicClient, logger, config } = deps;

  return {
    async loadBacktestDataset(start: Date, end: Date): Promise<BacktestDataset> {
      const tokenRefs = await repositories.snapshot.findDistinctTokensInRange(start, end);
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

        if (bars.length === 0) {
          continue;
        }

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
            liquidityUsd: toNumber(outcome.liquidity),
            volumeUsd: toNumber(outcome.volume),
            outcomeName: outcome.name,
          },
          bars,
        });
      }

      logger.info(
        { tokenCount: series.length, start: start.toISOString(), end: end.toISOString() },
        "Backtest dataset loaded",
      );

      return { start, end, series };
    },
  };
}

export function buildTimeline(dataset: BacktestDataset): Map<number, PriceBar[]> {
  const timeline = new Map<number, PriceBar[]>();

  for (const tokenSeries of dataset.series) {
    for (const bar of tokenSeries.bars) {
      const key = bar.timestamp.getTime();
      const bucket = timeline.get(key) ?? [];
      bucket.push(bar);
      timeline.set(key, bucket);
    }
  }

  return timeline;
}
