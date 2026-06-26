import type { Env } from "./env.js";

export type StrategyProfile = "default" | "nyetrisk";

export const NYETRISK_MIRROR_WALLET =
  "0xc03ce4d8af842ca6251ac57228b3ffb166ed50af";

const NYETRISK_OVERRIDES: Partial<Env> = {
  MAX_OPEN_POSITIONS: 120,
  MAX_OPEN_ORDERS: 50,
  MAX_OPEN_EXPOSURE_USD: 400,
  MAX_DAILY_SPEND_USD: 100,
  MAX_POSITION_SIZE_USD: 15,
  MAX_ORDER_SIZE_USD: 15,
  MAX_MARKET_EXPOSURE_USD: 30,
  MAX_THEME_EXPOSURE_USD: 80,
  PAPER_STARTING_BALANCE_USD: 2000,
  LONGSHOT_ENTRY_THRESHOLD: 60,
  NO_ENTRY_ENABLED: true,
  MIRROR_ENABLED: true,
  MIRROR_WALLET: NYETRISK_MIRROR_WALLET,
  MIRROR_MAX_ITEMS: 2000,
  SCAN_MAX_PAGES: 20,
};

export function applyStrategyProfile(env: Env): Env {
  if (env.STRATEGY_PROFILE !== "nyetrisk") {
    return env;
  }

  return { ...env, ...NYETRISK_OVERRIDES };
}

export function isNyetriskProfile(config: Pick<Env, "STRATEGY_PROFILE">): boolean {
  return config.STRATEGY_PROFILE === "nyetrisk";
}
