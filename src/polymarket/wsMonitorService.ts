import type { Config } from "../config/index.js";
import { isLiveMode, isPaperMode } from "../config/index.js";
import type { IRepositories } from "../db/repositories/index.js";
import { toNumber } from "../execution/entryHelpers.js";
import type { IExitEngine } from "../execution/exitTypes.js";
import type { ILogger } from "../logger/types.js";
import { midPrice, orderBookLiquidity } from "./orderBookPricing.js";
import type { IPublicClient } from "./publicClient.js";
import type { IPaperTradingEngine } from "../paper/paperTypes.js";
import type { IPriceCache } from "./priceCache.js";
import { deriveMidPrice } from "./priceCache.js";
import type { IWsClient, IWsMonitorService, PositionTokenMeta, TokenPriceQuote } from "./wsTypes.js";

export interface WsMonitorServiceDeps {
  config: Config;
  logger: ILogger;
  repositories: IRepositories;
  wsClient: IWsClient;
  priceCache: IPriceCache;
  publicClient: IPublicClient;
  exitEngine: IExitEngine;
  paperTradingEngine: IPaperTradingEngine;
}

function round8(value: number): number {
  return Math.round(value * 1e8) / 1e8;
}

export function createWsMonitorService(deps: WsMonitorServiceDeps): IWsMonitorService {
  const {
    config,
    logger,
    repositories,
    wsClient,
    priceCache,
    publicClient,
    exitEngine,
    paperTradingEngine,
  } = deps;

  let running = false;
  let subscriptionRefreshTimer: ReturnType<typeof setInterval> | null = null;
  let snapshotTimer: ReturnType<typeof setInterval> | null = null;
  let reconcileTimer: ReturnType<typeof setInterval> | null = null;

  const tokenMeta = new Map<string, PositionTokenMeta>();
  const exitDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const lastSnapshotAt = new Map<string, number>();

  async function loadTokenMeta(): Promise<void> {
    const positions = await repositories.position.findOpen();
    tokenMeta.clear();

    for (const position of positions) {
      const market = await repositories.market.findById(position.marketId);
      if (!market) {
        continue;
      }

      tokenMeta.set(position.tokenId, {
        tokenId: position.tokenId,
        marketId: position.marketId,
        outcomeId: position.outcomeId,
        conditionId: market.conditionId,
      });
    }
  }

  async function refreshSubscriptions(): Promise<void> {
    await loadTokenMeta();
    const tokenIds = [...tokenMeta.keys()];
    wsClient.setMarketSubscriptions(tokenIds);

    if (isLiveMode(config)) {
      const conditionIds = [...new Set([...tokenMeta.values()].map((meta) => meta.conditionId))];
      wsClient.setUserSubscriptions(conditionIds);
    }

    logger.debug({ tokenCount: tokenIds.length }, "Refreshed WebSocket subscriptions");
  }

  async function markPositionToMarket(tokenId: string, currentPrice: number): Promise<void> {
    if (isPaperMode(config)) {
      await paperTradingEngine.markToMarket(tokenId, currentPrice);
      return;
    }

    const position = await repositories.position.findOpenByTokenId(tokenId);
    if (!position) {
      return;
    }

    const size = toNumber(position.size) ?? 0;
    const costBasis = toNumber(position.costBasisUsd) ?? 0;
    const currentValueUsd = round8(size * currentPrice);
    const unrealizedPnlUsd = round8(currentValueUsd - costBasis);

    await repositories.position.update(position.id, {
      currentPrice,
      currentValueUsd,
      unrealizedPnlUsd,
    });
  }

  async function maybeWriteSnapshot(tokenId: string, quote: TokenPriceQuote): Promise<void> {
    const meta = tokenMeta.get(tokenId);
    if (!meta) {
      return;
    }

    const now = Date.now();
    const lastAt = lastSnapshotAt.get(tokenId) ?? 0;
    if (now - lastAt < config.WS_SNAPSHOT_INTERVAL_SECONDS * 1000) {
      return;
    }

    const price = quote.price ?? deriveMidPrice(quote);
    if (price == null) {
      return;
    }

    await repositories.snapshot.create({
      marketId: meta.marketId,
      outcomeId: meta.outcomeId,
      tokenId,
      price,
      bestBid: quote.bestBid,
      bestAsk: quote.bestAsk,
      spread: quote.spread,
      liquidity: null,
      volume: null,
    });

    lastSnapshotAt.set(tokenId, now);
  }

  function scheduleExitEvaluation(tokenId: string): void {
    const existing = exitDebounceTimers.get(tokenId);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      exitDebounceTimers.delete(tokenId);
      void exitEngine.runForToken(tokenId).catch((error) => {
        logger.warn(
          { tokenId, err: error instanceof Error ? error.message : String(error) },
          "Debounced exit evaluation failed",
        );
      });
    }, config.WS_EXIT_DEBOUNCE_MS);

    exitDebounceTimers.set(tokenId, timer);
  }

  async function handleQuoteUpdate(quote: TokenPriceQuote): Promise<void> {
    if (!tokenMeta.has(quote.tokenId)) {
      return;
    }

    const cached = priceCache.update(quote);
    const markPrice = cached.price ?? deriveMidPrice(cached);
    if (markPrice == null) {
      return;
    }

    await markPositionToMarket(quote.tokenId, markPrice);
    await maybeWriteSnapshot(quote.tokenId, cached);
    scheduleExitEvaluation(quote.tokenId);
  }

  async function reconcilePosition(tokenId: string): Promise<void> {
    const meta = tokenMeta.get(tokenId);
    if (!meta) {
      return;
    }

    const orderBook = await publicClient.getOrderBook(tokenId);
    if (!orderBook) {
      logger.warn({ tokenId }, "REST reconcile: order book unavailable");
      return;
    }

    const currentPrice =
      midPrice(orderBook) ??
      orderBook.bestBid ??
      orderBook.bestAsk ??
      null;

    if (currentPrice == null) {
      return;
    }

    priceCache.update({
      tokenId,
      price: currentPrice,
      bestBid: orderBook.bestBid ?? null,
      bestAsk: orderBook.bestAsk ?? null,
      spread: orderBook.spread ?? null,
      updatedAt: new Date(),
      source: "rest",
    });

    await markPositionToMarket(tokenId, currentPrice);

    await repositories.snapshot.create({
      marketId: meta.marketId,
      outcomeId: meta.outcomeId,
      tokenId,
      price: currentPrice,
      bestBid: orderBook.bestBid ?? null,
      bestAsk: orderBook.bestAsk ?? null,
      spread: orderBook.spread ?? null,
      liquidity: orderBookLiquidity(orderBook),
      volume: null,
    });

    lastSnapshotAt.set(tokenId, Date.now());
  }

  async function reconcileAll(): Promise<void> {
    logger.debug("Starting REST price reconciliation");
    await loadTokenMeta();

    for (const tokenId of tokenMeta.keys()) {
      try {
        await reconcilePosition(tokenId);
      } catch (error) {
        logger.warn(
          { tokenId, err: error instanceof Error ? error.message : String(error) },
          "REST reconcile failed for token",
        );
      }
    }
  }

  async function writePeriodicSnapshots(): Promise<void> {
    for (const quote of priceCache.getAll()) {
      if (!tokenMeta.has(quote.tokenId)) {
        continue;
      }
      try {
        await maybeWriteSnapshot(quote.tokenId, quote);
      } catch (error) {
        logger.warn(
          { tokenId: quote.tokenId, err: error instanceof Error ? error.message : String(error) },
          "Periodic snapshot write failed",
        );
      }
    }
  }

  return {
    async start() {
      if (running) {
        return;
      }
      running = true;

      if (isPaperMode(config)) {
        await paperTradingEngine.initialize();
      }

      wsClient.onMarketQuote((quote) => {
        void handleQuoteUpdate(quote).catch((error) => {
          logger.warn(
            { tokenId: quote.tokenId, err: error instanceof Error ? error.message : String(error) },
            "Quote update handler failed",
          );
        });
      });

      wsClient.onUserEvent((event) => {
        logger.info({ eventType: event.type, status: event.status }, "User WebSocket event");
      });

      await refreshSubscriptions();
      await wsClient.start();

      subscriptionRefreshTimer = setInterval(() => {
        void refreshSubscriptions().catch((error) => {
          logger.warn(
            { err: error instanceof Error ? error.message : String(error) },
            "Subscription refresh failed",
          );
        });
      }, config.WS_SUBSCRIPTION_REFRESH_MS);

      snapshotTimer = setInterval(() => {
        void writePeriodicSnapshots().catch((error) => {
          logger.warn(
            { err: error instanceof Error ? error.message : String(error) },
            "Periodic snapshot pass failed",
          );
        });
      }, config.WS_SNAPSHOT_INTERVAL_SECONDS * 1000);

      reconcileTimer = setInterval(() => {
        void reconcileAll().catch((error) => {
          logger.warn(
            { err: error instanceof Error ? error.message : String(error) },
            "REST reconciliation failed",
          );
        });
      }, config.WS_REST_RECONCILE_INTERVAL_SECONDS * 1000);

      logger.info("WebSocket monitor service started");
    },

    async stop() {
      running = false;

      if (subscriptionRefreshTimer) {
        clearInterval(subscriptionRefreshTimer);
        subscriptionRefreshTimer = null;
      }
      if (snapshotTimer) {
        clearInterval(snapshotTimer);
        snapshotTimer = null;
      }
      if (reconcileTimer) {
        clearInterval(reconcileTimer);
        reconcileTimer = null;
      }

      for (const timer of exitDebounceTimers.values()) {
        clearTimeout(timer);
      }
      exitDebounceTimers.clear();

      await wsClient.stop();
      logger.info("WebSocket monitor service stopped");
    },
  };
}
