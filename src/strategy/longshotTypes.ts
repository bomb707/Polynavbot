import type { OrderBook, PriceHistoryPoint } from "../polymarket/publicTypes.js";

export interface LongshotMarketContext {
  question: string;
  category: string | null;
  active: boolean;
  closed: boolean;
  archived: boolean;
  enableOrderBook: boolean;
  endDate: Date | null;
  outcomeCount: number;
  liquidityUsd?: number | null;
  volumeUsd?: number | null;
}

export interface LongshotOutcomeContext {
  tokenId: string;
  name: string;
  side: "YES" | "NO";
  price: number | null;
}

export interface LongshotPricingContext {
  orderBook?: OrderBook | null;
  spread?: number | null;
  priceHistory?: PriceHistoryPoint[];
}

export interface LongshotScoreInput {
  market: LongshotMarketContext;
  outcome: LongshotOutcomeContext;
  pricing: LongshotPricingContext;
  asOf?: Date;
}

export type LongshotDecision = "reject" | "watchlist" | "entry_candidate";

export interface LongshotScoreResult {
  score: number;
  decision: LongshotDecision;
  reasons: string[];
  suggestedEntryPrice: number;
  suggestedSizeUsd: number;
}
