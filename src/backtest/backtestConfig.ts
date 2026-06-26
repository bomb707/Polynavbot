import type { Config } from "../config/index.js";
import type { BacktestConfig } from "./backtestTypes.js";

export function createBacktestConfig(config: Config): BacktestConfig {
  return {
    interval: config.BACKTEST_INTERVAL,
    slippageBps: config.BACKTEST_SLIPPAGE_BPS,
    fillProbability: config.BACKTEST_FILL_PROBABILITY,
    assumedSpread: config.BACKTEST_ASSUMED_SPREAD,
    topOfBookDepthUsd: config.BACKTEST_TOP_OF_BOOK_DEPTH_USD,
    minLiquidityForExit: config.BACKTEST_MIN_LIQUIDITY_FOR_EXIT,
    startingCapitalUsd: config.BACKTEST_STARTING_CAPITAL_USD,
    seed: config.BACKTEST_SEED,
  };
}
