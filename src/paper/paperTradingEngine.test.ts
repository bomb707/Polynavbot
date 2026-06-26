import { describe, expect, it, vi, beforeEach } from "vitest";
import type { PaperOrder, Position, Trade } from "@prisma/client";

import type { Config } from "../config/index.js";
import type { IRepositories } from "../db/repositories/index.js";
import { createFeeService } from "../fees/feeService.js";
import { createPaperTradingEngine } from "./paperTradingEngine.js";
import type { OrderBook } from "../polymarket/publicTypes.js";
import type { IRiskEngine } from "../risk/riskTypes.js";

const allowAllRiskEngine: IRiskEngine = {
  checkOrder: vi.fn().mockResolvedValue({ allowed: true, reason: "Approved" }),
};

const baseConfig = {
  TRADING_MODE: "paper",
  PAPER_STARTING_BALANCE_USD: 500,
  PAPER_PASSIVE_FILL_ON_CROSS: true,
} as Pick<Config, "TRADING_MODE" | "PAPER_STARTING_BALANCE_USD" | "PAPER_PASSIVE_FILL_ON_CROSS"> as Config;

const feeService = createFeeService({ BUILDER_FEE_BPS: 0 });

function makeFeeFreeMarket() {
  return {
    id: "market-1",
    feesEnabled: false,
    feeRate: 0,
    feeExponent: null,
    takerOnly: true,
    makerBaseFeeBps: 0,
    takerBaseFeeBps: 0,
    feeCategory: null,
  };
}

function makeOrder(overrides: Partial<PaperOrder> = {}): PaperOrder {
  return {
    id: "order-1",
    signalId: null,
    marketId: "market-1",
    outcomeId: "outcome-1",
    tokenId: "token-1",
    side: "BUY",
    price: { toNumber: () => 0.02 } as PaperOrder["price"],
    size: { toNumber: () => 100 } as PaperOrder["size"],
    notionalUsd: { toNumber: () => 2 } as PaperOrder["notionalUsd"],
    status: "PENDING",
    filledAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

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
    totalFeesPaidUsd: { toNumber: () => 0 } as Position["totalFeesPaidUsd"],
    grossRealizedPnlUsd: { toNumber: () => 0 } as Position["grossRealizedPnlUsd"],
    netRealizedPnlUsd: { toNumber: () => 0 } as Position["netRealizedPnlUsd"],
    grossUnrealizedPnlUsd: { toNumber: () => 0 } as Position["grossUnrealizedPnlUsd"],
    netUnrealizedPnlUsd: { toNumber: () => 0 } as Position["netUnrealizedPnlUsd"],
    status: "OPEN",
    openedAt: new Date(),
    closedAt: null,
    updatedAt: new Date(),
    ...overrides,
  };
}

function orderBook(overrides: Partial<OrderBook> = {}): OrderBook {
  return {
    tokenId: "token-1",
    bids: [{ price: 0.019, size: 50 }],
    asks: [{ price: 0.018, size: 200 }],
    bestBid: 0.019,
    bestAsk: 0.018,
    spread: 0.001,
    ...overrides,
  };
}

function createMockRepositories(): IRepositories {
  const trades: Trade[] = [];
  let orderCounter = 0;
  let positionCounter = 0;

  return {
    market: {
      findById: vi.fn().mockResolvedValue(makeFeeFreeMarket()),
    } as unknown as IRepositories["market"],
    outcome: {} as IRepositories["outcome"],
    signal: {
      updateStatus: vi.fn().mockResolvedValue({}),
    } as unknown as IRepositories["signal"],
    order: {
      createPaperOrder: vi.fn().mockImplementation(async (data) => {
        orderCounter += 1;
        return makeOrder({
          id: `order-${orderCounter}`,
          side: data.side,
          price: { toNumber: () => Number(data.price) } as PaperOrder["price"],
          size: { toNumber: () => Number(data.size) } as PaperOrder["size"],
          notionalUsd: { toNumber: () => Number(data.notionalUsd) } as PaperOrder["notionalUsd"],
          status: data.status ?? "PENDING",
          signalId: data.signalId ?? null,
          tokenId: data.tokenId,
          marketId: data.marketId,
          outcomeId: data.outcomeId,
        });
      }),
      updatePaperFill: vi.fn().mockImplementation(async (id, data) =>
        makeOrder({ id, status: data.status, filledAt: data.filledAt ?? null }),
      ),
      findPendingPaperOrders: vi.fn().mockResolvedValue([]),
    } as unknown as IRepositories["order"],
    position: {
      findOpenByTokenId: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(async (data) => {
        positionCounter += 1;
        return makePosition({
          id: `pos-${positionCounter}`,
          tokenId: data.tokenId,
          size: { toNumber: () => Number(data.size) } as Position["size"],
          avgEntryPrice: { toNumber: () => Number(data.avgEntryPrice) } as Position["avgEntryPrice"],
          costBasisUsd: { toNumber: () => Number(data.costBasisUsd) } as Position["costBasisUsd"],
        });
      }),
      update: vi.fn().mockImplementation(async (id, data) =>
        makePosition({
          id,
          size: data.size != null ? { toNumber: () => Number(data.size) } as Position["size"] : undefined,
          avgEntryPrice:
            data.avgEntryPrice != null
              ? ({ toNumber: () => Number(data.avgEntryPrice) } as Position["avgEntryPrice"])
              : undefined,
          costBasisUsd:
            data.costBasisUsd != null
              ? ({ toNumber: () => Number(data.costBasisUsd) } as Position["costBasisUsd"])
              : undefined,
          realizedPnlUsd:
            data.realizedPnlUsd != null
              ? ({ toNumber: () => Number(data.realizedPnlUsd) } as Position["realizedPnlUsd"])
              : undefined,
        }),
      ),
      close: vi.fn().mockImplementation(async (id, data) =>
        makePosition({
          id,
          status: "CLOSED",
          realizedPnlUsd: { toNumber: () => Number(data.realizedPnlUsd) } as Position["realizedPnlUsd"],
        }),
      ),
      findOpen: vi.fn().mockResolvedValue([]),
    } as unknown as IRepositories["position"],
    riskEvent: {} as IRepositories["riskEvent"],
    snapshot: {} as IRepositories["snapshot"],
    trade: {
      create: vi.fn().mockImplementation(async (data) => {
        const trade = {
          id: `trade-${trades.length + 1}`,
          orderId: data.orderId,
          size: { toNumber: () => Number(data.size) },
          notionalUsd: { toNumber: () => Number(data.notionalUsd) },
          side: data.side,
        } as unknown as Trade;
        trades.push(trade);
        return trade;
      }),
      findByOrderId: vi.fn().mockImplementation(async (orderId: string) =>
        trades.filter((trade) => trade.orderId === orderId),
      ),
      sumNotionalBySide: vi.fn().mockImplementation(async (_source, side) => {
        return trades
          .filter((trade) => trade.side === side)
          .reduce((sum, trade) => sum + (trade.notionalUsd as { toNumber(): number }).toNumber(), 0);
      }),
      sumRealizedPnl: vi.fn().mockResolvedValue(0),
      sumNetCashFlow: vi.fn().mockResolvedValue(0),
    } as unknown as IRepositories["trade"],
  };
}

function createEngine(repositories: IRepositories) {
  return createPaperTradingEngine({
    config: baseConfig,
    repositories,
    logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() } as never,
    riskEngine: allowAllRiskEngine,
    feeService,
  });
}

describe("createPaperTradingEngine", () => {
  let repositories: IRepositories;

  beforeEach(() => {
    repositories = createMockRepositories();
  });

  it("fills BUY when bestAsk <= limit price", async () => {
    const engine = createEngine(repositories);
    await engine.initialize();

    const { order } = await engine.placeLimitOrder({
      marketId: "market-1",
      outcomeId: "outcome-1",
      tokenId: "token-1",
      side: "BUY",
      limitPrice: 0.02,
      sizeUsd: 2,
    });

    const result = await engine.simulateFill(order, { orderBook: orderBook() });

    expect(result.filled).toBe(true);
    expect(result.fillPrice).toBe(0.018);
    expect(result.orderStatus).toBe("FILLED");
    expect(repositories.trade.create).toHaveBeenCalled();
    expect(repositories.position.create).toHaveBeenCalled();
    expect(engine.getCashBalance()).toBeCloseTo(498.2, 2);
  });

  it("keeps BUY pending when bestAsk > limit price", async () => {
    const engine = createEngine(repositories);
    await engine.initialize();

    const { order } = await engine.placeLimitOrder({
      marketId: "market-1",
      outcomeId: "outcome-1",
      tokenId: "token-1",
      side: "BUY",
      limitPrice: 0.01,
      sizeUsd: 2,
    });

    const result = await engine.simulateFill(
      order,
      { orderBook: orderBook({ bestAsk: 0.02, asks: [{ price: 0.02, size: 100 }] }) },
    );

    expect(result.filled).toBe(false);
    expect(repositories.trade.create).not.toHaveBeenCalled();
  });

  it("rejects BUY when cash is insufficient", async () => {
    const engine = createPaperTradingEngine({
      config: { ...baseConfig, PAPER_STARTING_BALANCE_USD: 1 } as Config,
      repositories,
      logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() } as never,
      riskEngine: allowAllRiskEngine,
      feeService,
    });
    await engine.initialize();

    const { order, rejectedReason } = await engine.placeLimitOrder({
      marketId: "market-1",
      outcomeId: "outcome-1",
      tokenId: "token-1",
      side: "BUY",
      limitPrice: 0.02,
      sizeUsd: 2,
    });

    expect(rejectedReason).toBe("Insufficient cash balance (including fees)");
    expect(order.status).toBe("FAILED");
  });

  it("updates weighted average entry on second BUY", async () => {
    const engine = createEngine(repositories);
    await engine.initialize();

    vi.mocked(repositories.position.findOpenByTokenId)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(
        makePosition({
          size: { toNumber: () => 50 } as Position["size"],
          avgEntryPrice: { toNumber: () => 0.02 } as Position["avgEntryPrice"],
          costBasisUsd: { toNumber: () => 1 } as Position["costBasisUsd"],
        }),
      );

    const first = await engine.placeLimitOrder({
      marketId: "market-1",
      outcomeId: "outcome-1",
      tokenId: "token-1",
      side: "BUY",
      limitPrice: 0.02,
      sizeUsd: 1,
    });
    await engine.simulateFill(first.order, { orderBook: orderBook() });

    const second = await engine.placeLimitOrder({
      marketId: "market-1",
      outcomeId: "outcome-1",
      tokenId: "token-1",
      side: "BUY",
      limitPrice: 0.02,
      sizeUsd: 1,
    });
    await engine.simulateFill(second.order, { orderBook: orderBook() });

    expect(repositories.position.update).toHaveBeenCalled();
    const updateCall = vi.mocked(repositories.position.update).mock.calls[0]?.[1];
    expect(updateCall?.avgEntryPrice).toBeCloseTo(0.019, 3);
  });

  it("partially fills when top-of-book size is smaller than order", async () => {
    const engine = createEngine(repositories);
    await engine.initialize();

    const { order } = await engine.placeLimitOrder({
      marketId: "market-1",
      outcomeId: "outcome-1",
      tokenId: "token-1",
      side: "BUY",
      limitPrice: 0.02,
      sizeUsd: 4,
    });

    const result = await engine.simulateFill(
      order,
      { orderBook: orderBook({ asks: [{ price: 0.018, size: 50 }], bestAsk: 0.018 }) },
    );

    expect(result.filled).toBe(true);
    expect(result.fillSize).toBe(50);
    expect(result.orderStatus).toBe("PARTIALLY_FILLED");
  });

  it("fills SELL and realizes PnL", async () => {
    vi.mocked(repositories.position.findOpenByTokenId).mockResolvedValue(
      makePosition({
        size: { toNumber: () => 100 } as Position["size"],
        avgEntryPrice: { toNumber: () => 0.02 } as Position["avgEntryPrice"],
        costBasisUsd: { toNumber: () => 2 } as Position["costBasisUsd"],
      }),
    );

    const engine = createEngine(repositories);
    await engine.initialize();

    const sellOrder = makeOrder({
      id: "sell-1",
      side: "SELL",
      price: { toNumber: () => 0.025 } as PaperOrder["price"],
      size: { toNumber: () => 50 } as PaperOrder["size"],
      notionalUsd: { toNumber: () => 1.25 } as PaperOrder["notionalUsd"],
    });

    const result = await engine.simulateFill(sellOrder, {
      orderBook: orderBook({
        bestBid: 0.025,
        bids: [{ price: 0.025, size: 100 }],
      }),
    });

    expect(result.filled).toBe(true);
    expect(repositories.position.update).toHaveBeenCalled();
    const updateCall = vi.mocked(repositories.position.update).mock.calls[0]?.[1];
    expect(updateCall?.realizedPnlUsd).toBeCloseTo(0.25, 2);
  });

  it("fills BUY on passive ask cross through limit", async () => {
    const engine = createEngine(repositories);
    await engine.initialize();

    const { order } = await engine.placeLimitOrder({
      marketId: "market-1",
      outcomeId: "outcome-1",
      tokenId: "token-1",
      side: "BUY",
      limitPrice: 0.02,
      sizeUsd: 2,
    });

    const result = await engine.simulateFill(order, {
      orderBook: orderBook({ bestAsk: 0.02, asks: [{ price: 0.02, size: 100 }] }),
      previousBestAsk: 0.025,
    });

    expect(result.filled).toBe(true);
  });
});
