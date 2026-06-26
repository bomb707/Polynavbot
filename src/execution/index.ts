import type { ILogger } from "../logger/types.js";
import type { IExecutionService } from "./types.js";

export { createEntryEngine, type EntryEngineDeps } from "./entryEngine.js";
export { buildScoreInput, roundDownShares, toNumber } from "./entryHelpers.js";
export {
  computePassiveBidPrice,
  computePassiveSellPrice,
  getTickSize,
  roundToTick,
  addTicks,
  type PassiveBidResult,
  type PassiveSellResult,
} from "./passiveBid.js";
export { createExitEngine, type ExitEngineDeps } from "./exitEngine.js";
export type {
  ExitAction,
  ExitActionRecord,
  ExitEvaluation,
  ExitEvaluationInput,
  ExitPaperSummary,
  ExitReason,
  IExitEngine,
} from "./exitTypes.js";
export type {
  AcceptedEntry,
  EntryCandidateRecord,
  EntryPaperSummary,
  EntryRejectStage,
  IEntryEngine,
  RejectedEntry,
} from "./entryTypes.js";

/** Future: live order placement — currently disabled, paper only. */
export function createExecutionService(logger: ILogger): IExecutionService {
  return {
    async execute(signal) {
      logger.info({ signal }, "Execution stub: paper only — no live trades");
      return {
        orderId: `paper-${Date.now()}`,
        status: "simulated",
        signal,
      };
    },
  };
}
