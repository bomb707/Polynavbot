import type { OrderSide } from "@prisma/client";

export interface PlaceLimitOrderInput {
  marketId: string;
  outcomeId: string;
  tokenId: string;
  limitPrice: number;
  sizeUsd: number;
  signalId?: string | null;
  isNewEntry: boolean;
  spread?: number | null;
  liquidityUsd?: number | null;
  dataUpdatedAt?: Date | null;
}

export interface ExecutionOrderResult {
  orderId: string | null;
  externalOrderId?: string | null;
  status: "placed" | "rejected" | "logged";
  rejectedReason?: string;
  sizeShares?: number;
  notionalUsd?: number;
}

export interface ExecutionOpenOrder {
  orderId: string;
  externalOrderId?: string | null;
  tokenId: string;
  marketId: string;
  side: OrderSide;
  price: number;
  originalSize: number;
  sizeMatched: number;
  status: string;
  createdAt: Date;
}

export interface SyncTradesResult {
  tradesSynced: number;
  ordersUpdated: number;
}

export interface CancelOrderResult {
  canceled: boolean;
  reason?: string;
}

export interface IExecutionEngine {
  initialize(): Promise<void>;
  placeBuyLimitOrder(input: PlaceLimitOrderInput): Promise<ExecutionOrderResult>;
  placeSellLimitOrder(input: PlaceLimitOrderInput): Promise<ExecutionOrderResult>;
  cancelOrder(orderId: string): Promise<CancelOrderResult>;
  getOpenOrders(tokenId?: string): Promise<ExecutionOpenOrder[]>;
  syncTrades(): Promise<SyncTradesResult>;
}
