import type { Job } from "bullmq";

import type { AppContainer } from "../../container.js";
import { withIdempotencyLock } from "../idempotency.js";
import { withJobLog } from "../jobLog.js";
import { QUEUE_NAMES } from "../queueNames.js";
import type { UpdatePositionsJobData } from "../types.js";

export function createUpdatePositionsProcessor(container: AppContainer) {
  const { positionMonitor, redis, logger } = container;

  return async (job: Job<UpdatePositionsJobData>) => {
    const jobId = String(job.id ?? job.name);
    const result = await withIdempotencyLock(
      redis.client,
      QUEUE_NAMES.UPDATE_POSITIONS,
      jobId,
      () =>
        withJobLog(
          logger,
          job,
          async () => {
            const summary = await positionMonitor.run({ runExits: false });
            return {
              positionsUpdated: summary.positionsUpdated,
              positionsSkipped: summary.positionsSkipped,
              snapshotsSaved: summary.snapshotsSaved,
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
