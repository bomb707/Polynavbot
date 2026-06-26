import type { OrderSide } from "@prisma/client";

export interface OrderRiskCheckInput {
  marketId: string;
  outcomeId: string;
  tokenId: string;
  side: OrderSide;
  limitPrice: number;
  sizeUsd: number;
  isNewEntry: boolean;
  spread?: number | null;
  liquidityUsd?: number | null;
  dataUpdatedAt?: Date | null;
}

export interface RiskCheckResult {
  allowed: boolean;
  reason: string;
  adjustedSizeUsd?: number;
}

export interface IRiskEngine {
  checkOrder(input: OrderRiskCheckInput): Promise<RiskCheckResult>;
}
