import type { ILogger } from "../logger/types.js";
import type { IRiskEngine } from "../risk/riskTypes.js";
import {
  computeOrderSize,
  rejectedResult,
  runRiskCheck,
} from "./executionEngineHelpers.js";
import type {
  CancelOrderResult,
  ExecutionOpenOrder,
  ExecutionOrderResult,
  IExecutionEngine,
  PlaceLimitOrderInput,
  SyncTradesResult,
} from "./executionEngineTypes.js";

export interface DryRunExecutionEngineDeps {
  riskEngine: IRiskEngine;
  logger: ILogger;
}

export function createDryRunExecutionEngine(
  deps: DryRunExecutionEngineDeps,
): IExecutionEngine {
  const { riskEngine, logger } = deps;

  async function logOrder(
    input: PlaceLimitOrderInput,
    side: "BUY" | "SELL",
  ): Promise<ExecutionOrderResult> {
    const risk = await runRiskCheck(riskEngine, input, side);
    if (!risk.allowed) {
      return rejectedResult(risk.reason);
    }

    const { sizeShares, notionalUsd } = computeOrderSize(risk.sizeUsd, input.limitPrice);

    logger.info(
      {
        side,
        tokenId: input.tokenId,
        marketId: input.marketId,
        limitPrice: input.limitPrice,
        sizeUsd: risk.sizeUsd,
        sizeShares,
        signalId: input.signalId,
      },
      "Dry run: would place limit order",
    );

    return {
      orderId: null,
      status: "logged",
      sizeShares,
      notionalUsd,
    };
  }

  return {
    async initialize() {
      return;
    },

    placeBuyLimitOrder(input) {
      return logOrder(input, "BUY");
    },

    placeSellLimitOrder(input) {
      return logOrder(input, "SELL");
    },

    async cancelOrder(_orderId): Promise<CancelOrderResult> {
      return { canceled: false, reason: "Dry run mode does not cancel orders" };
    },

    async getOpenOrders(_tokenId?: string): Promise<ExecutionOpenOrder[]> {
      return [];
    },

    async syncTrades(): Promise<SyncTradesResult> {
      return { tradesSynced: 0, ordersUpdated: 0 };
    },
  };
}
