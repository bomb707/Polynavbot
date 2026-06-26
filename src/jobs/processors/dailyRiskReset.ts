import type { Job } from "bullmq";

import type { AppContainer } from "../../container.js";
import { clearRiskCacheKeys } from "../idempotency.js";
import { withIdempotencyLock } from "../idempotency.js";
import { withJobLog } from "../jobLog.js";
import { QUEUE_NAMES } from "../queueNames.js";
import type { DailyRiskResetJobData } from "../types.js";

export function createDailyRiskResetProcessor(container: AppContainer) {
  const { repositories, redis, logger } = container;

  return async (job: Job<DailyRiskResetJobData>) => {
    const jobId = String(job.id ?? job.name);
    const utcDay = job.data.utcDay ?? new Date().toISOString().slice(0, 10);

    const result = await withIdempotencyLock(
      redis.client,
      QUEUE_NAMES.DAILY_RISK_RESET,
      jobId,
      () =>
        withJobLog(
          logger,
          job,
          async () => {
            const keysCleared = await clearRiskCacheKeys(redis.client);
            const run = await repositories.strategyRun.create({
              mode: "paper",
              metadata: { type: "daily-risk-reset", utcDay },
            });
            await repositories.strategyRun.finish(run.id, {
              metadata: { type: "daily-risk-reset", utcDay, keysCleared },
            });

            logger.info(
              { utcDay, keysCleared },
              "UTC daily risk window refreshed; DB limits roll at UTC midnight",
            );

            return { utcDay, keysCleared };
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
