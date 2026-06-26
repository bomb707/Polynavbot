import type { Config } from "../config/index.js";
import { computePassiveBidPrice } from "../execution/passiveBid.js";
import { roundDownShares } from "../execution/entryHelpers.js";
import { createLongshotScorer } from "../strategy/longshotScorer.js";
import type { LongshotScoreInput } from "../strategy/longshotTypes.js";
import type { PriceHistoryPoint } from "../polymarket/publicTypes.js";
import { applyBacktestRiskCaps } from "./positionSizer.js";
import type { BacktestPortfolio } from "./portfolio.js";
import { nextOrderId } from "./portfolio.js";
import { buildSyntheticOrderBook } from "./syntheticOrderBook.js";
import type { IFeeService } from "../fees/feeTypes.js";
import { resolveBacktestFeeParams, resolveBacktestLiquidityRole } from "./feeMode.js";
import type { BacktestConfig, BacktestMarketMeta, BacktestOrder, PriceBar } from "./backtestTypes.js";

export interface EntryEvaluation {
  placed: boolean;
  reason?: string;
  order?: BacktestOrder;
}

export function buildPriceHistory(bars: PriceBar[], currentIndex: number): PriceHistoryPoint[] {
  return bars.slice(0, currentIndex + 1).map((bar) => ({
    timestamp: bar.timestamp,
    price: bar.price,
  }));
}

export function buildScoreInputFromBar(
  meta: BacktestMarketMeta,
  bar: PriceBar,
  priceHistory: PriceHistoryPoint[],
  asOf: Date,
): LongshotScoreInput {
  const orderBook = buildSyntheticOrderBook(bar, { assumedSpread: bar.spread ?? 0.02 });
  return {
    asOf,
    market: {
      question: meta.question,
      category: meta.category,
      active: meta.active,
      closed: meta.closed,
      archived: meta.archived,
      enableOrderBook: meta.enableOrderBook,
      endDate: meta.endDate,
      outcomeCount: meta.outcomeCount,
      liquidityUsd: bar.liquidity ?? meta.liquidityUsd,
      volumeUsd: meta.volumeUsd,
    },
    outcome: {
      tokenId: meta.tokenId,
      name: meta.outcomeName,
      side: "YES",
      price: bar.price,
    },
    pricing: {
      orderBook,
      spread: orderBook.spread,
      priceHistory,
    },
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
  if (bar.price < config.MIN_ENTRY_PRICE || bar.price > config.MAX_ENTRY_PRICE) {
    return { placed: false, reason: "price_out_of_band" };
  }

  if (portfolio.hasOpenPosition(meta.tokenId) || portfolio.hasPendingBuy(meta.tokenId)) {
    return { placed: false, reason: "duplicate_token" };
  }

  const scorer = createLongshotScorer(config);
  const scoreInput = buildScoreInputFromBar(meta, bar, priceHistory, bar.timestamp);
  const scoreResult = scorer.score(scoreInput);

  if (scoreResult.decision !== "entry_candidate") {
    return { placed: false, reason: `score_${scoreResult.decision}` };
  }

  const orderBook = buildSyntheticOrderBook(bar, backtestConfig);
  const bidResult = computePassiveBidPrice(orderBook, config);
  if ("rejected" in bidResult) {
    return { placed: false, reason: bidResult.reason };
  }

  const cappedSizeUsd = applyBacktestRiskCaps(config, portfolio.getState(), {
    marketId: meta.marketId,
    tokenId: meta.tokenId,
    category: meta.category,
    sizeUsd: scoreResult.suggestedSizeUsd,
    marketCategories: portfolio.marketCategories,
  });

  if (cappedSizeUsd == null) {
    return { placed: false, reason: "risk_rejected" };
  }

  const shares = roundDownShares(cappedSizeUsd / bidResult.bidPrice);
  if (shares <= 0 || shares * bidResult.bidPrice < config.MIN_ORDER_SIZE_USD) {
    return { placed: false, reason: "size_too_small" };
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
    return { placed: false, reason: "insufficient_cash" };
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
    reason: "entry_candidate",
  };

  return { placed: true, order };
}
