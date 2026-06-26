import { describe, expect, it } from "vitest";

import { formatTerminalDashboard } from "./reportFormatter.js";
import { makeEmptyReportSnapshot } from "./testFixtures.js";

const snapshot = makeEmptyReportSnapshot({
  portfolio: {
    generatedAt: "2026-06-26T12:00:00.000Z",
    mode: "paper",
    cashBalanceUsd: 490,
    openExposureUsd: 7,
    portfolioValueUsd: 507,
    realizedPnlUsd: 1,
    unrealizedPnlUsd: 6,
    totalPnlUsd: 7,
    grossRealizedPnlUsd: 1,
    netRealizedPnlUsd: 1,
    grossUnrealizedPnlUsd: 6,
    estimatedNetUnrealizedPnlUsd: 6,
    totalFeesPaidUsd: 0,
    estimatedFutureExitFeesUsd: 0,
    feesAsPercentOfGrossPnl: null,
    makerTradeCount: 0,
    takerTradeCount: 0,
    unknownRoleTradeCount: 0,
    openPositionsCount: 2,
    openOrdersCount: 1,
  },
  topWinners: [
    {
      tokenId: "token-1",
      question: "Will X win?",
      unrealizedPnlUsd: 8,
      currentPrice: 0.1,
      costBasisUsd: 2,
    },
  ],
  topLosers: [
    {
      tokenId: "token-2",
      question: "Will Y lose?",
      unrealizedPnlUsd: -2,
      currentPrice: 0.03,
      costBasisUsd: 5,
    },
  ],
  recentSignals: [
    {
      id: "sig-1",
      tokenId: "token-1",
      signalType: "LONGSHOT_ENTRY",
      status: "EXECUTED",
      score: 0.85,
      reason: "Strong longshot score",
      entryPrice: 0.02,
      suggestedSizeUsd: 2,
      createdAt: "2026-06-26T11:00:00.000Z",
    },
  ],
  riskRejections: [
    {
      id: "risk-1",
      level: "WARNING",
      type: "SPREAD",
      message: "Spread too wide",
      createdAt: "2026-06-26T10:00:00.000Z",
    },
  ],
  pendingExits: [
    {
      tokenId: "token-1",
      question: "Will X win?",
      action: "sell_partial",
      reason: "milestone_5x",
      sellSizeShares: 30,
      sellPrice: 0.09,
    },
  ],
  trades: [],
});

describe("formatTerminalDashboard", () => {
  it("includes all major sections", () => {
    const output = formatTerminalDashboard(snapshot);

    expect(output).toContain("=== Polynavbot Report ===");
    expect(output).toContain("Mode:      paper");
    expect(output).toContain("--- Portfolio ---");
    expect(output).toContain("Cash balance:");
    expect(output).toContain("Gross realized PnL:");
    expect(output).toContain("Total fees paid:");
    expect(output).toContain("Maker/taker/unknown trades:");
    expect(output).toContain("--- Top Winners");
    expect(output).toContain("--- Top Losers");
    expect(output).toContain("--- Recent Signals");
    expect(output).toContain("--- Risk Rejections");
    expect(output).toContain("--- Pending Exits");
    expect(output).toContain("Will X win?");
    expect(output).toContain("milestone_5x");
  });
});
