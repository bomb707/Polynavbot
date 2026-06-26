import type { Redis } from "ioredis";

export const REDIS_KEY_PREFIX = "polynavbot";
export const RISK_KEY_PREFIX = `${REDIS_KEY_PREFIX}:risk`;

export function buildJobId(queueName: string, date: Date): string {
  const bucket = date.toISOString().slice(0, 16);
  return `${queueName}:${bucket}`;
}

export function lockKey(queueName: string, jobId: string): string {
  return `${REDIS_KEY_PREFIX}:lock:${queueName}:${jobId}`;
}

export async function acquireProcessingLock(
  redis: Redis,
  queueName: string,
  jobId: string,
  ttlSeconds = 300,
): Promise<boolean> {
  const result = await redis.set(lockKey(queueName, jobId), "1", "EX", ttlSeconds, "NX");
  return result === "OK";
}

export async function releaseProcessingLock(
  redis: Redis,
  queueName: string,
  jobId: string,
): Promise<void> {
  await redis.del(lockKey(queueName, jobId));
}

export async function withIdempotencyLock<T>(
  redis: Redis,
  queueName: string,
  jobId: string,
  fn: () => Promise<T>,
): Promise<T | null> {
  const acquired = await acquireProcessingLock(redis, queueName, jobId);
  if (!acquired) {
    return null;
  }

  try {
    return await fn();
  } finally {
    await releaseProcessingLock(redis, queueName, jobId);
  }
}

export async function clearRiskCacheKeys(redis: Redis): Promise<number> {
  const keys: string[] = [];
  let cursor = "0";

  do {
    const [nextCursor, batch] = await redis.scan(
      cursor,
      "MATCH",
      `${RISK_KEY_PREFIX}:*`,
      "COUNT",
      100,
    );
    cursor = nextCursor;
    keys.push(...batch);
  } while (cursor !== "0");

  if (keys.length === 0) {
    return 0;
  }

  await redis.del(...keys);
  return keys.length;
}
