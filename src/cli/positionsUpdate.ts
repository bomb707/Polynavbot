import type { AppContainer } from "../container.js";
import type { PositionMonitorSummary } from "../positions/positionMonitorTypes.js";

export function formatPositionsUpdateSummary(summary: PositionMonitorSummary): string {
  const lines = [
    "=== Position Update ===",
    "",
    `Positions: loaded ${summary.positionsLoaded} | updated ${summary.positionsUpdated} | skipped ${summary.positionsSkipped} | snapshots ${summary.snapshotsSaved}`,
    "",
    "Portfolio:",
    `  Starting balance: $${summary.startingBalanceUsd.toFixed(2)}`,
    `  Cash balance:     $${summary.cashBalanceUsd.toFixed(2)}`,
    `  Open exposure:    $${summary.openExposureUsd.toFixed(2)}`,
    `  Portfolio value:  $${summary.portfolioValueUsd.toFixed(2)}`,
    `  Realized PnL:     $${summary.totalRealizedPnlUsd.toFixed(2)}`,
    `  Unrealized PnL:   $${summary.totalUnrealizedPnlUsd.toFixed(2)}`,
    `  Total PnL:        $${summary.totalPnlUsd.toFixed(2)}`,
    "",
  ];

  if (summary.bestPosition) {
    const best = summary.bestPosition;
    lines.push(
      `Best position:  ${best.tokenId.slice(0, 12)}… uPnL=$${best.unrealizedPnlUsd.toFixed(2)} @ ${best.currentPrice.toFixed(4)}`,
    );
  } else {
    lines.push("Best position:  (none)");
  }

  if (summary.worstPosition) {
    const worst = summary.worstPosition;
    lines.push(
      `Worst position: ${worst.tokenId.slice(0, 12)}… uPnL=$${worst.unrealizedPnlUsd.toFixed(2)} @ ${worst.currentPrice.toFixed(4)}`,
    );
  } else {
    lines.push("Worst position: (none)");
  }

  lines.push("", `Exit eligible (${summary.exitEligible.length}):`);

  if (summary.exitEligible.length === 0) {
    lines.push("  (none)");
  } else {
    for (const eligible of summary.exitEligible) {
      lines.push(
        `  [${eligible.action}/${eligible.reason}] ${eligible.question.slice(0, 50)} | size=${eligible.sellSizeShares.toFixed(4)} @ ${eligible.sellPrice.toFixed(4)}`,
      );
    }
  }

  return lines.join("\n");
}

export async function runPositionsUpdate(
  container: AppContainer,
): Promise<PositionMonitorSummary> {
  await container.db.connect();
  return container.positionMonitor.run();
}
