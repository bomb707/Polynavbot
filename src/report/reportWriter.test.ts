import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, afterEach } from "vitest";

import { writeLatestReports } from "./reportWriter.js";
import type { ReportSnapshot } from "./reportTypes.js";

const snapshot: ReportSnapshot = {
  portfolio: {
    generatedAt: "2026-06-26T12:00:00.000Z",
    mode: "paper",
    cashBalanceUsd: 500,
    openExposureUsd: 0,
    portfolioValueUsd: 500,
    realizedPnlUsd: 0,
    unrealizedPnlUsd: 0,
    totalPnlUsd: 0,
    openPositionsCount: 0,
    openOrdersCount: 0,
  },
  topWinners: [],
  topLosers: [],
  recentSignals: [],
  riskRejections: [],
  pendingExits: [],
  trades: [
    {
      timestamp: "2026-06-26T12:00:00.000Z",
      tokenId: "token-1",
      side: "BUY",
      price: 0.02,
      size: 100,
      notionalUsd: 2,
      feeUsd: 0,
      source: "PAPER",
      question: 'Market with "quotes", comma',
    },
  ],
};

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
