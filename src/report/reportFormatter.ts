import type { ReportSnapshot } from "./reportTypes.js";

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

function formatPositionLine(index: number, row: ReportSnapshot["topWinners"][number]): string {
  return `  #${index + 1}  ${truncate(row.question, 50).padEnd(50)}  uPnL=${formatUsd(row.unrealizedPnlUsd).padStart(10)}  @ ${row.currentPrice.toFixed(4)}`;
}

export function formatTerminalDashboard(snapshot: ReportSnapshot): string {
  const { portfolio: p } = snapshot;
  const lines = [
    "=== Polynavbot Report ===",
    "",
    `Generated: ${p.generatedAt}`,
    `Mode:      ${p.mode}`,
    "",
    "--- Portfolio ---",
    `Cash balance:       ${formatUsd(p.cashBalanceUsd)}`,
    `Open exposure:      ${formatUsd(p.openExposureUsd)}`,
    `Portfolio value:    ${formatUsd(p.portfolioValueUsd)}`,
    `Realized PnL:       ${formatUsd(p.realizedPnlUsd)}`,
    `Unrealized PnL:     ${formatUsd(p.unrealizedPnlUsd)}`,
    `Total PnL:          ${formatUsd(p.totalPnlUsd)}`,
    `Open positions:     ${p.openPositionsCount}`,
    `Open orders:        ${p.openOrdersCount}`,
    "",
    `--- Top Winners (${snapshot.topWinners.length}) ---`,
  ];

  if (snapshot.topWinners.length === 0) {
    lines.push("  (none)");
  } else {
    snapshot.topWinners.forEach((row, index) => {
      lines.push(formatPositionLine(index, row));
    });
  }

  lines.push("", `--- Top Losers (${snapshot.topLosers.length}) ---`);

  if (snapshot.topLosers.length === 0) {
    lines.push("  (none)");
  } else {
    snapshot.topLosers.forEach((row, index) => {
      lines.push(formatPositionLine(index, row));
    });
  }

  lines.push("", `--- Recent Signals (${snapshot.recentSignals.length}) ---`);

  if (snapshot.recentSignals.length === 0) {
    lines.push("  (none)");
  } else {
    for (const signal of snapshot.recentSignals) {
      lines.push(
        `  ${signal.createdAt.slice(0, 19)}  [${signal.status}] ${signal.signalType}  ${truncate(signal.reason, 40)}  score=${signal.score.toFixed(2)}  @ ${signal.entryPrice.toFixed(4)}`,
      );
    }
  }

  lines.push("", `--- Risk Rejections (${snapshot.riskRejections.length}) ---`);

  if (snapshot.riskRejections.length === 0) {
    lines.push("  (none)");
  } else {
    for (const event of snapshot.riskRejections) {
      lines.push(
        `  ${event.createdAt.slice(0, 19)}  [${event.level}/${event.type}]  ${truncate(event.message, 60)}`,
      );
    }
  }

  lines.push("", `--- Pending Exits (${snapshot.pendingExits.length}) ---`);

  if (snapshot.pendingExits.length === 0) {
    lines.push("  (none)");
  } else {
    for (const exit of snapshot.pendingExits) {
      lines.push(
        `  [${exit.action}/${exit.reason}] ${truncate(exit.question, 50)}  size=${exit.sellSizeShares.toFixed(4)} @ ${exit.sellPrice.toFixed(4)}`,
      );
    }
  }

  if (p.mode !== "paper") {
    lines.push("", "Note: cash balance and portfolio value are N/A outside paper mode.");
  }

  return lines.join("\n");
}
