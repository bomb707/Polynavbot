import type { Config } from "../config/index.js";
import type { BacktestOrder, BacktestPosition } from "./backtestTypes.js";

export interface BacktestPortfolioState {
  cashUsd: number;
  positions: Map<string, BacktestPosition>;
  pendingOrders: BacktestOrder[];
  todayBuyNotional: number;
}

export function createPortfolioState(startingCapitalUsd: number): BacktestPortfolioState {
  return {
    cashUsd: startingCapitalUsd,
    positions: new Map(),
    pendingOrders: [],
    todayBuyNotional: 0,
  };
}

function openExposure(state: BacktestPortfolioState): number {
  let exposure = 0;
  for (const position of state.positions.values()) {
    exposure += position.costBasisUsd;
  }
  for (const order of state.pendingOrders) {
    if (order.side === "BUY") {
      exposure += order.limitPrice * (order.sizeShares - order.filledShares);
    }
  }
  return exposure;
}

function marketExposure(state: BacktestPortfolioState, marketId: string): number {
  let exposure = 0;
  for (const position of state.positions.values()) {
    if (position.marketId === marketId) {
      exposure += position.costBasisUsd;
    }
  }
  for (const order of state.pendingOrders) {
    if (order.side === "BUY" && order.marketId === marketId) {
      exposure += order.limitPrice * (order.sizeShares - order.filledShares);
    }
  }
  return exposure;
}

function themeExposure(
  state: BacktestPortfolioState,
  category: string | null,
  marketCategories: Map<string, string | null>,
): number {
  if (!category) {
    return 0;
  }
  let exposure = 0;
  for (const position of state.positions.values()) {
    const posCategory = marketCategories.get(position.marketId) ?? null;
    if (posCategory === category) {
      exposure += position.costBasisUsd;
    }
  }
  for (const order of state.pendingOrders) {
    if (order.side !== "BUY") {
      continue;
    }
    const orderCategory = marketCategories.get(order.marketId) ?? null;
    if (orderCategory === category) {
      exposure += order.limitPrice * (order.sizeShares - order.filledShares);
    }
  }
  return exposure;
}

export function applyBacktestRiskCaps(
  config: Config,
  state: BacktestPortfolioState,
  input: {
    marketId: string;
    tokenId: string;
    category: string | null;
    sizeUsd: number;
    marketCategories: Map<string, string | null>;
  },
): number | null {
  let sizeUsd = input.sizeUsd;

  if (sizeUsd < config.MIN_ORDER_SIZE_USD) {
    return null;
  }

  sizeUsd = Math.min(sizeUsd, config.MAX_ORDER_SIZE_USD);

  const headroom = Math.min(
    config.MAX_ORDER_SIZE_USD,
    config.MAX_DAILY_SPEND_USD - state.todayBuyNotional,
    config.MAX_OPEN_EXPOSURE_USD - openExposure(state),
    config.MAX_MARKET_EXPOSURE_USD - marketExposure(state, input.marketId),
    config.MAX_POSITION_SIZE_USD - (state.positions.get(input.tokenId)?.costBasisUsd ?? 0),
  );

  if (headroom < config.MIN_ORDER_SIZE_USD) {
    return null;
  }

  if (sizeUsd > headroom) {
    sizeUsd = headroom;
  }

  const theme = input.category;
  if (theme) {
    const themeHeadroom = config.MAX_THEME_EXPOSURE_USD - themeExposure(
      state,
      theme,
      input.marketCategories,
    );
    if (themeHeadroom < config.MIN_ORDER_SIZE_USD) {
      return null;
    }
    if (sizeUsd > themeHeadroom) {
      sizeUsd = themeHeadroom;
    }
  }

  if (state.positions.size >= config.MAX_OPEN_POSITIONS && !state.positions.has(input.tokenId)) {
    return null;
  }

  const pendingBuys = state.pendingOrders.filter(
    (order) => order.side === "BUY" && order.filledShares < order.sizeShares,
  ).length;
  if (pendingBuys >= config.MAX_OPEN_ORDERS) {
    return null;
  }

  if (sizeUsd < config.MIN_ORDER_SIZE_USD) {
    return null;
  }

  return Math.round(sizeUsd * 100) / 100;
}
