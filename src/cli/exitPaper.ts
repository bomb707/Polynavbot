import type { AppContainer } from "../container.js";
import type { ExitPaperSummary } from "../execution/exitTypes.js";

export function formatExitPaperSummary(summary: ExitPaperSummary): string {
  const lines = [
    "=== Exit Paper Run ===",
    "",
    `Positions evaluated: ${summary.positionsEvaluated}`,
    `Holds: ${summary.holds}`,
    `Exits placed: ${summary.exitsPlaced}`,
    `Exits filled: ${summary.exitsFilled}`,
    `Total realized PnL: $${summary.totalRealizedPnlUsd.toFixed(2)}`,
    "",
    "Actions:",
  ];

  if (summary.actions.length === 0) {
    lines.push("  (none)");
  } else {
    for (const action of summary.actions) {
      const fillNote = action.filled ? "filled" : "not filled";
      const pnl =
        action.realizedPnlUsd != null ? ` | PnL=$${action.realizedPnlUsd.toFixed(2)}` : "";
      lines.push(
        `  [${action.action}/${action.reason}] ${action.question.slice(0, 50)} | size=${action.sellSizeShares.toFixed(4)} @ ${action.sellPrice.toFixed(4)} | ${fillNote}${pnl}`,
      );
    }
  }

  return lines.join("\n");
}

export async function runExitPaper(container: AppContainer): Promise<ExitPaperSummary> {
  await container.db.connect();
  return container.exitEngine.run();
}
