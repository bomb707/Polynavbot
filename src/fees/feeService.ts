import type { Market } from "@prisma/client";

import type { Config } from "../config/index.js";
import type {
  BuyEconomics,
  FeeBreakdown,
  FeeParams,
  IFeeService,
  LiquidityRole,
  LiquidityRoleInput,
  SellEconomics,
  TradeFeeInput,
} from "./feeTypes.js";
import { FEE_FREE_PARAMS } from "./feeTypes.js";

const MIN_FEE_USD = 0.00001;

function round5(value: number): number {
  const rounded = Math.round(value * 1e5) / 1e5;
  if (rounded < MIN_FEE_USD) {
    return 0;
  }
  return rounded;
}

function round8(value: number): number {
  return Math.round(value * 1e8) / 1e8;
}

export function createFeeService(config: Pick<Config, "BUILDER_FEE_BPS">): IFeeService {
  const defaultBuilderFeeBps = config.BUILDER_FEE_BPS;

  function getMarketFeeParams(
    market: Pick<
      Market,
      | "feesEnabled"
      | "feeRate"
      | "feeExponent"
      | "takerOnly"
      | "makerBaseFeeBps"
      | "takerBaseFeeBps"
      | "feeCategory"
    >,
  ): FeeParams {
    return {
      feesEnabled: market.feesEnabled,
      feeRate: market.feeRate,
      feeExponent: market.feeExponent,
      takerOnly: market.takerOnly,
      makerBaseFeeBps: market.makerBaseFeeBps,
      takerBaseFeeBps: market.takerBaseFeeBps,
      category: market.feeCategory,
    };
  }

  function calculatePlatformFee(input: TradeFeeInput): number {
    const { feeParams, liquidityRole, price, shares } = input;

    if (!feeParams.feesEnabled || liquidityRole === "maker") {
      return 0;
    }

    if (liquidityRole === "unknown") {
      return 0;
    }

    const raw = shares * feeParams.feeRate * price * (1 - price);
    return round5(raw);
  }

  function calculateBuilderFee(grossNotionalUsd: number, builderFeeBps?: number): number {
    const bps = builderFeeBps ?? defaultBuilderFeeBps;
    if (bps <= 0) {
      return 0;
    }
    return round5((grossNotionalUsd * bps) / 10000);
  }

  function calculateTotalFee(input: TradeFeeInput): FeeBreakdown {
    const grossNotionalUsd = round8(input.shares * input.price);
    const platformFeeUsd = calculatePlatformFee(input);
    const builderFeeUsd = calculateBuilderFee(grossNotionalUsd, input.builderFeeBps);
    const totalFeeUsd = round5(platformFeeUsd + builderFeeUsd);

    const netNotionalUsd =
      input.side === "BUY"
        ? round8(grossNotionalUsd + totalFeeUsd)
        : round8(grossNotionalUsd - totalFeeUsd);

    return {
      platformFeeUsd,
      builderFeeUsd,
      totalFeeUsd,
      grossNotionalUsd,
      netNotionalUsd,
    };
  }

  function estimateLiquidityRole(input: LiquidityRoleInput): LiquidityRole {
    const { side, limitPrice, bestBid, bestAsk } = input;

    if (side === "BUY") {
      if (bestAsk == null) {
        return "unknown";
      }
      return limitPrice >= bestAsk ? "taker" : "maker";
    }

    if (bestBid == null) {
      return "unknown";
    }
    return limitPrice <= bestBid ? "taker" : "maker";
  }

  function calculateBuyEconomics(input: TradeFeeInput): BuyEconomics {
    const breakdown = calculateTotalFee(input);
    return {
      grossCostUsd: breakdown.grossNotionalUsd,
      platformFeeUsd: breakdown.platformFeeUsd,
      builderFeeUsd: breakdown.builderFeeUsd,
      totalFeeUsd: breakdown.totalFeeUsd,
      totalCostUsd: breakdown.netNotionalUsd,
    };
  }

  function calculateSellEconomics(input: TradeFeeInput): SellEconomics {
    const breakdown = calculateTotalFee(input);
    return {
      grossProceedsUsd: breakdown.grossNotionalUsd,
      platformFeeUsd: breakdown.platformFeeUsd,
      builderFeeUsd: breakdown.builderFeeUsd,
      totalFeeUsd: breakdown.totalFeeUsd,
      netProceedsUsd: breakdown.netNotionalUsd,
    };
  }

  return {
    getMarketFeeParams,
    calculatePlatformFee,
    calculateBuilderFee,
    calculateTotalFee,
    estimateLiquidityRole,
    calculateBuyEconomics,
    calculateSellEconomics,
  };
}

export { FEE_FREE_PARAMS };
