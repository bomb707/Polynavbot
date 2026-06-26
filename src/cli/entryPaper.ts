import type { AppContainer } from "../container.js";
import type { EntryPaperSummary } from "../execution/entryTypes.js";
import type { ScanOptions } from "../scanner/types.js";

export function formatEntryPaperSummary(summary: EntryPaperSummary): string {
  const lines = [
    "=== Entry Paper Run ===",
    "",
    `Markets scanned: ${summary.scan.marketsScanned}`,
    `Outcomes scanned: ${summary.scan.outcomesScanned}`,
    `Scanner candidates: ${summary.scan.candidatesFound}`,
    "",
    "Candidates:",
  ];

  if (summary.candidates.length === 0) {
    lines.push("  (none)");
  } else {
    for (const candidate of summary.candidates) {
      lines.push(
        `  ${candidate.question.slice(0, 60)} | score=${candidate.score.toFixed(1)} | ${candidate.decision}`,
      );
    }
  }

  lines.push("", "Accepted entries:");
  if (summary.accepted.length === 0) {
    lines.push("  (none)");
  } else {
    for (const entry of summary.accepted) {
      lines.push(
        `  ${entry.question.slice(0, 50)} | bid=${entry.bidPrice.toFixed(4)} | $${entry.sizeUsd.toFixed(2)} | shares=${entry.shares.toFixed(4)} | order=${entry.orderId}`,
      );
    }
  }

  lines.push("", "Rejected entries:");
  if (summary.rejected.length === 0) {
    lines.push("  (none)");
  } else {
    for (const entry of summary.rejected) {
      lines.push(
        `  [${entry.stage}] ${entry.question.slice(0, 50)} | ${entry.reason}`,
      );
    }
  }

  lines.push("", `Total notional: $${summary.totalNotionalUsd.toFixed(2)}`);

  lines.push("", "Risk rejection reasons:");
  if (summary.riskRejectionReasons.length === 0) {
    lines.push("  (none)");
  } else {
    for (const reason of summary.riskRejectionReasons) {
      lines.push(`  - ${reason}`);
    }
  }

  return lines.join("\n");
}

export async function runEntryPaper(
  container: AppContainer,
  options?: ScanOptions,
): Promise<EntryPaperSummary> {
  await container.db.connect();
  return container.entryEngine.run(options);
}
