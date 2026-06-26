import type { Config } from "../config/index.js";
import type { ILogger } from "../logger/types.js";
import { createHttpClient, type HttpClient } from "./http.js";
import {
  parseNumberArrayField,
  parseStringArrayField,
  rawActivityItemSchema,
  rawActivityResponseSchema,
  rawGammaMarketSchema,
  rawGammaMarketsResponseSchema,
  rawOrderBookSchema,
  rawPriceHistorySchema,
} from "./schemas.js";
import type {
  ActivityItem,
  GetActiveMarketsParams,
  GetActiveMarketsResult,
  NormalizedMarket,
  NormalizedOutcome,
  OrderBook,
  PriceHistoryPoint,
} from "./publicTypes.js";

export interface IPublicClient {
  getActiveMarkets(params: GetActiveMarketsParams): Promise<GetActiveMarketsResult>;
  getMarketBySlug(slug: string): Promise<NormalizedMarket | null>;
  getOrderBook(tokenId: string): Promise<OrderBook | null>;
  getPricesHistory(
    tokenId: string,
    startTs: number,
    endTs: number,
    interval: string,
  ): Promise<PriceHistoryPoint[]>;
  getUserActivity(
    walletAddress: string,
    limit: number,
    offset: number,
  ): Promise<ActivityItem[]>;
  normalizeMarket(rawMarket: unknown): NormalizedMarket | null;
  normalizeOutcome(
    rawMarket: unknown,
    outcomeIndex: number,
  ): NormalizedOutcome | null;
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function inferSide(name: string, index: number): "YES" | "NO" {
  const normalized = name.trim().toLowerCase();
  if (normalized === "yes" || normalized === "y") {
    return "YES";
  }
  if (normalized === "no" || normalized === "n") {
    return "NO";
  }
  return index === 0 ? "YES" : "NO";
}

function extractGammaMarkets(payload: unknown): unknown[] {
  const parsed = rawGammaMarketsResponseSchema.safeParse(payload);
  if (!parsed.success) {
    return [];
  }
  if (Array.isArray(parsed.data)) {
    return parsed.data;
  }
  return parsed.data.data ?? [];
}

function extractActivityItems(payload: unknown): unknown[] {
  const parsed = rawActivityResponseSchema.safeParse(payload);
  if (!parsed.success) {
    return [];
  }
  if (Array.isArray(parsed.data)) {
    return parsed.data;
  }
  return parsed.data.data ?? [];
}

export function createPublicClient(
  config: Pick<Config, "POLY_GAMMA_API_URL" | "POLY_CLOB_HOST" | "POLY_DATA_API_URL">,
  logger: ILogger,
  httpClient?: HttpClient,
): IPublicClient {
  const http = httpClient ?? createHttpClient(logger);

  const normalizeOutcome = (
    rawMarket: unknown,
    outcomeIndex: number,
  ): NormalizedOutcome | null => {
    const parsed = rawGammaMarketSchema.safeParse(rawMarket);
    if (!parsed.success) {
      return null;
    }

    const market = parsed.data;
    const outcomes = parseStringArrayField(market.outcomes);
    const prices = parseNumberArrayField(
      market.outcomePrices ?? market.outcome_prices,
    );
    const tokenIds = parseStringArrayField(
      market.clobTokenIds ?? market.clob_token_ids,
    );

    const name = outcomes[outcomeIndex];
    const tokenId = tokenIds[outcomeIndex];
    if (!name || !tokenId) {
      return null;
    }

    return {
      tokenId,
      name,
      side: inferSide(name, outcomeIndex),
      price: prices[outcomeIndex] ?? null,
      outcomeIndex,
    };
  };

  const normalizeMarket = (rawMarket: unknown): NormalizedMarket | null => {
    const parsed = rawGammaMarketSchema.safeParse(rawMarket);
    if (!parsed.success) {
      logger.warn(
        { issues: parsed.error.issues },
        "Failed to parse raw Polymarket market",
      );
      return null;
    }

    const market = parsed.data;
    const polymarketMarketId = String(market.id);
    const conditionId = market.conditionId ?? market.condition_id;
    const question = market.question;

    if (!conditionId || !question) {
      logger.warn(
        { polymarketMarketId },
        "Skipping market with missing conditionId or question",
      );
      return null;
    }

    const outcomeNames = parseStringArrayField(market.outcomes);
    const outcomes: NormalizedOutcome[] = [];

    for (let index = 0; index < outcomeNames.length; index++) {
      const outcome = normalizeOutcome(market, index);
      if (outcome) {
        outcomes.push(outcome);
      }
    }

    if (outcomes.length === 0) {
      logger.warn({ polymarketMarketId }, "Skipping market with no valid outcomes");
      return null;
    }

    return {
      polymarketMarketId,
      conditionId,
      question,
      slug: market.slug ?? null,
      category: market.category ?? null,
      active: market.active ?? false,
      closed: market.closed ?? false,
      archived: market.archived ?? false,
      enableOrderBook:
        market.enableOrderBook ?? market.enable_order_book ?? false,
      endDate: parseDate(market.endDate ?? market.end_date_iso),
      outcomes,
    };
  };

  const getActiveMarkets = async (
    params: GetActiveMarketsParams,
  ): Promise<GetActiveMarketsResult> => {
    const url = new URL("/markets", config.POLY_GAMMA_API_URL);
    url.searchParams.set("active", "true");
    url.searchParams.set("closed", "false");
    url.searchParams.set("limit", String(params.limit));
    url.searchParams.set("offset", String(params.offset));
    if (params.category) {
      url.searchParams.set("category", params.category);
    }
    if (params.tag) {
      url.searchParams.set("tag", params.tag);
    }

    const payload = await http.fetchJson<unknown>(url.toString());
    const rawMarkets = extractGammaMarkets(payload);
    const markets: NormalizedMarket[] = [];
    let skipped = 0;

    rawMarkets.forEach((rawMarket, index) => {
      const normalized = normalizeMarket(rawMarket);
      if (normalized) {
        markets.push(normalized);
      } else {
        skipped += 1;
        logger.warn(
          { index, rawMarketId: (rawMarket as { id?: unknown })?.id },
          "Skipped malformed market in active markets response",
        );
      }
    });

    return { markets, total: rawMarkets.length, skipped };
  };

  const getMarketBySlug = async (slug: string): Promise<NormalizedMarket | null> => {
    const url = new URL(`/markets/slug/${encodeURIComponent(slug)}`, config.POLY_GAMMA_API_URL);
    const payload = await http.fetchJson<unknown>(url.toString());
    const normalized = normalizeMarket(payload);
    if (!normalized) {
      logger.warn({ slug }, "Failed to normalize market by slug");
    }
    return normalized;
  };

  const getOrderBook = async (tokenId: string): Promise<OrderBook | null> => {
    const url = new URL("/book", config.POLY_CLOB_HOST);
    url.searchParams.set("token_id", tokenId);

    let payload: unknown;
    try {
      payload = await http.fetchJson<unknown>(url.toString());
    } catch (error) {
      logger.error({ tokenId, err: String(error) }, "Failed to fetch order book");
      return null;
    }

    const parsed = rawOrderBookSchema.safeParse(payload);
    if (!parsed.success) {
      logger.warn({ tokenId, issues: parsed.error.issues }, "Invalid order book response");
      return null;
    }

    const bids = (parsed.data.bids ?? []).map((level) => ({
      price: Number(level.price),
      size: Number(level.size),
    }));
    const asks = (parsed.data.asks ?? []).map((level) => ({
      price: Number(level.price),
      size: Number(level.size),
    }));

    const bestBid = bids.length > 0 ? Math.max(...bids.map((b) => b.price)) : null;
    const bestAsk = asks.length > 0 ? Math.min(...asks.map((a) => a.price)) : null;
    const spread =
      bestBid !== null && bestAsk !== null ? bestAsk - bestBid : null;

    return { tokenId, bids, asks, bestBid, bestAsk, spread };
  };

  const getPricesHistory = async (
    tokenId: string,
    startTs: number,
    endTs: number,
    interval: string,
  ): Promise<PriceHistoryPoint[]> => {
    const url = new URL("/prices-history", config.POLY_CLOB_HOST);
    url.searchParams.set("market", tokenId);
    url.searchParams.set("startTs", String(startTs));
    url.searchParams.set("endTs", String(endTs));
    url.searchParams.set("interval", interval);

    let payload: unknown;
    try {
      payload = await http.fetchJson<unknown>(url.toString());
    } catch (error) {
      logger.error({ tokenId, err: String(error) }, "Failed to fetch price history");
      return [];
    }

    const parsed = rawPriceHistorySchema.safeParse(payload);
    if (!parsed.success) {
      logger.warn(
        { tokenId, issues: parsed.error.issues },
        "Invalid price history response",
      );
      return [];
    }

    return parsed.data.history
      .map((point) => {
        const timestamp = new Date(Number(point.t) * 1000);
        const price = Number(point.p);
        if (Number.isNaN(timestamp.getTime()) || Number.isNaN(price)) {
          return null;
        }
        return { timestamp, price };
      })
      .filter((point): point is PriceHistoryPoint => point !== null);
  };

  const getUserActivity = async (
    walletAddress: string,
    limit: number,
    offset: number,
  ): Promise<ActivityItem[]> => {
    const url = new URL("/activity", config.POLY_DATA_API_URL);
    url.searchParams.set("user", walletAddress);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("offset", String(offset));

    let payload: unknown;
    try {
      payload = await http.fetchJson<unknown>(url.toString());
    } catch (error) {
      logger.error(
        { walletAddress, err: String(error) },
        "Failed to fetch user activity",
      );
      return [];
    }

    const items: ActivityItem[] = [];
    for (const rawItem of extractActivityItems(payload)) {
      const parsed = rawActivityItemSchema.safeParse(rawItem);
      if (!parsed.success) {
        logger.warn({ issues: parsed.error.issues }, "Skipped malformed activity item");
        continue;
      }

      const item = parsed.data;
      const timestampValue = item.timestamp;
      const timestamp =
        timestampValue === null || timestampValue === undefined
          ? null
          : new Date(
              typeof timestampValue === "number" && timestampValue < 1_000_000_000_000
                ? timestampValue * 1000
                : Number(timestampValue),
            );

      items.push({
        type: item.type ?? null,
        timestamp: timestamp && !Number.isNaN(timestamp.getTime()) ? timestamp : null,
        asset: item.asset ?? null,
        side: item.side ?? null,
        size: toNumber(item.size),
        price: toNumber(item.price),
        raw: item as Record<string, unknown>,
      });
    }

    return items;
  };

  return {
    getActiveMarkets,
    getMarketBySlug,
    getOrderBook,
    getPricesHistory,
    getUserActivity,
    normalizeMarket,
    normalizeOutcome,
  };
}
