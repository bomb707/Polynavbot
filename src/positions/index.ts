import type { ILogger } from "../logger/types.js";
import type { PaperPosition } from "../paper/types.js";
import type { IPositionStore } from "./types.js";

/** Future: persistent position tracking via Prisma. */
export function createPositionStore(logger: ILogger): IPositionStore {
  const positions: PaperPosition[] = [];

  return {
    async save(position) {
      positions.push(position);
      logger.debug({ position }, "Position store stub: position saved");
    },

    async findAll() {
      return [...positions];
    },

    async findByMarket(marketId) {
      return positions.filter((p) => p.marketId === marketId);
    },
  };
}
