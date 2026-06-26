import type { JobsOptions } from "bullmq";

import type { Config } from "../config/index.js";

/** BullMQ custom job IDs must not contain ":" (repeatable job ids use that separator). */
export function sanitizeBullMqJobId(raw: string): string {
  return raw.replace(/:/g, "__");
}

export function createDefaultJobOptions(config: Config): JobsOptions {
  return {
    attempts: config.JOB_ATTEMPTS,
    backoff: {
      type: "exponential",
      delay: config.JOB_BACKOFF_MS,
    },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 200 },
  };
}
