import { WebSocketServer } from "ws";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ILogger } from "../logger/types.js";
import { createWsClient } from "./wsClient.js";
import type { TokenPriceQuote } from "./wsTypes.js";

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

describe("createWsClient", () => {
  let wss: WebSocketServer;
  let port: number;
  let lastMessage: string | null = null;

  beforeEach(async () => {
    wss = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => wss.once("listening", resolve));
    port = (wss.address() as { port: number }).port;
    lastMessage = null;

    wss.on("connection", (socket) => {
      socket.on("message", (data) => {
        const text = data.toString();
        lastMessage = text;
        if (text === "PING") {
          socket.send("PONG");
        }
      });
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      wss.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("sends market subscription on connect and emits quote updates", async () => {
    const quotes: TokenPriceQuote[] = [];
    const client = createWsClient(
      {
        POLY_WS_MARKET_URL: `ws://127.0.0.1:${port}`,
        POLY_WS_USER_URL: `ws://127.0.0.1:${port}`,
        TRADING_MODE: "paper",
        POLY_API_KEY: undefined,
        POLY_API_SECRET: undefined,
        POLY_API_PASSPHRASE: undefined,
        WS_PING_INTERVAL_MS: 60_000,
        WS_RECONNECT_BASE_MS: 50,
        WS_RECONNECT_MAX_MS: 200,
      },
      createLogger(),
    );

    client.onMarketQuote((quote) => quotes.push(quote));
    await client.start();
    client.setMarketSubscriptions(["token-1"]);

    await vi.waitFor(() => {
      expect(lastMessage).toContain("token-1");
    });

    const serverSocket = [...wss.clients][0];
    serverSocket?.send(
      JSON.stringify({
        event_type: "best_bid_ask",
        asset_id: "token-1",
        best_bid: "0.10",
        best_ask: "0.12",
      }),
    );

    await vi.waitFor(() => {
      expect(quotes.length).toBeGreaterThan(0);
    });

    expect(quotes[0]?.tokenId).toBe("token-1");
    expect(quotes[0]?.bestBid).toBe(0.1);
    expect(quotes[0]?.source).toBe("ws");

    await client.stop();
  });

  it("responds to PING with PONG handling", async () => {
    const client = createWsClient(
      {
        POLY_WS_MARKET_URL: `ws://127.0.0.1:${port}`,
        POLY_WS_USER_URL: `ws://127.0.0.1:${port}`,
        TRADING_MODE: "paper",
        POLY_API_KEY: undefined,
        POLY_API_SECRET: undefined,
        POLY_API_PASSPHRASE: undefined,
        WS_PING_INTERVAL_MS: 30,
        WS_RECONNECT_BASE_MS: 50,
        WS_RECONNECT_MAX_MS: 200,
      },
      createLogger(),
    );

    await client.start();
    client.setMarketSubscriptions(["token-1"]);

    await vi.waitFor(() => {
      expect(lastMessage).toBe("PING");
    });

    await client.stop();
  });
});
