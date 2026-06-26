import type { ILogger } from "../logger/types.js";
import type { IPolymarketClient } from "../polymarket/types.js";
import type { IScanner } from "./types.js";

/** Future: scan Polymarket for longshot opportunities. */
export function createScanner(
  polymarket: IPolymarketClient,
  logger: ILogger,
): IScanner {
  return {
    async scan() {
      logger.debug("Scanner stub: scan called");
      const markets = await polymarket.getMarkets();
      return { markets, scannedAt: new Date() };
    },
  };
}
