import type { OrderBook } from "../polymarket/publicTypes.js";
import type { PriceHistoryPoint } from "../polymarket/publicTypes.js";

export type TailNoDecision = "entry_candidate" | "watchlist" | "reject";

export interface TailNoScoreInput {
  asOf?: Date;
  market: {
    question: string;
    category: string | null;
    active: boolean;
    closed: boolean;
    archived: boolean;
    enableOrderBook: boolean;
    endDate: Date | null;
    outcomeCount: number;
    liquidityUsd: number | null;
    volumeUsd: number | null;
  };
  outcome: {
    tokenId: string;
    name: string;
    side: "YES" | "NO";
    price: number | null;
  };
  yesCounterpartPrice: number | null;
  pricing: {
    orderBook?: OrderBook | null;
    spread?: number | null;
    priceHistory?: PriceHistoryPoint[];
  };
}

export interface TailNoScoreResult {
  score: number;
  decision: TailNoDecision;
  reasons: string[];
  suggestedEntryPrice: number;
  suggestedSizeUsd: number;
}
