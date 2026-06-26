import type { ILogger } from "../logger/types.js";
import type { IPaperTrader, PaperPosition } from "./types.js";

/** Future: paper trading simulator with PnL tracking. */
export function createPaperTrader(logger: ILogger): IPaperTrader {
  const positions: PaperPosition[] = [];

  return {
    async recordFill(order) {
      const position: PaperPosition = {
        marketId: order.signal.marketId,
        side: order.signal.side,
        size: order.signal.size,
        entryPrice: 0,
        openedAt: new Date(),
      };
      positions.push(position);
      logger.debug({ position }, "Paper trader stub: fill recorded");
      return position;
    },

    async getPositions() {
      return [...positions];
    },
  };
}
