import type { ILogger } from "../logger/types.js";
import type { IExecutionService } from "./types.js";

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
