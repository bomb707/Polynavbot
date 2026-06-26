import type { OrderSide, OrderStatus, PaperOrder, Position } from "@prisma/client";

import type { OrderBook } from "../polymarket/publicTypes.js";
import type { ScanSummary } from "../scanner/types.js";

export interface OrderRiskContext {
  spread?: number | null;
  liquidityUsd?: number | null;
  dataUpdatedAt?: Date | null;
  isNewEntry: boolean;
}

export interface PlacePaperLimitOrderInput {
  marketId: string;
  outcomeId: string;
  tokenId: string;
  side: OrderSide;
  limitPrice: number;
  sizeUsd: number;
  signalId?: string | null;
  riskContext?: OrderRiskContext;
}

export interface PaperFillContext {
  orderBook: OrderBook;
  previousBestBid?: number | null;
  previousBestAsk?: number | null;
}

export interface PaperOrderResult {
  order?: PaperOrder;
  rejectedReason?: string;
}

export interface FillSimulationResult {
  filled: boolean;
  fillSize: number;
  fillPrice: number;
  tradeId?: string;
  position?: Position;
  orderStatus: OrderStatus;
}

export interface PortfolioSummary {
  cashBalanceUsd: number;
  openPositions: Position[];
  totalRealizedPnlUsd: number;
  totalUnrealizedPnlUsd: number;
}

export interface PaperRunSummary {
  scan: ScanSummary;
  signalsCreated: number;
  entryCandidates: number;
  ordersPlaced: number;
  ordersFilled: number;
  ordersRejected: number;
  ordersPending: number;
  portfolio: PortfolioSummary;
}

export interface IPaperTradingEngine {
  initialize(): Promise<void>;
  getCashBalance(): number;
  placeLimitOrder(input: PlacePaperLimitOrderInput): Promise<PaperOrderResult>;
  simulateFill(
    order: PaperOrder,
    ctx: PaperFillContext,
  ): Promise<FillSimulationResult>;
  tryFillPendingOrders(
    booksByTokenId: Map<string, OrderBook>,
    previousQuotes?: Map<string, { bestBid: number | null; bestAsk: number | null }>,
  ): Promise<FillSimulationResult[]>;
  markToMarket(tokenId: string, currentPrice: number): Promise<Position | null>;
  markAllOpenPositions(
    pricesByTokenId: Map<string, number>,
  ): Promise<Position[]>;
  getPortfolioSummary(): Promise<PortfolioSummary>;
}
