import { describe, expect, it, vi } from "vitest";
import type { Position } from "@prisma/client";

import type { Config } from "../config/index.js";
import { createReportService } from "./reportService.js";
import type { ReportSnapshot } from "./reportTypes.js";

const config = {
  TRADING_MODE: "paper",
  PAPER_STARTING_BALANCE_USD: 500,
} as Config;

function makePosition(overrides: Partial<Position> = {}): Position {
  return {
    id: "pos-1",
    marketId: "market-1",
    outcomeId: "outcome-1",
    tokenId: "token-1",
    side: "BUY",
    avgEntryPrice: { toNumber: () => 0.02 } as Position["avgEntryPrice"],
    currentPrice: { toNumber: () => 0.1 } as Position["currentPrice"],
    size: { toNumber: () => 100 } as Position["size"],
    costBasisUsd: { toNumber: () => 2 } as Position["costBasisUsd"],
    currentValueUsd: { toNumber: () => 10 } as Position["currentValueUsd"],
    realizedPnlUsd: { toNumber: () => 0 } as Position["realizedPnlUsd"],
    unrealizedPnlUsd: { toNumber: () => 8 } as Position["unrealizedPnlUsd"],
    exitState: null,
    status: "OPEN",
    openedAt: new Date(),
    closedAt: null,
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("createReportService", () => {
  it("builds paper-mode snapshot with sorted winners and losers", async () => {
    const positions = [
      makePosition({
        id: "pos-1",
        tokenId: "token-win",
        unrealizedPnlUsd: { toNumber: () => 8 } as Position["unrealizedPnlUsd"],
      }),
      makePosition({
        id: "pos-2",
        marketId: "market-2",
        outcomeId: "outcome-2",
        tokenId: "token-lose",
        unrealizedPnlUsd: { toNumber: () => -2 } as Position["unrealizedPnlUsd"],
        costBasisUsd: { toNumber: () => 5 } as Position["costBasisUsd"],
      }),
    ];

    const service = createReportService({
      config,
      repositories: {
        position: {
          findOpen: vi.fn().mockResolvedValue(positions),
        },
        market: {
          findById: vi.fn().mockImplementation(async (id: string) => ({
            id,
            question: id === "market-1" ? "Winner market?" : "Loser market?",
          })),
        },
        order: {
          countOpenPaperOrders: vi.fn().mockResolvedValue(3),
        },
        signal: {
          findRecent: vi.fn().mockResolvedValue([]),
        },
        riskEvent: {
          findRecent: vi.fn().mockResolvedValue([]),
        },
        trade: {
          findAllOrdered: vi.fn().mockResolvedValue([]),
          sumRealizedPnl: vi.fn(),
        },
      } as never,
      paperTradingEngine: {
        initialize: vi.fn().mockResolvedValue(undefined),
        getPortfolioSummary: vi.fn().mockResolvedValue({
          cashBalanceUsd: 490,
          openPositions: positions,
          totalRealizedPnlUsd: 1,
          totalUnrealizedPnlUsd: 6,
        }),
      } as never,
      exitEngine: {
        previewExits: vi.fn().mockResolvedValue([]),
      } as never,
    });

    const snapshot = await service.buildSnapshot();

    expect(snapshot.portfolio.mode).toBe("paper");
    expect(snapshot.portfolio.cashBalanceUsd).toBe(490);
    expect(snapshot.portfolio.openOrdersCount).toBe(3);
    expect(snapshot.topWinners[0]?.tokenId).toBe("token-win");
    expect(snapshot.topLosers[0]?.tokenId).toBe("token-lose");
  });

  it("returns empty sections for empty database", async () => {
    const service = createReportService({
      config,
      repositories: {
        position: { findOpen: vi.fn().mockResolvedValue([]) },
        market: { findById: vi.fn() },
        order: { countOpenPaperOrders: vi.fn().mockResolvedValue(0) },
        signal: { findRecent: vi.fn().mockResolvedValue([]) },
        riskEvent: { findRecent: vi.fn().mockResolvedValue([]) },
        trade: { findAllOrdered: vi.fn().mockResolvedValue([]) },
      } as never,
      paperTradingEngine: {
        initialize: vi.fn().mockResolvedValue(undefined),
        getPortfolioSummary: vi.fn().mockResolvedValue({
          cashBalanceUsd: 500,
          openPositions: [],
          totalRealizedPnlUsd: 0,
          totalUnrealizedPnlUsd: 0,
        }),
      } as never,
      exitEngine: { previewExits: vi.fn().mockResolvedValue([]) } as never,
    });

    const snapshot = await service.buildSnapshot();

    expect(snapshot.portfolio.openPositionsCount).toBe(0);
    expect(snapshot.topWinners).toHaveLength(0);
    expect(snapshot.recentSignals).toHaveLength(0);
  });
});
