import type { ILogger } from "../logger/types.js";
import type { IPolymarketClient } from "./types.js";
export { createClobClient, type ClobClientConfig } from "./clobClient.js";
export {
  ClobClientError,
  InsufficientAllowanceError,
  InsufficientBalanceError,
  InvalidSignatureError,
  LiveTradingDisabledError,
  LiveTradingNotConfirmedError,
  NetworkTimeoutError,
  RejectedOrderError,
  StaleApiCredentialsError,
  mapClobError,
} from "./clobErrors.js";
export type {
  CancelOrderResult,
  IClobClient,
  LimitOrderParams,
  LimitOrderType,
  NormalizedOpenOrder,
  NormalizedTrade,
  OpenOrderQuery,
  OrderPlacementResult,
  TradeQuery,
} from "./clobTypes.js";
export { createPublicClient, type IPublicClient } from "./publicClient.js";
export { createPriceCache, type IPriceCache } from "./priceCache.js";
export { createWsClient, type WsClientConfig, type WsClientDeps } from "./wsClient.js";
export { createWsMonitorService, type WsMonitorServiceDeps } from "./wsMonitorService.js";
export type {
  IWsClient,
  IWsMonitorService,
  MarketQuoteHandler,
  PositionTokenMeta,
  TokenPriceQuote,
  UserEventHandler,
  WsMarketEventType,
  WsUserEvent,
} from "./wsTypes.js";
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
