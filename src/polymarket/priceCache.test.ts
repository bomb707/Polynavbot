import { describe, expect, it } from "vitest";

import { createPriceCache, deriveMidPrice } from "./priceCache.js";

describe("createPriceCache", () => {
  it("merges partial updates and derives mid price", () => {
    const cache = createPriceCache();

    const quote = cache.update({
      tokenId: "token-1",
      bestBid: 0.1,
      bestAsk: 0.12,
      source: "ws",
    });

    expect(quote.price).toBeCloseTo(0.11);
    expect(quote.bestBid).toBe(0.1);
    expect(quote.bestAsk).toBe(0.12);
    expect(quote.source).toBe("ws");

    const merged = cache.update({
      tokenId: "token-1",
      lastTradePrice: 0.105,
    });

    expect(merged.bestBid).toBe(0.1);
    expect(merged.lastTradePrice).toBe(0.105);
    expect(merged.price).toBeCloseTo(0.11);
  });

  it("tracks staleness", () => {
    const cache = createPriceCache();
    const updatedAt = new Date(Date.now() - 10_000);

    cache.update({
      tokenId: "token-1",
      price: 0.1,
      updatedAt,
      source: "ws",
    });

    expect(cache.isFresh("token-1", 30)).toBe(true);
    expect(cache.isFresh("token-1", 5)).toBe(false);
    expect(cache.isFresh("missing", 30)).toBe(false);
  });

  it("deriveMidPrice prefers bid/ask midpoint", () => {
    expect(
      deriveMidPrice({
        bestBid: 0.1,
        bestAsk: 0.12,
        price: null,
        lastTradePrice: null,
      }),
    ).toBeCloseTo(0.11);
  });
});
