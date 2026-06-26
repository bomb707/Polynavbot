import { Queue, type ConnectionOptions } from "bullmq";

import type { Config } from "../config/index.js";
import type { ILogger } from "../logger/types.js";

export interface IQueueManager {
  getQueue(name: string): Queue;
  closeAll(): Promise<void>;
}

export function createQueueManager(
  config: Config,
  logger: ILogger,
): IQueueManager {
  const queues = new Map<string, Queue>();
  const connection: ConnectionOptions = {
    url: config.REDIS_URL,
    maxRetriesPerRequest: null,
  };

  return {
    getQueue(name: string): Queue {
      let queue = queues.get(name);
      if (!queue) {
        queue = new Queue(name, { connection });
        queues.set(name, queue);
        logger.debug({ queue: name }, "BullMQ queue created");
      }
      return queue;
    },

    async closeAll(): Promise<void> {
      await Promise.all(
        [...queues.values()].map((queue) => queue.close()),
      );
      queues.clear();
    },
  };
}
