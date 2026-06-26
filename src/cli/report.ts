import type { AppContainer } from "../container.js";
import { createReportService } from "../report/reportService.js";
import { writeLatestReports } from "../report/reportWriter.js";
import type { ReportSnapshot, WrittenReportPaths } from "../report/reportTypes.js";

export function formatReportPaths(paths: WrittenReportPaths): string {
  return [
    "Reports written:",
    `  ${paths.markdown}`,
    `  ${paths.json}`,
    `  ${paths.csv}`,
  ].join("\n");
}

export async function runReport(
  container: AppContainer,
  options?: { outputDir?: string },
): Promise<{ snapshot: ReportSnapshot; paths: WrittenReportPaths }> {
  await container.db.connect();

  const reportService = createReportService({
    config: container.config,
    repositories: container.repositories,
    paperTradingEngine: container.paperTradingEngine,
    exitEngine: container.exitEngine,
  });

  const snapshot = await reportService.buildSnapshot();
  const paths = await writeLatestReports(snapshot, options?.outputDir ?? "reports");

  return { snapshot, paths };
}
