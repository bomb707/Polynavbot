import { config as loadDotenv } from "dotenv";

import { type Env, parseEnv } from "./env.js";

export type Config = Env;

export function loadConfig(): Config {
  loadDotenv();
  return parseEnv();
}
