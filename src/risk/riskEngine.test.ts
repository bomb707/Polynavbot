import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Market, Outcome, PaperOrder, Position } from "@prisma/client";

import type { Config } from "../config/index.js";
import type { IRepositories } from "../db/repositories/index.js";
import { createRiskEngine } from "./riskEngine.js";
import type { OrderRiskCheckInput } from "./riskTypes.js";

const baseConfig = {
  MAX_DAILY_SPEND_USD: 25,
  MAX_POSITION_SIZE_USD: 2,
  MAX_MARKET_EXPOSURE_USD: 10,
  MAX_THEME_EXPOSURE_USD: 25,
  MIN_ENTRY_PRICE: 0.005,
  MAX_ENTRY_PRICE: 0.04,
  MIN_LIQUIDITY_USD: 1000,
  MAX_SPREAD: 0.03,
  MAX_OPEN_EXPOSURE_USD: 50,
  MAX_OPEN_POSITIONS: 25,
  MAX_OPEN_ORDERS: 10,
  MIN_ORDER_SIZE_USD: 0.5,
  MAX_ORDER_SIZE_USD: 2,
  MAX_OUTCOMES_PER_MARKET: 2,
  ALLOW_BOTH_SIDES_SAME_MARKET: false,
  MAX_DAILY_LOSS_USD: 10,
  DATA_STALE_SECONDS: 300,
} as Config;

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

function makeOutcome(overrides: Partial<Outcome> = {}): Outcome {
  return {
    id: "outcome-1",
    marketId: "market-1",
    tokenId: "token-1",
    name: "Yes",
    side: "YES",
    currentPrice: { toNumber: () => 0.02 } as Outcome["currentPrice"],
    bestBid: null,
    bestAsk: null,
    spread: null,
    liquidity: { toNumber: () => 5000 } as Outcome["liquidity"],
    volume: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function baseInput(overrides: Partial<OrderRiskCheckInput> = {}): OrderRiskCheckInput {
  return {
    marketId: "market-1",
    outcomeId: "outcome-1",
    tokenId: "token-1",
    side: "BUY",
    limitPrice: 0.02,
    sizeUsd: 1.5,
    isNewEntry: true,
    spread: 0.01,
    liquidityUsd: 5000,
    dataUpdatedAt: new Date(),
    ...overrides,
  };
}

function createMockRepositories(options?: {
  market?: Market | null;
  outcome?: Outcome | null;
  openPositions?: Position[];
  pendingOrders?: PaperOrder[];
  todayBuyNotional?: number;
  todayRealizedPnl?: number;
  pendingOrderCount?: number;
  marketOutcomes?: Outcome[];
}): IRepositories {
  const riskEventCreate = vi.fn().mockResolvedValue({});

  return {
    market: {
      findById: vi.fn().mockResolvedValue(options?.market ?? makeMarket()),
    } as unknown as IRepositories["market"],
    outcome: {
      findByTokenId: vi.fn().mockResolvedValue(options?.outcome ?? makeOutcome()),
      findByMarketId: vi
        .fn()
        .mockResolvedValue(
          options?.marketOutcomes ?? [
            makeOutcome({ id: "outcome-1", side: "YES" }),
            makeOutcome({ id: "outcome-2", tokenId: "token-2", side: "NO" }),
          ],
        ),
    } as unknown as IRepositories["outcome"],
    signal: {} as IRepositories["signal"],
    order: {
      findPendingPaperOrders: vi.fn().mockResolvedValue(options?.pendingOrders ?? []),
      countPendingPaperOrders: vi
        .fn()
        .mockResolvedValue(options?.pendingOrderCount ?? options?.pendingOrders?.length ?? 0),
    } as unknown as IRepositories["order"],
    position: {
      findOpen: vi.fn().mockResolvedValue(options?.openPositions ?? []),
      sumRealizedPnlSince: vi.fn().mockResolvedValue(options?.todayRealizedPnl ?? 0),
    } as unknown as IRepositories["position"],
    riskEvent: {
      create: riskEventCreate,
    } as unknown as IRepositories["riskEvent"],
    snapshot: {} as IRepositories["snapshot"],
    trade: {
      findByOrderId: vi.fn().mockResolvedValue([]),
      sumNotionalSince: vi.fn().mockResolvedValue(options?.todayBuyNotional ?? 0),
    } as unknown as IRepositories["trade"],
  };
}

describe("createRiskEngine", () => {
  let repositories: IRepositories;

  beforeEach(() => {
    repositories = createMockRepositories();
  });

  it("rejects missing tokenId", async () => {
    const engine = createRiskEngine({
      config: baseConfig,
      repositories,
      logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() } as never,
    });

    const result = await engine.checkOrder(baseInput({ tokenId: "" }));

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("tokenId");
    expect(repositories.riskEvent.create).toHaveBeenCalled();
  });

  it("rejects closed market", async () => {
    repositories = createMockRepositories({
      market: makeMarket({ closed: true }),
    });
    const engine = createRiskEngine({
      config: baseConfig,
      repositories,
      logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() } as never,
    });

    const result = await engine.checkOrder(baseInput());

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("inactive");
    expect(repositories.riskEvent.create).toHaveBeenCalled();
  });

  it("rejects price above MAX_ENTRY_PRICE", async () => {
    const engine = createRiskEngine({
      config: baseConfig,
      repositories,
      logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() } as never,
    });

    const result = await engine.checkOrder(baseInput({ limitPrice: 0.05 }));

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("maximum");
  });

  it("rejects spread too wide", async () => {
    const engine = createRiskEngine({
      config: baseConfig,
      repositories,
      logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() } as never,
    });

    const result = await engine.checkOrder(baseInput({ spread: 0.05 }));

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Spread");
    expect(repositories.riskEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: "SPREAD" }),
    );
  });

  it("rejects low liquidity", async () => {
    const engine = createRiskEngine({
      config: baseConfig,
      repositories,
      logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() } as never,
    });

    const result = await engine.checkOrder(baseInput({ liquidityUsd: 100 }));

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Liquidity");
    expect(repositories.riskEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: "LIQUIDITY" }),
    );
  });

  it("rejects when daily spend exceeded", async () => {
    repositories = createMockRepositories({ todayBuyNotional: 24.75 });
    const engine = createRiskEngine({
      config: baseConfig,
      repositories,
      logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() } as never,
    });

    const result = await engine.checkOrder(baseInput({ sizeUsd: 2 }));

    expect(result.allowed).toBe(false);
    expect(repositories.riskEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: "DAILY_LIMIT" }),
    );
  });

  it("rejects when max open positions reached", async () => {
    const openPositions = Array.from({ length: 25 }, (_, index) => ({
      id: `pos-${index}`,
      marketId: `market-${index}`,
      outcomeId: `outcome-${index}`,
      tokenId: `token-${index}`,
      side: "BUY" as const,
      avgEntryPrice: { toNumber: () => 0.02 },
      currentPrice: { toNumber: () => 0.02 },
      size: { toNumber: () => 50 },
      costBasisUsd: { toNumber: () => 1 },
      currentValueUsd: { toNumber: () => 1 },
      realizedPnlUsd: { toNumber: () => 0 },
      unrealizedPnlUsd: { toNumber: () => 0 },
      status: "OPEN" as const,
      openedAt: new Date(),
      closedAt: null,
      updatedAt: new Date(),
    })) as Position[];

    repositories = createMockRepositories({ openPositions });
    const engine = createRiskEngine({
      config: baseConfig,
      repositories,
      logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() } as never,
    });

    const result = await engine.checkOrder(baseInput({ tokenId: "new-token" }));

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("positions");
  });

  it("rejects YES/NO conflict when not allowed", async () => {
    repositories = createMockRepositories({
      openPositions: [
        {
          id: "pos-1",
          marketId: "market-1",
          outcomeId: "outcome-2",
          tokenId: "token-2",
          side: "BUY",
          avgEntryPrice: { toNumber: () => 0.02 },
          currentPrice: { toNumber: () => 0.02 },
          size: { toNumber: () => 50 },
          costBasisUsd: { toNumber: () => 1 },
          currentValueUsd: { toNumber: () => 1 },
          realizedPnlUsd: { toNumber: () => 0 },
          unrealizedPnlUsd: { toNumber: () => 0 },
          status: "OPEN",
          openedAt: new Date(),
          closedAt: null,
          updatedAt: new Date(),
        } as Position,
      ],
      outcome: makeOutcome({ side: "YES" }),
    });

    const engine = createRiskEngine({
      config: baseConfig,
      repositories,
      logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() } as never,
    });

    const result = await engine.checkOrder(baseInput({ outcomeId: "outcome-1", side: "BUY" }));

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("YES and NO");
  });

  it("rejects theme exposure exceeded", async () => {
    repositories = createMockRepositories({
      market: makeMarket({ id: "market-2", category: "politics" }),
      openPositions: [
        {
          id: "pos-1",
          marketId: "market-2",
          outcomeId: "outcome-1",
          tokenId: "token-2",
          side: "BUY",
          avgEntryPrice: { toNumber: () => 0.02 },
          currentPrice: { toNumber: () => 0.02 },
          size: { toNumber: () => 50 },
          costBasisUsd: { toNumber: () => 24.75 },
          currentValueUsd: { toNumber: () => 24.75 },
          realizedPnlUsd: { toNumber: () => 0 },
          unrealizedPnlUsd: { toNumber: () => 0 },
          status: "OPEN",
          openedAt: new Date(),
          closedAt: null,
          updatedAt: new Date(),
        } as Position,
      ],
    });
    vi.mocked(repositories.market.findById).mockImplementation(async (id: string) => {
      if (id === "market-1") {
        return makeMarket({ id: "market-1", category: "politics" });
      }
      return makeMarket({ id: "market-2", category: "politics" });
    });

    const engine = createRiskEngine({
      config: baseConfig,
      repositories,
      logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() } as never,
    });

    const result = await engine.checkOrder(baseInput({ marketId: "market-1", sizeUsd: 2 }));

    expect(result.allowed).toBe(false);
    expect(repositories.riskEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: "THEME_EXPOSURE" }),
    );
  });

  it("rejects stale API data", async () => {
    const staleDate = new Date(Date.now() - 600_000);
    const engine = createRiskEngine({
      config: baseConfig,
      repositories,
      logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() } as never,
    });

    const result = await engine.checkOrder(baseInput({ dataUpdatedAt: staleDate }));

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("stale");
  });

  it("adjusts size to fit headroom", async () => {
    repositories = createMockRepositories({ todayBuyNotional: 23.6 });
    const engine = createRiskEngine({
      config: baseConfig,
      repositories,
      logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() } as never,
    });

    const result = await engine.checkOrder(baseInput({ sizeUsd: 2 }));

    expect(result.allowed).toBe(true);
    expect(result.adjustedSizeUsd).toBeCloseTo(1.4, 1);
    expect(result.reason).toContain("reduced");
  });

  it("approves clean order without risk event", async () => {
    const engine = createRiskEngine({
      config: baseConfig,
      repositories,
      logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() } as never,
    });

    const result = await engine.checkOrder(baseInput());

    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("Approved");
    expect(repositories.riskEvent.create).not.toHaveBeenCalled();
  });
});
