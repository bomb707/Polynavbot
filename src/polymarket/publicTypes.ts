export interface NormalizedOutcome {
  tokenId: string;
  name: string;
  side: "YES" | "NO";
  price: number | null;
  outcomeIndex: number;
}

export interface NormalizedMarket {
  polymarketMarketId: string;
  conditionId: string;
  question: string;
  slug: string | null;
  category: string | null;
  active: boolean;
  closed: boolean;
  archived: boolean;
  enableOrderBook: boolean;
  endDate: Date | null;
  liquidityUsd: number | null;
  volumeUsd: number | null;
  outcomes: NormalizedOutcome[];
}

export interface GetActiveMarketsParams {
  limit: number;
  offset: number;
  category?: string;
  tag?: string;
}

export interface GetActiveMarketsResult {
  markets: NormalizedMarket[];
  total: number;
  skipped: number;
}

export interface GetBacktestMarketsParams {
  start: Date;
  end: Date;
  limit: number;
  offset: number;
  closed: boolean;
}

export interface OrderBookLevel {
  price: number;
  size: number;
}

export interface OrderBook {
  tokenId: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  bestBid: number | null;
  bestAsk: number | null;
  spread: number | null;
}

export interface PriceHistoryPoint {
  timestamp: Date;
  price: number;
}

export interface ActivityItem {
  type: string | null;
  timestamp: Date | null;
  asset: string | null;
  side: string | null;
  size: number | null;
  price: number | null;
  slug: string | null;
  title: string | null;
  conditionId: string | null;
  outcomeName: string | null;
  raw: Record<string, unknown>;
}

export interface ClobMarketFeeDetails {
  feeRate: number;
  feeExponent: number | null;
  takerOnly: boolean;
}

export interface ClobMarketInfo {
  conditionId: string;
  makerBaseFeeBps: number;
  takerBaseFeeBps: number;
  feesEnabled: boolean;
  feeDetails: ClobMarketFeeDetails | null;
  feeCategory: string | null;
}
