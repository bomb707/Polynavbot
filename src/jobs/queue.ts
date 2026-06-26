import { Queue, type ConnectionOptions } from "bullmq";

import type { Config } from "../config/index.js";
import type { ILogger } from "../logger/types.js";
import { getBullMQConnection } from "./connection.js";
import { createDefaultJobOptions } from "./jobOptions.js";
import type { QueueName } from "./queueNames.js";

export interface IQueueManager {
  getConnection(): ConnectionOptions;
  getQueue(name: QueueName | string): Queue;
  closeAll(): Promise<void>;
}

export function createQueueManager(
  config: Config,
  logger: ILogger,
): IQueueManager {
  const queues = new Map<string, Queue>();
  const connection = getBullMQConnection(config);
  const defaultJobOptions = createDefaultJobOptions(config);

  return {
    getConnection(): ConnectionOptions {
      return connection;
    },

    getQueue(name: string): Queue {
      let queue = queues.get(name);
      if (!queue) {
        queue = new Queue(name, {
          connection,
          defaultJobOptions,
        });
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
