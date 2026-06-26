import type { IQueueManager } from "./queue.js";
import { QUEUE_NAMES } from "./queueNames.js";

export interface SchedulerRegistration {
  queue: string;
  schedulerId: string;
  pattern: string;
}

const SCHEDULED_JOBS: SchedulerRegistration[] = [
  {
    queue: QUEUE_NAMES.SCAN_MARKETS,
    schedulerId: "scan-markets-every-10m",
    pattern: "*/10 * * * *",
  },
  {
    queue: QUEUE_NAMES.UPDATE_POSITIONS,
    schedulerId: "update-positions-every-2m",
    pattern: "*/2 * * * *",
  },
  {
    queue: QUEUE_NAMES.EVALUATE_EXITS,
    schedulerId: "evaluate-exits-every-2m",
    pattern: "*/2 * * * *",
  },
  {
    queue: QUEUE_NAMES.DAILY_RISK_RESET,
    schedulerId: "daily-risk-reset-utc-midnight",
    pattern: "0 0 * * *",
  },
  {
    queue: QUEUE_NAMES.PORTFOLIO_REPORT,
    schedulerId: "portfolio-report-hourly",
    pattern: "0 * * * *",
  },
];

export function getScheduledJobs(): SchedulerRegistration[] {
  return [...SCHEDULED_JOBS];
}

export async function registerSchedulers(
  queueManager: IQueueManager,
): Promise<SchedulerRegistration[]> {
  for (const job of SCHEDULED_JOBS) {
    const queue = queueManager.getQueue(job.queue);
    await queue.upsertJobScheduler(
      job.schedulerId,
      { pattern: job.pattern },
      {
        name: job.queue,
        data: { triggeredAt: new Date().toISOString() },
      },
    );
  }

  return SCHEDULED_JOBS;
}
