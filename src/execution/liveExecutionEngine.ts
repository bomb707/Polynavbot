import type { OrderStatus, Prisma } from "@prisma/client";

import type { Config } from "../config/index.js";
import type { IRepositories } from "../db/repositories/index.js";
import type { ILogger } from "../logger/types.js";
import type { IClobClient } from "../polymarket/clobTypes.js";
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

export interface LiveExecutionEngineDeps {
  config: Config;
  repositories: IRepositories;
  clobClient: IClobClient;
  riskEngine: IRiskEngine;
  logger: ILogger;
}

function toNumber(value: { toNumber(): number } | number): number {
  return typeof value === "number" ? value : value.toNumber();
}

function round8(value: number): number {
  return Math.round(value * 1e8) / 1e8;
}

function mapClobStatusToOrderStatus(
  clobStatus: string,
  sizeMatched: number,
  originalSize: number,
): OrderStatus {
  const normalized = clobStatus.toUpperCase();
  if (normalized.includes("FILLED") && sizeMatched >= originalSize) {
    return "FILLED";
  }
  if (sizeMatched > 0) {
    return "PARTIALLY_FILLED";
  }
  if (normalized.includes("CANCEL")) {
    return "CANCELLED";
  }
  if (normalized.includes("FAIL")) {
    return "FAILED";
  }
  return "OPEN";
}

export function createLiveExecutionEngine(
  deps: LiveExecutionEngineDeps,
): IExecutionEngine {
  const { repositories, clobClient, riskEngine, logger } = deps;
  const syncedTradeIds = new Set<string>();

  async function placeLimitOrder(
    input: PlaceLimitOrderInput,
    side: "BUY" | "SELL",
  ): Promise<ExecutionOrderResult> {
    const risk = await runRiskCheck(riskEngine, input, side);
    if (!risk.allowed) {
      return rejectedResult(risk.reason);
    }

    const { sizeShares, notionalUsd } = computeOrderSize(risk.sizeUsd, input.limitPrice);
    if (sizeShares <= 0) {
      return rejectedResult("Computed order size is zero");
    }

    const clobParams = {
      tokenId: input.tokenId,
      price: input.limitPrice,
      size: sizeShares,
    };

    const placement =
      side === "BUY"
        ? await clobClient.createLimitBuyOrder(clobParams)
        : await clobClient.createLimitSellOrder(clobParams);

    const liveOrder = await repositories.order.createLiveOrder({
      externalOrderId: placement.orderId,
      marketId: input.marketId,
      outcomeId: input.outcomeId,
      tokenId: input.tokenId,
      side,
      price: input.limitPrice,
      size: sizeShares,
      notionalUsd,
      status: placement.success ? "OPEN" : "FAILED",
      rawResponse: placement as unknown as Prisma.InputJsonValue,
    });

    if (!placement.success) {
      return {
        orderId: liveOrder.id,
        externalOrderId: placement.orderId,
        status: "rejected",
        rejectedReason: placement.errorMessage ?? "Live order rejected",
      };
    }

    return {
      orderId: liveOrder.id,
      externalOrderId: placement.orderId,
      status: "placed",
      sizeShares,
      notionalUsd,
    };
  }

  return {
    async initialize() {
      await clobClient.initialize();
    },

    placeBuyLimitOrder(input) {
      return placeLimitOrder(input, "BUY");
    },

    placeSellLimitOrder(input) {
      return placeLimitOrder(input, "SELL");
    },

    async cancelOrder(orderId): Promise<CancelOrderResult> {
      const order =
        (await repositories.order.findLiveById(orderId)) ??
        (await repositories.order.findLiveByExternalId(orderId));

      if (!order?.externalOrderId) {
        return { canceled: false, reason: "Live order not found" };
      }

      const result = await clobClient.cancelOrder(order.externalOrderId);
      const canceled = result.canceled.includes(order.externalOrderId);
      if (canceled) {
        await repositories.order.updateLiveStatus(order.id, "CANCELLED");
      }

      return {
        canceled,
        reason: canceled
          ? undefined
          : result.notCanceled[order.externalOrderId] ?? "Cancel rejected by CLOB",
      };
    },

    async getOpenOrders(tokenId?: string) {
      const orders = await clobClient.getOpenOrders(
        tokenId ? { assetId: tokenId } : undefined,
      );

      return orders.map(
        (order): ExecutionOpenOrder => ({
          orderId: order.orderId,
          externalOrderId: order.orderId,
          tokenId: order.tokenId,
          marketId: order.market,
          side: order.side === "SELL" ? "SELL" : "BUY",
          price: order.price,
          originalSize: order.originalSize,
          sizeMatched: order.sizeMatched,
          status: order.status,
          createdAt: order.createdAt,
        }),
      );
    },

    async syncTrades(): Promise<SyncTradesResult> {
      const trades = await clobClient.getTrades();
      let tradesSynced = 0;
      let ordersUpdated = 0;

      for (const trade of trades) {
        if (syncedTradeIds.has(trade.tradeId)) {
          continue;
        }

        const liveOrder =
          (trade.tradeId
            ? await repositories.order.findLiveByExternalId(trade.tradeId)
            : null) ??
          (await repositories.order.findPendingLiveOrders()).find(
            (order) =>
              order.tokenId === trade.tokenId &&
              order.side === trade.side &&
              order.externalOrderId != null,
          );

        if (!liveOrder) {
          continue;
        }

        await repositories.trade.create({
          orderId: liveOrder.id,
          orderType: "LIVE",
          marketId: liveOrder.marketId,
          outcomeId: liveOrder.outcomeId,
          tokenId: liveOrder.tokenId,
          side: trade.side === "SELL" ? "SELL" : "BUY",
          price: trade.price,
          size: trade.size,
          notionalUsd: round8(trade.price * trade.size),
          source: "LIVE",
          timestamp: trade.matchTime ?? new Date(),
        });

        syncedTradeIds.add(trade.tradeId);
        tradesSynced += 1;

        const orderStatus = mapClobStatusToOrderStatus(
          trade.status,
          trade.size,
          toNumber(liveOrder.size),
        );
        await repositories.order.updateLiveStatus(liveOrder.id, orderStatus);
        ordersUpdated += 1;
      }

      logger.info({ tradesSynced, ordersUpdated }, "Synced live CLOB trades");
      return { tradesSynced, ordersUpdated };
    },
  };
}
