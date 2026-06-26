import { describe, expect, it } from "vitest";

import {
  parseWsMarketEvent,
  parseWsUserEvent,
} from "./wsSchemas.js";

describe("wsSchemas", () => {
  it("parses best_bid_ask events", () => {
    const result = parseWsMarketEvent({
      event_type: "best_bid_ask",
      asset_id: "token-1",
      best_bid: "0.10",
      best_ask: "0.12",
      spread: "0.02",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.asset_id).toBe("token-1");
      expect(result.data.best_bid).toBe(0.1);
      expect(result.data.best_ask).toBe(0.12);
    }
  });

  it("parses price_change events", () => {
    const result = parseWsMarketEvent({
      event_type: "price_change",
      price_changes: [
        { asset_id: "token-1", best_bid: 0.09, best_ask: 0.11 },
      ],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.price_changes[0]?.asset_id).toBe("token-1");
    }
  });

  it("parses last_trade_price events", () => {
    const result = parseWsMarketEvent({
      event_type: "last_trade_price",
      asset_id: "token-1",
      price: 0.105,
      side: "BUY",
      size: 50,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.price).toBe(0.105);
    }
  });

  it("rejects unknown market event types", () => {
    const result = parseWsMarketEvent({
      event_type: "book",
      asset_id: "token-1",
    });

    expect(result.success).toBe(false);
  });

  it("rejects invalid best_bid_ask payloads", () => {
    const result = parseWsMarketEvent({
      event_type: "best_bid_ask",
      asset_id: "token-1",
    });

    expect(result.success).toBe(false);
  });

  it("parses user events with passthrough fields", () => {
    const result = parseWsUserEvent({
      event_type: "order",
      order_id: "order-1",
      market: "cond-1",
      asset_id: "token-1",
      side: "SELL",
      status: "OPEN",
      price: "0.5",
      size: "10",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.order_id).toBe("order-1");
      expect(result.data.price).toBe(0.5);
    }
  });
});
