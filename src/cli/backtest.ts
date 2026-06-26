import path from "node:path";

import type { AppContainer } from "../container.js";
import { createBacktestEngine } from "../backtest/backtestEngine.js";
import { writeBacktestReports } from "../backtest/report.js";

export interface BacktestCliOptions {
  start: string;
  end: string;
  outputDir?: string;
  feeMode?: "maker_only" | "taker_only" | "mixed" | "actual_if_available";
}

function parseDate(value: string, label: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ${label} date: ${value}`);
  }
  return date;
}

export async function runBacktest(
  container: AppContainer,
  options: BacktestCliOptions,
): Promise<{ outputDir: string; resultPath: string }> {
  const start = parseDate(options.start, "start");
  const end = parseDate(options.end, "end");

  if (start >= end) {
    throw new Error("start must be before end");
  }

  await container.db.connect();

  const outputDir =
    options.outputDir ??
    path.join("backtest-results", `${options.start}_${options.end}`);

  const engine = createBacktestEngine({
    config: container.config,
    repositories: container.repositories,
    publicClient: container.publicClient,
    logger: container.logger,
  });

  const result = await engine.run({ start, end, outputDir, feeMode: options.feeMode });
  const files = await writeBacktestReports(outputDir, result);

  container.logger.info(
    {
      outputDir,
      totalRoi: result.metrics.totalRoi,
      trades: result.metrics.totalTrades,
      files,
    },
    "Backtest complete",
  );

  console.log(JSON.stringify({ outputDir, files, metrics: result.metrics }, null, 2));

  return { outputDir, resultPath: files.json };
}
