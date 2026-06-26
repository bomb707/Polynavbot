import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ReportSnapshot, WrittenReportPaths } from "./reportTypes.js";

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function formatUsd(value: number | null): string {
  if (value == null) {
    return "N/A";
  }
  return `$${value.toFixed(2)}`;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 1)}…`;
}

function buildMarkdown(snapshot: ReportSnapshot): string {
  const p = snapshot.portfolio;
  const lines = [
    "# Polynavbot Report",
    "",
    `Generated: ${p.generatedAt}`,
    "",
    "## Portfolio",
    "",
    "| Metric | Value |",
    "|--------|-------|",
    `| Mode | ${p.mode} |`,
    `| Cash balance | ${formatUsd(p.cashBalanceUsd)} |`,
    `| Open exposure | ${formatUsd(p.openExposureUsd)} |`,
    `| Portfolio value | ${formatUsd(p.portfolioValueUsd)} |`,
    `| Realized PnL | ${formatUsd(p.realizedPnlUsd)} |`,
    `| Unrealized PnL | ${formatUsd(p.unrealizedPnlUsd)} |`,
    `| Total PnL | ${formatUsd(p.totalPnlUsd)} |`,
    `| Open positions | ${p.openPositionsCount} |`,
    `| Open orders | ${p.openOrdersCount} |`,
    "",
    "## Top Winners",
    "",
  ];

  if (snapshot.topWinners.length === 0) {
    lines.push("_None_");
  } else {
    lines.push("| # | Question | Unrealized PnL | Price |");
    lines.push("|---|----------|----------------|-------|");
    snapshot.topWinners.forEach((row, index) => {
      lines.push(
        `| ${index + 1} | ${truncate(row.question, 60)} | ${formatUsd(row.unrealizedPnlUsd)} | ${row.currentPrice.toFixed(4)} |`,
      );
    });
  }

  lines.push("", "## Top Losers", "");

  if (snapshot.topLosers.length === 0) {
    lines.push("_None_");
  } else {
    lines.push("| # | Question | Unrealized PnL | Price |");
    lines.push("|---|----------|----------------|-------|");
    snapshot.topLosers.forEach((row, index) => {
      lines.push(
        `| ${index + 1} | ${truncate(row.question, 60)} | ${formatUsd(row.unrealizedPnlUsd)} | ${row.currentPrice.toFixed(4)} |`,
      );
    });
  }

  lines.push("", "## Recent Signals", "");

  if (snapshot.recentSignals.length === 0) {
    lines.push("_None_");
  } else {
    lines.push("| Time | Type | Status | Score | Entry | Reason |");
    lines.push("|------|------|--------|-------|-------|--------|");
    for (const signal of snapshot.recentSignals) {
      lines.push(
        `| ${signal.createdAt.slice(0, 19)} | ${signal.signalType} | ${signal.status} | ${signal.score.toFixed(2)} | ${signal.entryPrice.toFixed(4)} | ${truncate(signal.reason, 40)} |`,
      );
    }
  }

  lines.push("", "## Risk Rejections", "");

  if (snapshot.riskRejections.length === 0) {
    lines.push("_None_");
  } else {
    lines.push("| Time | Level | Type | Message |");
    lines.push("|------|-------|------|---------|");
    for (const event of snapshot.riskRejections) {
      lines.push(
        `| ${event.createdAt.slice(0, 19)} | ${event.level} | ${event.type} | ${truncate(event.message, 60)} |`,
      );
    }
  }

  lines.push("", "## Pending Exits", "");

  if (snapshot.pendingExits.length === 0) {
    lines.push("_None_");
  } else {
    lines.push("| Action | Reason | Question | Size | Price |");
    lines.push("|--------|--------|----------|------|-------|");
    for (const exit of snapshot.pendingExits) {
      lines.push(
        `| ${exit.action} | ${exit.reason} | ${truncate(exit.question, 50)} | ${exit.sellSizeShares.toFixed(4)} | ${exit.sellPrice.toFixed(4)} |`,
      );
    }
  }

  if (p.mode !== "paper") {
    lines.push("", "_Cash balance and portfolio value are N/A outside paper mode._");
  }

  return lines.join("\n");
}

function buildCsv(snapshot: ReportSnapshot): string {
  const header =
    "timestamp,tokenId,side,price,size,notionalUsd,feeUsd,source,question";
  const rows = snapshot.trades.map((trade) =>
    [
      trade.timestamp,
      trade.tokenId,
      trade.side,
      trade.price.toFixed(8),
      trade.size.toFixed(8),
      trade.notionalUsd.toFixed(2),
      trade.feeUsd.toFixed(2),
      trade.source,
      csvEscape(trade.question),
    ].join(","),
  );
  return [header, ...rows].join("\n");
}

export async function writeLatestReports(
  snapshot: ReportSnapshot,
  outputDir = "reports",
): Promise<WrittenReportPaths> {
  await mkdir(outputDir, { recursive: true });

  const markdown = path.join(outputDir, "latest.md");
  const json = path.join(outputDir, "latest.json");
  const csv = path.join(outputDir, "trades.csv");

  await Promise.all([
    writeFile(markdown, buildMarkdown(snapshot), "utf8"),
    writeFile(json, JSON.stringify(snapshot, null, 2), "utf8"),
    writeFile(csv, buildCsv(snapshot), "utf8"),
  ]);

  return { markdown, json, csv };
}
