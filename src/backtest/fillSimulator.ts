import type { OrderSide } from "@prisma/client";

import { roundDownShares } from "../execution/entryHelpers.js";
import { buildSyntheticOrderBook } from "./syntheticOrderBook.js";
import type { BacktestConfig, BacktestOrder, PriceBar } from "./backtestTypes.js";

export interface FillResult {
  filled: boolean;
  fillSize: number;
  fillPrice: number;
}

export function simulateConservativeFill(
  order: BacktestOrder,
  bar: PriceBar,
  config: BacktestConfig,
  rng: () => number,
): FillResult {
  const remaining = order.sizeShares - order.filledShares;
  if (remaining <= 0) {
    return { filled: false, fillSize: 0, fillPrice: 0 };
  }

  const book = buildSyntheticOrderBook(bar, config);
  const slippage = config.slippageBps / 10_000;

  if (order.side === "BUY") {
    if (bar.price > order.limitPrice) {
      return { filled: false, fillSize: 0, fillPrice: 0 };
    }
    if (rng() > config.fillProbability) {
      return { filled: false, fillSize: 0, fillPrice: 0 };
    }
    const base = Math.min(book.bestAsk ?? bar.price, order.limitPrice);
    const fillPrice = base * (1 + slippage);
    const maxShares = config.topOfBookDepthUsd / fillPrice;
    const fillSize = roundDownShares(Math.min(remaining, maxShares));
    if (fillSize <= 0) {
      return { filled: false, fillSize: 0, fillPrice: 0 };
    }
    return { filled: true, fillSize, fillPrice };
  }

  if (bar.price < order.limitPrice) {
    return { filled: false, fillSize: 0, fillPrice: 0 };
  }
  if (rng() > config.fillProbability) {
    return { filled: false, fillSize: 0, fillPrice: 0 };
  }
  const base = Math.max(book.bestBid ?? bar.price, order.limitPrice);
  const fillPrice = base * (1 - slippage);
  const maxShares = config.topOfBookDepthUsd / fillPrice;
  const fillSize = roundDownShares(Math.min(remaining, maxShares));
  if (fillSize <= 0) {
    return { filled: false, fillSize: 0, fillPrice: 0 };
  }
  return { filled: true, fillSize, fillPrice };
}

export function isExitLiquiditySufficient(
  bar: PriceBar,
  config: Pick<BacktestConfig, "minLiquidityForExit">,
): boolean {
  return (bar.liquidity ?? 0) >= config.minLiquidityForExit;
}

export function sideLabel(side: OrderSide): string {
  return side;
}
