import type { AppContainer } from "../container.js";
import { isPaperMode } from "../config/index.js";
import { ALL_QUEUE_NAMES } from "../jobs/queueNames.js";
import { startWorkers, stopWorkers } from "../jobs/worker.js";

export async function runWorker(container: AppContainer): Promise<void> {
  if (!isPaperMode(container.config)) {
    throw new Error("worker requires TRADING_MODE=paper");
  }

  await container.db.connect();
  await container.redis.connect();
  await startWorkers(container);

  const shutdown = async (signal: string) => {
    container.logger.info({ signal }, "Worker shutting down");
    await stopWorkers();
    await container.shutdown();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  container.logger.info({ queues: ALL_QUEUE_NAMES }, "Worker listening for jobs");
}
