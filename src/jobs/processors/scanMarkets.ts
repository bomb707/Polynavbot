import type { Job } from "bullmq";

import type { AppContainer } from "../../container.js";
import { createDefaultJobOptions, sanitizeBullMqJobId } from "../jobOptions.js";
import { withIdempotencyLock } from "../idempotency.js";
import { withJobLog } from "../jobLog.js";
import { QUEUE_NAMES } from "../queueNames.js";
import type { ScanMarketsJobData } from "../types.js";

export function createScanMarketsProcessor(container: AppContainer) {
  const { scanner, queueManager, redis, logger } = container;

  return async (job: Job<ScanMarketsJobData>) => {
    const jobId = String(job.id ?? job.name);
    const result = await withIdempotencyLock(redis.client, QUEUE_NAMES.SCAN_MARKETS, jobId, () =>
      withJobLog(
        logger,
        job,
        async () => {
          const summary = await scanner.scanMarkets({
            maxPages: container.config.SCAN_MAX_PAGES,
          });
          const scanRunId = jobId;
          const evaluateQueue = queueManager.getQueue(QUEUE_NAMES.EVALUATE_ENTRY);
          const evaluateJobId = sanitizeBullMqJobId(`evaluate-entry__${scanRunId}`);

          await evaluateQueue.add(
            "evaluate-entry",
            {
              scanRunId,
              scan: summary,
            },
            {
              ...createDefaultJobOptions(container.config),
              jobId: evaluateJobId,
            },
          );

          return {
            marketsScanned: summary.marketsScanned,
            candidatesFound: summary.candidatesFound,
            scanRunId,
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
