import { describe, expect, it } from "vitest";

import type { Config } from "../config/index.js";
import { createContainer } from "../container.js";
import { runEntryPaper } from "./entryPaper.js";
import { runExitPaper } from "./exitPaper.js";
import { runWsMonitor } from "./wsMonitor.js";

const liveConfig = {
  TRADING_MODE: "live",
  LIVE_TRADING_CONFIRMATION: "I_UNDERSTAND_THE_RISKS",
  DATABASE_URL: "postgresql://user:pass@localhost:5432/test",
  REDIS_URL: "redis://localhost:6379",
  NODE_ENV: "test",
  LOG_LEVEL: "info",
} as Config;

describe("CLI paper-mode guards", () => {
  it("entry:paper rejects live mode", async () => {
    const container = createContainer(liveConfig);
    await expect(runEntryPaper(container)).rejects.toThrow(
      "entry:paper requires TRADING_MODE=paper",
    );
  });

  it("exit:paper rejects live mode", async () => {
    const container = createContainer(liveConfig);
    await expect(runExitPaper(container)).rejects.toThrow(
      "exit:paper requires TRADING_MODE=paper",
    );
  });

  it("ws:monitor rejects live mode", async () => {
    const container = createContainer(liveConfig);
    await expect(runWsMonitor(container)).rejects.toThrow(
      "ws:monitor requires TRADING_MODE=paper",
    );
  });
});
