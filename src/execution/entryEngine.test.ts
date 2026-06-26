import { describe, expect, it, vi } from "vitest";
import type { PaperOrder } from "@prisma/client";

import type { Config } from "../config/index.js";
import type { IRepositories } from "../db/repositories/index.js";
import { createFeeService } from "../fees/feeService.js";
import { createEntryEngine } from "./entryEngine.js";
import type { OrderBook } from "../polymarket/publicTypes.js";

const config = {
  TRADING_MODE: "paper",
  MIN_ENTRY_PRICE: 0.005,
  MAX_ENTRY_PRICE: 0.04,
  MAX_SPREAD: 0.03,
  MIN_ORDER_SIZE_USD: 0.5,
  ENTRY_SIGNAL_DEDUP_MINUTES: 10,
} as Config;

const orderBook: OrderBook = {
  tokenId: "token-1",
  bids: [{ price: 0.02, size: 100 }],
  asks: [{ price: 0.022, size: 100 }],
  bestBid: 0.02,
  bestAsk: 0.022,
  spread: 0.002,
};

const entryEngineExtras = {
  feeService: createFeeService({ BUILDER_FEE_BPS: 0 }),
  paperTradingEngine: {
    getCashBalance: vi.fn().mockReturnValue(1000),
    initialize: vi.fn().mockResolvedValue(undefined),
  },
};

function makePaperOrder(id: string): PaperOrder {
  return {
    id,
    signalId: "signal-1",
    marketId: "market-1",
    outcomeId: "outcome-1",
    tokenId: "token-1",
    side: "BUY",
    price: { toNumber: () => 0.021 } as PaperOrder["price"],
    size: { toNumber: () => 50 } as PaperOrder["size"],
    notionalUsd: { toNumber: () => 1.5 } as PaperOrder["notionalUsd"],
    status: "PENDING",
    filledAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("createEntryEngine", () => {
  it("rejects non-entry_candidate at score stage", async () => {
    const engine = createEntryEngine({
      config,
      scanner: {
        scanMarkets: vi.fn().mockResolvedValue({
          marketsScanned: 1,
          outcomesScanned: 2,
          candidatesFound: 1,
          skipped: {},
          candidates: [
            {
              marketId: "market-1",
              outcomeId: "outcome-1",
              tokenId: "token-1",
              question: "Will X win?",
              outcomeName: "Yes",
              price: 0.02,
              endDate: null,
              outcomeCount: 2,
            },
          ],
        }),
      },
      scorer: {
        score: vi.fn().mockReturnValue({
          score: 40,
          decision: "watchlist",
          reasons: ["Low score"],
          suggestedEntryPrice: 0.022,
          suggestedSizeUsd: 1.5,
        }),
      },
      riskEngine: { checkOrder: vi.fn() },
      executionEngine: {
        initialize: vi.fn(),
        placeBuyLimitOrder: vi.fn(),
        placeSellLimitOrder: vi.fn(),
        cancelOrder: vi.fn(),
        getOpenOrders: vi.fn(),
        syncTrades: vi.fn(),
      },
      publicClient: {
        getOrderBook: vi.fn().mockResolvedValue(orderBook),
      },
      repositories: {
        market: {
          findById: vi.fn().mockResolvedValue({
            id: "market-1",
            question: "Will X win?",
            category: "politics",
            active: true,
            closed: false,
            archived: false,
            enableOrderBook: true,
            endDate: null,
          }),
        },
        outcome: {
          findByTokenId: vi.fn().mockResolvedValue({
            id: "outcome-1",
            tokenId: "token-1",
            name: "Yes",
            side: "YES",
            liquidity: { toNumber: () => 5000 },
            currentPrice: { toNumber: () => 0.02 },
            updatedAt: new Date(),
          }),
        },
        signal: {
          create: vi.fn(),
          findRecentEntrySignal: vi.fn().mockResolvedValue(null),
          hasPaperOrder: vi.fn().mockResolvedValue(false),
        },
        order: { findPendingBuyByTokenId: vi.fn().mockResolvedValue(null) },
      } as unknown as IRepositories,
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
      ...entryEngineExtras,
    });

    const summary = await engine.run();

    expect(summary.rejected).toHaveLength(1);
    expect(summary.rejected[0]?.stage).toBe("score");
    expect(summary.accepted).toHaveLength(0);
  });

  it("rejects at risk stage and collects reason", async () => {
    const engine = createEntryEngine({
      config,
      scanner: {
        scanMarkets: vi.fn().mockResolvedValue({
          marketsScanned: 1,
          outcomesScanned: 2,
          candidatesFound: 1,
          skipped: {},
          candidates: [
            {
              marketId: "market-1",
              outcomeId: "outcome-1",
              tokenId: "token-1",
              question: "Will X win?",
              outcomeName: "Yes",
              price: 0.02,
              endDate: null,
              outcomeCount: 2,
            },
          ],
        }),
      },
      scorer: {
        score: vi.fn().mockReturnValue({
          score: 80,
          decision: "entry_candidate",
          reasons: ["Good longshot"],
          suggestedEntryPrice: 0.022,
          suggestedSizeUsd: 1.5,
        }),
      },
      riskEngine: { checkOrder: vi.fn() },
      executionEngine: {
        initialize: vi.fn(),
        placeBuyLimitOrder: vi.fn().mockResolvedValue({
          orderId: null,
          status: "rejected",
          rejectedReason: "Daily spend limit exceeded",
        }),
        placeSellLimitOrder: vi.fn(),
        cancelOrder: vi.fn(),
        getOpenOrders: vi.fn(),
        syncTrades: vi.fn(),
      },
      publicClient: {
        getOrderBook: vi.fn().mockResolvedValue(orderBook),
      },
      repositories: {
        market: {
          findById: vi.fn().mockResolvedValue({
            id: "market-1",
            question: "Will X win?",
            category: "politics",
            active: true,
            closed: false,
            archived: false,
            enableOrderBook: true,
            endDate: null,
          }),
        },
        outcome: {
          findByTokenId: vi.fn().mockResolvedValue({
            id: "outcome-1",
            tokenId: "token-1",
            name: "Yes",
            side: "YES",
            liquidity: { toNumber: () => 5000 },
            currentPrice: { toNumber: () => 0.02 },
            updatedAt: new Date(),
          }),
        },
        signal: {
          create: vi.fn().mockResolvedValue({ id: "signal-1" }),
          findRecentEntrySignal: vi.fn().mockResolvedValue(null),
          hasPaperOrder: vi.fn().mockResolvedValue(false),
          updateStatus: vi.fn(),
        },
        order: { findPendingBuyByTokenId: vi.fn().mockResolvedValue(null) },
      } as unknown as IRepositories,
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
      ...entryEngineExtras,
    });

    const summary = await engine.run();

    expect(summary.rejected).toHaveLength(1);
    expect(summary.rejected[0]?.stage).toBe("order");
    expect(summary.riskRejectionReasons).toContain("Daily spend limit exceeded");
  });

  it("accepts entry and sums notional on happy path", async () => {
    const placeBuyLimitOrder = vi.fn().mockResolvedValue({
      orderId: "order-1",
      status: "placed",
      sizeShares: 71.42857142,
      notionalUsd: 1.5,
    });

    const engine = createEntryEngine({
      config,
      scanner: {
        scanMarkets: vi.fn().mockResolvedValue({
          marketsScanned: 1,
          outcomesScanned: 2,
          candidatesFound: 1,
          skipped: {},
          candidates: [
            {
              marketId: "market-1",
              outcomeId: "outcome-1",
              tokenId: "token-1",
              question: "Will X win?",
              outcomeName: "Yes",
              price: 0.02,
              endDate: null,
              outcomeCount: 2,
            },
          ],
        }),
      },
      scorer: {
        score: vi.fn().mockReturnValue({
          score: 80,
          decision: "entry_candidate",
          reasons: ["Good longshot"],
          suggestedEntryPrice: 0.022,
          suggestedSizeUsd: 1.5,
        }),
      },
      riskEngine: { checkOrder: vi.fn() },
      executionEngine: {
        initialize: vi.fn(),
        placeBuyLimitOrder,
        placeSellLimitOrder: vi.fn(),
        cancelOrder: vi.fn(),
        getOpenOrders: vi.fn(),
        syncTrades: vi.fn(),
      },
      publicClient: {
        getOrderBook: vi.fn().mockResolvedValue(orderBook),
      },
      repositories: {
        market: {
          findById: vi.fn().mockResolvedValue({
            id: "market-1",
            question: "Will X win?",
            category: "politics",
            active: true,
            closed: false,
            archived: false,
            enableOrderBook: true,
            endDate: null,
          }),
        },
        outcome: {
          findByTokenId: vi.fn().mockResolvedValue({
            id: "outcome-1",
            tokenId: "token-1",
            name: "Yes",
            side: "YES",
            liquidity: { toNumber: () => 5000 },
            currentPrice: { toNumber: () => 0.02 },
            updatedAt: new Date(),
          }),
        },
        signal: {
          create: vi.fn().mockResolvedValue({ id: "signal-1" }),
          findRecentEntrySignal: vi.fn().mockResolvedValue(null),
          hasPaperOrder: vi.fn().mockResolvedValue(false),
        },
        order: { findPendingBuyByTokenId: vi.fn().mockResolvedValue(null) },
      } as unknown as IRepositories,
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
      ...entryEngineExtras,
    });

    const summary = await engine.run();

    expect(summary.accepted).toHaveLength(1);
    expect(summary.accepted[0]?.bidPrice).toBe(0.021);
    expect(summary.totalNotionalUsd).toBe(1.5);
    expect(placeBuyLimitOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        limitPrice: 0.021,
        sizeUsd: 1.5,
        isNewEntry: true,
      }),
    );
  });

  it("uses provided scan without calling scanner", async () => {
    const scanMarkets = vi.fn();
    const engine = createEntryEngine({
      config,
      scanner: { scanMarkets },
      scorer: {
        score: vi.fn().mockReturnValue({
          score: 40,
          decision: "watchlist",
          reasons: ["Low score"],
          suggestedEntryPrice: 0.022,
          suggestedSizeUsd: 1.5,
        }),
      },
      riskEngine: { checkOrder: vi.fn() },
      executionEngine: {
        initialize: vi.fn(),
        placeBuyLimitOrder: vi.fn(),
        placeSellLimitOrder: vi.fn(),
        cancelOrder: vi.fn(),
        getOpenOrders: vi.fn(),
        syncTrades: vi.fn(),
      },
      publicClient: {
        getOrderBook: vi.fn().mockResolvedValue(orderBook),
      },
      repositories: {
        market: {
          findById: vi.fn().mockResolvedValue({
            id: "market-1",
            question: "Will X win?",
            category: "politics",
            active: true,
            closed: false,
            archived: false,
            enableOrderBook: true,
            endDate: null,
          }),
        },
        outcome: {
          findByTokenId: vi.fn().mockResolvedValue({
            id: "outcome-1",
            tokenId: "token-1",
            name: "Yes",
            side: "YES",
            liquidity: { toNumber: () => 5000 },
            currentPrice: { toNumber: () => 0.02 },
            updatedAt: new Date(),
          }),
        },
        order: {
          findPendingBuyByTokenId: vi.fn().mockResolvedValue(null),
        },
        signal: {
          findRecentEntrySignal: vi.fn().mockResolvedValue(null),
          hasPaperOrder: vi.fn().mockResolvedValue(false),
          create: vi.fn(),
        },
      } as unknown as IRepositories,
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
      ...entryEngineExtras,
    });

    const scan = {
      marketsScanned: 5,
      outcomesScanned: 10,
      candidatesFound: 1,
      skipped: {},
      candidates: [
        {
          marketId: "market-1",
          outcomeId: "outcome-1",
          tokenId: "token-1",
          question: "Will X win?",
          outcomeName: "Yes",
          price: 0.02,
          endDate: null,
          outcomeCount: 2,
        },
      ],
    };

    await engine.run({ scan });

    expect(scanMarkets).not.toHaveBeenCalled();
  });

  it("skips entry when pending BUY order exists", async () => {
    const placeBuyLimitOrder = vi.fn();
    const engine = createEntryEngine({
      config,
      scanner: {
        scanMarkets: vi.fn().mockResolvedValue({
          marketsScanned: 1,
          outcomesScanned: 2,
          candidatesFound: 1,
          skipped: {},
          candidates: [
            {
              marketId: "market-1",
              outcomeId: "outcome-1",
              tokenId: "token-1",
              question: "Will X win?",
              outcomeName: "Yes",
              price: 0.02,
              endDate: null,
              outcomeCount: 2,
            },
          ],
        }),
      },
      scorer: { score: vi.fn() },
      riskEngine: { checkOrder: vi.fn() },
      executionEngine: {
        initialize: vi.fn(),
        placeBuyLimitOrder,
        placeSellLimitOrder: vi.fn(),
        cancelOrder: vi.fn(),
        getOpenOrders: vi.fn(),
        syncTrades: vi.fn(),
      },
      publicClient: { getOrderBook: vi.fn() },
      repositories: {
        market: { findById: vi.fn().mockResolvedValue({ id: "market-1" }) },
        outcome: { findByTokenId: vi.fn().mockResolvedValue({ id: "outcome-1" }) },
        order: {
          findPendingBuyByTokenId: vi.fn().mockResolvedValue(makePaperOrder("pending-1")),
        },
        signal: {
          findRecentEntrySignal: vi.fn(),
          hasPaperOrder: vi.fn(),
          create: vi.fn(),
        },
      } as unknown as IRepositories,
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
      ...entryEngineExtras,
    });

    const summary = await engine.run();

    expect(summary.rejected).toHaveLength(1);
    expect(summary.rejected[0]?.stage).toBe("idempotency");
    expect(placeBuyLimitOrder).not.toHaveBeenCalled();
  });
});
