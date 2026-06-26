export { createBacktestConfig } from "./backtestConfig.js";
export { createBacktestEngine } from "./backtestEngine.js";
export type { BacktestEngineDeps } from "./backtestEngine.js";
export { createDataLoader, mergePriceBars, buildTimeline } from "./dataLoader.js";
export { simulateConservativeFill } from "./fillSimulator.js";
export { computeMetrics } from "./metrics.js";
export { writeBacktestReports } from "./report.js";
export type {
  BacktestConfig,
  BacktestDataset,
  BacktestMetrics,
  BacktestResult,
  BacktestRunOptions,
  BacktestTrade,
  IBacktestEngine,
  PriceBar,
} from "./backtestTypes.js";
