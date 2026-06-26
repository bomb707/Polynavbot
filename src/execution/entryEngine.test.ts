import { describe, expect, it, vi } from "vitest";
import type { PaperOrder } from "@prisma/client";

import type { Config } from "../config/index.js";
import type { IRepositories } from "../db/repositories/index.js";
import { createEntryEngine } from "./entryEngine.js";
import type { OrderBook } from "../polymarket/publicTypes.js";

const config = {
  TRADING_MODE: "paper",
  MIN_ENTRY_PRICE: 0.005,
  MAX_ENTRY_PRICE: 0.04,
  MAX_SPREAD: 0.03,
  MIN_ORDER_SIZE_USD: 0.5,
} as Config;

const orderBook: OrderBook = {
  tokenId: "token-1",
  bids: [{ price: 0.02, size: 100 }],
  asks: [{ price: 0.022, size: 100 }],
  bestBid: 0.02,
  bestAsk: 0.022,
  spread: 0.002,
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
      paperTradingEngine: {
        initialize: vi.fn(),
        placeLimitOrder: vi.fn(),
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
        signal: { create: vi.fn() },
      } as unknown as IRepositories,
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
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
      riskEngine: {
        checkOrder: vi.fn().mockResolvedValue({
          allowed: false,
          reason: "Daily spend limit exceeded",
        }),
      },
      paperTradingEngine: {
        initialize: vi.fn(),
        placeLimitOrder: vi.fn(),
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
        signal: { create: vi.fn() },
      } as unknown as IRepositories,
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
    });

    const summary = await engine.run();

    expect(summary.rejected).toHaveLength(1);
    expect(summary.rejected[0]?.stage).toBe("risk");
    expect(summary.riskRejectionReasons).toContain("Daily spend limit exceeded");
  });

  it("accepts entry and sums notional on happy path", async () => {
    const placeLimitOrder = vi.fn().mockResolvedValue({
      order: makePaperOrder("order-1"),
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
      riskEngine: {
        checkOrder: vi.fn().mockResolvedValue({ allowed: true, reason: "Approved" }),
      },
      paperTradingEngine: {
        initialize: vi.fn(),
        placeLimitOrder,
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
        },
      } as unknown as IRepositories,
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
    });

    const summary = await engine.run();

    expect(summary.accepted).toHaveLength(1);
    expect(summary.accepted[0]?.bidPrice).toBe(0.021);
    expect(summary.totalNotionalUsd).toBe(1.5);
    expect(placeLimitOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        limitPrice: 0.021,
        sizeUsd: 1.5,
        skipRiskCheck: true,
      }),
    );
  });
});
