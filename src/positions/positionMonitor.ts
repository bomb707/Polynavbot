import type { Position } from "@prisma/client";

import type { Config } from "../config/index.js";
import { isPaperMode } from "../config/index.js";
import type { IRepositories } from "../db/repositories/index.js";
import { toNumber } from "../execution/entryHelpers.js";
import type { IExitEngine, ExitPaperSummary } from "../execution/exitTypes.js";
import type { ILogger } from "../logger/types.js";
import { midPrice, orderBookLiquidity } from "../polymarket/orderBookPricing.js";
import type { IPublicClient } from "../polymarket/publicClient.js";
import type { IPaperTradingEngine } from "../paper/paperTypes.js";
import type {
  ExitEligiblePosition,
  IPositionMonitor,
  PositionHighlight,
  PositionMonitorRunOptions,
  PositionMonitorSummary,
} from "./positionMonitorTypes.js";

const emptyExitResult: ExitPaperSummary = {
  positionsEvaluated: 0,
  holds: 0,
  exitsPlaced: 0,
  exitsFilled: 0,
  totalRealizedPnlUsd: 0,
  actions: [],
};

export interface PositionMonitorDeps {
  config: Config;
  repositories: IRepositories;
  publicClient: IPublicClient;
  paperTradingEngine: IPaperTradingEngine;
  exitEngine: IExitEngine;
  logger: ILogger;
}

function round8(value: number): number {
  return Math.round(value * 1e8) / 1e8;
}

function toHighlight(position: Position): PositionHighlight {
  return {
    tokenId: position.tokenId,
    marketId: position.marketId,
    unrealizedPnlUsd: toNumber(position.unrealizedPnlUsd) ?? 0,
    currentPrice: toNumber(position.currentPrice) ?? toNumber(position.avgEntryPrice) ?? 0,
  };
}

function pickBestPosition(positions: Position[]): PositionHighlight | null {
  if (positions.length === 0) {
    return null;
  }
  const best = positions.reduce((a, b) => {
    const aPnl = toNumber(a.unrealizedPnlUsd) ?? 0;
    const bPnl = toNumber(b.unrealizedPnlUsd) ?? 0;
    return bPnl > aPnl ? b : a;
  });
  return toHighlight(best);
}

function pickWorstPosition(positions: Position[]): PositionHighlight | null {
  if (positions.length === 0) {
    return null;
  }
  const worst = positions.reduce((a, b) => {
    const aPnl = toNumber(a.unrealizedPnlUsd) ?? 0;
    const bPnl = toNumber(b.unrealizedPnlUsd) ?? 0;
    return bPnl < aPnl ? b : a;
  });
  return toHighlight(worst);
}

export function createPositionMonitor(deps: PositionMonitorDeps): IPositionMonitor {
  const { config, repositories, publicClient, paperTradingEngine, exitEngine, logger } = deps;

  return {
    async run(options?: PositionMonitorRunOptions): Promise<PositionMonitorSummary> {
      const runExits = options?.runExits ?? true;
      if (!isPaperMode(config)) {
        throw new Error("positions:update requires TRADING_MODE=paper");
      }

      await paperTradingEngine.initialize();

      const positions = await repositories.position.findOpen();
      let positionsUpdated = 0;
      let positionsSkipped = 0;
      let snapshotsSaved = 0;

      for (const position of positions) {
        const orderBook = await publicClient.getOrderBook(position.tokenId);
        if (!orderBook) {
          logger.warn({ tokenId: position.tokenId }, "Order book unavailable, skipping position update");
          positionsSkipped += 1;
          continue;
        }

        const currentPrice =
          midPrice(orderBook) ??
          toNumber(position.currentPrice) ??
          toNumber(position.avgEntryPrice) ??
          0;

        await paperTradingEngine.markToMarket(position.tokenId, currentPrice);
        positionsUpdated += 1;

        await repositories.snapshot.create({
          marketId: position.marketId,
          outcomeId: position.outcomeId,
          tokenId: position.tokenId,
          price: currentPrice,
          bestBid: orderBook.bestBid ?? null,
          bestAsk: orderBook.bestAsk ?? null,
          spread: orderBook.spread ?? null,
          liquidity: orderBookLiquidity(orderBook),
          volume: null,
        });
        snapshotsSaved += 1;
      }

      const exitResult = runExits ? await exitEngine.run() : emptyExitResult;
      const portfolio = await paperTradingEngine.getPortfolioSummary();

      const openExposureUsd = round8(
        portfolio.openPositions.reduce(
          (sum, position) => sum + (toNumber(position.costBasisUsd) ?? 0),
          0,
        ),
      );

      const positionsValueUsd = portfolio.openPositions.reduce((sum, position) => {
        const value =
          toNumber(position.currentValueUsd) ?? toNumber(position.costBasisUsd) ?? 0;
        return sum + value;
      }, 0);

      const portfolioValueUsd = round8(portfolio.cashBalanceUsd + positionsValueUsd);
      const totalPnlUsd = round8(
        portfolio.totalRealizedPnlUsd + portfolio.totalUnrealizedPnlUsd,
      );

      const exitEligible: ExitEligiblePosition[] = exitResult.actions
        .filter((action) => action.action !== "hold")
        .map((action) => ({
          tokenId: action.tokenId,
          question: action.question,
          action: action.action,
          reason: action.reason,
          sellSizeShares: action.sellSizeShares,
          sellPrice: action.sellPrice,
        }));

      return {
        positionsLoaded: positions.length,
        positionsUpdated,
        positionsSkipped,
        snapshotsSaved,
        startingBalanceUsd: config.PAPER_STARTING_BALANCE_USD,
        cashBalanceUsd: portfolio.cashBalanceUsd,
        openExposureUsd,
        portfolioValueUsd,
        totalRealizedPnlUsd: portfolio.totalRealizedPnlUsd,
        totalUnrealizedPnlUsd: portfolio.totalUnrealizedPnlUsd,
        totalPnlUsd,
        bestPosition: pickBestPosition(portfolio.openPositions),
        worstPosition: pickWorstPosition(portfolio.openPositions),
        exitEligible,
        exitResult,
      };
    },
  };
}
