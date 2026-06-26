import {
  LiveTradingDisabledError,
  LiveTradingNotConfirmedError,
} from "../polymarket/clobErrors.js";
import type { Env } from "./env.js";
import { isLiveMode } from "./env.js";

export const LIVE_TRADING_CONFIRMATION_PHRASE = "I_UNDERSTAND_THE_RISKS";

export function assertLiveTradingEnabled(
  config: Pick<Env, "TRADING_MODE">,
): void {
  if (!isLiveMode(config)) {
    throw new LiveTradingDisabledError(
      `Live CLOB trading is disabled when TRADING_MODE=${config.TRADING_MODE}. Set TRADING_MODE=live to enable.`,
    );
  }
}

export function assertLiveOrderPlacementAllowed(
  config: Pick<Env, "TRADING_MODE" | "LIVE_TRADING_CONFIRMATION">,
): void {
  assertLiveTradingEnabled(config);
  if (config.LIVE_TRADING_CONFIRMATION !== LIVE_TRADING_CONFIRMATION_PHRASE) {
    throw new LiveTradingNotConfirmedError(
      `Live order placement requires LIVE_TRADING_CONFIRMATION=${LIVE_TRADING_CONFIRMATION_PHRASE}.`,
    );
  }
}
