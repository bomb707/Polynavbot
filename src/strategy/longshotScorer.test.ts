import { describe, expect, it } from "vitest";

import type { Config } from "../config/index.js";
import { createLongshotScorer } from "./longshotScorer.js";
import type { LongshotScoreInput } from "./longshotTypes.js";

const config = {
  MIN_ENTRY_PRICE: 0.005,
  MAX_ENTRY_PRICE: 0.04,
  MIN_DAYS_TO_EXPIRY: 30,
  MIN_LIQUIDITY_USD: 1000,
  MAX_SPREAD: 0.03,
  MAX_POSITION_SIZE_USD: 2,
} as Pick<
  Config,
  | "MIN_ENTRY_PRICE"
  | "MAX_ENTRY_PRICE"
  | "MIN_DAYS_TO_EXPIRY"
  | "MIN_LIQUIDITY_USD"
  | "MAX_SPREAD"
  | "MAX_POSITION_SIZE_USD"
> as Config;

function daysFromNow(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
}

function baseInput(overrides: {
  market?: Partial<LongshotScoreInput["market"]>;
  outcome?: Partial<LongshotScoreInput["outcome"]>;
  pricing?: Partial<LongshotScoreInput["pricing"]>;
} = {}): LongshotScoreInput {
  return {
    market: {
      question: "Will candidate win the 2028 presidential election?",
      category: "politics",
      active: true,
      closed: false,
      archived: false,
      enableOrderBook: true,
      endDate: daysFromNow(90),
      outcomeCount: 4,
      liquidityUsd: 5000,
      volumeUsd: 2000,
      ...overrides.market,
    },
    outcome: {
      tokenId: "token-yes",
      name: "Yes",
      side: "YES",
      price: 0.02,
      ...overrides.outcome,
    },
    pricing: {
      spread: 0.01,
      orderBook: {
        tokenId: "token-yes",
        bids: [{ price: 0.019, size: 100 }],
        asks: [{ price: 0.021, size: 100 }],
        bestBid: 0.019,
        bestAsk: 0.021,
        spread: 0.002,
      },
      priceHistory: [
        { timestamp: daysFromNow(-7), price: 0.018 },
        { timestamp: daysFromNow(-1), price: 0.019 },
      ],
      ...overrides.pricing,
    },
  };
}

describe("createLongshotScorer", () => {
  const scorer = createLongshotScorer(config);

  it("scores a good 2¢ longshot as entry_candidate", () => {
    const result = scorer.score(baseInput());

    expect(result.decision).toBe("entry_candidate");
    expect(result.score).toBeGreaterThanOrEqual(70);
    expect(result.suggestedEntryPrice).toBe(0.021);
    expect(result.suggestedSizeUsd).toBeLessThanOrEqual(config.MAX_POSITION_SIZE_USD);
    expect(result.reasons.some((r) => r.includes("sweet spot"))).toBe(true);
  });

  it("rejects bad illiquid 2¢ longshot", () => {
    const result = scorer.score(
      baseInput({ market: { liquidityUsd: 100 } }),
    );

    expect(result.decision).toBe("reject");
    expect(result.reasons.some((r) => r.toLowerCase().includes("liquidity"))).toBe(
      true,
    );
  });

  it("rejects already pumped 20¢ outcome", () => {
    const result = scorer.score(
      baseInput({
        outcome: { price: 0.2 },
        pricing: {
          priceHistory: [
            { timestamp: daysFromNow(-7), price: 0.03 },
            { timestamp: daysFromNow(-1), price: 0.04 },
          ],
        },
      }),
    );

    expect(result.decision).toBe("reject");
    expect(
      result.reasons.some(
        (r) =>
          r.toLowerCase().includes("exceeds max entry") ||
          r.toLowerCase().includes("pump"),
      ),
    ).toBe(true);
  });

  it("rejects coin-flip 50¢ outcome", () => {
    const result = scorer.score(
      baseInput({
        market: { outcomeCount: 2 },
        outcome: { price: 0.5 },
      }),
    );

    expect(result.decision).toBe("reject");
    expect(
      result.reasons.some(
        (r) =>
          r.toLowerCase().includes("coin-flip") ||
          r.toLowerCase().includes("exceeds max entry"),
      ),
    ).toBe(true);
  });

  it("rejects short expiry market", () => {
    const result = scorer.score(
      baseInput({ market: { endDate: daysFromNow(5) } }),
    );

    expect(result.decision).toBe("reject");
    expect(result.reasons.some((r) => r.toLowerCase().includes("too soon"))).toBe(
      true,
    );
  });
});
