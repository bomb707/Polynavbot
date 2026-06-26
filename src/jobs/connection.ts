import type { ConnectionOptions } from "bullmq";

import type { Config } from "../config/index.js";

export function getBullMQConnection(config: Config): ConnectionOptions {
  return {
    url: config.REDIS_URL,
    maxRetriesPerRequest: null,
  };
}
