import type { JobsOptions } from "bullmq";

import type { Config } from "../config/index.js";

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
