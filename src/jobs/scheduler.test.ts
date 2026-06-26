import { describe, expect, it, vi } from "vitest";

import { createQueueManager } from "./queue.js";
import { QUEUE_NAMES } from "./queueNames.js";
import { getScheduledJobs, registerSchedulers } from "./scheduler.js";

const config = {
  REDIS_URL: "redis://localhost:6379",
  JOB_ATTEMPTS: 3,
  JOB_BACKOFF_MS: 5000,
} as never;

describe("registerSchedulers", () => {
  it("registers five repeatable jobs and excludes evaluate-entry", async () => {
    const upsertJobScheduler = vi.fn().mockResolvedValue({});
    const queueManager = {
      getQueue: vi.fn().mockReturnValue({ upsertJobScheduler }),
    };

    const registered = await registerSchedulers(queueManager as never);

    expect(registered).toHaveLength(5);
    expect(registered.map((job) => job.queue)).not.toContain(QUEUE_NAMES.EVALUATE_ENTRY);
    expect(upsertJobScheduler).toHaveBeenCalledTimes(5);
    expect(queueManager.getQueue).toHaveBeenCalledWith(QUEUE_NAMES.SCAN_MARKETS);
  });

  it("getScheduledJobs returns cron patterns", () => {
    const jobs = getScheduledJobs();
    expect(jobs.find((job) => job.queue === QUEUE_NAMES.SCAN_MARKETS)?.pattern).toBe(
      "*/10 * * * *",
    );
    expect(jobs.find((job) => job.queue === QUEUE_NAMES.UPDATE_POSITIONS)?.pattern).toBe(
      "*/2 * * * *",
    );
  });
});

describe("createQueueManager", () => {
  it("exposes shared connection for workers", () => {
    const manager = createQueueManager(config, {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as never);

    expect(manager.getConnection()).toMatchObject({
      url: "redis://localhost:6379",
      maxRetriesPerRequest: null,
    });
  });
});
