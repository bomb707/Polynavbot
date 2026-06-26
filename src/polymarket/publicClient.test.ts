import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ILogger } from "../logger/types.js";
import { PublicApiError } from "./http.js";
import { createHttpClient } from "./http.js";
import { createPublicClient } from "./publicClient.js";

const config = {
  POLY_GAMMA_API_URL: "https://gamma-api.polymarket.com",
  POLY_CLOB_HOST: "https://clob.polymarket.com",
  POLY_DATA_API_URL: "https://data-api.polymarket.com",
};

function createLogger(): ILogger {
  const noop = () => undefined;
  return {
    fatal: noop,
    error: noop,
    warn: noop,
    info: noop,
    debug: noop,
    child: () => createLogger(),
  };
}

function validMarket(id: string) {
  return {
    id,
    conditionId: `cond-${id}`,
    question: `Question ${id}?`,
    slug: `market-${id}`,
    category: "politics",
    active: true,
    closed: false,
    archived: false,
    enableOrderBook: true,
    endDate: "2026-12-31T00:00:00.000Z",
    outcomes: '["Yes","No"]',
    outcomePrices: '["0.02","0.98"]',
    clobTokenIds: `["token-${id}-yes","token-${id}-no"]`,
  };
}

describe("createPublicClient", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("getActiveMarkets returns normalized markets", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify([validMarket("1"), validMarket("2")]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    const client = createPublicClient(config, createLogger());
    const resultPromise = client.getActiveMarkets({ limit: 2, offset: 0 });
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.markets).toHaveLength(2);
    expect(result.total).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.markets[0]?.polymarketMarketId).toBe("1");
    expect(result.markets[0]?.outcomes).toHaveLength(2);
  });

  it("getActiveMarkets skips malformed markets without throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify([validMarket("1"), { id: "bad", question: "missing condition" }]),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      ),
    );

    const client = createPublicClient(config, createLogger());
    const resultPromise = client.getActiveMarkets({ limit: 2, offset: 0 });
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.markets).toHaveLength(1);
    expect(result.skipped).toBe(1);
  });

  it("normalizeMarket returns null when conditionId is missing", () => {
    const client = createPublicClient(config, createLogger());
    const result = client.normalizeMarket({ id: "1", question: "Test?" });
    expect(result).toBeNull();
  });

  it("normalizeOutcome parses JSON-string outcome fields", () => {
    const client = createPublicClient(config, createLogger());
    const outcome = client.normalizeOutcome(validMarket("1"), 0);
    expect(outcome).toEqual({
      tokenId: "token-1-yes",
      name: "Yes",
      side: "YES",
      price: 0.02,
      outcomeIndex: 0,
    });
  });

  it("getOrderBook maps bids and asks", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            bids: [{ price: "0.01", size: "100" }],
            asks: [{ price: "0.03", size: "50" }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    const client = createPublicClient(config, createLogger());
    const resultPromise = client.getOrderBook("token-1");
    await vi.runAllTimersAsync();
    const book = await resultPromise;

    expect(book?.bestBid).toBe(0.01);
    expect(book?.bestAsk).toBe(0.03);
    expect(book?.spread).toBeCloseTo(0.02);
  });

  it("getPricesHistory maps history points", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            history: [{ t: 1_700_000_000, p: "0.02" }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    const client = createPublicClient(config, createLogger());
    const resultPromise = client.getPricesHistory("token-1", 1, 2, "1h");
    await vi.runAllTimersAsync();
    const history = await resultPromise;

    expect(history).toHaveLength(1);
    expect(history[0]?.price).toBe(0.02);
  });

  it("retries on 429 then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("rate limited", {
          status: 429,
          headers: { "Retry-After": "1" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([validMarket("1")]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

    vi.stubGlobal("fetch", fetchMock);

    const http = createHttpClient(createLogger(), {
      minIntervalMs: 0,
      baseBackoffMs: 10,
    });
    const client = createPublicClient(config, createLogger(), http);
    const resultPromise = client.getActiveMarkets({ limit: 1, offset: 0 });
    await vi.advanceTimersByTimeAsync(2_000);
    const result = await resultPromise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.markets).toHaveLength(1);
  });

  it("throws PublicApiError after retries exhausted", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down")),
    );

    const http = createHttpClient(createLogger(), {
      maxRetries: 2,
      minIntervalMs: 0,
      baseBackoffMs: 10,
    });
    const client = createPublicClient(config, createLogger(), http);
    const resultPromise = client.getActiveMarkets({ limit: 1, offset: 0 });
    const assertion = expect(resultPromise).rejects.toBeInstanceOf(PublicApiError);
    await vi.runAllTimersAsync();
    await assertion;
  });
});
