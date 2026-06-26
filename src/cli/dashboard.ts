import type { Server } from "node:http";

import type { AppContainer } from "../container.js";
import { startDashboardServer } from "../dashboard/server.js";
import { createReportService } from "../report/reportService.js";

export interface DashboardRunOptions {
  port: number;
  refreshSeconds: number;
}

export async function runDashboard(
  container: AppContainer,
  options: DashboardRunOptions,
): Promise<void> {
  await container.db.connect();

  const reportService = createReportService({
    config: container.config,
    repositories: container.repositories,
    paperTradingEngine: container.paperTradingEngine,
    exitEngine: container.exitEngine,
    feeService: container.feeService,
  });

  let server: Server | undefined;

  const shutdown = async (signal: string) => {
    container.logger.info({ signal }, "Dashboard shutting down");
    await new Promise<void>((resolve, reject) => {
      if (!server) {
        resolve();
        return;
      }
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await container.shutdown();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  server = await startDashboardServer({
    port: options.port,
    refreshSeconds: options.refreshSeconds,
    buildSnapshot: () => reportService.buildSnapshot(),
    logger: container.logger,
  });

  container.logger.info(
    { url: `http://127.0.0.1:${options.port}` },
    "Open dashboard in your browser",
  );
}
