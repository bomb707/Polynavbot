import { describe, expect, it, vi } from "vitest";

import { mergePriceBars } from "./dataLoader.js";
import type { PriceBar } from "./backtestTypes.js";

describe("mergePriceBars", () => {
  it("prefers snapshot bars over clob on same timestamp", () => {
    const ts = new Date("2026-01-01T00:00:00.000Z");
    const clob: PriceBar = {
      timestamp: ts,
      tokenId: "t1",
      marketId: "m1",
      outcomeId: "o1",
      price: 0.02,
      bestBid: null,
      bestAsk: null,
      spread: null,
      liquidity: null,
      source: "clob",
    };
    const snapshot: PriceBar = {
      timestamp: ts,
      tokenId: "t1",
      marketId: "m1",
      outcomeId: "o1",
      price: 0.021,
      bestBid: 0.02,
      bestAsk: 0.022,
      spread: 0.002,
      liquidity: 5000,
      source: "snapshot",
    };

    const merged = mergePriceBars([snapshot], [clob]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.source).toBe("snapshot");
    expect(merged[0]?.bestBid).toBe(0.02);
  });
});

describe("createDataLoader", () => {
  it("loads series from snapshots and fills gaps with clob", async () => {
    const { createDataLoader } = await import("./dataLoader.js");

    const start = new Date("2026-01-01T00:00:00.000Z");
    const end = new Date("2026-01-02T00:00:00.000Z");

    const loader = createDataLoader({
      config: {
        interval: "1h",
        slippageBps: 50,
        fillProbability: 0.7,
        assumedSpread: 0.02,
        topOfBookDepthUsd: 25,
        minLiquidityForExit: 1000,
        startingCapitalUsd: 500,
        seed: 42,
        maxMarkets: 100,
        minLiquidityUsd: 1000,
        feeMode: "mixed",
      },
      logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
      publicClient: {
        getPricesHistory: vi.fn().mockResolvedValue([
          { timestamp: new Date("2026-01-01T01:00:00.000Z"), price: 0.018 },
        ]),
      } as never,
      repositories: {
        snapshot: {
          findDistinctTokensInRange: vi.fn().mockResolvedValue([
            { tokenId: "token-1", marketId: "market-1", outcomeId: "outcome-1" },
          ]),
          findByTokenInRange: vi.fn().mockResolvedValue([
            {
              timestamp: new Date("2026-01-01T00:00:00.000Z"),
              tokenId: "token-1",
              marketId: "market-1",
              outcomeId: "outcome-1",
              price: { toNumber: () => 0.02 },
              bestBid: { toNumber: () => 0.019 },
              bestAsk: { toNumber: () => 0.021 },
              spread: { toNumber: () => 0.002 },
              liquidity: { toNumber: () => 5000 },
            },
          ]),
        },
        market: {
          findById: vi.fn().mockResolvedValue({
            id: "market-1",
            question: "Will X win?",
            category: "politics",
            endDate: new Date("2027-01-01"),
            active: true,
            closed: false,
            archived: false,
            enableOrderBook: true,
          }),
        },
        outcome: {
          findByTokenId: vi.fn().mockResolvedValue({
            id: "outcome-1",
            tokenId: "token-1",
            name: "Yes",
            side: "YES",
            liquidity: { toNumber: () => 5000 },
            volume: { toNumber: () => 1000 },
          }),
          listAllTokenRefs: vi.fn().mockResolvedValue([]),
          findTokenRefsForBacktest: vi.fn().mockResolvedValue([]),
        },
      } as never,
      appConfig: { NO_ENTRY_ENABLED: false } as never,
    });
  });

  it("falls back to Gamma API when snapshots and DB outcomes are empty", async () => {
    const { createDataLoader } = await import("./dataLoader.js");

    const start = new Date("2025-01-01T00:00:00.000Z");
    const end = new Date("2025-01-02T00:00:00.000Z");

    const loader = createDataLoader({
      config: {
        interval: "1h",
        slippageBps: 50,
        fillProbability: 0.7,
        assumedSpread: 0.02,
        topOfBookDepthUsd: 25,
        minLiquidityForExit: 1000,
        startingCapitalUsd: 500,
        seed: 42,
        maxMarkets: 10,
        minLiquidityUsd: 1000,
        feeMode: "mixed",
      },
      logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
      publicClient: {
        getBacktestMarkets: vi.fn().mockResolvedValue([
          {
            polymarketMarketId: "pm-1",
            conditionId: "cond-1",
            question: "Will X win?",
            slug: "will-x-win",
            category: "politics",
            active: true,
            closed: false,
            archived: false,
            enableOrderBook: true,
            endDate: new Date("2027-01-01"),
            outcomes: [
              {
                tokenId: "token-1",
                name: "Yes",
                side: "YES",
                price: 0.02,
                outcomeIndex: 0,
              },
            ],
          },
        ]),
        getPricesHistory: vi.fn().mockResolvedValue([
          { timestamp: new Date("2025-01-01T00:00:00.000Z"), price: 0.02 },
        ]),
      } as never,
      repositories: {
        snapshot: {
          findDistinctTokensInRange: vi.fn().mockResolvedValue([]),
          findByTokenInRange: vi.fn().mockResolvedValue([]),
        },
        market: {
          findById: vi.fn().mockResolvedValue({
            id: "market-1",
            question: "Will X win?",
            category: "politics",
            endDate: new Date("2027-01-01"),
            active: true,
            closed: false,
            archived: false,
            enableOrderBook: true,
          }),
          upsertByPolymarketId: vi.fn().mockResolvedValue({
            id: "market-1",
            question: "Will X win?",
            category: "politics",
            endDate: new Date("2027-01-01"),
            active: true,
            closed: false,
            archived: false,
            enableOrderBook: true,
          }),
        },
        outcome: {
          listAllTokenRefs: vi.fn().mockResolvedValue([]),
          findTokenRefsForBacktest: vi.fn().mockResolvedValue([]),
          findByTokenId: vi.fn().mockResolvedValue({
            id: "outcome-1",
            tokenId: "token-1",
            name: "Yes",
            side: "YES",
            liquidity: { toNumber: () => 5000 },
            volume: { toNumber: () => 1000 },
          }),
          upsertByTokenId: vi.fn().mockResolvedValue({
            id: "outcome-1",
            tokenId: "token-1",
            name: "Yes",
            side: "YES",
          }),
        },
      } as never,
      appConfig: { NO_ENTRY_ENABLED: false } as never,
    });

    const dataset = await loader.loadBacktestDataset(start, end);
    expect(dataset.series).toHaveLength(1);
    expect(dataset.series[0]?.bars).toHaveLength(1);
  });
});
