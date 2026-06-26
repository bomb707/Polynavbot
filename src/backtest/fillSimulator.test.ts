import { describe, expect, it } from "vitest";

import { createBacktestConfig } from "./backtestConfig.js";
import { simulateConservativeFill } from "./fillSimulator.js";
import type { BacktestConfig, BacktestOrder, PriceBar } from "./backtestTypes.js";
import { createSeededRng } from "./rng.js";

const config: BacktestConfig = {
  interval: "1h",
  slippageBps: 50,
  fillProbability: 1,
  assumedSpread: 0.02,
  topOfBookDepthUsd: 25,
  minLiquidityForExit: 1000,
  startingCapitalUsd: 500,
  seed: 42,
};

function makeBar(price: number): PriceBar {
  return {
    timestamp: new Date("2026-01-01T00:00:00.000Z"),
    tokenId: "token-1",
    marketId: "market-1",
    outcomeId: "outcome-1",
    price,
    bestBid: null,
    bestAsk: null,
    spread: null,
    liquidity: 5000,
    source: "clob",
  };
}

function makeOrder(side: "BUY" | "SELL", limitPrice: number, sizeShares = 100): BacktestOrder {
  return {
    id: "order-1",
    tokenId: "token-1",
    marketId: "market-1",
    outcomeId: "outcome-1",
    side,
    limitPrice,
    sizeShares,
    filledShares: 0,
    createdAt: new Date(),
  };
}

describe("simulateConservativeFill", () => {
  const rng = createSeededRng(42);

  it("fills BUY when bar price touches limit with slippage", () => {
    const result = simulateConservativeFill(makeOrder("BUY", 0.02), makeBar(0.019), config, rng);
    expect(result.filled).toBe(true);
    expect(result.fillPrice).toBeGreaterThan(0.019);
    expect(result.fillSize).toBeGreaterThan(0);
  });

  it("does not fill BUY when bar price is above limit", () => {
    const result = simulateConservativeFill(makeOrder("BUY", 0.01), makeBar(0.02), config, rng);
    expect(result.filled).toBe(false);
  });

  it("respects missed fill probability", () => {
    const lowProbConfig = { ...config, fillProbability: 0 };
    const result = simulateConservativeFill(
      makeOrder("BUY", 0.02),
      makeBar(0.019),
      lowProbConfig,
      rng,
    );
    expect(result.filled).toBe(false);
  });

  it("caps fill size by top-of-book depth", () => {
    const shallowConfig = { ...config, topOfBookDepthUsd: 1 };
    const result = simulateConservativeFill(
      makeOrder("BUY", 0.02, 1000),
      makeBar(0.019),
      shallowConfig,
      rng,
    );
    expect(result.filled).toBe(true);
    expect(result.fillSize).toBeLessThan(100);
  });
});

describe("createBacktestConfig", () => {
  it("reads defaults from env config", () => {
    const cfg = createBacktestConfig({
      BACKTEST_INTERVAL: "1h",
      BACKTEST_SLIPPAGE_BPS: 50,
      BACKTEST_FILL_PROBABILITY: 0.7,
      BACKTEST_ASSUMED_SPREAD: 0.02,
      BACKTEST_TOP_OF_BOOK_DEPTH_USD: 25,
      BACKTEST_MIN_LIQUIDITY_FOR_EXIT: 1000,
      BACKTEST_STARTING_CAPITAL_USD: 500,
      BACKTEST_SEED: 7,
    } as never);
    expect(cfg.seed).toBe(7);
    expect(cfg.fillProbability).toBe(0.7);
  });
});
