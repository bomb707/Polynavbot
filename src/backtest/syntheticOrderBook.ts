import type { OrderBook } from "../polymarket/publicTypes.js";
import type { BacktestConfig, PriceBar } from "./backtestTypes.js";

export function buildSyntheticOrderBook(
  bar: PriceBar,
  config: Pick<BacktestConfig, "assumedSpread">,
): OrderBook {
  const spread =
    bar.spread ??
    (bar.bestBid != null && bar.bestAsk != null
      ? bar.bestAsk - bar.bestBid
      : config.assumedSpread);

  const mid = bar.price;
  const bestBid = bar.bestBid ?? Math.max(0.0001, mid - spread / 2);
  const bestAsk = bar.bestAsk ?? mid + spread / 2;
  const depthShares = Math.max(1, (bar.liquidity ?? 100) / mid);

  return {
    tokenId: bar.tokenId,
    bids: [{ price: bestBid, size: depthShares }],
    asks: [{ price: bestAsk, size: depthShares }],
    bestBid,
    bestAsk,
    spread,
  };
}

export function conservativeBidPrice(bar: PriceBar, config: Pick<BacktestConfig, "assumedSpread">): number {
  const book = buildSyntheticOrderBook(bar, config);
  return book.bestBid ?? bar.price;
}
