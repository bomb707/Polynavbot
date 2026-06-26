import type { Market, Outcome, PaperOrder, Position, Prisma, RiskEventType } from "@prisma/client";

import type { Config } from "../config/index.js";
import type { IRepositories } from "../db/repositories/index.js";
import type { ILogger } from "../logger/types.js";
import type { IRiskEngine, OrderRiskCheckInput, RiskCheckResult } from "./riskTypes.js";

export interface RiskEngineDeps {
  config: Config;
  repositories: IRepositories;
  logger: ILogger;
}

interface PortfolioSnapshot {
  openPositions: Position[];
  pendingOrders: PaperOrder[];
  todayBuyNotional: number;
  todayRealizedPnl: number;
  pendingOrderCount: number;
  filledNotionalByOrderId: Map<string, number>;
}

function toNumber(value: { toNumber(): number } | number | null | undefined): number {
  if (value == null) {
    return 0;
  }
  return typeof value === "number" ? value : value.toNumber();
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function startOfUtcDay(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function createRiskEngine(deps: RiskEngineDeps): IRiskEngine {
  const { config, repositories, logger } = deps;

  async function recordRejection(
    type: RiskEventType,
    message: string,
    metadata?: Prisma.InputJsonValue,
  ): Promise<void> {
    await repositories.riskEvent.create({
      level: "WARNING",
      type,
      message,
      metadata,
    });
    logger.warn({ type, message, metadata }, "Order rejected by risk engine");
  }

  async function loadSnapshot(): Promise<PortfolioSnapshot> {
    const since = startOfUtcDay();
    const [openPositions, pendingOrders, todayBuyNotional, todayRealizedPnl, pendingOrderCount] =
      await Promise.all([
        repositories.position.findOpen(),
        repositories.order.findPendingPaperOrders(),
        repositories.trade.sumNotionalSince("PAPER", "BUY", since),
        repositories.position.sumRealizedPnlSince(since),
        repositories.order.countPendingPaperOrders(),
      ]);

    const filledNotionalByOrderId = new Map<string, number>();
    for (const order of pendingOrders) {
      const trades = await repositories.trade.findByOrderId(order.id);
      const filled = trades.reduce((sum, trade) => sum + toNumber(trade.notionalUsd), 0);
      filledNotionalByOrderId.set(order.id, filled);
    }

    return {
      openPositions,
      pendingOrders,
      todayBuyNotional,
      todayRealizedPnl,
      pendingOrderCount,
      filledNotionalByOrderId,
    };
  }

  function computeOpenExposure(snapshot: PortfolioSnapshot): number {
    const positionExposure = snapshot.openPositions.reduce(
      (sum, position) => sum + toNumber(position.costBasisUsd),
      0,
    );

    const pendingExposure = snapshot.pendingOrders
      .filter((order) => order.side === "BUY")
      .reduce((sum, order) => {
        const filled = snapshot.filledNotionalByOrderId.get(order.id) ?? 0;
        return sum + Math.max(0, toNumber(order.notionalUsd) - filled);
      }, 0);

    return round2(positionExposure + pendingExposure);
  }

  function computeMarketExposure(snapshot: PortfolioSnapshot, marketId: string): number {
    const positionExposure = snapshot.openPositions
      .filter((position) => position.marketId === marketId)
      .reduce((sum, position) => sum + toNumber(position.costBasisUsd), 0);

    const pendingExposure = snapshot.pendingOrders
      .filter((order) => order.marketId === marketId && order.side === "BUY")
      .reduce((sum, order) => {
        const filled = snapshot.filledNotionalByOrderId.get(order.id) ?? 0;
        return sum + Math.max(0, toNumber(order.notionalUsd) - filled);
      }, 0);

    return round2(positionExposure + pendingExposure);
  }

  async function computeThemeExposure(
    snapshot: PortfolioSnapshot,
    category: string | null,
  ): Promise<number> {
    if (!category) {
      return 0;
    }

    const marketIds = new Set(snapshot.openPositions.map((position) => position.marketId));
    for (const order of snapshot.pendingOrders) {
      if (order.side === "BUY") {
        marketIds.add(order.marketId);
      }
    }

    const markets = await Promise.all(
      [...marketIds].map((id) => repositories.market.findById(id)),
    );
    const marketCategory = new Map<string, string | null>();
    for (const market of markets) {
      if (market) {
        marketCategory.set(market.id, market.category);
      }
    }

    let exposure = 0;
    for (const position of snapshot.openPositions) {
      if (marketCategory.get(position.marketId) === category) {
        exposure += toNumber(position.costBasisUsd);
      }
    }
    for (const order of snapshot.pendingOrders) {
      if (order.side !== "BUY") {
        continue;
      }
      if (marketCategory.get(order.marketId) === category) {
        const filled = snapshot.filledNotionalByOrderId.get(order.id) ?? 0;
        exposure += Math.max(0, toNumber(order.notionalUsd) - filled);
      }
    }

    return round2(exposure);
  }

  function computeHeadroom(
    input: OrderRiskCheckInput,
    snapshot: PortfolioSnapshot,
    market: Market | null,
    themeExposure: number,
  ): number {
    const caps: number[] = [config.MAX_ORDER_SIZE_USD];

    caps.push(Math.max(0, config.MAX_DAILY_SPEND_USD - snapshot.todayBuyNotional));
    caps.push(Math.max(0, config.MAX_OPEN_EXPOSURE_USD - computeOpenExposure(snapshot)));
    caps.push(Math.max(0, config.MAX_MARKET_EXPOSURE_USD - computeMarketExposure(snapshot, input.marketId)));

    if (market?.category) {
      caps.push(Math.max(0, config.MAX_THEME_EXPOSURE_USD - themeExposure));
    }

    const tokenPosition = snapshot.openPositions.find(
      (position) => position.tokenId === input.tokenId,
    );
    const tokenExposure = tokenPosition ? toNumber(tokenPosition.costBasisUsd) : 0;
    caps.push(Math.max(0, config.MAX_POSITION_SIZE_USD - tokenExposure));

    return round2(Math.min(...caps));
  }

  async function reject(
    type: RiskEventType,
    reason: string,
    metadata?: Prisma.InputJsonValue,
  ): Promise<RiskCheckResult> {
    await recordRejection(type, reason, metadata);
    return { allowed: false, reason };
  }

  return {
    async checkOrder(input) {
      if (!input.tokenId.trim()) {
        return reject("OTHER", "Missing tokenId", { marketId: input.marketId });
      }

      const [market, outcome, snapshot] = await Promise.all([
        repositories.market.findById(input.marketId),
        repositories.outcome.findByTokenId(input.tokenId),
        loadSnapshot(),
      ]);

      if (!market) {
        return reject("OTHER", "Market not found", { marketId: input.marketId });
      }

      if (!market.active || market.closed || market.archived) {
        return reject("OTHER", "Market is closed or inactive", {
          marketId: input.marketId,
          active: market.active,
          closed: market.closed,
          archived: market.archived,
        });
      }

      if (input.dataUpdatedAt) {
        const ageSeconds = (Date.now() - input.dataUpdatedAt.getTime()) / 1000;
        if (ageSeconds > config.DATA_STALE_SECONDS) {
          return reject("OTHER", "API data is stale", {
            dataUpdatedAt: input.dataUpdatedAt.toISOString(),
            ageSeconds,
            maxAgeSeconds: config.DATA_STALE_SECONDS,
          });
        }
      }

      if (snapshot.todayRealizedPnl < -config.MAX_DAILY_LOSS_USD) {
        return reject("DAILY_LIMIT", "Daily loss limit exceeded", {
          todayRealizedPnl: snapshot.todayRealizedPnl,
          maxDailyLossUsd: config.MAX_DAILY_LOSS_USD,
        });
      }

      if (input.isNewEntry && input.side === "BUY") {
        if (input.limitPrice > config.MAX_ENTRY_PRICE) {
          return reject("OTHER", "Entry price above maximum", {
            limitPrice: input.limitPrice,
            maxEntryPrice: config.MAX_ENTRY_PRICE,
          });
        }
        if (input.limitPrice < config.MIN_ENTRY_PRICE) {
          return reject("OTHER", "Entry price below minimum", {
            limitPrice: input.limitPrice,
            minEntryPrice: config.MIN_ENTRY_PRICE,
          });
        }
      }

      if (input.spread != null && input.spread > config.MAX_SPREAD) {
        return reject("SPREAD", "Spread too wide", {
          spread: input.spread,
          maxSpread: config.MAX_SPREAD,
        });
      }

      if (input.liquidityUsd != null && input.liquidityUsd < config.MIN_LIQUIDITY_USD) {
        return reject("LIQUIDITY", "Liquidity below minimum", {
          liquidityUsd: input.liquidityUsd,
          minLiquidityUsd: config.MIN_LIQUIDITY_USD,
        });
      }

      if (snapshot.pendingOrderCount >= config.MAX_OPEN_ORDERS) {
        return reject("OTHER", "Maximum open orders reached", {
          openOrders: snapshot.pendingOrderCount,
          maxOpenOrders: config.MAX_OPEN_ORDERS,
        });
      }

      if (input.side === "BUY" && input.isNewEntry) {
        const hasOpenPosition = snapshot.openPositions.some(
          (position) => position.tokenId === input.tokenId,
        );
        if (!hasOpenPosition && snapshot.openPositions.length >= config.MAX_OPEN_POSITIONS) {
          return reject("POSITION_LIMIT", "Maximum open positions reached", {
            openPositions: snapshot.openPositions.length,
            maxOpenPositions: config.MAX_OPEN_POSITIONS,
          });
        }
      }

      const tokenPosition = snapshot.openPositions.find(
        (position) => position.tokenId === input.tokenId,
      );
      if (input.side === "BUY" && input.isNewEntry && tokenPosition) {
        const costBasis = toNumber(tokenPosition.costBasisUsd);
        if (costBasis >= config.MAX_POSITION_SIZE_USD) {
          return reject("POSITION_LIMIT", "Open position already at size limit", {
            tokenId: input.tokenId,
            costBasisUsd: costBasis,
            maxPositionSizeUsd: config.MAX_POSITION_SIZE_USD,
          });
        }
      }

      if (!config.ALLOW_BOTH_SIDES_SAME_MARKET && input.side === "BUY" && outcome) {
        const marketOutcomes = await repositories.outcome.findByMarketId(input.marketId);
        const outcomeSideById = new Map(marketOutcomes.map((o) => [o.id, o.side]));
        const openSides = new Set(
          snapshot.openPositions
            .filter((position) => position.marketId === input.marketId)
            .map((position) => outcomeSideById.get(position.outcomeId))
            .filter((side): side is Outcome["side"] => side != null),
        );

        if (openSides.size > 0 && !openSides.has(outcome.side)) {
          return reject("MARKET_EXPOSURE", "Cannot hold both YES and NO in same market", {
            marketId: input.marketId,
            existingSides: [...openSides],
            incomingSide: outcome.side,
          });
        }
      }

      if (input.side === "BUY" && input.isNewEntry) {
        const marketOutcomes = snapshot.openPositions
          .filter((position) => position.marketId === input.marketId)
          .map((position) => position.outcomeId);
        const distinctOutcomes = new Set(marketOutcomes);
        const isNewOutcome = !distinctOutcomes.has(input.outcomeId);

        if (isNewOutcome && distinctOutcomes.size >= config.MAX_OUTCOMES_PER_MARKET) {
          return reject("MARKET_EXPOSURE", "Maximum outcomes per market reached", {
            marketId: input.marketId,
            openOutcomes: distinctOutcomes.size,
            maxOutcomesPerMarket: config.MAX_OUTCOMES_PER_MARKET,
          });
        }
      }

      const themeExposure = await computeThemeExposure(snapshot, market.category);
      const headroom = computeHeadroom(input, snapshot, market, themeExposure);
      let sizeUsd = input.sizeUsd;

      if (sizeUsd < config.MIN_ORDER_SIZE_USD) {
        return reject("POSITION_LIMIT", "Order size below minimum", {
          sizeUsd,
          minOrderSizeUsd: config.MIN_ORDER_SIZE_USD,
        });
      }

      if (sizeUsd > config.MAX_ORDER_SIZE_USD) {
        if (headroom >= config.MIN_ORDER_SIZE_USD && headroom < sizeUsd) {
          sizeUsd = headroom;
        } else if (headroom < config.MIN_ORDER_SIZE_USD) {
          return reject("POSITION_LIMIT", "Order size above maximum", {
            sizeUsd,
            maxOrderSizeUsd: config.MAX_ORDER_SIZE_USD,
          });
        } else {
          sizeUsd = config.MAX_ORDER_SIZE_USD;
        }
      }

      const openExposure = computeOpenExposure(snapshot);
      if (openExposure + sizeUsd > config.MAX_OPEN_EXPOSURE_USD) {
        const exposureHeadroom = config.MAX_OPEN_EXPOSURE_USD - openExposure;
        if (exposureHeadroom >= config.MIN_ORDER_SIZE_USD) {
          sizeUsd = Math.min(sizeUsd, round2(exposureHeadroom));
        } else {
          return reject("POSITION_LIMIT", "Maximum open exposure reached", {
            openExposureUsd: openExposure,
            maxOpenExposureUsd: config.MAX_OPEN_EXPOSURE_USD,
          });
        }
      }

      if (snapshot.todayBuyNotional + sizeUsd > config.MAX_DAILY_SPEND_USD) {
        const spendHeadroom = config.MAX_DAILY_SPEND_USD - snapshot.todayBuyNotional;
        if (spendHeadroom >= config.MIN_ORDER_SIZE_USD) {
          sizeUsd = Math.min(sizeUsd, round2(spendHeadroom));
        } else {
          return reject("DAILY_LIMIT", "Daily spend limit exceeded", {
            todaySpendUsd: snapshot.todayBuyNotional,
            maxDailySpendUsd: config.MAX_DAILY_SPEND_USD,
          });
        }
      }

      const marketExposure = computeMarketExposure(snapshot, input.marketId);
      if (marketExposure + sizeUsd > config.MAX_MARKET_EXPOSURE_USD) {
        const marketHeadroom = config.MAX_MARKET_EXPOSURE_USD - marketExposure;
        if (marketHeadroom >= config.MIN_ORDER_SIZE_USD) {
          sizeUsd = Math.min(sizeUsd, round2(marketHeadroom));
        } else {
          return reject("MARKET_EXPOSURE", "Maximum market exposure reached", {
            marketExposureUsd: marketExposure,
            maxMarketExposureUsd: config.MAX_MARKET_EXPOSURE_USD,
          });
        }
      }

      if (market.category && themeExposure + sizeUsd > config.MAX_THEME_EXPOSURE_USD) {
        const themeHeadroom = config.MAX_THEME_EXPOSURE_USD - themeExposure;
        if (themeHeadroom >= config.MIN_ORDER_SIZE_USD) {
          sizeUsd = Math.min(sizeUsd, round2(themeHeadroom));
        } else {
          return reject("THEME_EXPOSURE", "Maximum theme exposure reached", {
            themeExposureUsd: themeExposure,
            category: market.category,
            maxThemeExposureUsd: config.MAX_THEME_EXPOSURE_USD,
          });
        }
      }

      const tokenExposure = tokenPosition ? toNumber(tokenPosition.costBasisUsd) : 0;
      if (tokenExposure + sizeUsd > config.MAX_POSITION_SIZE_USD) {
        const positionHeadroom = config.MAX_POSITION_SIZE_USD - tokenExposure;
        if (positionHeadroom >= config.MIN_ORDER_SIZE_USD) {
          sizeUsd = Math.min(sizeUsd, round2(positionHeadroom));
        } else {
          return reject("POSITION_LIMIT", "Maximum position size reached", {
            tokenExposureUsd: tokenExposure,
            maxPositionSizeUsd: config.MAX_POSITION_SIZE_USD,
          });
        }
      }

      if (sizeUsd < config.MIN_ORDER_SIZE_USD) {
        return reject("POSITION_LIMIT", "Adjusted order size below minimum", {
          adjustedSizeUsd: sizeUsd,
          minOrderSizeUsd: config.MIN_ORDER_SIZE_USD,
        });
      }

      if (sizeUsd < input.sizeUsd) {
        return {
          allowed: true,
          reason: "Size reduced to fit limits",
          adjustedSizeUsd: sizeUsd,
        };
      }

      return { allowed: true, reason: "Approved" };
    },
  };
}
