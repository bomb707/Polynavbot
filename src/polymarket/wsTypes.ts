export type WsMarketEventType = "best_bid_ask" | "price_change" | "last_trade_price";

export type PriceQuoteSource = "ws" | "rest";

export interface TokenPriceQuote {
  tokenId: string;
  price: number | null;
  bestBid: number | null;
  bestAsk: number | null;
  spread: number | null;
  lastTradePrice: number | null;
  updatedAt: Date;
  source: PriceQuoteSource;
}

export interface WsUserOrderEvent {
  type: "order";
  orderId: string;
  market: string;
  assetId: string;
  side: string;
  status: string;
  price: number | null;
  size: number | null;
  raw: Record<string, unknown>;
}

export interface WsUserTradeEvent {
  type: "trade";
  tradeId: string;
  market: string;
  assetId: string;
  side: string;
  status: string;
  price: number | null;
  size: number | null;
  raw: Record<string, unknown>;
}

export type WsUserEvent = WsUserOrderEvent | WsUserTradeEvent;

export type MarketQuoteHandler = (quote: TokenPriceQuote) => void;
export type UserEventHandler = (event: WsUserEvent) => void;

export interface IWsClient {
  start(): Promise<void>;
  stop(): Promise<void>;
  setMarketSubscriptions(tokenIds: string[]): void;
  setUserSubscriptions(conditionIds: string[]): void;
  onMarketQuote(handler: MarketQuoteHandler): void;
  onUserEvent(handler: UserEventHandler): void;
}

export interface PositionTokenMeta {
  tokenId: string;
  marketId: string;
  outcomeId: string;
  conditionId: string;
}

export interface IWsMonitorService {
  start(): Promise<void>;
  stop(): Promise<void>;
}
