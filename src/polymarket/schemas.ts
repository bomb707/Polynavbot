import { z } from "zod";

export function parseStringArrayField(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(String);
  }
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.map(String);
      }
    } catch {
      return [];
    }
  }
  return [];
}

export function parseNumberArrayField(value: unknown): number[] {
  return parseStringArrayField(value)
    .map((item) => Number(item))
    .filter((item) => !Number.isNaN(item));
}

const stringOrNumber = z.union([z.string(), z.number()]);

export const rawGammaMarketSchema = z
  .object({
    id: stringOrNumber,
    conditionId: z.string().optional(),
    condition_id: z.string().optional(),
    question: z.string().optional(),
    slug: z.string().optional().nullable(),
    category: z.string().optional().nullable(),
    active: z.boolean().optional(),
    closed: z.boolean().optional(),
    archived: z.boolean().optional(),
    enableOrderBook: z.boolean().optional(),
    enable_order_book: z.boolean().optional(),
    endDate: z.string().optional().nullable(),
    end_date_iso: z.string().optional().nullable(),
    outcomes: z.unknown().optional(),
    outcomePrices: z.unknown().optional(),
    outcome_prices: z.unknown().optional(),
    clobTokenIds: z.unknown().optional(),
    clob_token_ids: z.unknown().optional(),
  })
  .passthrough();

export type RawGammaMarket = z.infer<typeof rawGammaMarketSchema>;

const orderBookLevelSchema = z.object({
  price: stringOrNumber,
  size: stringOrNumber,
});

export const rawOrderBookSchema = z
  .object({
    market: z.string().optional(),
    asset_id: z.string().optional(),
    bids: z.array(orderBookLevelSchema).optional().default([]),
    asks: z.array(orderBookLevelSchema).optional().default([]),
  })
  .passthrough();

export const rawPriceHistorySchema = z
  .object({
    history: z
      .array(
        z.object({
          t: z.union([z.number(), z.string()]),
          p: stringOrNumber,
        }),
      )
      .optional()
      .default([]),
  })
  .passthrough();

export const rawActivityItemSchema = z
  .object({
    type: z.string().optional().nullable(),
    timestamp: z.union([z.number(), z.string()]).optional().nullable(),
    asset: z.string().optional().nullable(),
    side: z.string().optional().nullable(),
    size: stringOrNumber.optional().nullable(),
    price: stringOrNumber.optional().nullable(),
  })
  .passthrough();

export const rawActivityResponseSchema = z.union([
  z.array(rawActivityItemSchema),
  z.object({ data: z.array(rawActivityItemSchema).optional() }).passthrough(),
]);

export const rawGammaMarketsResponseSchema = z.union([
  z.array(rawGammaMarketSchema),
  z.object({ data: z.array(rawGammaMarketSchema).optional() }).passthrough(),
]);
