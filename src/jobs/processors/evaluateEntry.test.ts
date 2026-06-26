import { describe, expect, it, vi } from "vitest";
import type { Job } from "bullmq";

import type { Config } from "../config/index.js";
import { createEvaluateEntryProcessor } from "./evaluateEntry.js";
import type { EvaluateEntryJobData } from "../types.js";

const config = {
  TRADING_MODE: "paper",
  JOB_ATTEMPTS: 3,
  JOB_BACKOFF_MS: 5000,
} as Config;

function makeJob(data: EvaluateEntryJobData): Job<EvaluateEntryJobData> {
  return {
    id: "evaluate-entry:scan-1",
    name: "evaluate-entry",
    queueName: "evaluate-entry",
    data,
    attemptsMade: 0,
  } as Job<EvaluateEntryJobData>;
}

describe("createEvaluateEntryProcessor", () => {
  it("runs entry engine with provided scan summary", async () => {
    const run = vi.fn().mockResolvedValue({
      accepted: [{ tokenId: "t1" }],
      rejected: [],
      totalNotionalUsd: 2,
    });

    const redis = {
      set: vi.fn().mockResolvedValue("OK"),
      del: vi.fn().mockResolvedValue(1),
    };

    const processor = createEvaluateEntryProcessor({
      config,
      entryEngine: { run },
      redis: { client: redis },
      logger: { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() },
    } as never);

    const scan = {
      marketsScanned: 10,
      outcomesScanned: 20,
      candidatesFound: 1,
      skipped: {} as never,
      candidates: [],
    };

    const result = await processor(
      makeJob({
        scanRunId: "scan-1",
        scan,
      }),
    );

    expect(run).toHaveBeenCalledWith({ scan });
    expect(result).toMatchObject({ accepted: 1, rejected: 0, totalNotionalUsd: 2 });
  });
});
