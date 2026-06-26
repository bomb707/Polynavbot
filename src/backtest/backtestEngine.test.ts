import { describe, expect, it, vi } from "vitest";

const mockDataset = {
  start: new Date("2026-01-01T00:00:00.000Z"),
  end: new Date("2026-01-01T03:00:00.000Z"),
  source: "snapshots" as const,
  series: [
    {
      meta: {
        marketId: "market-1",
        outcomeId: "outcome-1",
        tokenId: "token-1",
        question: "Will X win the tournament?",
        category: "sports",
        endDate: new Date("2027-01-01"),
        active: true,
        closed: false,
        archived: false,
        enableOrderBook: true,
        outcomeCount: 3,
        liquidityUsd: 5000,
        volumeUsd: 1000,
        outcomeName: "Yes",
        outcomeSide: "YES" as const,
      },
      bars: [
        {
          timestamp: new Date("2026-01-01T00:00:00.000Z"),
          tokenId: "token-1",
          marketId: "market-1",
          outcomeId: "outcome-1",
          price: 0.015,
          bestBid: 0.014,
          bestAsk: 0.016,
          spread: 0.002,
          liquidity: 5000,
          source: "snapshot" as const,
        },
        {
          timestamp: new Date("2026-01-01T01:00:00.000Z"),
          tokenId: "token-1",
          marketId: "market-1",
          outcomeId: "outcome-1",
          price: 0.014,
          bestBid: 0.013,
          bestAsk: 0.015,
          spread: 0.002,
          liquidity: 5000,
          source: "snapshot" as const,
        },
        {
          timestamp: new Date("2026-01-01T02:00:00.000Z"),
          tokenId: "token-1",
          marketId: "market-1",
          outcomeId: "outcome-1",
          price: 0.11,
          bestBid: 0.1,
          bestAsk: 0.12,
          spread: 0.02,
          liquidity: 5000,
          source: "snapshot" as const,
        },
      ],
    },
  ],
};

vi.mock("./dataLoader.js", () => ({
  createDataLoader: () => ({
    loadBacktestDataset: vi.fn().mockResolvedValue(mockDataset),
  }),
  buildTimeline: vi.fn((dataset: typeof mockDataset) => {
    const timeline = new Map<number, (typeof mockDataset.series)[0]["bars"][0][]>();
    for (const tokenSeries of dataset.series) {
      for (const bar of tokenSeries.bars) {
        const key = bar.timestamp.getTime();
        const bucket = timeline.get(key) ?? [];
        bucket.push(bar);
        timeline.set(key, bucket);
      }
    }
    return timeline;
  }),
}));

import { createBacktestEngine } from "./backtestEngine.js";

const config = {
  TRADING_MODE: "paper",
  MIN_ENTRY_PRICE: 0.005,
  MAX_ENTRY_PRICE: 0.04,
  MIN_DAYS_TO_EXPIRY: 30,
  MIN_LIQUIDITY_USD: 1000,
  MAX_SPREAD: 0.03,
  MAX_POSITION_SIZE_USD: 2,
  MAX_DAILY_SPEND_USD: 25,
  MAX_MARKET_EXPOSURE_USD: 10,
  MAX_THEME_EXPOSURE_USD: 25,
  MAX_OPEN_EXPOSURE_USD: 50,
  MAX_OPEN_POSITIONS: 25,
  MAX_OPEN_ORDERS: 10,
  MIN_ORDER_SIZE_USD: 0.5,
  MAX_ORDER_SIZE_USD: 2,
  BACKTEST_INTERVAL: "1h",
  BACKTEST_SLIPPAGE_BPS: 0,
  BACKTEST_FILL_PROBABILITY: 1,
  BACKTEST_ASSUMED_SPREAD: 0.01,
  BACKTEST_TOP_OF_BOOK_DEPTH_USD: 100,
  BACKTEST_MIN_LIQUIDITY_FOR_EXIT: 100,
  BACKTEST_STARTING_CAPITAL_USD: 500,
  BACKTEST_SEED: 1,
  BACKTEST_MAX_MARKETS: 100,
  LONGSHOT_ENTRY_THRESHOLD: 70,
  NO_ENTRY_ENABLED: false,
  TAIL_NO_ENTRY_THRESHOLD: 60,
} as never;

describe("createBacktestEngine", () => {
  it("runs end-to-end on mock price series", async () => {
    const engine = createBacktestEngine({
      config,
      repositories: {} as never,
      publicClient: {} as never,
      logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
    });

    const result = await engine.run({
      start: mockDataset.start,
      end: mockDataset.end,
    });

    expect(result.metrics.totalTrades).toBeGreaterThan(0);
    expect(result.equityCurve.length).toBeGreaterThan(0);
    expect(result.tokensTraded).toBeGreaterThanOrEqual(1);
  });
});
