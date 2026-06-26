import { describe, expect, it, vi } from "vitest";
import type { Position } from "@prisma/client";

import type { Config } from "../config/index.js";
import type { ExitPaperSummary } from "../execution/exitTypes.js";
import type { OrderBook } from "../polymarket/publicTypes.js";
import type { PortfolioSummary } from "../paper/paperTypes.js";
import { createPositionMonitor } from "./positionMonitor.js";

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
    currentPrice: { toNumber: () => 0.02 } as Position["currentPrice"],
    size: { toNumber: () => 100 } as Position["size"],
    costBasisUsd: { toNumber: () => 2 } as Position["costBasisUsd"],
    currentValueUsd: { toNumber: () => 2 } as Position["currentValueUsd"],
    realizedPnlUsd: { toNumber: () => 0 } as Position["realizedPnlUsd"],
    unrealizedPnlUsd: { toNumber: () => 0 } as Position["unrealizedPnlUsd"],
    exitState: null,
    status: "OPEN",
    openedAt: new Date(),
    closedAt: null,
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeOrderBook(tokenId: string, bestBid: number, bestAsk: number): OrderBook {
  return {
    tokenId,
    bids: [{ price: bestBid, size: 100 }],
    asks: [{ price: bestAsk, size: 100 }],
    bestBid,
    bestAsk,
    spread: bestAsk - bestBid,
  };
}

const emptyExitResult: ExitPaperSummary = {
  positionsEvaluated: 0,
  holds: 0,
  exitsPlaced: 0,
  exitsFilled: 0,
  totalRealizedPnlUsd: 0,
  actions: [],
};

function createMonitor(overrides: {
  positions?: Position[];
  orderBooks?: Map<string, OrderBook | null>;
  portfolio?: PortfolioSummary;
  exitResult?: ExitPaperSummary;
}) {
  const markToMarket = vi.fn().mockImplementation(async (tokenId: string, currentPrice: number) => {
    const position = overrides.positions?.find((p) => p.tokenId === tokenId);
    if (!position) {
      return null;
    }
    const size = position.size.toNumber();
    const costBasis = position.costBasisUsd.toNumber();
    const currentValueUsd = size * currentPrice;
    return {
      ...position,
      currentPrice: { toNumber: () => currentPrice } as Position["currentPrice"],
      currentValueUsd: { toNumber: () => currentValueUsd } as Position["currentValueUsd"],
      unrealizedPnlUsd: {
        toNumber: () => currentValueUsd - costBasis,
      } as Position["unrealizedPnlUsd"],
    };
  });

  const snapshotCreate = vi.fn().mockResolvedValue({});

  const getPortfolioSummary = vi.fn().mockResolvedValue(
    overrides.portfolio ?? {
      cashBalanceUsd: 498,
      openPositions: overrides.positions ?? [],
      totalRealizedPnlUsd: 0,
      totalUnrealizedPnlUsd: 0,
    },
  );

  const exitRun = vi.fn().mockResolvedValue(overrides.exitResult ?? emptyExitResult);

  const getOrderBook = vi.fn().mockImplementation(async (tokenId: string) => {
    if (overrides.orderBooks?.has(tokenId)) {
      return overrides.orderBooks.get(tokenId) ?? null;
    }
    return makeOrderBook(tokenId, 0.1, 0.11);
  });

  const monitor = createPositionMonitor({
    config,
    repositories: {
      position: {
        findOpen: vi.fn().mockResolvedValue(overrides.positions ?? []),
      },
      snapshot: {
        create: snapshotCreate,
      },
    } as never,
    publicClient: {
      getOrderBook,
    } as never,
    paperTradingEngine: {
      initialize: vi.fn().mockResolvedValue(undefined),
      markToMarket,
      getPortfolioSummary,
    } as never,
    exitEngine: {
      run: exitRun,
    } as never,
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as never,
  });

  return {
    monitor,
    markToMarket,
    snapshotCreate,
    getOrderBook,
    exitRun,
    getPortfolioSummary,
  };
}

describe("createPositionMonitor.run", () => {
  it("marks positions, saves snapshots, and computes portfolio summary", async () => {
    const positions = [
      makePosition({ id: "pos-1", tokenId: "token-1", costBasisUsd: { toNumber: () => 2 } as Position["costBasisUsd"] }),
      makePosition({
        id: "pos-2",
        tokenId: "token-2",
        marketId: "market-2",
        outcomeId: "outcome-2",
        costBasisUsd: { toNumber: () => 3 } as Position["costBasisUsd"],
      }),
    ];

    const markedPositions = [
      {
        ...positions[0],
        currentPrice: { toNumber: () => 0.105 } as Position["currentPrice"],
        currentValueUsd: { toNumber: () => 10.5 } as Position["currentValueUsd"],
        unrealizedPnlUsd: { toNumber: () => 8.5 } as Position["unrealizedPnlUsd"],
      },
      {
        ...positions[1],
        currentPrice: { toNumber: () => 0.105 } as Position["currentPrice"],
        currentValueUsd: { toNumber: () => 10.5 } as Position["currentValueUsd"],
        unrealizedPnlUsd: { toNumber: () => 7.5 } as Position["unrealizedPnlUsd"],
      },
    ];

    const { monitor, markToMarket, snapshotCreate } = createMonitor({
      positions,
      portfolio: {
        cashBalanceUsd: 495,
        openPositions: markedPositions,
        totalRealizedPnlUsd: 1,
        totalUnrealizedPnlUsd: 16,
      },
    });

    const summary = await monitor.run();

    expect(markToMarket).toHaveBeenCalledTimes(2);
    expect(snapshotCreate).toHaveBeenCalledTimes(2);
    expect(summary.positionsLoaded).toBe(2);
    expect(summary.positionsUpdated).toBe(2);
    expect(summary.positionsSkipped).toBe(0);
    expect(summary.snapshotsSaved).toBe(2);
    expect(summary.startingBalanceUsd).toBe(500);
    expect(summary.cashBalanceUsd).toBe(495);
    expect(summary.openExposureUsd).toBe(5);
    expect(summary.portfolioValueUsd).toBe(516);
    expect(summary.totalRealizedPnlUsd).toBe(1);
    expect(summary.totalUnrealizedPnlUsd).toBe(16);
    expect(summary.totalPnlUsd).toBe(17);
  });

  it("skips positions when order book is unavailable", async () => {
    const positions = [makePosition()];
    const orderBooks = new Map<string, OrderBook | null>([["token-1", null]]);

    const { monitor, markToMarket, snapshotCreate } = createMonitor({
      positions,
      orderBooks,
    });

    const summary = await monitor.run();

    expect(summary.positionsSkipped).toBe(1);
    expect(summary.positionsUpdated).toBe(0);
    expect(summary.snapshotsSaved).toBe(0);
    expect(markToMarket).not.toHaveBeenCalled();
    expect(snapshotCreate).not.toHaveBeenCalled();
  });

  it("includes exit-eligible positions from exit engine actions", async () => {
    const positions = [makePosition()];
    const exitResult: ExitPaperSummary = {
      positionsEvaluated: 1,
      holds: 0,
      exitsPlaced: 1,
      exitsFilled: 0,
      totalRealizedPnlUsd: 0,
      actions: [
        {
          tokenId: "token-1",
          question: "Will X win?",
          action: "sell_partial",
          reason: "milestone_5x",
          sellSizeShares: 30,
          sellPrice: 0.1,
          filled: false,
        },
      ],
    };

    const { monitor } = createMonitor({ positions, exitResult });
    const summary = await monitor.run();

    expect(summary.exitEligible).toHaveLength(1);
    expect(summary.exitEligible[0]).toMatchObject({
      tokenId: "token-1",
      action: "sell_partial",
      reason: "milestone_5x",
      sellSizeShares: 30,
    });
  });

  it("picks best and worst positions by unrealized PnL", async () => {
    const positions = [
      makePosition({ id: "pos-1", tokenId: "token-1" }),
      makePosition({ id: "pos-2", tokenId: "token-2" }),
    ];

    const markedPositions = [
      {
        ...positions[0],
        unrealizedPnlUsd: { toNumber: () => 5 } as Position["unrealizedPnlUsd"],
        currentPrice: { toNumber: () => 0.07 } as Position["currentPrice"],
      },
      {
        ...positions[1],
        unrealizedPnlUsd: { toNumber: () => -2 } as Position["unrealizedPnlUsd"],
        currentPrice: { toNumber: () => 0.01 } as Position["currentPrice"],
      },
    ];

    const { monitor } = createMonitor({
      positions,
      portfolio: {
        cashBalanceUsd: 500,
        openPositions: markedPositions,
        totalRealizedPnlUsd: 0,
        totalUnrealizedPnlUsd: 3,
      },
    });

    const summary = await monitor.run();

    expect(summary.bestPosition?.tokenId).toBe("token-1");
    expect(summary.bestPosition?.unrealizedPnlUsd).toBe(5);
    expect(summary.worstPosition?.tokenId).toBe("token-2");
    expect(summary.worstPosition?.unrealizedPnlUsd).toBe(-2);
  });

  it("throws when not in paper mode", async () => {
    const monitor = createPositionMonitor({
      config: { TRADING_MODE: "live", PAPER_STARTING_BALANCE_USD: 500 } as Config,
      repositories: {} as never,
      publicClient: {} as never,
      paperTradingEngine: {} as never,
      exitEngine: {} as never,
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
    });

    await expect(monitor.run()).rejects.toThrow("positions:update requires TRADING_MODE=paper");
  });
});
