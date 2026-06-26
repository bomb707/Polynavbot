import WebSocket from "ws";

import type { Config } from "../config/index.js";
import { isLiveMode } from "../config/index.js";
import type { ILogger } from "../logger/types.js";
import {
  parseWsMarketEvent,
  parseWsUserEvent,
  type ParsedBestBidAskEvent,
  type ParsedLastTradePriceEvent,
  type ParsedPriceChangeEvent,
} from "./wsSchemas.js";
import type {
  IWsClient,
  MarketQuoteHandler,
  TokenPriceQuote,
  UserEventHandler,
  WsUserEvent,
} from "./wsTypes.js";

export type WsClientConfig = Pick<
  Config,
  | "POLY_WS_MARKET_URL"
  | "POLY_WS_USER_URL"
  | "TRADING_MODE"
  | "POLY_API_KEY"
  | "POLY_API_SECRET"
  | "POLY_API_PASSPHRASE"
  | "WS_PING_INTERVAL_MS"
  | "WS_RECONNECT_BASE_MS"
  | "WS_RECONNECT_MAX_MS"
>;

export interface WsClientDeps {
  WebSocketImpl?: typeof WebSocket;
}

function parseNumber(value: number | undefined): number | null {
  if (value == null || Number.isNaN(value)) {
    return null;
  }
  return value;
}

function hasLiveCredentials(
  config: WsClientConfig,
): config is WsClientConfig & {
  POLY_API_KEY: string;
  POLY_API_SECRET: string;
  POLY_API_PASSPHRASE: string;
} {
  return Boolean(
    config.POLY_API_KEY && config.POLY_API_SECRET && config.POLY_API_PASSPHRASE,
  );
}

export function createWsClient(
  config: WsClientConfig,
  logger: ILogger,
  deps: WsClientDeps = {},
): IWsClient {
  const WebSocketImpl = deps.WebSocketImpl ?? WebSocket;

  let marketSocket: WebSocket | null = null;
  let userSocket: WebSocket | null = null;
  let running = false;
  let marketReconnectAttempt = 0;
  let userReconnectAttempt = 0;
  let marketPingTimer: ReturnType<typeof setInterval> | null = null;
  let userPingTimer: ReturnType<typeof setInterval> | null = null;
  let marketReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let userReconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const marketTokenIds = new Set<string>();
  const userConditionIds = new Set<string>();
  let marketQuoteHandler: MarketQuoteHandler | null = null;
  let userEventHandler: UserEventHandler | null = null;

  function emitQuote(partial: Partial<TokenPriceQuote> & { tokenId: string }) {
    if (!marketQuoteHandler) {
      return;
    }
    marketQuoteHandler({
      tokenId: partial.tokenId,
      price: partial.price ?? null,
      bestBid: partial.bestBid ?? null,
      bestAsk: partial.bestAsk ?? null,
      spread: partial.spread ?? null,
      lastTradePrice: partial.lastTradePrice ?? null,
      updatedAt: partial.updatedAt ?? new Date(),
      source: "ws",
    });
  }

  function handleBestBidAsk(event: ParsedBestBidAskEvent) {
    const bestBid = parseNumber(event.best_bid);
    const bestAsk = parseNumber(event.best_ask);
    emitQuote({
      tokenId: event.asset_id,
      bestBid,
      bestAsk,
      spread: parseNumber(event.spread) ?? (bestBid != null && bestAsk != null ? bestAsk - bestBid : null),
      price: bestBid != null && bestAsk != null ? (bestBid + bestAsk) / 2 : null,
    });
  }

  function handlePriceChange(event: ParsedPriceChangeEvent) {
    for (const change of event.price_changes) {
      const bestBid = parseNumber(change.best_bid);
      const bestAsk = parseNumber(change.best_ask);
      emitQuote({
        tokenId: change.asset_id,
        bestBid,
        bestAsk,
        spread: bestBid != null && bestAsk != null ? bestAsk - bestBid : null,
        price: bestBid != null && bestAsk != null ? (bestBid + bestAsk) / 2 : parseNumber(change.price),
      });
    }
  }

  function handleLastTradePrice(event: ParsedLastTradePriceEvent) {
    const price = parseNumber(event.price);
    emitQuote({
      tokenId: event.asset_id,
      lastTradePrice: price,
      price,
    });
  }

  function handleMarketMessage(raw: WebSocket.RawData) {
    const text = raw.toString();
    if (text === "PONG") {
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      logger.debug({ text }, "Ignored non-JSON market WS message");
      return;
    }

    const parsed = parseWsMarketEvent(payload);
    if (!parsed.success) {
      logger.debug({ issues: parsed.error.issues }, "Ignored invalid market WS payload");
      return;
    }

    switch (parsed.data.event_type) {
      case "best_bid_ask":
        handleBestBidAsk(parsed.data);
        break;
      case "price_change":
        handlePriceChange(parsed.data);
        break;
      case "last_trade_price":
        handleLastTradePrice(parsed.data);
        break;
    }
  }

  function handleUserMessage(raw: WebSocket.RawData) {
    const text = raw.toString();
    if (text === "PONG") {
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      logger.debug({ text }, "Ignored non-JSON user WS message");
      return;
    }

    const parsed = parseWsUserEvent(payload);
    if (!parsed.success) {
      logger.debug({ issues: parsed.error.issues }, "Ignored invalid user WS payload");
      return;
    }

    const eventType = parsed.data.event_type.toLowerCase();
    const event: WsUserEvent =
      eventType.includes("trade")
        ? {
            type: "trade",
            tradeId: parsed.data.id ?? parsed.data.order_id ?? "unknown",
            market: parsed.data.market ?? "",
            assetId: parsed.data.asset_id ?? "",
            side: parsed.data.side ?? "",
            status: parsed.data.status ?? "",
            price: parseNumber(parsed.data.price),
            size: parseNumber(parsed.data.size),
            raw: parsed.data as Record<string, unknown>,
          }
        : {
            type: "order",
            orderId: parsed.data.order_id ?? parsed.data.id ?? "unknown",
            market: parsed.data.market ?? "",
            assetId: parsed.data.asset_id ?? "",
            side: parsed.data.side ?? "",
            status: parsed.data.status ?? "",
            price: parseNumber(parsed.data.price),
            size: parseNumber(parsed.data.size),
            raw: parsed.data as Record<string, unknown>,
          };

    userEventHandler?.(event);
  }

  function scheduleReconnect(kind: "market" | "user") {
    if (!running) {
      return;
    }

    const attempt = kind === "market" ? ++marketReconnectAttempt : ++userReconnectAttempt;
    const delay = Math.min(
      config.WS_RECONNECT_BASE_MS * 2 ** (attempt - 1),
      config.WS_RECONNECT_MAX_MS,
    );

    logger.warn({ kind, attempt, delayMs: delay }, "Scheduling WebSocket reconnect");

    const timer = setTimeout(() => {
      if (kind === "market") {
        void connectMarket();
      } else {
        void connectUser();
      }
    }, delay);

    if (kind === "market") {
      marketReconnectTimer = timer;
    } else {
      userReconnectTimer = timer;
    }
  }

  function startPing(socket: WebSocket, kind: "market" | "user") {
    const timer = setInterval(() => {
      if (socket.readyState === WebSocketImpl.OPEN) {
        socket.send("PING");
      }
    }, config.WS_PING_INTERVAL_MS);

    if (kind === "market") {
      marketPingTimer = timer;
    } else {
      userPingTimer = timer;
    }
  }

  function sendMarketSubscription(initial: boolean) {
    if (!marketSocket || marketSocket.readyState !== WebSocketImpl.OPEN) {
      return;
    }

    const tokenIds = [...marketTokenIds];
    if (tokenIds.length === 0) {
      return;
    }

    if (initial) {
      marketSocket.send(
        JSON.stringify({
          assets_ids: tokenIds,
          type: "market",
          custom_feature_enabled: true,
        }),
      );
      return;
    }

    marketSocket.send(
      JSON.stringify({
        assets_ids: tokenIds,
        operation: "subscribe",
      }),
    );
  }

  function sendUserSubscription(initial: boolean) {
    if (!userSocket || userSocket.readyState !== WebSocketImpl.OPEN) {
      return;
    }
    if (!hasLiveCredentials(config)) {
      return;
    }

    const markets = [...userConditionIds];
    if (initial) {
      userSocket.send(
        JSON.stringify({
          auth: {
            apiKey: config.POLY_API_KEY,
            secret: config.POLY_API_SECRET,
            passphrase: config.POLY_API_PASSPHRASE,
          },
          type: "user",
          markets,
        }),
      );
      return;
    }

    if (markets.length === 0) {
      return;
    }

    userSocket.send(
      JSON.stringify({
        markets,
        operation: "subscribe",
      }),
    );
  }

  async function connectMarket(): Promise<void> {
    if (!running) {
      return;
    }

    if (marketReconnectTimer) {
      clearTimeout(marketReconnectTimer);
      marketReconnectTimer = null;
    }

    if (marketPingTimer) {
      clearInterval(marketPingTimer);
      marketPingTimer = null;
    }

    marketSocket?.removeAllListeners();
    marketSocket?.close();

    marketSocket = new WebSocketImpl(config.POLY_WS_MARKET_URL);

    marketSocket.on("open", () => {
      marketReconnectAttempt = 0;
      logger.info("Market WebSocket connected");
      sendMarketSubscription(true);
      startPing(marketSocket!, "market");
    });

    marketSocket.on("message", handleMarketMessage);
    marketSocket.on("error", (error) => {
      logger.warn({ err: String(error) }, "Market WebSocket error");
    });
    marketSocket.on("close", () => {
      logger.warn("Market WebSocket closed");
      if (marketPingTimer) {
        clearInterval(marketPingTimer);
        marketPingTimer = null;
      }
      scheduleReconnect("market");
    });
  }

  async function connectUser(): Promise<void> {
    if (!running || !isLiveMode(config) || !hasLiveCredentials(config)) {
      return;
    }

    if (userReconnectTimer) {
      clearTimeout(userReconnectTimer);
      userReconnectTimer = null;
    }

    if (userPingTimer) {
      clearInterval(userPingTimer);
      userPingTimer = null;
    }

    userSocket?.removeAllListeners();
    userSocket?.close();

    userSocket = new WebSocketImpl(config.POLY_WS_USER_URL);

    userSocket.on("open", () => {
      userReconnectAttempt = 0;
      logger.info("User WebSocket connected");
      sendUserSubscription(true);
      startPing(userSocket!, "user");
    });

    userSocket.on("message", handleUserMessage);
    userSocket.on("error", (error) => {
      logger.warn({ err: String(error) }, "User WebSocket error");
    });
    userSocket.on("close", () => {
      logger.warn("User WebSocket closed");
      if (userPingTimer) {
        clearInterval(userPingTimer);
        userPingTimer = null;
      }
      scheduleReconnect("user");
    });
  }

  return {
    async start() {
      if (running) {
        return;
      }
      running = true;
      await connectMarket();
      await connectUser();
    },

    async stop() {
      running = false;

      if (marketReconnectTimer) {
        clearTimeout(marketReconnectTimer);
        marketReconnectTimer = null;
      }
      if (userReconnectTimer) {
        clearTimeout(userReconnectTimer);
        userReconnectTimer = null;
      }
      if (marketPingTimer) {
        clearInterval(marketPingTimer);
        marketPingTimer = null;
      }
      if (userPingTimer) {
        clearInterval(userPingTimer);
        userPingTimer = null;
      }

      marketSocket?.removeAllListeners();
      userSocket?.removeAllListeners();
      marketSocket?.close();
      userSocket?.close();
      marketSocket = null;
      userSocket = null;
    },

    setMarketSubscriptions(tokenIds) {
      const next = new Set(tokenIds);
      const changed =
        next.size !== marketTokenIds.size ||
        [...next].some((tokenId) => !marketTokenIds.has(tokenId));

      marketTokenIds.clear();
      for (const tokenId of next) {
        marketTokenIds.add(tokenId);
      }

      if (changed && running) {
        sendMarketSubscription(false);
      }
    },

    setUserSubscriptions(conditionIds) {
      const next = new Set(conditionIds);
      const changed =
        next.size !== userConditionIds.size ||
        [...next].some((conditionId) => !userConditionIds.has(conditionId));

      userConditionIds.clear();
      for (const conditionId of next) {
        userConditionIds.add(conditionId);
      }

      if (changed && running) {
        sendUserSubscription(false);
      }
    },

    onMarketQuote(handler) {
      marketQuoteHandler = handler;
    },

    onUserEvent(handler) {
      userEventHandler = handler;
    },
  };
}
