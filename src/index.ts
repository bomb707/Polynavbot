import { loadConfig } from "./config/index.js";
import { createCli } from "./cli/index.js";
import { createContainer, type AppContainer } from "./container.js";

function registerShutdownHandlers(container: AppContainer): void {
  const shutdown = async (signal: string) => {
    container.logger.info({ signal }, "Shutting down");
    await container.shutdown();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

async function main(): Promise<void> {
  const config = loadConfig();
  const container = createContainer(config);

  registerShutdownHandlers(container);

  const program = createCli(container);
  await program.parseAsync(process.argv);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Fatal error: ${message}`);
  process.exit(1);
});
