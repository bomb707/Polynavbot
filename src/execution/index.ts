import type { ILogger } from "../logger/types.js";
import type { IExecutionService } from "./types.js";

export { createEntryEngine, type EntryEngineDeps } from "./entryEngine.js";
export { buildScoreInput, roundDownShares, toNumber } from "./entryHelpers.js";
export {
  computePassiveBidPrice,
  getTickSize,
  roundToTick,
  addTicks,
  type PassiveBidResult,
} from "./passiveBid.js";
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
