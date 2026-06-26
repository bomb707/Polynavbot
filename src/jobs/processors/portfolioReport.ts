import type { Job } from "bullmq";

import type { AppContainer } from "../../container.js";
import { toNumber } from "../../execution/entryHelpers.js";
import { withIdempotencyLock } from "../idempotency.js";
import { withJobLog } from "../jobLog.js";
import { QUEUE_NAMES } from "../queueNames.js";
import type { PortfolioReportJobData } from "../types.js";

function round8(value: number): number {
  return Math.round(value * 1e8) / 1e8;
}

export function createPortfolioReportProcessor(container: AppContainer) {
  const { paperTradingEngine, config, redis, logger } = container;

  return async (job: Job<PortfolioReportJobData>) => {
    const jobId = String(job.id ?? job.name);
    const result = await withIdempotencyLock(
      redis.client,
      QUEUE_NAMES.PORTFOLIO_REPORT,
      jobId,
      () =>
        withJobLog(
          logger,
          job,
          async () => {
            await paperTradingEngine.initialize();
            const portfolio = await paperTradingEngine.getPortfolioSummary();

            const openExposureUsd = round8(
              portfolio.openPositions.reduce(
                (sum, position) => sum + (toNumber(position.costBasisUsd) ?? 0),
                0,
              ),
            );

            const positionsValueUsd = portfolio.openPositions.reduce((sum, position) => {
              const value =
                toNumber(position.currentValueUsd) ?? toNumber(position.costBasisUsd) ?? 0;
              return sum + value;
            }, 0);

            const portfolioValueUsd = round8(portfolio.cashBalanceUsd + positionsValueUsd);
            const totalPnlUsd = round8(
              portfolio.totalRealizedPnlUsd + portfolio.totalUnrealizedPnlUsd,
            );

            return {
              startingBalanceUsd: config.PAPER_STARTING_BALANCE_USD,
              cashBalanceUsd: portfolio.cashBalanceUsd,
              openExposureUsd,
              portfolioValueUsd,
              totalRealizedPnlUsd: portfolio.totalRealizedPnlUsd,
              totalUnrealizedPnlUsd: portfolio.totalUnrealizedPnlUsd,
              totalPnlUsd,
              openPositions: portfolio.openPositions.length,
            };
          },
          (value) => value,
        ),
    );

    if (result == null) {
      return { skipped: true, reason: "duplicate job lock" };
    }

    return result;
  };
}
