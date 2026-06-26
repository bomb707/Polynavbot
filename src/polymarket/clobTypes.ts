export type LimitOrderType = "GTC" | "GTD";

export interface LimitOrderParams {
  tokenId: string;
  price: number;
  size: number;
  tickSize?: string;
  negRisk?: boolean;
  orderType?: LimitOrderType;
}

export interface OpenOrderQuery {
  id?: string;
  market?: string;
  assetId?: string;
}

export interface TradeQuery {
  id?: string;
  makerAddress?: string;
  market?: string;
  assetId?: string;
  before?: string;
  after?: string;
}

export interface NormalizedOpenOrder {
  orderId: string;
  status: string;
  tokenId: string;
  market: string;
  side: string;
  price: number;
  originalSize: number;
  sizeMatched: number;
  outcome: string;
  createdAt: Date;
  orderType: string;
}

export interface NormalizedTrade {
  tradeId: string;
  tokenId: string;
  market: string;
  side: string;
  price: number;
  size: number;
  status: string;
  outcome: string;
  matchTime: Date | null;
  traderSide: string;
}

export interface OrderPlacementResult {
  success: boolean;
  orderId: string;
  status: string;
  errorMessage: string | null;
  takingAmount: string;
  makingAmount: string;
}

export interface CancelOrderResult {
  canceled: string[];
  notCanceled: Record<string, string>;
}

export interface IClobClient {
  initialize(): Promise<void>;
  getOpenOrders(params?: OpenOrderQuery): Promise<NormalizedOpenOrder[]>;
  getTrades(params?: TradeQuery): Promise<NormalizedTrade[]>;
  createLimitBuyOrder(params: LimitOrderParams): Promise<OrderPlacementResult>;
  createLimitSellOrder(params: LimitOrderParams): Promise<OrderPlacementResult>;
  cancelOrder(orderId: string): Promise<CancelOrderResult>;
  cancelAllOrders(): Promise<CancelOrderResult>;
}
