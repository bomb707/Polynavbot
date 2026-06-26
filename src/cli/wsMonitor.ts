import type { AppContainer } from "../container.js";

export async function runWsMonitor(container: AppContainer): Promise<void> {
  await container.db.connect();
  await container.wsMonitorService.start();

  const shutdown = async (signal: string) => {
    container.logger.info({ signal }, "WebSocket monitor shutting down");
    await container.wsMonitorService.stop();
    await container.shutdown();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  container.logger.info("WebSocket monitor running");
}
