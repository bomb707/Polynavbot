import type { EvaluateMarketResult } from "./marketScanner.js";

export type SkipReason =
  | "malformed"
  | "inactive"
  | "closed"
  | "no_order_book"
  | "expiry_too_soon"
  | "missing_end_date"
  | "low_liquidity"
  | "not_yes"
  | "missing_token"
  | "missing_price"
  | "price_out_of_range";

export const SKIP_REASONS: SkipReason[] = [
  "malformed",
  "inactive",
  "closed",
  "no_order_book",
  "expiry_too_soon",
  "missing_end_date",
  "low_liquidity",
  "not_yes",
  "missing_token",
  "missing_price",
  "price_out_of_range",
];

export interface CandidateOutcome {
  marketId: string;
  outcomeId: string;
  tokenId: string;
  question: string;
  outcomeName: string;
  price: number;
  endDate: Date | null;
  outcomeCount: number;
}

export interface ScanSummary {
  marketsScanned: number;
  outcomesScanned: number;
  candidatesFound: number;
  skipped: Record<SkipReason, number>;
  candidates: CandidateOutcome[];
}

export interface ScanOptions {
  limitPerPage?: number;
  maxPages?: number;
}

export interface IMarketScanner {
  scanMarkets(options?: ScanOptions): Promise<ScanSummary>;
  scanMarketPage(limit: number, offset: number): Promise<{ rawMarkets: unknown[] }>;
  evaluateMarket(rawMarket: unknown): EvaluateMarketResult;
}
