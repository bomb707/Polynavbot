import { describe, expect, it } from "vitest";

import type { BacktestMarketMeta } from "./backtestTypes.js";
import {
  EntryRejectionTracker,
  filterBarsInRange,
  isMarketOpenAt,
  resolveHistoricalMarketFlags,
} from "./marketState.js";
import type { PriceBar } from "./backtestTypes.js";

const meta: BacktestMarketMeta = {
  marketId: "m1",
  outcomeId: "o1",
  tokenId: "t1",
  question: "Will candidate win the election?",
  category: "politics",
  endDate: new Date("2025-06-01T00:00:00.000Z"),
  active: false,
  closed: true,
  archived: false,
  enableOrderBook: true,
  outcomeCount: 2,
  liquidityUsd: 5000,
  volumeUsd: 1000,
  outcomeName: "Yes",
  outcomeSide: "YES",
};

describe("filterBarsInRange", () => {
  it("drops bars outside the backtest window", () => {
    const bars: PriceBar[] = [
      {
        timestamp: new Date("2025-01-01T00:00:00.000Z"),
        tokenId: "t1",
        marketId: "m1",
        outcomeId: "o1",
        price: 0.02,
        bestBid: null,
        bestAsk: null,
        spread: null,
        liquidity: null,
        source: "clob",
      },
      {
        timestamp: new Date("2026-06-26T00:00:00.000Z"),
        tokenId: "t1",
        marketId: "m1",
        outcomeId: "o1",
        price: 0.99,
        bestBid: null,
        bestAsk: null,
        spread: null,
        liquidity: null,
        source: "clob",
      },
    ];

    const filtered = filterBarsInRange(
      bars,
      new Date("2025-01-01T00:00:00.000Z"),
      new Date("2025-06-01T00:00:00.000Z"),
    );

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.timestamp.toISOString()).toBe("2025-01-01T00:00:00.000Z");
  });
});

describe("isMarketOpenAt", () => {
  it("treats currently-closed markets as open before endDate", () => {
    expect(isMarketOpenAt(meta, new Date("2025-03-01T00:00:00.000Z"))).toBe(true);
    expect(resolveHistoricalMarketFlags(meta, new Date("2025-03-01T00:00:00.000Z"))).toEqual({
      active: true,
      closed: false,
    });
  });

  it("treats markets as closed on or after endDate", () => {
    expect(isMarketOpenAt(meta, new Date("2025-06-01T00:00:00.000Z"))).toBe(false);
  });
});

describe("EntryRejectionTracker", () => {
  it("aggregates rejection counts", () => {
    const tracker = new EntryRejectionTracker();
    tracker.record("price_out_of_band");
    tracker.record("price_out_of_band");
    tracker.record("score_reject");

    expect(tracker.total()).toBe(3);
    expect(tracker.toSortedRecord()).toEqual({
      price_out_of_band: 2,
      score_reject: 1,
    });
  });
});
