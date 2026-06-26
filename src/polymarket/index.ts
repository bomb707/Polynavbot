import type { ILogger } from "../logger/types.js";
import type { IPolymarketClient } from "./types.js";

/** Future: Polymarket CLOB/Gamma API client. */
export function createPolymarketClient(logger: ILogger): IPolymarketClient {
  return {
    async getMarkets() {
      logger.debug("Polymarket client stub: getMarkets called");
      return [];
    },
  };
}
