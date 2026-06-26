import { describe, expect, it, vi } from "vitest";

import { createCompositeScanner } from "./compositeScanner.js";
import type { CandidateOutcome, ScanSummary } from "./types.js";

function candidate(tokenId: string, source: "gamma" | "wallet"): CandidateOutcome {
  return {
    marketId: "market-1",
    outcomeId: "outcome-1",
    tokenId,
    question: "Test?",
    outcomeName: "Yes",
    price: 0.02,
    endDate: null,
    outcomeCount: 2,
    side: "YES",
    source,
  };
}

function summary(candidates: CandidateOutcome[]): ScanSummary {
  return {
    marketsScanned: 1,
    outcomesScanned: 2,
    candidatesFound: candidates.length,
    skipped: {
      malformed: 0,
      inactive: 0,
      closed: 0,
      no_order_book: 0,
      expiry_too_soon: 0,
      missing_end_date: 0,
      low_liquidity: 0,
      not_yes: 0,
      not_no: 0,
      missing_token: 0,
      missing_price: 0,
      price_out_of_range: 0,
      no_price_out_of_range: 0,
    },
    candidates,
  };
}

describe("createCompositeScanner", () => {
  it("dedupes by tokenId with wallet candidates first", async () => {
    const gammaScanner = {
      scanMarkets: vi.fn().mockResolvedValue(
        summary([candidate("token-a", "gamma"), candidate("token-b", "gamma")]),
      ),
      scanMarketPage: vi.fn(),
      evaluateMarket: vi.fn(),
    };
    const walletScanner = {
      scanMarkets: vi.fn().mockResolvedValue(
        summary([candidate("token-a", "wallet"), candidate("token-c", "wallet")]),
      ),
      scanMarketPage: vi.fn(),
      evaluateMarket: vi.fn(),
    };

    const scanner = createCompositeScanner({ gammaScanner, walletScanner });
    const result = await scanner.scanMarkets();

    expect(result.candidates.map((c) => c.tokenId)).toEqual(["token-a", "token-c", "token-b"]);
    expect(result.candidates.find((c) => c.tokenId === "token-a")?.source).toBe("wallet");
  });
});
