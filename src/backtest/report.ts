import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { BacktestResult } from "./backtestTypes.js";

export async function writeJsonReport(outputDir: string, result: BacktestResult): Promise<string> {
  await mkdir(outputDir, { recursive: true });
  const filePath = path.join(outputDir, "report.json");
  await writeFile(filePath, JSON.stringify(result, null, 2), "utf8");
  return filePath;
}

export async function writeCsvTrades(outputDir: string, result: BacktestResult): Promise<string> {
  await mkdir(outputDir, { recursive: true });
  const filePath = path.join(outputDir, "trades.csv");
  const header = "timestamp,tokenId,side,price,sizeShares,notionalUsd,realizedPnlUsd,reason,question";
  const rows = result.trades.map((trade) =>
    [
      trade.timestamp.toISOString(),
      trade.tokenId,
      trade.side,
      trade.price.toFixed(8),
      trade.sizeShares.toFixed(8),
      trade.notionalUsd.toFixed(2),
      trade.realizedPnlUsd.toFixed(2),
      csvEscape(trade.reason),
      csvEscape(trade.question),
    ].join(","),
  );
  await writeFile(filePath, [header, ...rows].join("\n"), "utf8");
  return filePath;
}

export async function writeMarkdownSummary(
  outputDir: string,
  result: BacktestResult,
): Promise<string> {
  await mkdir(outputDir, { recursive: true });
  const filePath = path.join(outputDir, "summary.md");
  const m = result.metrics;
  const topTrades = [...result.trades]
    .filter((trade) => trade.side === "SELL")
    .sort((a, b) => b.realizedPnlUsd - a.realizedPnlUsd)
    .slice(0, 5);
  const worstTrades = [...result.trades]
    .filter((trade) => trade.side === "SELL")
    .sort((a, b) => a.realizedPnlUsd - b.realizedPnlUsd)
    .slice(0, 5);

  const lines = [
    "# Backtest Summary",
    "",
    `Period: ${result.start} → ${result.end}`,
    "",
    "## Metrics",
    "",
    "| Metric | Value |",
    "|--------|-------|",
    `| Total ROI | ${(m.totalRoi * 100).toFixed(2)}% |`,
    `| Final equity | $${m.finalEquityUsd.toFixed(2)} |`,
    `| Realized PnL | $${m.realizedPnlUsd.toFixed(2)} |`,
    `| Unrealized PnL | $${m.unrealizedPnlUsd.toFixed(2)} |`,
    `| Max drawdown | ${(m.maxDrawdown * 100).toFixed(2)}% |`,
    `| Hit rate | ${(m.hitRate * 100).toFixed(1)}% |`,
    `| Average winner | $${m.averageWinner.toFixed(2)} |`,
    `| Average loser | $${m.averageLoser.toFixed(2)} |`,
    `| Payoff skew | ${m.payoffSkew.toFixed(2)} |`,
    `| Capital utilization | ${(m.capitalUtilization * 100).toFixed(1)}% |`,
    `| Worst losing streak | ${m.worstLosingStreak} |`,
    `| Total fills | ${m.totalTrades} |`,
    `| Tokens traded | ${result.tokensTraded} |`,
    `| Data source | ${result.dataset.dataSource}${result.dataset.mirrorWallet ? ` (${result.dataset.mirrorWallet.slice(0, 10)}…)` : ""} |`,
    `| Tokens loaded | ${result.dataset.tokensLoaded} |`,
    `| Timeline steps | ${result.dataset.timelineSteps} |`,
    "",
    "## Entry diagnostics",
    "",
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Entry evaluations | ${result.diagnostics.entryEvaluations} |`,
    `| Orders placed | ${result.diagnostics.ordersPlaced} |`,
    "",
  ];

  const rejectionEntries = Object.entries(result.diagnostics.entryRejections);
  if (rejectionEntries.length === 0) {
    lines.push("_No entry evaluations recorded._");
  } else {
    lines.push("| Rejection reason | Count |", "|------------------|-------|");
    for (const [reason, count] of rejectionEntries) {
      lines.push(`| ${reason} | ${count} |`);
    }
  }

  lines.push("", "## Top exits", "");

  if (topTrades.length === 0) {
    lines.push("(none)");
  } else {
    for (const trade of topTrades) {
      lines.push(
        `- ${trade.timestamp.toISOString()} ${trade.tokenId.slice(0, 12)}… PnL=$${trade.realizedPnlUsd.toFixed(2)} (${trade.reason})`,
      );
    }
  }

  lines.push("", "## Worst exits", "");
  if (worstTrades.length === 0) {
    lines.push("(none)");
  } else {
    for (const trade of worstTrades) {
      lines.push(
        `- ${trade.timestamp.toISOString()} ${trade.tokenId.slice(0, 12)}… PnL=$${trade.realizedPnlUsd.toFixed(2)} (${trade.reason})`,
      );
    }
  }

  await writeFile(filePath, lines.join("\n"), "utf8");
  return filePath;
}

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export async function writeBacktestReports(
  outputDir: string,
  result: BacktestResult,
): Promise<{ json: string; csv: string; markdown: string }> {
  const [json, csv, markdown] = await Promise.all([
    writeJsonReport(outputDir, result),
    writeCsvTrades(outputDir, result),
    writeMarkdownSummary(outputDir, result),
  ]);
  return { json, csv, markdown };
}
