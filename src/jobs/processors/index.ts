import type { Processor } from "bullmq";

import type { AppContainer } from "../../container.js";
import { QUEUE_NAMES } from "../queueNames.js";
import { createDailyRiskResetProcessor } from "./dailyRiskReset.js";
import { createEvaluateEntryProcessor } from "./evaluateEntry.js";
import { createEvaluateExitsProcessor } from "./evaluateExits.js";
import { createPortfolioReportProcessor } from "./portfolioReport.js";
import { createScanMarketsProcessor } from "./scanMarkets.js";
import { createUpdatePositionsProcessor } from "./updatePositions.js";

export type JobProcessor = Processor;

export function createJobProcessors(
  container: AppContainer,
): Record<string, JobProcessor> {
  return {
    [QUEUE_NAMES.SCAN_MARKETS]: createScanMarketsProcessor(container),
    [QUEUE_NAMES.EVALUATE_ENTRY]: createEvaluateEntryProcessor(container),
    [QUEUE_NAMES.UPDATE_POSITIONS]: createUpdatePositionsProcessor(container),
    [QUEUE_NAMES.EVALUATE_EXITS]: createEvaluateExitsProcessor(container),
    [QUEUE_NAMES.DAILY_RISK_RESET]: createDailyRiskResetProcessor(container),
    [QUEUE_NAMES.PORTFOLIO_REPORT]: createPortfolioReportProcessor(container),
  };
}
