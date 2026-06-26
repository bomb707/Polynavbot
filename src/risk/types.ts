import type { TradeSignal } from "../strategy/types.js";

export interface RiskAssessment {
  approved: boolean;
  reason: string;
  adjustedSize: number;
}

export interface IRiskManager {
  assess(signal: TradeSignal): Promise<RiskAssessment>;
}
