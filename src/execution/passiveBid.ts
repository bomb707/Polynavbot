import type { Config } from "../config/index.js";
import type { OrderBook } from "../polymarket/publicTypes.js";

export type PassiveBidResult =
  | { bidPrice: number }
  | { rejected: true; reason: string };

export function getTickSize(price: number): number {
  return price < 0.1 ? 0.001 : 0.01;
}

export function roundToTick(
  price: number,
  tick: number,
  direction: "down" | "up",
): number {
  if (tick <= 0) {
    return price;
  }
  const steps = price / tick;
  const rounded = direction === "down" ? Math.floor(steps + 1e-9) : Math.ceil(steps - 1e-9);
  return Math.round(rounded * tick * 1e8) / 1e8;
}

export function addTicks(price: number, tick: number, ticks: number): number {
  const baseSteps = Math.round(roundToTick(price, tick, "down") / tick);
  return Math.round((baseSteps + ticks) * tick * 1e8) / 1e8;
}

function resolveSpread(orderBook: OrderBook): number | null {
  if (orderBook.spread != null) {
    return orderBook.spread;
  }
  if (orderBook.bestBid != null && orderBook.bestAsk != null) {
    return orderBook.bestAsk - orderBook.bestBid;
  }
  return null;
}

export function computePassiveBidPrice(
  orderBook: OrderBook,
  config: Pick<Config, "MIN_ENTRY_PRICE" | "MAX_ENTRY_PRICE" | "MAX_SPREAD">,
): PassiveBidResult {
  const { bestBid, bestAsk } = orderBook;

  if (bestBid == null && bestAsk == null) {
    return { rejected: true, reason: "No order book quotes" };
  }

  const referencePrice = bestBid ?? bestAsk ?? config.MIN_ENTRY_PRICE;
  const tick = getTickSize(referencePrice);
  const spread = resolveSpread(orderBook);

  let bidPrice: number;

  if (bestBid != null) {
    bidPrice = roundToTick(bestBid, tick, "down");
    const improvedBid = addTicks(bestBid, tick, 1);

    if (spread != null && spread <= config.MAX_SPREAD) {
      if (bestAsk == null || improvedBid < bestAsk) {
        bidPrice = improvedBid;
      }
    } else if (spread != null && spread > config.MAX_SPREAD) {
      bidPrice = roundToTick(bestBid, tick, "down");
      return { rejected: true, reason: "Spread too wide for passive entry" };
    }
  } else if (bestAsk != null) {
    bidPrice = addTicks(bestAsk, tick, -1);
  } else {
    return { rejected: true, reason: "No order book quotes" };
  }

  if (bestAsk != null) {
    const maxBid = addTicks(bestAsk, tick, -1);
    if (bidPrice >= bestAsk) {
      bidPrice = maxBid;
    }
    bidPrice = Math.min(bidPrice, maxBid);
  }

  bidPrice = Math.min(bidPrice, config.MAX_ENTRY_PRICE);
  bidPrice = roundToTick(bidPrice, tick, "down");
  bidPrice = Math.max(bidPrice, config.MIN_ENTRY_PRICE);

  if (bidPrice <= 0 || bidPrice < config.MIN_ENTRY_PRICE) {
    return { rejected: true, reason: "Bid price below minimum entry price" };
  }

  return { bidPrice };
}
