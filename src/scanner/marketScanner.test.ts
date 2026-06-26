import { describe, expect, it, vi } from "vitest";

import type { Config } from "../config/index.js";
import type { IRepositories } from "../db/repositories/index.js";
import type { ILogger } from "../logger/types.js";
import type { IPublicClient } from "../polymarket/publicClient.js";
import type { NormalizedMarket } from "../polymarket/publicTypes.js";
import { PublicApiError } from "../polymarket/http.js";
import { createMarketScanner, GAMMA_MARKETS_MAX_OFFSET } from "./marketScanner.js";
import { SKIP_REASONS } from "./types.js";

function createLogger(): ILogger {
  const noop = () => undefined;
  return {
    fatal: noop,
    error: noop,
    warn: noop,
    info: noop,
    debug: noop,
    child: () => createLogger(),
  };
}

const config = {
  MIN_ENTRY_PRICE: 0.005,
  MAX_ENTRY_PRICE: 0.04,
  MIN_DAYS_TO_EXPIRY: 30,
  MIN_LIQUIDITY_USD: 1000,
} as Pick<
  Config,
  "MIN_ENTRY_PRICE" | "MAX_ENTRY_PRICE" | "MIN_DAYS_TO_EXPIRY" | "MIN_LIQUIDITY_USD"
> as Config;

function validNormalized(overrides: Partial<NormalizedMarket> = {}): NormalizedMarket {
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + 60);

  return {
    polymarketMarketId: "1",
    conditionId: "cond-1",
    question: "Will it happen?",
    slug: "will-it-happen",
    category: "politics",
    active: true,
    closed: false,
    archived: false,
    enableOrderBook: true,
    endDate,
    outcomes: [
      {
        tokenId: "token-yes",
        name: "Yes",
        side: "YES",
        price: 0.02,
        outcomeIndex: 0,
      },
      {
        tokenId: "token-no",
        name: "No",
        side: "NO",
        price: 0.98,
        outcomeIndex: 1,
      },
    ],
    ...overrides,
  };
}

function validRawMarket() {
  return {
    id: "1",
    conditionId: "cond-1",
    question: "Will it happen?",
    active: true,
    closed: false,
    enableOrderBook: true,
    endDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
    liquidityNum: 5000,
    outcomes: '["Yes","No"]',
    outcomePrices: '["0.02","0.98"]',
    clobTokenIds: '["token-yes","token-no"]',
  };
}

function createMockPublicClient(
  overrides: Partial<IPublicClient> = {},
): IPublicClient {
  return {
    getActiveMarkets: vi.fn(),
    getMarketBySlug: vi.fn(),
    getOrderBook: vi.fn().mockResolvedValue(null),
    getPricesHistory: vi.fn(),
    getUserActivity: vi.fn(),
    normalizeMarket: vi.fn(),
    normalizeOutcome: vi.fn(),
    fetchActiveMarketsRaw: vi.fn(),
    ...overrides,
  };
}

function createMockRepositories(): IRepositories {
  return {
    market: {
      upsertByPolymarketId: vi.fn().mockImplementation(async (data) => ({
        id: "db-market-1",
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
      findById: vi.fn(),
      findByPolymarketId: vi.fn(),
      listActive: vi.fn(),
    },
    outcome: {
      upsertByTokenId: vi.fn().mockImplementation(async (data) => ({
        id: `db-outcome-${data.tokenId}`,
        ...data,
        bestBid: null,
        bestAsk: null,
        spread: null,
        liquidity: null,
        volume: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
      findByTokenId: vi.fn(),
      findByMarketId: vi.fn(),
      updatePricing: vi.fn(),
    },
    signal: {} as IRepositories["signal"],
    order: {} as IRepositories["order"],
    position: {} as IRepositories["position"],
    riskEvent: {} as IRepositories["riskEvent"],
    snapshot: {
      create: vi.fn().mockResolvedValue({ id: "snap-1" }),
    },
  };
}

describe("createMarketScanner", () => {
  it("evaluateMarket passes valid longshot YES", () => {
    const publicClient = createMockPublicClient({
      normalizeMarket: vi.fn().mockReturnValue(validNormalized()),
    });
    const scanner = createMarketScanner({
      publicClient,
      repositories: createMockRepositories(),
      config,
      logger: createLogger(),
    });

    const result = scanner.evaluateMarket(validRawMarket());
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.outcome.tokenId).toBe("token-yes");
  });

  it("evaluateMarket rejects price above MAX", () => {
    const publicClient = createMockPublicClient({
      normalizeMarket: vi.fn().mockReturnValue(
        validNormalized({
          outcomes: [
            {
              tokenId: "token-yes",
              name: "Yes",
              side: "YES",
              price: 0.5,
              outcomeIndex: 0,
            },
          ],
        }),
      ),
    });
    const scanner = createMarketScanner({
      publicClient,
      repositories: createMockRepositories(),
      config,
      logger: createLogger(),
    });

    const result = scanner.evaluateMarket(validRawMarket());
    expect(result.candidates).toHaveLength(0);
    expect(result.skips.price_out_of_range).toBe(1);
  });

  it("evaluateMarket rejects NO outcome", () => {
    const publicClient = createMockPublicClient({
      normalizeMarket: vi.fn().mockReturnValue(
        validNormalized({
          outcomes: [
            {
              tokenId: "token-no",
              name: "No",
              side: "NO",
              price: 0.02,
              outcomeIndex: 1,
            },
          ],
        }),
      ),
    });
    const scanner = createMarketScanner({
      publicClient,
      repositories: createMockRepositories(),
      config,
      logger: createLogger(),
    });

    const result = scanner.evaluateMarket(validRawMarket());
    expect(result.candidates).toHaveLength(0);
    expect(result.skips.not_yes).toBe(1);
  });

  it("evaluateMarket rejects low liquidity", () => {
    const publicClient = createMockPublicClient({
      normalizeMarket: vi.fn().mockReturnValue(validNormalized()),
    });
    const scanner = createMarketScanner({
      publicClient,
      repositories: createMockRepositories(),
      config,
      logger: createLogger(),
    });

    const result = scanner.evaluateMarket({
      ...validRawMarket(),
      liquidityNum: 10,
    });
    expect(result.candidates).toHaveLength(0);
    expect(result.skips.low_liquidity).toBe(1);
  });

  it("scanMarkets processes good and bad markets without throwing", async () => {
    const publicClient = createMockPublicClient({
      fetchActiveMarketsRaw: vi
        .fn()
        .mockResolvedValueOnce([validRawMarket(), { id: "bad" }])
        .mockResolvedValueOnce([]),
      normalizeMarket: vi.fn().mockImplementation((raw: { id?: string }) => {
        if (raw.id === "bad") {
          return null;
        }
        return validNormalized();
      }),
      getOrderBook: vi.fn().mockResolvedValue({
        tokenId: "token-yes",
        bids: [{ price: 0.01, size: 100 }],
        asks: [{ price: 0.03, size: 50 }],
        bestBid: 0.01,
        bestAsk: 0.03,
        spread: 0.02,
      }),
    });

    const scanner = createMarketScanner({
      publicClient,
      repositories: createMockRepositories(),
      config,
      logger: createLogger(),
    });

    const summary = await scanner.scanMarkets({ limitPerPage: 10, maxPages: 1 });

    expect(summary.marketsScanned).toBe(1);
    expect(summary.candidatesFound).toBe(1);
    expect(summary.skipped.malformed).toBe(1);
  });

  it("scanMarketPage stops at gamma offset limit without throwing", async () => {
    const fetchActiveMarketsRaw = vi.fn().mockRejectedValue(
      new PublicApiError("Request failed with status 422", {
        url: `https://gamma-api.polymarket.com/markets?offset=${GAMMA_MARKETS_MAX_OFFSET}`,
        status: 422,
        body: '{"error":"offset too large, use /markets/keyset for deeper pagination"}',
      }),
    );
    const publicClient = createMockPublicClient({ fetchActiveMarketsRaw });
    const scanner = createMarketScanner({
      publicClient,
      repositories: createMockRepositories(),
      config,
      logger: createLogger(),
    });

    const page = await scanner.scanMarketPage(100, GAMMA_MARKETS_MAX_OFFSET);
    expect(page.rawMarkets).toEqual([]);
    expect(fetchActiveMarketsRaw).not.toHaveBeenCalled();
  });

  it("aggregates skip summary counters", () => {
    const publicClient = createMockPublicClient({
      normalizeMarket: vi.fn().mockReturnValue(null),
    });
    const scanner = createMarketScanner({
      publicClient,
      repositories: createMockRepositories(),
      config,
      logger: createLogger(),
    });

    const result = scanner.evaluateMarket({ id: "x" });
    expect(result.skips.malformed).toBe(1);
    expect(SKIP_REASONS).toContain("malformed");
  });
});
