import type { OrderResult } from "../execution/types.js";

export interface PaperPosition {
  marketId: string;
  side: "buy" | "sell";
  size: number;
  entryPrice: number;
  openedAt: Date;
}

export interface IPaperTrader {
  recordFill(order: OrderResult): Promise<PaperPosition>;
  getPositions(): Promise<PaperPosition[]>;
}
