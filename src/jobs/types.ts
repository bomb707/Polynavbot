import type { Redis } from "ioredis";

import type { ScanSummary } from "../scanner/types.js";

export interface IRedisConnection {
  readonly client: Redis;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}

export interface ScanMarketsJobData {
  triggeredAt?: string;
}

export interface EvaluateEntryJobData {
  scanRunId: string;
  scan: ScanSummary;
}

export interface UpdatePositionsJobData {
  triggeredAt?: string;
}

export interface EvaluateExitsJobData {
  triggeredAt?: string;
}

export interface DailyRiskResetJobData {
  utcDay?: string;
}

export interface PortfolioReportJobData {
  triggeredAt?: string;
}

export type JobData =
  | ScanMarketsJobData
  | EvaluateEntryJobData
  | UpdatePositionsJobData
  | EvaluateExitsJobData
  | DailyRiskResetJobData
  | PortfolioReportJobData;
