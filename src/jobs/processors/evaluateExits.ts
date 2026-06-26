import type { Job } from "bullmq";

import type { AppContainer } from "../../container.js";
import { withIdempotencyLock } from "../idempotency.js";
import { withJobLog } from "../jobLog.js";
import { QUEUE_NAMES } from "../queueNames.js";
import type { EvaluateExitsJobData } from "../types.js";

export function createEvaluateExitsProcessor(container: AppContainer) {
  const { exitEngine, redis, logger } = container;

  return async (job: Job<EvaluateExitsJobData>) => {
    const jobId = String(job.id ?? job.name);
    const result = await withIdempotencyLock(redis.client, QUEUE_NAMES.EVALUATE_EXITS, jobId, () =>
      withJobLog(
        logger,
        job,
        async () => {
          const summary = await exitEngine.run();
          return {
            positionsEvaluated: summary.positionsEvaluated,
            exitsPlaced: summary.exitsPlaced,
            exitsFilled: summary.exitsFilled,
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
