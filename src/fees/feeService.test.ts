import { describe, expect, it } from "vitest";

import { createFeeService } from "./feeService.js";
import type { FeeParams } from "./feeTypes.js";
import { FEE_FREE_PARAMS } from "./feeTypes.js";

const feeParams: FeeParams = {
  feesEnabled: true,
  feeRate: 0.02,
  feeExponent: 2,
  takerOnly: true,
  makerBaseFeeBps: 0,
  takerBaseFeeBps: 0,
  category: "sports",
};

describe("createFeeService", () => {
  const feeService = createFeeService({ BUILDER_FEE_BPS: 0 });
  const feeServiceWithBuilder = createFeeService({ BUILDER_FEE_BPS: 50 });

  it("maker buy has zero platform fee", () => {
    const fee = feeService.calculatePlatformFee({
      side: "BUY",
      price: 0.5,
      shares: 10,
      liquidityRole: "maker",
      feeParams,
    });
    expect(fee).toBe(0);
  });

  it("taker buy calculates correct fee", () => {
    const fee = feeService.calculatePlatformFee({
      side: "BUY",
      price: 0.5,
      shares: 10,
      liquidityRole: "taker",
      feeParams,
    });
    // 10 * 0.02 * 0.5 * 0.5 = 0.05
    expect(fee).toBe(0.05);
  });

  it("fee-free market has zero fee", () => {
    const breakdown = feeService.calculateTotalFee({
      side: "BUY",
      price: 0.5,
      shares: 10,
      liquidityRole: "taker",
      feeParams: FEE_FREE_PARAMS,
    });
    expect(breakdown.totalFeeUsd).toBe(0);
  });

  it("tiny fee below 0.00001 rounds to zero", () => {
    const fee = feeService.calculatePlatformFee({
      side: "BUY",
      price: 0.01,
      shares: 1,
      liquidityRole: "taker",
      feeParams: { ...feeParams, feeRate: 0.0001 },
    });
    expect(fee).toBe(0);
  });

  it("builder fee stacks with platform fee", () => {
    const breakdown = feeServiceWithBuilder.calculateTotalFee({
      side: "BUY",
      price: 0.5,
      shares: 10,
      liquidityRole: "taker",
      feeParams,
      builderFeeBps: 100,
    });
    expect(breakdown.platformFeeUsd).toBe(0.05);
    expect(breakdown.builderFeeUsd).toBe(0.05);
    expect(breakdown.totalFeeUsd).toBe(0.1);
  });

  it("estimateLiquidityRole for passive bid and ask", () => {
    expect(
      feeService.estimateLiquidityRole({
        side: "BUY",
        limitPrice: 0.48,
        bestBid: 0.48,
        bestAsk: 0.5,
      }),
    ).toBe("maker");

    expect(
      feeService.estimateLiquidityRole({
        side: "BUY",
        limitPrice: 0.5,
        bestBid: 0.48,
        bestAsk: 0.5,
      }),
    ).toBe("taker");

    expect(
      feeService.estimateLiquidityRole({
        side: "SELL",
        limitPrice: 0.52,
        bestBid: 0.5,
        bestAsk: 0.52,
      }),
    ).toBe("maker");
  });

  it("calculateBuyEconomics includes fees in total cost", () => {
    const economics = feeService.calculateBuyEconomics({
      side: "BUY",
      price: 0.5,
      shares: 10,
      liquidityRole: "taker",
      feeParams,
    });
    expect(economics.grossCostUsd).toBe(5);
    expect(economics.totalCostUsd).toBe(5.05);
  });

  it("calculateSellEconomics deducts fees from proceeds", () => {
    const economics = feeService.calculateSellEconomics({
      side: "SELL",
      price: 0.5,
      shares: 10,
      liquidityRole: "taker",
      feeParams,
    });
    expect(economics.grossProceedsUsd).toBe(5);
    expect(economics.netProceedsUsd).toBe(4.95);
  });
});
