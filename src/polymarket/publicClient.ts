import type { Config } from "../config/index.js";
import type { ILogger } from "../logger/types.js";
import { createHttpClient, type HttpClient } from "./http.js";
import {
  extractLiquidity,
  parseNumberArrayField,
  parseStringArrayField,
  rawActivityItemSchema,
  rawActivityResponseSchema,
  rawGammaMarketSchema,
  rawGammaMarketsResponseSchema,
  rawOrderBookSchema,
  rawPriceHistorySchema,
  rawClobMarketInfoSchema,
} from "./schemas.js";
import type {
  ActivityItem,
  GetActiveMarketsParams,
  GetActiveMarketsResult,
  GetBacktestMarketsParams,
  NormalizedMarket,
  NormalizedOutcome,
  OrderBook,
  PriceHistoryPoint,
  ClobMarketInfo,
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
  getBacktestMarkets(start: Date, end: Date, maxMarkets: number): Promise<NormalizedMarket[]>;
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
  fetchActiveMarketsRaw(params: GetActiveMarketsParams): Promise<unknown[]>;
  getClobMarketInfo(conditionId: string): Promise<ClobMarketInfo | null>;
}

const GAMMA_MARKETS_PAGE_SIZE = 100;
/** CLOB /prices-history rejects ranges longer than ~15 days. */
const CLOB_PRICE_HISTORY_MAX_CHUNK_SECONDS = 14 * 24 * 60 * 60;

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
      liquidityUsd: (() => {
        const value = extractLiquidity(rawMarket);
        return value > 0 ? value : null;
      })(),
      volumeUsd: (() => {
        for (const candidate of [market.volumeNum, market.volume]) {
          if (candidate === null || candidate === undefined) {
            continue;
          }
          const num = Number(candidate);
          if (Number.isFinite(num) && num > 0) {
            return num;
          }
        }
        return null;
      })(),
      outcomes,
    };
  };

  const buildActiveMarketsUrl = (params: GetActiveMarketsParams): URL => {
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
    return url;
  };

  const fetchActiveMarketsRaw = async (
    params: GetActiveMarketsParams,
  ): Promise<unknown[]> => {
    const url = buildActiveMarketsUrl(params);
    const payload = await http.fetchJson<unknown>(url.toString());
    return extractGammaMarkets(payload);
  };

  const getActiveMarkets = async (
    params: GetActiveMarketsParams,
  ): Promise<GetActiveMarketsResult> => {
    const rawMarkets = await fetchActiveMarketsRaw(params);
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

  const buildBacktestMarketsUrl = (params: GetBacktestMarketsParams): URL => {
    const url = new URL("/markets", config.POLY_GAMMA_API_URL);
    url.searchParams.set("limit", String(params.limit));
    url.searchParams.set("offset", String(params.offset));
    url.searchParams.set("closed", String(params.closed));
    url.searchParams.set("end_date_min", params.start.toISOString());
    url.searchParams.set("start_date_max", params.end.toISOString());
    return url;
  };

  const fetchBacktestMarketsPage = async (
    params: GetBacktestMarketsParams,
  ): Promise<NormalizedMarket[]> => {
    const url = buildBacktestMarketsUrl(params);
    const payload = await http.fetchJson<unknown>(url.toString());
    const rawMarkets = extractGammaMarkets(payload);
    const markets: NormalizedMarket[] = [];

    for (const rawMarket of rawMarkets) {
      const normalized = normalizeMarket(rawMarket);
      if (normalized?.enableOrderBook) {
        markets.push(normalized);
      }
    }

    return markets;
  };

  const getBacktestMarkets = async (
    start: Date,
    end: Date,
    maxMarkets: number,
  ): Promise<NormalizedMarket[]> => {
    const seen = new Set<string>();
    const markets: NormalizedMarket[] = [];

    for (const closed of [false, true]) {
      let offset = 0;

      while (markets.length < maxMarkets) {
        const page = await fetchBacktestMarketsPage({
          start,
          end,
          limit: GAMMA_MARKETS_PAGE_SIZE,
          offset,
          closed,
        });

        if (page.length === 0) {
          break;
        }

        for (const market of page) {
          if (seen.has(market.polymarketMarketId)) {
            continue;
          }
          seen.add(market.polymarketMarketId);
          markets.push(market);
          if (markets.length >= maxMarkets) {
            break;
          }
        }

        if (page.length < GAMMA_MARKETS_PAGE_SIZE) {
          break;
        }

        offset += GAMMA_MARKETS_PAGE_SIZE;
      }

      if (markets.length >= maxMarkets) {
        break;
      }
    }

    return markets;
  };

  const parsePriceHistoryPayload = (payload: unknown): PriceHistoryPoint[] => {
    if (
      payload !== null &&
      typeof payload === "object" &&
      "error" in payload &&
      typeof (payload as { error?: unknown }).error === "string"
    ) {
      return [];
    }

    const parsed = rawPriceHistorySchema.safeParse(payload);
    if (!parsed.success) {
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

  const filterPointsInRange = (
    points: PriceHistoryPoint[],
    startTs: number,
    endTs: number,
  ): PriceHistoryPoint[] => {
    const startMs = startTs * 1000;
    const endMs = endTs * 1000;
    return points.filter((point) => {
      const ts = point.timestamp.getTime();
      return ts >= startMs && ts <= endMs;
    });
  };

  const fetchPricesHistoryChunk = async (
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

    const points = parsePriceHistoryPayload(payload);
    const inRange = filterPointsInRange(points, startTs, endTs);
    if (inRange.length === 0 && interval !== "max") {
      const fallback = filterPointsInRange(
        await fetchPricesHistoryChunk(tokenId, startTs, endTs, "max"),
        startTs,
        endTs,
      );
      return fallback;
    }

    return inRange;
  };

  const getPricesHistory = async (
    tokenId: string,
    startTs: number,
    endTs: number,
    interval: string,
  ): Promise<PriceHistoryPoint[]> => {
    if (endTs <= startTs) {
      return [];
    }

    if (endTs - startTs <= CLOB_PRICE_HISTORY_MAX_CHUNK_SECONDS) {
      return filterPointsInRange(
        await fetchPricesHistoryChunk(tokenId, startTs, endTs, interval),
        startTs,
        endTs,
      );
    }

    const byTs = new Map<number, PriceHistoryPoint>();
    let chunkStart = startTs;

    while (chunkStart < endTs) {
      const chunkEnd = Math.min(chunkStart + CLOB_PRICE_HISTORY_MAX_CHUNK_SECONDS, endTs);
      const chunk = filterPointsInRange(
        await fetchPricesHistoryChunk(tokenId, chunkStart, chunkEnd, interval),
        chunkStart,
        chunkEnd,
      );
      for (const point of chunk) {
        byTs.set(point.timestamp.getTime(), point);
      }
      chunkStart = chunkEnd;
    }

    return filterPointsInRange(
      [...byTs.values()].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime()),
      startTs,
      endTs,
    );
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

  const getClobMarketInfo = async (conditionId: string): Promise<ClobMarketInfo | null> => {
    const url = new URL(`/clob-markets/${conditionId}`, config.POLY_CLOB_HOST);

    let payload: unknown;
    try {
      payload = await http.fetchJson<unknown>(url.toString());
    } catch (error) {
      logger.warn({ conditionId, err: String(error) }, "Failed to fetch CLOB market info");
      return null;
    }

    const parsed = rawClobMarketInfoSchema.safeParse(payload);
    if (!parsed.success) {
      logger.warn({ conditionId, issues: parsed.error.issues }, "Invalid CLOB market info response");
      return {
        conditionId,
        makerBaseFeeBps: 0,
        takerBaseFeeBps: 0,
        feesEnabled: false,
        feeDetails: null,
        feeCategory: null,
      };
    }

    const data = parsed.data;
    const makerBaseFeeBps = data.mbf ?? 0;
    const takerBaseFeeBps = data.tbf ?? 0;
    const feeRate = data.fd?.r ?? 0;
    const feesEnabled = feeRate > 0 || takerBaseFeeBps > 0;

    if (!data.fd) {
      logger.debug({ conditionId }, "CLOB market info missing fee details");
    }

    return {
      conditionId,
      makerBaseFeeBps,
      takerBaseFeeBps,
      feesEnabled,
      feeDetails: data.fd
        ? {
            feeRate,
            feeExponent: data.fd.e ?? null,
            takerOnly: data.fd.to ?? true,
          }
        : null,
      feeCategory: null,
    };
  };

  return {
    getActiveMarkets,
    getMarketBySlug,
    getOrderBook,
    getPricesHistory,
    getBacktestMarkets,
    getUserActivity,
    getClobMarketInfo,
    normalizeMarket,
    normalizeOutcome,
    fetchActiveMarketsRaw,
  };
}
