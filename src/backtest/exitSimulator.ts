import type { Config } from "../config/index.js";
import type { PositionExitState } from "../db/repositories/position.repository.js";
import { createExitEngine } from "../execution/exitEngine.js";
import type { ExitEvaluation } from "../execution/exitTypes.js";
import { computePassiveSellPrice } from "../execution/passiveBid.js";
import { createFeeService } from "../fees/index.js";
import { isExitLiquiditySufficient } from "./fillSimulator.js";
import { updateExitState } from "./portfolio.js";
import { buildSyntheticOrderBook } from "./syntheticOrderBook.js";
import type { BacktestConfig, BacktestMarketMeta, BacktestOrder, BacktestPosition, PriceBar } from "./backtestTypes.js";
import { resolveHistoricalMarketFlags } from "./marketState.js";
import { nextOrderId } from "./portfolio.js";

function createStubExitEngine(config: Config) {
  return createExitEngine({
    config,
    repositories: {} as never,
    publicClient: {} as never,
    executionEngine: {} as never,
    paperTradingEngine: {} as never,
    riskEngine: {} as never,
    feeService: createFeeService(config),
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as never,
  });
}

export interface ExitPlacement {
  evaluation: ExitEvaluation;
  order: BacktestOrder | null;
  deferred: boolean;
}

export function evaluateExitForBar(
  config: Config,
  backtestConfig: BacktestConfig,
  meta: BacktestMarketMeta,
  position: BacktestPosition,
  bar: PriceBar,
  riskForced = false,
): ExitPlacement {
  const exitEngine = createStubExitEngine(config);
  const orderBook = buildSyntheticOrderBook(bar, backtestConfig);
  const currentPrice = bar.price;
  const exitState = updateExitState(position.exitState, currentPrice, position.avgEntryPrice);
  const historicalFlags = resolveHistoricalMarketFlags(meta, bar.timestamp);

  const evaluation = exitEngine.evaluateExit({
    position: {
      id: position.tokenId,
      marketId: position.marketId,
      outcomeId: position.outcomeId,
      tokenId: position.tokenId,
      side: "BUY",
      avgEntryPrice: position.avgEntryPrice,
      currentPrice,
      size: position.sizeShares,
      costBasisUsd: position.costBasisUsd,
      currentValueUsd: currentPrice * position.sizeShares,
      realizedPnlUsd: 0,
      unrealizedPnlUsd: currentPrice * position.sizeShares - position.costBasisUsd,
      exitState,
      status: "OPEN",
      openedAt: position.openedAt,
      closedAt: null,
      updatedAt: bar.timestamp,
    } as never,
    exitState,
    currentPrice,
    orderBook,
    market: {
      active: historicalFlags.active,
      closed: historicalFlags.closed,
      endDate: meta.endDate,
    },
    liquidityUsd: bar.liquidity ?? meta.liquidityUsd,
    riskForced,
    outcomeSide: meta.outcomeSide,
  });

  position.exitState = evaluation.nextExitState as PositionExitState;

  if (evaluation.action === "hold") {
    return { evaluation, order: null, deferred: false };
  }

  if (!isExitLiquiditySufficient(bar, backtestConfig)) {
    return { evaluation, order: null, deferred: true };
  }

  const sellPriceResult = computePassiveSellPrice(orderBook);
  const sellPrice =
    "sellPrice" in sellPriceResult ? sellPriceResult.sellPrice : evaluation.sellPrice;

  const order: BacktestOrder = {
    id: nextOrderId(),
    tokenId: position.tokenId,
    marketId: position.marketId,
    outcomeId: position.outcomeId,
    side: "SELL",
    limitPrice: sellPrice,
    sizeShares: evaluation.sellSizeShares,
    filledShares: 0,
    createdAt: bar.timestamp,
    reason: evaluation.reason,
  };

  return { evaluation, order, deferred: false };
}
