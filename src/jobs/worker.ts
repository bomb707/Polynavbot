import { Worker } from "bullmq";

import type { AppContainer } from "../container.js";
import { ALL_QUEUE_NAMES } from "./queueNames.js";
import { createJobProcessors } from "./processors/index.js";

let workers: Worker[] = [];

export function createWorkers(container: AppContainer): Worker[] {
  const connection = container.queueManager.getConnection();
  const processors = createJobProcessors(container);
  const concurrency = container.config.JOB_CONCURRENCY;

  return ALL_QUEUE_NAMES.map(
    (queueName) =>
      new Worker(queueName, processors[queueName]!, {
        connection,
        concurrency,
      }),
  );
}

export async function startWorkers(container: AppContainer): Promise<Worker[]> {
  workers = createWorkers(container);
  container.logger.info(
    { queues: ALL_QUEUE_NAMES, concurrency: container.config.JOB_CONCURRENCY },
    "Worker started",
  );
  return workers;
}

export async function stopWorkers(): Promise<void> {
  await Promise.all(workers.map((worker) => worker.close()));
  workers = [];
}

export function getActiveWorkers(): Worker[] {
  return workers;
}
