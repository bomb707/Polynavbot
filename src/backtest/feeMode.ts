import type { BacktestFeeMode } from "./backtestTypes.js";
import type { FeeParams } from "../fees/feeTypes.js";
import { FEE_FREE_PARAMS } from "../fees/feeTypes.js";

export function resolveBacktestLiquidityRole(
  feeMode: BacktestFeeMode,
  side: "BUY" | "SELL",
  feeParams?: FeeParams,
): "maker" | "taker" | "unknown" {
  if (feeMode === "actual_if_available" && feeParams?.feesEnabled) {
    return side === "BUY" ? "maker" : "taker";
  }

  switch (feeMode) {
    case "maker_only":
      return "maker";
    case "taker_only":
      return "taker";
    case "mixed":
      return side === "BUY" ? "maker" : "taker";
    case "actual_if_available":
      return side === "BUY" ? "maker" : "taker";
    default:
      return "unknown";
  }
}

export function resolveBacktestFeeParams(feeParams?: FeeParams): FeeParams {
  return feeParams ?? FEE_FREE_PARAMS;
}
