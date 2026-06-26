import { Command } from "commander";

import type { AppContainer } from "../container.js";
import { runHealthCheck } from "./health.js";
import { formatScanSummary, runScan } from "./scan.js";

export function createCli(container: AppContainer): Command {
  const program = new Command();

  program
    .name("polynavbot")
    .description("Polymarket longshot trading bot")
    .version("0.1.0");

  program
    .command("health")
    .description("Check connectivity to PostgreSQL and Redis")
    .action(async () => {
      const report = await runHealthCheck(container);
      console.log(JSON.stringify(report, null, 2));
      await container.shutdown();
      process.exit(report.status === "healthy" ? 0 : 1);
    });

  program
    .command("scan")
    .description("Scan active Polymarket markets for longshot YES candidates")
    .option("--limit-per-page <n>", "markets per page", "100")
    .option("--max-pages <n>", "maximum pages to scan", "50")
    .action(async (options: { limitPerPage: string; maxPages: string }) => {
      const summary = await runScan(container, {
        limitPerPage: Number(options.limitPerPage),
        maxPages: Number(options.maxPages),
      });
      console.log(formatScanSummary(summary));
      await container.shutdown();
      process.exit(0);
    });

  program.action(async () => {
    container.logger.info(
      { env: container.config.NODE_ENV },
      "Polynavbot started — no command given, use `health` to check services",
    );
    await container.shutdown();
  });

  return program;
}
