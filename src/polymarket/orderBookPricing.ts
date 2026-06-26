import type { OrderBook } from "./publicTypes.js";

export function midPrice(orderBook: OrderBook): number | null {
  if (orderBook.bestBid != null && orderBook.bestAsk != null) {
    return (orderBook.bestBid + orderBook.bestAsk) / 2;
  }
  if (orderBook.bestAsk != null) {
    return orderBook.bestAsk;
  }
  if (orderBook.bestBid != null) {
    return orderBook.bestBid;
  }
  return null;
}

export function orderBookLiquidity(orderBook: OrderBook): number {
  return (
    orderBook.bids.reduce((sum, level) => sum + level.size, 0) +
    orderBook.asks.reduce((sum, level) => sum + level.size, 0)
  );
}
