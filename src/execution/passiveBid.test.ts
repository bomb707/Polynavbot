import { describe, expect, it } from "vitest";

import type { Config } from "../config/index.js";
import type { OrderBook } from "../polymarket/publicTypes.js";
import { computePassiveBidPrice, getTickSize } from "./passiveBid.js";

const config = {
  MIN_ENTRY_PRICE: 0.005,
  MAX_ENTRY_PRICE: 0.04,
  MAX_SPREAD: 0.03,
} as Pick<Config, "MIN_ENTRY_PRICE" | "MAX_ENTRY_PRICE" | "MAX_SPREAD">;

function book(overrides: Partial<OrderBook> = {}): OrderBook {
  return {
    tokenId: "token-1",
    bids: [],
    asks: [],
    bestBid: null,
    bestAsk: null,
    spread: null,
    ...overrides,
  };
}

describe("getTickSize", () => {
  it("uses 0.001 for prices below 0.10", () => {
    expect(getTickSize(0.02)).toBe(0.001);
  });

  it("uses 0.01 for prices at or above 0.10", () => {
    expect(getTickSize(0.1)).toBe(0.01);
  });
});

describe("computePassiveBidPrice", () => {
  it("bids bestBid + tick on narrow spread", () => {
    const result = computePassiveBidPrice(
      book({ bestBid: 0.02, bestAsk: 0.022, spread: 0.002 }),
      config,
    );

    expect("bidPrice" in result).toBe(true);
    if ("bidPrice" in result) {
      expect(result.bidPrice).toBe(0.021);
    }
  });

  it("caps bid when bestBid + tick would cross ask", () => {
    const result = computePassiveBidPrice(
      book({ bestBid: 0.02, bestAsk: 0.021, spread: 0.001 }),
      config,
    );

    expect("bidPrice" in result).toBe(true);
    if ("bidPrice" in result) {
      expect(result.bidPrice).toBe(0.02);
    }
  });

  it("caps bid at MAX_ENTRY_PRICE", () => {
    const result = computePassiveBidPrice(
      book({ bestBid: 0.038, bestAsk: 0.04, spread: 0.002 }),
      { ...config, MAX_ENTRY_PRICE: 0.035 },
    );

    expect("bidPrice" in result).toBe(true);
    if ("bidPrice" in result) {
      expect(result.bidPrice).toBe(0.035);
    }
  });

  it("rejects when spread is too wide", () => {
    const result = computePassiveBidPrice(
      book({ bestBid: 0.01, bestAsk: 0.05, spread: 0.04 }),
      config,
    );

    expect("rejected" in result).toBe(true);
    if ("rejected" in result) {
      expect(result.reason).toContain("Spread too wide");
    }
  });

  it("rejects when no quotes", () => {
    const result = computePassiveBidPrice(book(), config);

    expect("rejected" in result).toBe(true);
    if ("rejected" in result) {
      expect(result.reason).toContain("No order book quotes");
    }
  });
});
