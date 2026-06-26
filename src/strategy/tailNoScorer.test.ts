import { describe, expect, it } from "vitest";

import type { Config } from "../config/index.js";
import { createTailNoScorer } from "./tailNoScorer.js";
import type { TailNoScoreInput } from "./tailNoTypes.js";

const config = {
  NO_MIN_ENTRY_PRICE: 0.35,
  NO_MAX_ENTRY_PRICE: 0.65,
  MIN_DAYS_TO_EXPIRY: 30,
  MIN_LIQUIDITY_USD: 1000,
  MAX_SPREAD: 0.03,
  MAX_POSITION_SIZE_USD: 15,
  MIN_ENTRY_PRICE: 0.005,
  MAX_ENTRY_PRICE: 0.04,
  TAIL_NO_ENTRY_THRESHOLD: 60,
} as Config;

function baseInput(overrides: Partial<TailNoScoreInput> = {}): TailNoScoreInput {
  return {
    market: {
      question: "Will the nominee win the 2028 presidential election?",
      category: "politics",
      active: true,
      closed: false,
      archived: false,
      enableOrderBook: true,
      endDate: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000),
      outcomeCount: 2,
      liquidityUsd: 5000,
      volumeUsd: 10000,
    },
    outcome: {
      tokenId: "token-no",
      name: "No",
      side: "NO",
      price: 0.5,
    },
    yesCounterpartPrice: 0.85,
    pricing: {
      spread: 0.01,
      orderBook: {
        tokenId: "token-no",
        bids: [{ price: 0.49, size: 100 }],
        asks: [{ price: 0.51, size: 100 }],
        bestBid: 0.49,
        bestAsk: 0.51,
        spread: 0.02,
      },
    },
    ...overrides,
  };
}

describe("createTailNoScorer", () => {
  const scorer = createTailNoScorer(config);

  it("accepts NO tail-fade in band with favorable category", () => {
    const result = scorer.score(baseInput());
    expect(result.decision).toBe("entry_candidate");
    expect(result.score).toBeGreaterThanOrEqual(60);
  });

  it("rejects NO below min price band", () => {
    const result = scorer.score(
      baseInput({
        outcome: { tokenId: "token-no", name: "No", side: "NO", price: 0.2 },
      }),
    );
    expect(result.decision).toBe("reject");
  });

  it("rejects when YES counterpart is in longshot band", () => {
    const result = scorer.score(
      baseInput({
        yesCounterpartPrice: 0.02,
      }),
    );
    expect(result.decision).toBe("reject");
    expect(result.reasons.some((r) => r.includes("longshot"))).toBe(true);
  });

  it("rejects coin-flip binary markets", () => {
    const result = scorer.score(
      baseInput({
        outcome: { tokenId: "token-no", name: "No", side: "NO", price: 0.5 },
        yesCounterpartPrice: 0.5,
      }),
    );
    expect(result.decision).toBe("reject");
  });
});
