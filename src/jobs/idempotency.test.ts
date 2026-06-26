import { describe, expect, it, vi } from "vitest";

import {
  acquireProcessingLock,
  buildJobId,
  lockKey,
  releaseProcessingLock,
} from "./idempotency.js";

function createMockRedis() {
  const store = new Map<string, string>();
  return {
    set: vi.fn(async (key: string, value: string, ...args: string[]) => {
      const hasNx = args.includes("NX");
      if (hasNx && store.has(key)) {
        return null;
      }
      store.set(key, value);
      return "OK";
    }),
    del: vi.fn(async (...keys: string[]) => {
      let count = 0;
      for (const key of keys) {
        if (store.delete(key)) {
          count += 1;
        }
      }
      return count;
    }),
    scan: vi.fn(async () => ["0", []]),
    store,
  };
}

describe("idempotency", () => {
  it("buildJobId uses 10-minute bucket", () => {
    const id = buildJobId("scan-markets", new Date("2026-06-26T18:07:00.000Z"));
    expect(id).toBe("scan-markets:2026-06-26T18:07");
  });

  it("lockKey uses namespaced format", () => {
    expect(lockKey("scan-markets", "job-1")).toBe("polynavbot:lock:scan-markets:job-1");
  });

  it("acquireProcessingLock returns false when lock already held", async () => {
    const redis = createMockRedis();
    const first = await acquireProcessingLock(redis as never, "scan-markets", "job-1");
    const second = await acquireProcessingLock(redis as never, "scan-markets", "job-1");
    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  it("releaseProcessingLock allows re-acquire", async () => {
    const redis = createMockRedis();
    await acquireProcessingLock(redis as never, "scan-markets", "job-1");
    await releaseProcessingLock(redis as never, "scan-markets", "job-1");
    const acquired = await acquireProcessingLock(redis as never, "scan-markets", "job-1");
    expect(acquired).toBe(true);
  });
});
