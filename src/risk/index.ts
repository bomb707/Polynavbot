import type { ILogger } from "../logger/types.js";
import type { IRiskManager } from "./types.js";

export { createRiskEngine, type RiskEngineDeps } from "./riskEngine.js";
export type { IRiskEngine, OrderRiskCheckInput, RiskCheckResult } from "./riskTypes.js";

/** Future: position sizing, exposure limits, and kill switches. */
export function createRiskManager(logger: ILogger): IRiskManager {
  return {
    async assess(signal) {
      logger.debug({ signal }, "Risk manager stub: assess called");
      return {
        approved: true,
        reason: "stub — no risk checks applied",
        adjustedSize: signal.size,
      };
    },
  };
}
