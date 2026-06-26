import type { TokenPriceQuote } from "./wsTypes.js";

export interface IPriceCache {
  update(partial: Partial<TokenPriceQuote> & { tokenId: string }): TokenPriceQuote;
  get(tokenId: string): TokenPriceQuote | undefined;
  getAll(): TokenPriceQuote[];
  isFresh(tokenId: string, maxAgeSeconds: number): boolean;
}

function deriveMidPrice(quote: Pick<TokenPriceQuote, "bestBid" | "bestAsk" | "price" | "lastTradePrice">): number | null {
  if (quote.bestBid != null && quote.bestAsk != null) {
    return (quote.bestBid + quote.bestAsk) / 2;
  }
  if (quote.bestAsk != null) {
    return quote.bestAsk;
  }
  if (quote.bestBid != null) {
    return quote.bestBid;
  }
  if (quote.price != null) {
    return quote.price;
  }
  if (quote.lastTradePrice != null) {
    return quote.lastTradePrice;
  }
  return null;
}

export function createPriceCache(): IPriceCache {
  const quotes = new Map<string, TokenPriceQuote>();

  return {
    update(partial) {
      const existing = quotes.get(partial.tokenId);
      const merged: TokenPriceQuote = {
        tokenId: partial.tokenId,
        price: partial.price ?? existing?.price ?? null,
        bestBid: partial.bestBid ?? existing?.bestBid ?? null,
        bestAsk: partial.bestAsk ?? existing?.bestAsk ?? null,
        spread: partial.spread ?? existing?.spread ?? null,
        lastTradePrice: partial.lastTradePrice ?? existing?.lastTradePrice ?? null,
        updatedAt: partial.updatedAt ?? new Date(),
        source: partial.source ?? existing?.source ?? "ws",
      };

      if (merged.price == null) {
        merged.price = deriveMidPrice(merged);
      }

      quotes.set(partial.tokenId, merged);
      return merged;
    },

    get(tokenId) {
      return quotes.get(tokenId);
    },

    getAll() {
      return [...quotes.values()];
    },

    isFresh(tokenId, maxAgeSeconds) {
      const quote = quotes.get(tokenId);
      if (!quote) {
        return false;
      }
      const ageMs = Date.now() - quote.updatedAt.getTime();
      return ageMs <= maxAgeSeconds * 1000;
    },
  };
}

export { deriveMidPrice };
