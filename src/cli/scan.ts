import type { AppContainer } from "../container.js";
import type { ScanSummary } from "../scanner/types.js";
import { SKIP_REASONS } from "../scanner/types.js";

export function formatScanSummary(summary: ScanSummary): string {
  const lines = [
    `Markets scanned: ${summary.marketsScanned}`,
    `Outcomes scanned: ${summary.outcomesScanned}`,
    `Candidates found: ${summary.candidatesFound}`,
    "",
    "Skipped reasons:",
  ];

  let hasSkips = false;
  for (const reason of SKIP_REASONS) {
    const count = summary.skipped[reason];
    if (count > 0) {
      lines.push(`  ${reason}: ${count}`);
      hasSkips = true;
    }
  }

  if (!hasSkips) {
    lines.push("  (none)");
  }

  return lines.join("\n");
}

export async function runScan(
  container: AppContainer,
  options?: { limitPerPage?: number; maxPages?: number },
): Promise<ScanSummary> {
  await container.db.connect();
  return container.scanner.scanMarkets(options);
}
