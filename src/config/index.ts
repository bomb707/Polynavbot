import { config as loadDotenv } from "dotenv";

import { type Env, type TradingMode, parseEnv } from "./env.js";

export type Config = Env;

export type { Env, TradingMode };
export {
  parseEnv,
  envSchema,
  isLiveMode,
  isPaperMode,
} from "./env.js";
export {
  LIVE_TRADING_CONFIRMATION_PHRASE,
  assertLiveTradingEnabled,
  assertLiveOrderPlacementAllowed,
} from "./liveTradingGuards.js";

export function loadConfig(): Config {
  loadDotenv();
  return parseEnv();
}
