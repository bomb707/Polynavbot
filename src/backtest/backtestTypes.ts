import type { OrderSide } from "@prisma/client";

import type { PositionExitState } from "../db/repositories/position.repository.js";

export type BacktestFeeMode =
  | "maker_only"
  | "taker_only"
  | "mixed"
  | "actual_if_available";

export interface BacktestRunOptions {
  start: Date;
  end: Date;
  outputDir?: string;
  feeMode?: BacktestFeeMode;
  mirrorWallet?: string;
  mirrorMaxItems?: number;
}

export interface BacktestLoadOptions {
  mirrorWallet?: string;
  mirrorMaxItems?: number;
}

export type BacktestDataSource = "snapshots" | "database" | "gamma" | "wallet";

export interface BacktestConfig {
  interval: string;
  slippageBps: number;
  fillProbability: number;
  assumedSpread: number;
  topOfBookDepthUsd: number;
  minLiquidityForExit: number;
  startingCapitalUsd: number;
  seed: number;
  feeMode: BacktestFeeMode;
  maxMarkets: number;
  minLiquidityUsd: number;
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

import type { FeeParams } from "../fees/feeTypes.js";

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
  outcomeSide: "YES" | "NO";
  feeParams?: FeeParams;
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
  totalFeeUsd: number;
  liquidityRole: "maker" | "taker" | "unknown";
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
  source: BacktestDataSource;
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
  dataset: {
    tokensLoaded: number;
    dataSource: BacktestDataSource;
    timelineSteps: number;
    mirrorWallet?: string | null;
  };
  diagnostics: {
    entryEvaluations: number;
    ordersPlaced: number;
    entryRejections: Record<string, number>;
  };
}

export interface IBacktestEngine {
  run(options: BacktestRunOptions): Promise<BacktestResult>;
}
