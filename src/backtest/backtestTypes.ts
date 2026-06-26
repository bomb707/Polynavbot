import type { OrderSide } from "@prisma/client";

import type { PositionExitState } from "../db/repositories/position.repository.js";

export interface BacktestRunOptions {
  start: Date;
  end: Date;
  outputDir?: string;
}

export interface BacktestConfig {
  interval: string;
  slippageBps: number;
  fillProbability: number;
  assumedSpread: number;
  topOfBookDepthUsd: number;
  minLiquidityForExit: number;
  startingCapitalUsd: number;
  seed: number;
}

export interface PriceBar {
  timestamp: Date;
  tokenId: string;
  marketId: string;
  outcomeId: string;
  price: number;
  bestBid: number | null;
  bestAsk: number | null;
  spread: number | null;
  liquidity: number | null;
  source: "snapshot" | "clob";
}

export interface BacktestMarketMeta {
  marketId: string;
  outcomeId: string;
  tokenId: string;
  question: string;
  category: string | null;
  endDate: Date | null;
  active: boolean;
  closed: boolean;
  archived: boolean;
  enableOrderBook: boolean;
  outcomeCount: number;
  liquidityUsd: number | null;
  volumeUsd: number | null;
  outcomeName: string;
}

export interface BacktestOrder {
  id: string;
  tokenId: string;
  marketId: string;
  outcomeId: string;
  side: OrderSide;
  limitPrice: number;
  sizeShares: number;
  filledShares: number;
  createdAt: Date;
  reason?: string;
}

export interface BacktestPosition {
  tokenId: string;
  marketId: string;
  outcomeId: string;
  sizeShares: number;
  avgEntryPrice: number;
  costBasisUsd: number;
  exitState: PositionExitState;
  openedAt: Date;
}

export interface BacktestTrade {
  id: string;
  timestamp: Date;
  tokenId: string;
  marketId: string;
  outcomeId: string;
  question: string;
  side: OrderSide;
  price: number;
  sizeShares: number;
  notionalUsd: number;
  realizedPnlUsd: number;
  reason: string;
}

export interface EquityPoint {
  timestamp: Date;
  equityUsd: number;
  cashUsd: number;
  deployedUsd: number;
}

export interface BacktestTokenSeries {
  meta: BacktestMarketMeta;
  bars: PriceBar[];
}

export interface BacktestDataset {
  start: Date;
  end: Date;
  series: BacktestTokenSeries[];
}

export interface BacktestMetrics {
  totalRoi: number;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  finalEquityUsd: number;
  maxDrawdown: number;
  hitRate: number;
  averageWinner: number;
  averageLoser: number;
  payoffSkew: number;
  capitalUtilization: number;
  worstLosingStreak: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
}

export interface BacktestResult {
  start: string;
  end: string;
  config: BacktestConfig;
  metrics: BacktestMetrics;
  trades: BacktestTrade[];
  equityCurve: EquityPoint[];
  tokensTraded: number;
}

export interface IBacktestEngine {
  run(options: BacktestRunOptions): Promise<BacktestResult>;
}
