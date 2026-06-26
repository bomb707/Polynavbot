import type { Config } from "../config/index.js";
import { isDryRunMode, isLiveMode, isPaperMode } from "../config/index.js";
import type { IRepositories } from "../db/repositories/index.js";
import type { ILogger } from "../logger/types.js";
import type { IClobClient } from "../polymarket/clobTypes.js";
import type { IPaperTradingEngine } from "../paper/paperTypes.js";
import type { IRiskEngine } from "../risk/riskTypes.js";
import { createDryRunExecutionEngine } from "./dryRunExecutionEngine.js";
import type { IExecutionEngine } from "./executionEngineTypes.js";
import { createLiveExecutionEngine } from "./liveExecutionEngine.js";
import { createPaperExecutionEngine } from "./paperExecutionEngine.js";

export interface CreateExecutionEngineDeps {
  config: Config;
  repositories: IRepositories;
  logger: ILogger;
  riskEngine: IRiskEngine;
  paperTradingEngine: IPaperTradingEngine;
  clobClient: IClobClient;
}

export function createExecutionEngine(deps: CreateExecutionEngineDeps): IExecutionEngine {
  const { config, repositories, logger, riskEngine, paperTradingEngine, clobClient } =
    deps;

  if (isDryRunMode(config)) {
    return createDryRunExecutionEngine({ riskEngine, logger });
  }

  if (isLiveMode(config)) {
    return createLiveExecutionEngine({
      config,
      repositories,
      clobClient,
      riskEngine,
      logger,
    });
  }

  if (isPaperMode(config)) {
    return createPaperExecutionEngine({
      repositories,
      paperTradingEngine,
      riskEngine,
    });
  }

  throw new Error(`Unsupported TRADING_MODE: ${config.TRADING_MODE}`);
}
