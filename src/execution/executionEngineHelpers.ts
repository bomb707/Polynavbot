import type { OrderSide } from "@prisma/client";

import type { IRiskEngine } from "../risk/riskTypes.js";
import type { ExecutionOrderResult, PlaceLimitOrderInput } from "./executionEngineTypes.js";

function round8(value: number): number {
  return Math.round(value * 1e8) / 1e8;
}

export async function runRiskCheck(
  riskEngine: IRiskEngine,
  input: PlaceLimitOrderInput,
  side: OrderSide,
): Promise<{ allowed: true; sizeUsd: number } | { allowed: false; reason: string }> {
  const riskResult = await riskEngine.checkOrder({
    marketId: input.marketId,
    outcomeId: input.outcomeId,
    tokenId: input.tokenId,
    side,
    limitPrice: input.limitPrice,
    sizeUsd: input.sizeUsd,
    isNewEntry: input.isNewEntry,
    spread: input.spread,
    liquidityUsd: input.liquidityUsd,
    dataUpdatedAt: input.dataUpdatedAt,
  });

  if (!riskResult.allowed) {
    return { allowed: false, reason: riskResult.reason };
  }

  return {
    allowed: true,
    sizeUsd: riskResult.adjustedSizeUsd ?? input.sizeUsd,
  };
}

export function rejectedResult(reason: string): ExecutionOrderResult {
  return {
    orderId: null,
    status: "rejected",
    rejectedReason: reason,
  };
}

export function computeOrderSize(sizeUsd: number, limitPrice: number): {
  sizeShares: number;
  notionalUsd: number;
} {
  const notionalUsd = round8(sizeUsd);
  const sizeShares = round8(sizeUsd / limitPrice);
  return { sizeShares, notionalUsd };
}
