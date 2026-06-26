import type { AppContainer } from "../container.js";
import { isPaperMode } from "../config/index.js";
import { registerSchedulers } from "../jobs/scheduler.js";

export async function runScheduler(container: AppContainer): Promise<void> {
  if (!isPaperMode(container.config)) {
    throw new Error("scheduler requires TRADING_MODE=paper");
  }

  await container.redis.connect();
  const registered = await registerSchedulers(container.queueManager);

  for (const job of registered) {
    container.logger.info(
      { queue: job.queue, schedulerId: job.schedulerId, pattern: job.pattern },
      "Registered repeatable job",
    );
  }
}
