import { config as loadDotenv } from "dotenv";

import {
  type Env,
  type TradingMode,
  parseEnv,
  envSchema,
  isLiveMode,
  isPaperMode,
} from "./env.js";

export type Config = Env;

export type { Env, TradingMode };
export { parseEnv, envSchema, isLiveMode, isPaperMode };

export function loadConfig(): Config {
  loadDotenv();
  return parseEnv();
}
