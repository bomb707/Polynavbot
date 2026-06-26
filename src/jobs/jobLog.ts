import type { Job } from "bullmq";

import type { ILogger } from "../logger/types.js";

export interface JobLogContext {
  queue: string;
  jobId: string | undefined;
  name: string;
}

function jobContext(job: Job): JobLogContext {
  return {
    queue: job.queueName,
    jobId: job.id,
    name: job.name,
  };
}

export async function withJobLog<T>(
  logger: ILogger,
  job: Job,
  fn: () => Promise<T>,
  summarize: (result: T) => Record<string, unknown>,
): Promise<T> {
  const ctx = jobContext(job);
  const start = Date.now();

  logger.info({ ...ctx, data: job.data }, "job started");

  try {
    const result = await fn();
    logger.info(
      {
        ...ctx,
        durationMs: Date.now() - start,
        resultSummary: summarize(result),
      },
      "job completed",
    );
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(
      {
        ...ctx,
        durationMs: Date.now() - start,
        attempt: job.attemptsMade,
        error: message,
      },
      "job failed",
    );
    throw error;
  }
}
