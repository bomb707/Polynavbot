import type { ScanOptions, ScanSummary } from "../scanner/types.js";
import type { LongshotDecision } from "../strategy/longshotTypes.js";

export type EntryRejectStage = "score" | "bid" | "size" | "risk" | "order" | "idempotency";

export interface EntryRunOptions extends ScanOptions {
  scan?: ScanSummary;
}

export interface EntryCandidateRecord {
  tokenId: string;
  question: string;
  outcomeName: string;
  score: number;
  decision: LongshotDecision;
}

export interface AcceptedEntry {
  tokenId: string;
  question: string;
  bidPrice: number;
  sizeUsd: number;
  shares: number;
  orderId: string;
  signalId: string;
}

export interface RejectedEntry {
  tokenId: string;
  question: string;
  stage: EntryRejectStage;
  reason: string;
}

export interface EntryPaperSummary {
  scan: ScanSummary;
  candidates: EntryCandidateRecord[];
  accepted: AcceptedEntry[];
  rejected: RejectedEntry[];
  totalNotionalUsd: number;
  riskRejectionReasons: string[];
}

export interface IEntryEngine {
  run(options?: EntryRunOptions): Promise<EntryPaperSummary>;
}
