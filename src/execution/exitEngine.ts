import type { PaperOrder, Position } from "@prisma/client";

import type { Config } from "../config/index.js";
import { isLiveMode, isPaperMode } from "../config/index.js";
import type { IRepositories } from "../db/repositories/index.js";
import type { PositionExitState } from "../db/repositories/position.repository.js";
import type { ILogger } from "../logger/types.js";
import { midPrice } from "../polymarket/orderBookPricing.js";
import type { IPublicClient } from "../polymarket/publicClient.js";
import type { OrderBook } from "../polymarket/publicTypes.js";
import type { IPaperTradingEngine } from "../paper/paperTypes.js";
import type { IRiskEngine } from "../risk/riskTypes.js";
import { roundDownShares, toNumber } from "./entryHelpers.js";
import type { IExecutionEngine } from "./executionEngineTypes.js";
import type {
  ExitActionRecord,
  ExitEvaluation,
  ExitEvaluationInput,
  IExitEngine,
} from "./exitTypes.js";
import { computePassiveSellPrice } from "./passiveBid.js";

export interface ExitEngineDeps {
  config: Config;
  repositories: IRepositories;
  publicClient: IPublicClient;
  executionEngine: IExecutionEngine;
  paperTradingEngine: IPaperTradingEngine;
  riskEngine: IRiskEngine;
  logger: ILogger;
}

function toNum(value: { toNumber(): number } | number): number {
  return typeof value === "number" ? value : value.toNumber();
}

function round8(value: number): number {
  return Math.round(value * 1e8) / 1e8;
}

function parseExitState(raw: unknown): PositionExitState | null {
  if (raw == null || typeof raw !== "object") {
    return null;
  }
  const state = raw as Partial<PositionExitState>;
  if (typeof state.originalSize !== "number") {
    return null;
  }
  return {
    originalSize: state.originalSize,
    soldAt5x: state.soldAt5x ?? false,
    soldAt10x: state.soldAt10x ?? false,
    soldAt25x: state.soldAt25x ?? false,
    hasReached5x: state.hasReached5x ?? false,
    recentHighPrice: state.recentHighPrice ?? 0,
  };
}

function bumpExitState(
  exitState: PositionExitState,
  currentPrice: number,
  avgEntry: number,
): PositionExitState {
  const hasReached5x = exitState.hasReached5x || currentPrice >= avgEntry * 5;
  return {
    ...exitState,
    hasReached5x,
    recentHighPrice: Math.max(exitState.recentHighPrice, currentPrice),
  };
}

function holdEvaluation(
  exitState: PositionExitState,
  sellPrice: number,
): ExitEvaluation {
  return {
    action: "hold",
    sellSizeShares: 0,
    sellPrice,
    reason: "moonbag_hold",
    message: "No exit rule triggered",
    nextExitState: exitState,
  };
}

export function createExitEngine(deps: ExitEngineDeps): IExitEngine {
  const {
    config,
    repositories,
    publicClient,
    executionEngine,
    paperTradingEngine,
    logger,
  } = deps;

  async function resolveExitState(
    position: Position,
    currentPrice: number,
  ): Promise<PositionExitState> {
    const parsed = parseExitState(position.exitState);
    const avgEntry = toNum(position.avgEntryPrice);
    if (parsed) {
      return bumpExitState(parsed, currentPrice, avgEntry);
    }

    const trades = await repositories.trade.findByTokenId(position.tokenId);
    const soldSize = trades
      .filter((trade) => trade.side === "SELL")
      .reduce((sum, trade) => sum + toNum(trade.size), 0);
    const currentSize = toNum(position.size);

    return {
      originalSize: round8(currentSize + soldSize),
      soldAt5x: false,
      soldAt10x: false,
      soldAt25x: false,
      hasReached5x: currentPrice >= avgEntry * 5,
      recentHighPrice: currentPrice,
    };
  }

  function evaluateExit(input: ExitEvaluationInput): ExitEvaluation {
    const { position, market, liquidityUsd, riskForced } = input;
    let exitState = bumpExitState(
      input.exitState,
      input.currentPrice,
      toNum(position.avgEntryPrice),
    );

    const avgEntry = toNum(position.avgEntryPrice);
    const currentPrice = input.currentPrice;
    const positionSize = toNum(position.size);
    const sellPriceResult = computePassiveSellPrice(input.orderBook);
    const sellPrice =
      "sellPrice" in sellPriceResult ? sellPriceResult.sellPrice : currentPrice;

    if (positionSize <= 0) {
      return holdEvaluation(exitState, sellPrice);
    }

    const sellAll = (reason: ExitEvaluation["reason"], message: string): ExitEvaluation => ({
      action: "sell_all",
      sellSizeShares: roundDownShares(positionSize),
      sellPrice,
      reason,
      message,
      nextExitState: exitState,
    });

    if (riskForced) {
      return sellAll("risk_forced", "Risk engine forced exit");
    }

    if (!market.active || market.closed) {
      return sellAll("resolution_risk", "Market is inactive or closed");
    }

    if (liquidityUsd != null && liquidityUsd < config.EXIT_MIN_LIQUIDITY_USD) {
      return sellAll("low_liquidity", "Liquidity below exit threshold");
    }

    if (market.endDate) {
      const hoursToExpiry =
        (market.endDate.getTime() - Date.now()) / (1000 * 60 * 60);
      if (
        hoursToExpiry <= config.EXIT_NEAR_EXPIRY_HOURS &&
        hoursToExpiry >= 0 &&
        currentPrice > avgEntry
      ) {
        return sellAll("near_expiry", "Market near expiry with profitable position");
      }
    }

    if (
      exitState.hasReached5x &&
      currentPrice < exitState.recentHighPrice * (1 - config.EXIT_TRAILING_STOP_PCT)
    ) {
      return sellAll(
        "trailing_stop",
        `Price fell ${(config.EXIT_TRAILING_STOP_PCT * 100).toFixed(0)}% from recent high`,
      );
    }

    const milestoneChecks: Array<{
      multiplier: number;
      fraction: number;
      flag: keyof Pick<PositionExitState, "soldAt5x" | "soldAt10x" | "soldAt25x">;
      reason: ExitEvaluation["reason"];
      label: string;
    }> = [
      { multiplier: 5, fraction: 0.3, flag: "soldAt5x", reason: "milestone_5x", label: "5x" },
      { multiplier: 10, fraction: 0.3, flag: "soldAt10x", reason: "milestone_10x", label: "10x" },
      { multiplier: 25, fraction: 0.2, flag: "soldAt25x", reason: "milestone_25x", label: "25x" },
    ];

    for (const milestone of milestoneChecks) {
      if (exitState[milestone.flag]) {
        continue;
      }
      if (currentPrice < avgEntry * milestone.multiplier) {
        continue;
      }

      const targetSize = roundDownShares(exitState.originalSize * milestone.fraction);
      const sellSizeShares = roundDownShares(Math.min(targetSize, positionSize));
      if (sellSizeShares <= 0) {
        continue;
      }

      exitState = { ...exitState, [milestone.flag]: true };

      return {
        action: "sell_partial",
        sellSizeShares,
        sellPrice,
        reason: milestone.reason,
        message: `Partial exit at ${milestone.label} milestone`,
        nextExitState: exitState,
      };
    }

    return holdEvaluation(exitState, sellPrice);
  }

  async function executeSellOrder(
    position: Position,
    sellSizeShares: number,
    sellPrice: number,
    orderBook: OrderBook,
    liquidityUsd: number | null,
  ): Promise<{
    order?: PaperOrder;
    filled: boolean;
    realizedPnlUsd: number;
    rejectedReason?: string;
  }> {
    const sizeUsd = round8(sellSizeShares * sellPrice);
    const avgEntry = toNum(position.avgEntryPrice);

    const orderResult = await executionEngine.placeSellLimitOrder({
      marketId: position.marketId,
      outcomeId: position.outcomeId,
      tokenId: position.tokenId,
      limitPrice: sellPrice,
      sizeUsd,
      isNewEntry: false,
      spread: orderBook.spread,
      liquidityUsd,
      dataUpdatedAt: new Date(),
    });

    if (orderResult.status === "rejected") {
      return {
        filled: false,
        realizedPnlUsd: 0,
        rejectedReason: orderResult.rejectedReason ?? "Order rejected",
      };
    }

    if (orderResult.status === "logged") {
      return { filled: false, realizedPnlUsd: 0 };
    }

    if (isPaperMode(config) && orderResult.orderId) {
      const order = await repositories.order.findPaperById(orderResult.orderId);
      if (!order) {
        return { filled: false, realizedPnlUsd: 0, rejectedReason: "Paper order not found" };
      }

      const fillResult = await paperTradingEngine.simulateFill(order, { orderBook });
      const realizedPnlUsd = fillResult.filled
        ? round8((fillResult.fillPrice - avgEntry) * fillResult.fillSize)
        : 0;

      return { order, filled: fillResult.filled, realizedPnlUsd };
    }

    return { filled: false, realizedPnlUsd: 0 };
  }

  async function updatePositionAfterExit(
    positionId: string,
    exitState: PositionExitState,
  ): Promise<void> {
    await repositories.position.updateExitState(positionId, exitState);
  }

  async function previewPositionExit(position: Position): Promise<ExitActionRecord | null> {
    const market = await repositories.market.findById(position.marketId);
    const outcome = await repositories.outcome.findByTokenId(position.tokenId);
    if (!market || !outcome) {
      return null;
    }

    const orderBook = await publicClient.getOrderBook(position.tokenId);
    if (!orderBook) {
      return null;
    }

    const currentPrice =
      midPrice(orderBook) ??
      orderBook.bestBid ??
      orderBook.bestAsk ??
      toNumber(position.currentPrice) ??
      toNum(position.avgEntryPrice);

    const exitState = await resolveExitState(position, currentPrice);
    const liquidityUsd = toNumber(outcome.liquidity);

    const todayPnl = await repositories.position.sumRealizedPnlSince(
      new Date(Date.now() - 24 * 60 * 60 * 1000),
    );
    const riskForced = todayPnl < -config.MAX_DAILY_LOSS_USD;

    const evaluation = evaluateExit({
      position,
      exitState,
      currentPrice,
      orderBook,
      market,
      liquidityUsd,
      riskForced,
    });

    if (evaluation.action === "hold") {
      return null;
    }

    return {
      tokenId: position.tokenId,
      question: market.question,
      action: evaluation.action,
      reason: evaluation.reason,
      sellSizeShares: evaluation.sellSizeShares,
      sellPrice: evaluation.sellPrice,
      filled: false,
    };
  }

  async function evaluatePositionExit(position: Position): Promise<ExitActionRecord | null> {
    const market = await repositories.market.findById(position.marketId);
    const outcome = await repositories.outcome.findByTokenId(position.tokenId);
    if (!market || !outcome) {
      return null;
    }

    const orderBook = await publicClient.getOrderBook(position.tokenId);
    if (!orderBook) {
      return null;
    }

    const sellPriceResult = computePassiveSellPrice(orderBook);
    const currentPrice =
      midPrice(orderBook) ??
      orderBook.bestBid ??
      orderBook.bestAsk ??
      toNumber(position.currentPrice) ??
      toNum(position.avgEntryPrice);

    if (isPaperMode(config)) {
      await paperTradingEngine.markToMarket(position.tokenId, currentPrice);
    }

    const exitState = await resolveExitState(position, currentPrice);
    const liquidityUsd = toNumber(outcome.liquidity);

    const todayPnl = await repositories.position.sumRealizedPnlSince(
      new Date(Date.now() - 24 * 60 * 60 * 1000),
    );
    const riskForced = todayPnl < -config.MAX_DAILY_LOSS_USD;

    const evaluation = evaluateExit({
      position,
      exitState,
      currentPrice,
      orderBook,
      market,
      liquidityUsd,
      riskForced,
    });

    if (evaluation.action === "hold") {
      await updatePositionAfterExit(position.id, evaluation.nextExitState);
      return {
        tokenId: position.tokenId,
        question: market.question,
        action: "hold",
        reason: evaluation.reason,
        sellSizeShares: 0,
        sellPrice: "sellPrice" in sellPriceResult ? sellPriceResult.sellPrice : currentPrice,
        filled: false,
      };
    }

    const sellResult = await executeSellOrder(
      position,
      evaluation.sellSizeShares,
      evaluation.sellPrice,
      orderBook,
      liquidityUsd,
    );

    await updatePositionAfterExit(position.id, evaluation.nextExitState);

    logger.info(
      {
        tokenId: position.tokenId,
        action: evaluation.action,
        reason: evaluation.reason,
        filled: sellResult.filled,
      },
      "Exit evaluated",
    );

    return {
      tokenId: position.tokenId,
      question: market.question,
      action: evaluation.action,
      reason: evaluation.reason,
      sellSizeShares: evaluation.sellSizeShares,
      sellPrice: evaluation.sellPrice,
      filled: sellResult.filled,
      realizedPnlUsd: sellResult.filled ? sellResult.realizedPnlUsd : undefined,
    };
  }

  return {
    evaluateExit,

    async runForToken(tokenId) {
      await executionEngine.initialize();

      if (isPaperMode(config)) {
        await paperTradingEngine.initialize();
      }

      const position = await repositories.position.findOpenByTokenId(tokenId);
      if (!position) {
        return null;
      }

      const action = await evaluatePositionExit(position);

      if (isLiveMode(config)) {
        await executionEngine.syncTrades();
      }

      return action;
    },

    async previewExits() {
      const positions = await repositories.position.findOpen();
      const pending: ExitActionRecord[] = [];

      for (const position of positions) {
        const action = await previewPositionExit(position);
        if (action) {
          pending.push(action);
        }
      }

      return pending;
    },

    async run() {
      await executionEngine.initialize();

      if (isPaperMode(config)) {
        await paperTradingEngine.initialize();
      }

      const positions = await repositories.position.findOpen();
      const actions: ExitActionRecord[] = [];
      let holds = 0;
      let exitsPlaced = 0;
      let exitsFilled = 0;
      let totalRealizedPnlUsd = 0;

      for (const position of positions) {
        const action = await evaluatePositionExit(position);
        if (!action) {
          holds += 1;
          continue;
        }

        actions.push(action);

        if (action.action === "hold") {
          holds += 1;
          continue;
        }

        exitsPlaced += 1;
        if (action.filled) {
          exitsFilled += 1;
          totalRealizedPnlUsd += action.realizedPnlUsd ?? 0;
        }
      }

      if (isLiveMode(config)) {
        await executionEngine.syncTrades();
      }

      return {
        positionsEvaluated: positions.length,
        holds,
        exitsPlaced,
        exitsFilled,
        totalRealizedPnlUsd: round8(totalRealizedPnlUsd),
        actions,
      };
    },
  };
}

// Export for tests
export { parseExitState, bumpExitState };
