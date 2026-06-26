import type { Job } from "bullmq";

import type { AppContainer } from "../../container.js";
import { withIdempotencyLock } from "../idempotency.js";
import { withJobLog } from "../jobLog.js";
import { QUEUE_NAMES } from "../queueNames.js";
import type { EvaluateEntryJobData } from "../types.js";

export function createEvaluateEntryProcessor(container: AppContainer) {
  const { entryEngine, redis, logger } = container;

  return async (job: Job<EvaluateEntryJobData>) => {
    const jobId = String(job.id ?? job.data.scanRunId);
    const result = await withIdempotencyLock(redis.client, QUEUE_NAMES.EVALUATE_ENTRY, jobId, () =>
      withJobLog(
        logger,
        job,
        async () => {
          const summary = await entryEngine.run({ scan: job.data.scan });
          return {
            accepted: summary.accepted.length,
            rejected: summary.rejected.length,
            totalNotionalUsd: summary.totalNotionalUsd,
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
