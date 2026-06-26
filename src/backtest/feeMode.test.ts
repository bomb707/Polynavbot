import { describe, expect, it } from "vitest";

import { createFeeService } from "../fees/feeService.js";
import type { FeeParams } from "../fees/feeTypes.js";
import { resolveBacktestLiquidityRole } from "./feeMode.js";

const feeParams: FeeParams = {
  feesEnabled: true,
  feeRate: 0.02,
  takerOnly: true,
  makerBaseFeeBps: 0,
  takerBaseFeeBps: 0,
};

describe("resolveBacktestLiquidityRole", () => {
  const feeService = createFeeService({ BUILDER_FEE_BPS: 0 });

  it("mixed mode uses maker entry and taker exit fees", () => {
    const entryRole = resolveBacktestLiquidityRole("mixed", "BUY", feeParams);
    const exitRole = resolveBacktestLiquidityRole("mixed", "SELL", feeParams);

    const entryFee = feeService.calculateTotalFee({
      side: "BUY",
      price: 0.5,
      shares: 10,
      liquidityRole: entryRole,
      feeParams,
    });
    const exitFee = feeService.calculateTotalFee({
      side: "SELL",
      price: 0.5,
      shares: 10,
      liquidityRole: exitRole,
      feeParams,
    });

    expect(entryFee.totalFeeUsd).toBe(0);
    expect(exitFee.totalFeeUsd).toBeGreaterThan(0);
  });
});
