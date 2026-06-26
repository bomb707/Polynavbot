import type { ExitAction, ExitPaperSummary, ExitReason } from "../execution/exitTypes.js";

export interface PositionHighlight {
  tokenId: string;
  marketId: string;
  unrealizedPnlUsd: number;
  currentPrice: number;
}

export interface ExitEligiblePosition {
  tokenId: string;
  question: string;
  action: ExitAction;
  reason: ExitReason;
  sellSizeShares: number;
  sellPrice: number;
}

export interface PositionMonitorSummary {
  positionsLoaded: number;
  positionsUpdated: number;
  positionsSkipped: number;
  snapshotsSaved: number;
  startingBalanceUsd: number;
  cashBalanceUsd: number;
  openExposureUsd: number;
  portfolioValueUsd: number;
  totalRealizedPnlUsd: number;
  totalUnrealizedPnlUsd: number;
  totalPnlUsd: number;
  bestPosition: PositionHighlight | null;
  worstPosition: PositionHighlight | null;
  exitEligible: ExitEligiblePosition[];
  exitResult: ExitPaperSummary;
}

export interface PositionMonitorRunOptions {
  runExits?: boolean;
}

export interface IPositionMonitor {
  run(options?: PositionMonitorRunOptions): Promise<PositionMonitorSummary>;
}
