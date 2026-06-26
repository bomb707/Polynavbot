import type { Config } from "../config/index.js";
import { computePassiveBidPrice } from "../execution/passiveBid.js";
import { roundDownShares } from "../execution/entryHelpers.js";
import { createLongshotScorer } from "../strategy/longshotScorer.js";
import { createTailNoScorer } from "../strategy/tailNoScorer.js";
import type { LongshotScoreInput } from "../strategy/longshotTypes.js";
import type { TailNoScoreInput } from "../strategy/tailNoTypes.js";
import type { PriceHistoryPoint } from "../polymarket/publicTypes.js";
import { applyBacktestRiskCaps } from "./positionSizer.js";
import type { BacktestPortfolio } from "./portfolio.js";
import { nextOrderId } from "./portfolio.js";
import { buildSyntheticOrderBook } from "./syntheticOrderBook.js";
import type { IFeeService } from "../fees/feeTypes.js";
import { resolveBacktestFeeParams, resolveBacktestLiquidityRole } from "./feeMode.js";
import type { BacktestConfig, BacktestMarketMeta, BacktestOrder, PriceBar } from "./backtestTypes.js";
import { resolveHistoricalMarketFlags } from "./marketState.js";

export interface EntryEvaluation {
  placed: boolean;
  reason?: string;
  order?: BacktestOrder;
  leg?: "YES" | "NO";
}

export function buildPriceHistory(bars: PriceBar[], currentIndex: number): PriceHistoryPoint[] {
  return bars.slice(0, currentIndex + 1).map((bar) => ({
    timestamp: bar.timestamp,
    price: bar.price,
  }));
}

function resolveYesCounterpartPrice(meta: BacktestMarketMeta, barPrice: number): number | null {
  if (meta.outcomeCount !== 2) {
    return null;
  }
  if (meta.outcomeSide === "NO") {
    return Math.max(0, Math.min(1, 1 - barPrice));
  }
  return barPrice;
}

export function buildScoreInputFromBar(
  meta: BacktestMarketMeta,
  bar: PriceBar,
  priceHistory: PriceHistoryPoint[],
  asOf: Date,
): LongshotScoreInput {
  const orderBook = buildSyntheticOrderBook(bar, { assumedSpread: bar.spread ?? 0.02 });
  const historicalFlags = resolveHistoricalMarketFlags(meta, asOf);
  const liquidityUsd = bar.liquidity ?? meta.liquidityUsd ?? 0;

  return {
    asOf,
    market: {
      question: meta.question,
      category: meta.category,
      active: historicalFlags.active,
      closed: historicalFlags.closed,
      archived: meta.archived,
      enableOrderBook: meta.enableOrderBook,
      endDate: meta.endDate,
      outcomeCount: meta.outcomeCount,
      liquidityUsd,
      volumeUsd: meta.volumeUsd,
    },
    outcome: {
      tokenId: meta.tokenId,
      name: meta.outcomeName,
      side: meta.outcomeSide,
      price: bar.price,
    },
    pricing: {
      orderBook,
      spread: orderBook.spread,
      priceHistory,
    },
  };
}

export function buildTailNoScoreInputFromBar(
  meta: BacktestMarketMeta,
  bar: PriceBar,
  priceHistory: PriceHistoryPoint[],
  asOf: Date,
): TailNoScoreInput {
  const base = buildScoreInputFromBar(meta, bar, priceHistory, asOf);
  return {
    asOf: base.asOf,
    market: {
      ...base.market,
      liquidityUsd: base.market.liquidityUsd ?? null,
      volumeUsd: base.market.volumeUsd ?? null,
    },
    outcome: base.outcome,
    yesCounterpartPrice: resolveYesCounterpartPrice(meta, bar.price),
    pricing: base.pricing,
  };
}

export function evaluateEntry(
  config: Config,
  backtestConfig: BacktestConfig,
  portfolio: BacktestPortfolio,
  meta: BacktestMarketMeta,
  bar: PriceBar,
  priceHistory: PriceHistoryPoint[],
  feeService: IFeeService,
): EntryEvaluation {
  const leg = meta.outcomeSide;

  if (leg === "YES") {
    if (bar.price < config.MIN_ENTRY_PRICE || bar.price > config.MAX_ENTRY_PRICE) {
      return { placed: false, reason: "yes:price_out_of_band", leg };
    }
  } else if (leg === "NO") {
    if (!config.NO_ENTRY_ENABLED) {
      return { placed: false, reason: "no:disabled", leg };
    }
    if (bar.price < config.NO_MIN_ENTRY_PRICE || bar.price > config.NO_MAX_ENTRY_PRICE) {
      return { placed: false, reason: "no:price_out_of_band", leg };
    }
  }

  if (portfolio.hasOpenPosition(meta.tokenId) || portfolio.hasPendingBuy(meta.tokenId)) {
    return { placed: false, reason: `${leg.toLowerCase()}:duplicate_token`, leg };
  }

  const scoreResult =
    leg === "NO"
      ? createTailNoScorer(config).score(
          buildTailNoScoreInputFromBar(meta, bar, priceHistory, bar.timestamp),
        )
      : createLongshotScorer(config).score(
          buildScoreInputFromBar(meta, bar, priceHistory, bar.timestamp),
        );

  if (scoreResult.decision !== "entry_candidate") {
    return { placed: false, reason: `${leg.toLowerCase()}:score_${scoreResult.decision}`, leg };
  }

  const orderBook = buildSyntheticOrderBook(bar, backtestConfig);
  const bidResult = computePassiveBidPrice(orderBook, config);
  if ("rejected" in bidResult) {
    return { placed: false, reason: `${leg.toLowerCase()}:${bidResult.reason}`, leg };
  }

  const cappedSizeUsd = applyBacktestRiskCaps(config, portfolio.getState(), {
    marketId: meta.marketId,
    tokenId: meta.tokenId,
    category: meta.category,
    sizeUsd: scoreResult.suggestedSizeUsd,
    marketCategories: portfolio.marketCategories,
  });

  if (cappedSizeUsd == null) {
    return { placed: false, reason: `${leg.toLowerCase()}:risk_rejected`, leg };
  }

  const shares = roundDownShares(cappedSizeUsd / bidResult.bidPrice);
  if (shares <= 0 || shares * bidResult.bidPrice < config.MIN_ORDER_SIZE_USD) {
    return { placed: false, reason: `${leg.toLowerCase()}:size_too_small`, leg };
  }

  const feeParams = resolveBacktestFeeParams(meta.feeParams);
  const liquidityRole = resolveBacktestLiquidityRole(backtestConfig.feeMode, "BUY", feeParams);
  const buyEconomics = feeService.calculateBuyEconomics({
    side: "BUY",
    price: bidResult.bidPrice,
    shares,
    liquidityRole,
    feeParams,
  });

  if (buyEconomics.totalCostUsd > portfolio.cashUsd) {
    return { placed: false, reason: `${leg.toLowerCase()}:insufficient_cash`, leg };
  }

  const order: BacktestOrder = {
    id: nextOrderId(),
    tokenId: meta.tokenId,
    marketId: meta.marketId,
    outcomeId: meta.outcomeId,
    side: "BUY",
    limitPrice: bidResult.bidPrice,
    sizeShares: shares,
    filledShares: 0,
    createdAt: bar.timestamp,
    reason: leg === "NO" ? "tail_no_entry" : "longshot_entry",
  };

  return { placed: true, order, leg };
}
