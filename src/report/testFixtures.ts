import type { PortfolioSummary, ReportSnapshot } from "./reportTypes.js";

export function makePortfolioSummary(
  overrides: Partial<PortfolioSummary> = {},
): PortfolioSummary {
  return {
    generatedAt: "2026-06-26T12:00:00.000Z",
    mode: "paper",
    cashBalanceUsd: 500,
    openExposureUsd: 0,
    portfolioValueUsd: 500,
    realizedPnlUsd: 0,
    unrealizedPnlUsd: 0,
    totalPnlUsd: 0,
    grossRealizedPnlUsd: 0,
    netRealizedPnlUsd: 0,
    grossUnrealizedPnlUsd: 0,
    estimatedNetUnrealizedPnlUsd: 0,
    totalFeesPaidUsd: 0,
    estimatedFutureExitFeesUsd: 0,
    feesAsPercentOfGrossPnl: null,
    makerTradeCount: 0,
    takerTradeCount: 0,
    unknownRoleTradeCount: 0,
    openPositionsCount: 0,
    openOrdersCount: 0,
    ...overrides,
  };
}

export function makeEmptyReportSnapshot(
  overrides: Partial<ReportSnapshot> = {},
): ReportSnapshot {
  return {
    portfolio: makePortfolioSummary(),
    topWinners: [],
    topLosers: [],
    recentSignals: [],
    riskRejections: [],
    pendingExits: [],
    trades: [],
    ...overrides,
  };
}
