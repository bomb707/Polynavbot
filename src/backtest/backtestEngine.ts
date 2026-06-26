import type { Config } from "../config/index.js";
import type { IRepositories } from "../db/repositories/index.js";
import type { ILogger } from "../logger/types.js";
import type { IPublicClient } from "../polymarket/publicClient.js";
import { createBacktestConfig } from "./backtestConfig.js";
import { buildTimeline, createDataLoader } from "./dataLoader.js";
import { buildPriceHistory, evaluateEntry } from "./entrySimulator.js";
import { evaluateExitForBar } from "./exitSimulator.js";
import { simulateConservativeFill } from "./fillSimulator.js";
import { computeMetrics } from "./metrics.js";
import {
  BacktestPortfolio,
  resetBacktestCounters,
} from "./portfolio.js";
import { createSeededRng } from "./rng.js";
import { conservativeBidPrice } from "./syntheticOrderBook.js";
import type {
  BacktestResult,
  BacktestRunOptions,
  BacktestTokenSeries,
  IBacktestEngine,
  PriceBar,
} from "./backtestTypes.js";

export interface BacktestEngineDeps {
  config: Config;
  repositories: IRepositories;
  publicClient: IPublicClient;
  logger: ILogger;
}

function seriesByToken(datasetSeries: BacktestTokenSeries[]): Map<string, BacktestTokenSeries> {
  const map = new Map<string, BacktestTokenSeries>();
  for (const series of datasetSeries) {
    map.set(series.meta.tokenId, series);
  }
  return map;
}

function barIndex(series: BacktestTokenSeries, timestamp: number): number {
  return series.bars.findIndex((bar) => bar.timestamp.getTime() === timestamp);
}

export function createBacktestEngine(deps: BacktestEngineDeps): IBacktestEngine {
  const { config, repositories, publicClient, logger } = deps;
  const backtestConfig = createBacktestConfig(config);

  const dataLoader = createDataLoader({
    repositories,
    publicClient,
    logger,
    config: backtestConfig,
  });

  return {
    async run(options: BacktestRunOptions): Promise<BacktestResult> {
      if (options.start >= options.end) {
        throw new Error("backtest start must be before end");
      }

      resetBacktestCounters();
      const rng = createSeededRng(backtestConfig.seed);
      const dataset = await dataLoader.loadBacktestDataset(options.start, options.end);
      const timeline = buildTimeline(dataset);
      const timestamps = [...timeline.keys()].sort((a, b) => a - b);
      const seriesMap = seriesByToken(dataset.series);

      const portfolio = new BacktestPortfolio(
        backtestConfig.startingCapitalUsd,
        backtestConfig.startingCapitalUsd,
      );

      for (const tokenSeries of dataset.series) {
        portfolio.marketCategories.set(tokenSeries.meta.marketId, tokenSeries.meta.category);
      }

      for (const ts of timestamps) {
        const bars = timeline.get(ts) ?? [];
        const timestamp = new Date(ts);
        portfolio.resetDailySpend(timestamp);

        const barsByToken = new Map<string, PriceBar>();
        for (const bar of bars) {
          barsByToken.set(bar.tokenId, bar);
        }

        portfolio.prunePendingOrders();

        for (const order of [...portfolio.pendingOrders]) {
          const bar = barsByToken.get(order.tokenId);
          if (!bar) {
            continue;
          }
          const fill = simulateConservativeFill(order, bar, backtestConfig, rng);
          if (!fill.filled) {
            continue;
          }
          const meta = seriesMap.get(order.tokenId)?.meta;
          const question = meta?.question ?? order.tokenId;
          const trade =
            order.side === "BUY"
              ? portfolio.applyBuyFill(order, fill.fillPrice, fill.fillSize, timestamp, question, order.reason ?? "fill")
              : portfolio.applySellFill(order, fill.fillPrice, fill.fillSize, timestamp, question, order.reason ?? "fill");
          portfolio.trades.push(trade);
        }

        portfolio.prunePendingOrders();

        for (const [tokenId, position] of [...portfolio.positions.entries()]) {
          const bar = barsByToken.get(tokenId);
          const tokenSeries = seriesMap.get(tokenId);
          if (!bar || !tokenSeries) {
            continue;
          }

          const exitPlacement = evaluateExitForBar(
            config,
            backtestConfig,
            tokenSeries.meta,
            position,
            bar,
          );

          if (exitPlacement.order) {
            portfolio.placeOrder(exitPlacement.order);
          }
        }

        for (const bar of bars) {
          const tokenSeries = seriesMap.get(bar.tokenId);
          if (!tokenSeries) {
            continue;
          }

          const idx = barIndex(tokenSeries, ts);
          const priceHistory = buildPriceHistory(tokenSeries.bars, idx);
          const entry = evaluateEntry(
            config,
            backtestConfig,
            portfolio,
            tokenSeries.meta,
            bar,
            priceHistory,
          );
          if (entry.placed && entry.order) {
            portfolio.placeOrder(entry.order);
          }
        }

        portfolio.recordEquity(timestamp, barsByToken, backtestConfig);
      }

      for (const [tokenId] of [...portfolio.positions.entries()]) {
        const tokenSeries = seriesMap.get(tokenId);
        if (!tokenSeries) {
          continue;
        }
        const lastBar = tokenSeries.bars[tokenSeries.bars.length - 1];
        if (!lastBar) {
          continue;
        }
        portfolio.closeRemainingAtBid(
          tokenId,
          lastBar,
          lastBar.timestamp,
          tokenSeries.meta.question,
          backtestConfig,
          "backtest_end_close",
        );
      }

      let openUnrealized = 0;
      for (const [tokenId, position] of portfolio.positions.entries()) {
        const tokenSeries = seriesMap.get(tokenId);
        const lastBar = tokenSeries?.bars[tokenSeries.bars.length - 1];
        if (!lastBar) {
          continue;
        }
        const bid = conservativeBidPrice(lastBar, backtestConfig);
        openUnrealized += bid * position.sizeShares - position.costBasisUsd;
      }

      const lastEquity = portfolio.equityCurve.at(-1)?.equityUsd ?? portfolio.cashUsd;
      const metrics = computeMetrics({
        startingCapitalUsd: backtestConfig.startingCapitalUsd,
        finalEquityUsd: lastEquity,
        trades: portfolio.trades,
        equityCurve: portfolio.equityCurve,
        openUnrealizedUsd: openUnrealized,
      });

      const tokensTraded = new Set(portfolio.trades.map((trade) => trade.tokenId)).size;

      return {
        start: options.start.toISOString(),
        end: options.end.toISOString(),
        config: backtestConfig,
        metrics,
        trades: portfolio.trades,
        equityCurve: portfolio.equityCurve,
        tokensTraded,
      };
    },
  };
}
