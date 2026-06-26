import { describe, expect, it, vi } from "vitest";
import type { Market, Position } from "@prisma/client";

import type { Config } from "../config/index.js";
import type { PositionExitState } from "../db/repositories/position.repository.js";
import { createFeeService } from "../fees/feeService.js";
import { createExitEngine } from "./exitEngine.js";
import type { OrderBook } from "../polymarket/publicTypes.js";

const config = {
  TRADING_MODE: "paper",
  EXIT_NEAR_EXPIRY_HOURS: 48,
  EXIT_TRAILING_STOP_PCT: 0.6,
  EXIT_MIN_LIQUIDITY_USD: 1000,
  MAX_DAILY_LOSS_USD: 10,
} as Config;

const orderBook: OrderBook = {
  tokenId: "token-1",
  bids: [{ price: 0.10, size: 100 }],
  asks: [{ price: 0.11, size: 100 }],
  bestBid: 0.1,
  bestAsk: 0.11,
  spread: 0.01,
};

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

function makeMarket(overrides: Partial<Market> = {}): Market {
  return {
    id: "market-1",
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
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function baseExitState(overrides: Partial<PositionExitState> = {}): PositionExitState {
  return {
    originalSize: 100,
    soldAt5x: false,
    soldAt10x: false,
    soldAt25x: false,
    hasReached5x: false,
    recentHighPrice: 0.1,
    ...overrides,
  };
}

function createTestEngine() {
  return createExitEngine({
    config,
    repositories: {} as never,
    publicClient: {} as never,
    executionEngine: {} as never,
    paperTradingEngine: {} as never,
    riskEngine: {} as never,
    feeService: createFeeService({ BUILDER_FEE_BPS: 0 }),
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
  });
}

describe("createExitEngine.evaluateExit", () => {
  const engine = createTestEngine();

  it("triggers 5x partial exit selling 30% of original size", () => {
    const result = engine.evaluateExit({
      position: makePosition({ size: { toNumber: () => 100 } as Position["size"] }),
      exitState: baseExitState(),
      currentPrice: 0.11,
      orderBook,
      market: makeMarket(),
      liquidityUsd: 5000,
    });

    expect(result.action).toBe("sell_partial");
    expect(result.reason).toBe("milestone_5x");
    expect(result.sellSizeShares).toBe(30);
    expect(result.milestoneFlag).toBe("soldAt5x");
    expect(result.nextExitState.soldAt5x).toBe(false);
  });

  it("triggers 10x partial exit selling 30% of original size", () => {
    const result = engine.evaluateExit({
      position: makePosition({
        size: { toNumber: () => 70 } as Position["size"],
        avgEntryPrice: { toNumber: () => 0.02 } as Position["avgEntryPrice"],
      }),
      exitState: baseExitState({ soldAt5x: true, hasReached5x: true }),
      currentPrice: 0.21,
      orderBook: { ...orderBook, bestBid: 0.21, bestAsk: 0.22 },
      market: makeMarket(),
      liquidityUsd: 5000,
    });

    expect(result.action).toBe("sell_partial");
    expect(result.reason).toBe("milestone_10x");
    expect(result.sellSizeShares).toBe(30);
    expect(result.milestoneFlag).toBe("soldAt10x");
    expect(result.nextExitState.soldAt10x).toBe(false);
  });

  it("triggers 25x partial exit selling 20% of original size", () => {
    const result = engine.evaluateExit({
      position: makePosition({
        size: { toNumber: () => 40 } as Position["size"],
      }),
      exitState: baseExitState({
        soldAt5x: true,
        soldAt10x: true,
        hasReached5x: true,
      }),
      currentPrice: 0.51,
      orderBook: { ...orderBook, bestBid: 0.51, bestAsk: 0.52 },
      market: makeMarket(),
      liquidityUsd: 5000,
    });

    expect(result.action).toBe("sell_partial");
    expect(result.reason).toBe("milestone_25x");
    expect(result.sellSizeShares).toBe(20);
    expect(result.milestoneFlag).toBe("soldAt25x");
    expect(result.nextExitState.soldAt25x).toBe(false);
  });

  it("does not duplicate 5x exit when already sold", () => {
    const result = engine.evaluateExit({
      position: makePosition(),
      exitState: baseExitState({ soldAt5x: true, hasReached5x: true }),
      currentPrice: 0.11,
      orderBook,
      market: makeMarket(),
      liquidityUsd: 5000,
    });

    expect(result.action).toBe("hold");
    expect(result.reason).toBe("moonbag_hold");
  });

  it("triggers trailing stop after 5x when price falls 60% from high", () => {
    const result = engine.evaluateExit({
      position: makePosition({
        size: { toNumber: () => 70 } as Position["size"],
      }),
      exitState: baseExitState({
        soldAt5x: true,
        hasReached5x: true,
        recentHighPrice: 0.2,
      }),
      currentPrice: 0.07,
      orderBook: { ...orderBook, bestBid: 0.07, bestAsk: 0.08 },
      market: makeMarket(),
      liquidityUsd: 5000,
    });

    expect(result.action).toBe("sell_all");
    expect(result.reason).toBe("trailing_stop");
    expect(result.sellSizeShares).toBe(70);
  });

  it("never sells more shares than available", () => {
    const result = engine.evaluateExit({
      position: makePosition({
        size: { toNumber: () => 10 } as Position["size"],
      }),
      exitState: baseExitState({ originalSize: 100 }),
      currentPrice: 0.11,
      orderBook,
      market: makeMarket(),
      liquidityUsd: 5000,
    });

    expect(result.sellSizeShares).toBeLessThanOrEqual(10);
  });
});

describe("createExitEngine.previewExits", () => {
  it("returns non-hold actions without executing orders", async () => {
    const placeSellLimitOrder = vi.fn();
    const updateExitState = vi.fn();

    const engine = createExitEngine({
      config,
      repositories: {
        position: {
          findOpen: vi.fn().mockResolvedValue([makePosition()]),
          sumRealizedPnlSince: vi.fn().mockResolvedValue(0),
          updateExitState,
        },
        market: {
          findById: vi.fn().mockResolvedValue(makeMarket()),
        },
        outcome: {
          findByTokenId: vi.fn().mockResolvedValue({
            tokenId: "token-1",
            liquidity: { toNumber: () => 5000 },
          }),
        },
        trade: {
          findByTokenId: vi.fn().mockResolvedValue([]),
        },
      } as never,
      publicClient: {
        getOrderBook: vi.fn().mockResolvedValue(orderBook),
      } as never,
      executionEngine: {
        initialize: vi.fn(),
        placeSellLimitOrder,
      } as never,
      paperTradingEngine: {
        initialize: vi.fn(),
        markToMarket: vi.fn(),
      } as never,
      riskEngine: {} as never,
      feeService: createFeeService({ BUILDER_FEE_BPS: 0 }),
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
    });

    const pending = await engine.previewExits();

    expect(pending).toHaveLength(1);
    expect(pending[0]?.action).toBe("sell_partial");
    expect(pending[0]?.reason).toBe("milestone_5x");
    expect(placeSellLimitOrder).not.toHaveBeenCalled();
    expect(updateExitState).not.toHaveBeenCalled();
  });
});

describe("createExitEngine.run", () => {
  it("does not persist soldAt5x when sell is not filled", async () => {
    const updateExitState = vi.fn();

    const engine = createExitEngine({
      config,
      repositories: {
        position: {
          findOpen: vi.fn().mockResolvedValue([makePosition()]),
          sumRealizedPnlSince: vi.fn().mockResolvedValue(0),
          updateExitState,
        },
        market: {
          findById: vi.fn().mockResolvedValue(makeMarket()),
        },
        outcome: {
          findByTokenId: vi.fn().mockResolvedValue({
            tokenId: "token-1",
            liquidity: { toNumber: () => 5000 },
            updatedAt: new Date(),
          }),
        },
        order: {
          findPendingSellByTokenId: vi.fn().mockResolvedValue(null),
        },
        trade: {
          findByTokenId: vi.fn().mockResolvedValue([]),
        },
      } as never,
      publicClient: {
        getOrderBook: vi.fn().mockResolvedValue(orderBook),
      } as never,
      executionEngine: {
        initialize: vi.fn(),
        placeSellLimitOrder: vi.fn().mockResolvedValue({
          status: "rejected",
          rejectedReason: "Risk rejected",
        }),
      } as never,
      paperTradingEngine: {
        initialize: vi.fn(),
        markToMarket: vi.fn(),
      } as never,
      riskEngine: {} as never,
      feeService: createFeeService({ BUILDER_FEE_BPS: 0 }),
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
    });

    await engine.run();

    const persistedState = updateExitState.mock.calls[0]?.[1] as PositionExitState;
    expect(persistedState.soldAt5x).toBe(false);
  });

  it("skips exit placement when pending SELL exists", async () => {
    const placeSellLimitOrder = vi.fn();

    const engine = createExitEngine({
      config,
      repositories: {
        position: {
          findOpen: vi.fn().mockResolvedValue([makePosition()]),
          sumRealizedPnlSince: vi.fn().mockResolvedValue(0),
          updateExitState: vi.fn(),
        },
        market: {
          findById: vi.fn().mockResolvedValue(makeMarket()),
        },
        outcome: {
          findByTokenId: vi.fn().mockResolvedValue({
            tokenId: "token-1",
            liquidity: { toNumber: () => 5000 },
            updatedAt: new Date(),
          }),
        },
        order: {
          findPendingSellByTokenId: vi.fn().mockResolvedValue({ id: "pending-sell" }),
        },
        trade: {
          findByTokenId: vi.fn().mockResolvedValue([]),
        },
      } as never,
      publicClient: {
        getOrderBook: vi.fn().mockResolvedValue(orderBook),
      } as never,
      executionEngine: {
        initialize: vi.fn(),
        placeSellLimitOrder,
      } as never,
      paperTradingEngine: {
        initialize: vi.fn(),
        markToMarket: vi.fn(),
      } as never,
      riskEngine: {} as never,
      feeService: createFeeService({ BUILDER_FEE_BPS: 0 }),
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
    });

    const summary = await engine.run();

    expect(placeSellLimitOrder).not.toHaveBeenCalled();
    expect(summary.exitsPlaced).toBe(1);
    expect(summary.exitsFilled).toBe(0);
  });
});
