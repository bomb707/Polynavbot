import type { ILogger } from "../logger/types.js";
import type { Market } from "../polymarket/types.js";
import type { IStrategy } from "./types.js";

/** Future: longshot entry/exit rules. */
export function createStrategy(logger: ILogger): IStrategy {
  return {
    async evaluate(_markets: Market[]) {
      logger.debug("Strategy stub: evaluate called");
      return [];
    },
  };
}
