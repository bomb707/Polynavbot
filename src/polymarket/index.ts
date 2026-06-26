import type { ILogger } from "../logger/types.js";
import type { IPolymarketClient } from "./types.js";
export { createPublicClient, type IPublicClient } from "./publicClient.js";
export type {
  ActivityItem,
  GetActiveMarketsParams,
  GetActiveMarketsResult,
  NormalizedMarket,
  NormalizedOutcome,
  OrderBook,
  PriceHistoryPoint,
} from "./publicTypes.js";

/** Legacy stub client — use createPublicClient for market discovery. */
export function createPolymarketClient(logger: ILogger): IPolymarketClient {
  return {
    async getMarkets() {
      logger.debug("Polymarket client stub: getMarkets called");
      return [];
    },
  };
}
