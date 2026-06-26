import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, afterEach } from "vitest";

import { writeLatestReports } from "./reportWriter.js";
import { makeEmptyReportSnapshot } from "./testFixtures.js";

const snapshot = makeEmptyReportSnapshot({
  trades: [
    {
      timestamp: "2026-06-26T12:00:00.000Z",
      tokenId: "token-1",
      side: "BUY",
      price: 0.02,
      size: 100,
      notionalUsd: 2,
      feeUsd: 0,
      platformFeeUsd: 0,
      builderFeeUsd: 0,
      totalFeeUsd: 0,
      netNotionalUsd: 2,
      liquidityRole: "maker",
      source: "PAPER",
      question: 'Market with "quotes", comma',
    },
  ],
});

describe("writeLatestReports", () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("writes markdown, json, and csv files", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "polynavbot-report-"));

    const paths = await writeLatestReports(snapshot, tempDir);

    const md = await readFile(paths.markdown, "utf8");
    const json = await readFile(paths.json, "utf8");
    const csv = await readFile(paths.csv, "utf8");

    expect(md).toContain("# Polynavbot Report");
    expect(JSON.parse(json).portfolio.mode).toBe("paper");
    expect(csv).toContain("timestamp,tokenId,side");
    expect(csv).toContain('"Market with ""quotes"", comma"');
  });
});
