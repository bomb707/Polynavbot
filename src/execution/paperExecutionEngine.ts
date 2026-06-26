import type { IRepositories } from "../db/repositories/index.js";
import type { IPaperTradingEngine } from "../paper/paperTypes.js";
import type { IRiskEngine } from "../risk/riskTypes.js";
import {
  computeOrderSize,
  rejectedResult,
  runRiskCheck,
} from "./executionEngineHelpers.js";
import type {
  ExecutionOpenOrder,
  ExecutionOrderResult,
  IExecutionEngine,
  PlaceLimitOrderInput,
  SyncTradesResult,
} from "./executionEngineTypes.js";

export interface PaperExecutionEngineDeps {
  repositories: IRepositories;
  paperTradingEngine: IPaperTradingEngine;
  riskEngine: IRiskEngine;
}

function toNumber(value: { toNumber(): number } | number): number {
  return typeof value === "number" ? value : value.toNumber();
}

export function createPaperExecutionEngine(
  deps: PaperExecutionEngineDeps,
): IExecutionEngine {
  const { repositories, paperTradingEngine, riskEngine } = deps;

  async function placeLimitOrder(
    input: PlaceLimitOrderInput,
    side: "BUY" | "SELL",
  ): Promise<ExecutionOrderResult> {
    const risk = await runRiskCheck(riskEngine, input, side);
    if (!risk.allowed) {
      return rejectedResult(risk.reason);
    }

    const { sizeShares, notionalUsd } = computeOrderSize(risk.sizeUsd, input.limitPrice);

    const { order, rejectedReason } = await paperTradingEngine.placeLimitOrder({
      marketId: input.marketId,
      outcomeId: input.outcomeId,
      tokenId: input.tokenId,
      side,
      limitPrice: input.limitPrice,
      sizeUsd: risk.sizeUsd,
      signalId: input.signalId,
      skipRiskCheck: true,
      riskContext: {
        spread: input.spread,
        liquidityUsd: input.liquidityUsd,
        dataUpdatedAt: input.dataUpdatedAt,
        isNewEntry: input.isNewEntry,
      },
    });

    if (rejectedReason || !order || order.status === "FAILED") {
      return rejectedResult(rejectedReason ?? "Order creation failed");
    }

    return {
      orderId: order.id,
      status: "placed",
      sizeShares,
      notionalUsd,
    };
  }

  return {
    async initialize() {
      await paperTradingEngine.initialize();
    },

    placeBuyLimitOrder(input) {
      return placeLimitOrder(input, "BUY");
    },

    placeSellLimitOrder(input) {
      return placeLimitOrder(input, "SELL");
    },

    async cancelOrder(orderId) {
      const order = await repositories.order.findPaperById(orderId);
      if (!order) {
        return { canceled: false, reason: "Paper order not found" };
      }

      await repositories.order.updatePaperStatus(orderId, "CANCELLED");
      return { canceled: true };
    },

    async getOpenOrders(tokenId?: string) {
      const orders = await repositories.order.findPendingPaperOrders();
      return orders
        .filter((order) => !tokenId || order.tokenId === tokenId)
        .map(
          (order): ExecutionOpenOrder => ({
            orderId: order.id,
            tokenId: order.tokenId,
            marketId: order.marketId,
            side: order.side,
            price: toNumber(order.price),
            originalSize: toNumber(order.size),
            sizeMatched: 0,
            status: order.status,
            createdAt: order.createdAt,
          }),
        );
    },

    async syncTrades(): Promise<SyncTradesResult> {
      return { tradesSynced: 0, ordersUpdated: 0 };
    },
  };
}
