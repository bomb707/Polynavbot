import type { Market } from "../polymarket/types.js";

export interface TradeSignal {
  marketId: string;
  side: "buy" | "sell";
  size: number;
  reason: string;
}

export interface IStrategy {
  evaluate(markets: Market[]): Promise<TradeSignal[]>;
}
