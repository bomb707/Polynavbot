import type { TradingMode } from "../config/index.js";
import type { ExitAction, ExitReason } from "../execution/exitTypes.js";

export interface PortfolioSummary {
  generatedAt: string;
  mode: TradingMode;
  cashBalanceUsd: number | null;
  openExposureUsd: number;
  portfolioValueUsd: number | null;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  totalPnlUsd: number;
  openPositionsCount: number;
  openOrdersCount: number;
}

export interface PositionRow {
  tokenId: string;
  question: string;
  unrealizedPnlUsd: number;
  currentPrice: number;
  costBasisUsd: number;
}

export interface SignalRow {
  id: string;
  tokenId: string;
  signalType: string;
  status: string;
  score: number;
  reason: string;
  entryPrice: number;
  suggestedSizeUsd: number;
  createdAt: string;
}

export interface RiskRejectionRow {
  id: string;
  level: string;
  type: string;
  message: string;
  createdAt: string;
}

export interface PendingExitRow {
  tokenId: string;
  question: string;
  action: ExitAction;
  reason: ExitReason;
  sellSizeShares: number;
  sellPrice: number;
}

export interface TradeRow {
  timestamp: string;
  tokenId: string;
  side: string;
  price: number;
  size: number;
  notionalUsd: number;
  feeUsd: number;
  source: string;
  question: string;
}

export interface ReportSnapshot {
  portfolio: PortfolioSummary;
  topWinners: PositionRow[];
  topLosers: PositionRow[];
  recentSignals: SignalRow[];
  riskRejections: RiskRejectionRow[];
  pendingExits: PendingExitRow[];
  trades: TradeRow[];
}

export interface IReportService {
  buildSnapshot(): Promise<ReportSnapshot>;
}

export interface WrittenReportPaths {
  markdown: string;
  json: string;
  csv: string;
}
