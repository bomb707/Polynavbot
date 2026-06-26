import type { Market, Position } from "@prisma/client";

import type { PositionExitState } from "../db/repositories/position.repository.js";
import type { OrderBook } from "../polymarket/publicTypes.js";

export type ExitReason =
  | "milestone_5x"
  | "milestone_10x"
  | "milestone_25x"
  | "trailing_stop"
  | "near_expiry"
  | "low_liquidity"
  | "resolution_risk"
  | "risk_forced"
  | "moonbag_hold";

export type ExitAction = "hold" | "sell_partial" | "sell_all";

export interface ExitEvaluationInput {
  position: Position;
  exitState: PositionExitState;
  currentPrice: number;
  orderBook: OrderBook;
  market: Pick<Market, "active" | "closed" | "endDate">;
  liquidityUsd: number | null;
  riskForced?: boolean;
}

export interface ExitEvaluation {
  action: ExitAction;
  sellSizeShares: number;
  sellPrice: number;
  reason: ExitReason;
  message: string;
  nextExitState: PositionExitState;
}

export interface ExitActionRecord {
  tokenId: string;
  question: string;
  action: ExitAction;
  reason: ExitReason;
  sellSizeShares: number;
  sellPrice: number;
  filled: boolean;
  realizedPnlUsd?: number;
}

export interface ExitPaperSummary {
  positionsEvaluated: number;
  holds: number;
  exitsPlaced: number;
  exitsFilled: number;
  totalRealizedPnlUsd: number;
  actions: ExitActionRecord[];
}

export interface IExitEngine {
  run(): Promise<ExitPaperSummary>;
  runForToken(tokenId: string): Promise<ExitActionRecord | null>;
  previewExits(): Promise<ExitActionRecord[]>;
  evaluateExit(input: ExitEvaluationInput): ExitEvaluation;
}
