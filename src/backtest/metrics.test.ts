import { describe, expect, it } from "vitest";

import { computeMetrics } from "./metrics.js";
import type { BacktestTrade, EquityPoint } from "./backtestTypes.js";

describe("computeMetrics", () => {
  it("computes drawdown, hit rate, and losing streak", () => {
    const trades: BacktestTrade[] = [
      {
        id: "1",
        timestamp: new Date("2026-01-02"),
        tokenId: "a",
        marketId: "m1",
        outcomeId: "o1",
        question: "Q1",
        side: "SELL",
        price: 0.1,
        sizeShares: 10,
        notionalUsd: 1,
        realizedPnlUsd: 0.5,
        reason: "milestone_5x",
      },
      {
        id: "2",
        timestamp: new Date("2026-01-03"),
        tokenId: "b",
        marketId: "m2",
        outcomeId: "o2",
        question: "Q2",
        side: "SELL",
        price: 0.01,
        sizeShares: 10,
        notionalUsd: 0.1,
        realizedPnlUsd: -0.2,
        reason: "backtest_end_close",
      },
      {
        id: "3",
        timestamp: new Date("2026-01-04"),
        tokenId: "c",
        marketId: "m3",
        outcomeId: "o3",
        question: "Q3",
        side: "SELL",
        price: 0.01,
        sizeShares: 10,
        notionalUsd: 0.1,
        realizedPnlUsd: -0.1,
        reason: "backtest_end_close",
      },
    ];

    const equityCurve: EquityPoint[] = [
      { timestamp: new Date("2026-01-01"), equityUsd: 500, cashUsd: 500, deployedUsd: 0 },
      { timestamp: new Date("2026-01-02"), equityUsd: 520, cashUsd: 400, deployedUsd: 120 },
      { timestamp: new Date("2026-01-03"), equityUsd: 480, cashUsd: 450, deployedUsd: 30 },
      { timestamp: new Date("2026-01-04"), equityUsd: 470, cashUsd: 470, deployedUsd: 0 },
    ];

    const metrics = computeMetrics({
      startingCapitalUsd: 500,
      finalEquityUsd: 470,
      trades,
      equityCurve,
      openUnrealizedUsd: 0,
    });

    expect(metrics.totalRoi).toBeCloseTo(-0.06, 2);
    expect(metrics.hitRate).toBeCloseTo(1 / 3, 2);
    expect(metrics.worstLosingStreak).toBe(2);
    expect(metrics.maxDrawdown).toBeGreaterThan(0);
    expect(metrics.capitalUtilization).toBeGreaterThan(0);
  });
});
