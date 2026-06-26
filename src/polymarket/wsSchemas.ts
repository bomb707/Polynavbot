import { z } from "zod";

const numericString = z.union([z.string(), z.number()]).transform((value) => Number(value));

const priceChangeItemSchema = z.object({
  asset_id: z.string(),
  price: numericString.optional(),
  size: numericString.optional(),
  side: z.string().optional(),
  best_bid: numericString.optional(),
  best_ask: numericString.optional(),
});

export const bestBidAskEventSchema = z.object({
  event_type: z.literal("best_bid_ask"),
  asset_id: z.string(),
  best_bid: numericString,
  best_ask: numericString,
  spread: numericString.optional(),
  timestamp: z.union([z.string(), z.number()]).optional(),
});

export const priceChangeEventSchema = z.object({
  event_type: z.literal("price_change"),
  price_changes: z.array(priceChangeItemSchema).min(1),
  timestamp: z.union([z.string(), z.number()]).optional(),
});

export const lastTradePriceEventSchema = z.object({
  event_type: z.literal("last_trade_price"),
  asset_id: z.string(),
  price: numericString,
  side: z.string().optional(),
  size: numericString.optional(),
  timestamp: z.union([z.string(), z.number()]).optional(),
});

export const wsMarketEventSchema = z.discriminatedUnion("event_type", [
  bestBidAskEventSchema,
  priceChangeEventSchema,
  lastTradePriceEventSchema,
]);

export const wsUserEventSchema = z
  .object({
    event_type: z.string(),
    id: z.string().optional(),
    order_id: z.string().optional(),
    market: z.string().optional(),
    asset_id: z.string().optional(),
    side: z.string().optional(),
    status: z.string().optional(),
    price: numericString.optional(),
    size: numericString.optional(),
  })
  .passthrough();

export type ParsedBestBidAskEvent = z.infer<typeof bestBidAskEventSchema>;
export type ParsedPriceChangeEvent = z.infer<typeof priceChangeEventSchema>;
export type ParsedLastTradePriceEvent = z.infer<typeof lastTradePriceEventSchema>;

export function parseWsMarketEvent(payload: unknown) {
  return wsMarketEventSchema.safeParse(payload);
}

export function parseWsUserEvent(payload: unknown) {
  return wsUserEventSchema.safeParse(payload);
}
