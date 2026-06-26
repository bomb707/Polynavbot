import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { Position } from "@prisma/client";

import type { Config } from "../config/index.js";
import { createPriceCache } from "./priceCache.js";
import { createWsMonitorService } from "./wsMonitorService.js";
import type { IWsClient, TokenPriceQuote } from "./wsTypes.js";

const config = {
  TRADING_MODE: "paper",
  WS_EXIT_DEBOUNCE_MS: 50,
  WS_SNAPSHOT_INTERVAL_SECONDS: 60,
  WS_SUBSCRIPTION_REFRESH_MS: 60_000,
  WS_REST_RECONCILE_INTERVAL_SECONDS: 120,
} as Config;

function makePosition(): Position {
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
  };
}

describe("createWsMonitorService", () => {
  let marketQuoteHandler: ((quote: TokenPriceQuote) => void) | null = null;
  const wsClient: IWsClient = {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    setMarketSubscriptions: vi.fn(),
    setUserSubscriptions: vi.fn(),
    onMarketQuote(handler) {
      marketQuoteHandler = handler;
    },
    onUserEvent: vi.fn(),
  };

  const markToMarket = vi.fn().mockResolvedValue(makePosition());
  const runForToken = vi.fn().mockResolvedValue(null);
  const snapshotCreate = vi.fn().mockResolvedValue({});
  const getOrderBook = vi.fn();

  const repositories = {
    position: {
      findOpen: vi.fn().mockResolvedValue([makePosition()]),
      findOpenByTokenId: vi.fn().mockResolvedValue(makePosition()),
      update: vi.fn(),
    },
    market: {
      findById: vi.fn().mockResolvedValue({
        id: "market-1",
        conditionId: "cond-1",
        question: "Test?",
      }),
    },
    snapshot: {
      create: snapshotCreate,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    marketQuoteHandler = null;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createService() {
    return createWsMonitorService({
      config,
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
        child: vi.fn(),
      } as never,
      repositories: repositories as never,
      wsClient,
      priceCache: createPriceCache(),
      publicClient: { getOrderBook } as never,
      exitEngine: { runForToken } as never,
      paperTradingEngine: {
        initialize: vi.fn().mockResolvedValue(undefined),
        markToMarket,
      } as never,
    });
  }

  it("debounces exit evaluation on quote updates", async () => {
    const service = createService();
    await service.start();

    expect(marketQuoteHandler).not.toBeNull();
    marketQuoteHandler?.({
      tokenId: "token-1",
      price: 0.11,
      bestBid: 0.1,
      bestAsk: 0.12,
      spread: 0.02,
      lastTradePrice: null,
      updatedAt: new Date(),
      source: "ws",
    });

    marketQuoteHandler?.({
      tokenId: "token-1",
      price: 0.12,
      bestBid: 0.11,
      bestAsk: 0.13,
      spread: 0.02,
      lastTradePrice: null,
      updatedAt: new Date(),
      source: "ws",
    });

    expect(runForToken).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60);
    expect(runForToken).toHaveBeenCalledTimes(1);
    expect(runForToken).toHaveBeenCalledWith("token-1");
    expect(markToMarket).toHaveBeenCalled();

    await service.stop();
  });

  it("throttles snapshot writes", async () => {
    const service = createService();
    await service.start();

    marketQuoteHandler?.({
      tokenId: "token-1",
      price: 0.11,
      bestBid: 0.1,
      bestAsk: 0.12,
      spread: 0.02,
      lastTradePrice: null,
      updatedAt: new Date(),
      source: "ws",
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(snapshotCreate).toHaveBeenCalledTimes(1);

    marketQuoteHandler?.({
      tokenId: "token-1",
      price: 0.12,
      bestBid: 0.11,
      bestAsk: 0.13,
      spread: 0.02,
      lastTradePrice: null,
      updatedAt: new Date(),
      source: "ws",
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(snapshotCreate).toHaveBeenCalledTimes(1);

    await service.stop();
  });

  it("REST reconcile overwrites WS cache", async () => {
    getOrderBook.mockResolvedValue({
      tokenId: "token-1",
      bids: [{ price: 0.2, size: 100 }],
      asks: [{ price: 0.22, size: 100 }],
      bestBid: 0.2,
      bestAsk: 0.22,
      spread: 0.02,
    });

    const priceCache = createPriceCache();
    priceCache.update({
      tokenId: "token-1",
      price: 0.11,
      bestBid: 0.1,
      bestAsk: 0.12,
      source: "ws",
    });

    const service = createWsMonitorService({
      config: {
        ...config,
        WS_REST_RECONCILE_INTERVAL_SECONDS: 1,
      } as Config,
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
        child: vi.fn(),
      } as never,
      repositories: repositories as never,
      wsClient,
      priceCache,
      publicClient: { getOrderBook } as never,
      exitEngine: { runForToken } as never,
      paperTradingEngine: {
        initialize: vi.fn().mockResolvedValue(undefined),
        markToMarket,
      } as never,
    });

    await service.start();
    await vi.advanceTimersByTimeAsync(1000);

    const quote = priceCache.get("token-1");
    expect(quote?.source).toBe("rest");
    expect(quote?.bestBid).toBe(0.2);
    expect(markToMarket).toHaveBeenCalledWith("token-1", expect.closeTo(0.21));

    await service.stop();
  });
});
