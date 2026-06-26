import type { Market } from "@prisma/client";

export type LiquidityRole = "maker" | "taker" | "unknown";

export interface FeeParams {
  feesEnabled: boolean;
  feeRate: number;
  feeExponent?: number | null;
  takerOnly: boolean;
  makerBaseFeeBps: number;
  takerBaseFeeBps: number;
  category?: string | null;
}

export interface TradeFeeInput {
  side: "BUY" | "SELL";
  price: number;
  shares: number;
  liquidityRole: LiquidityRole;
  feeParams: FeeParams;
  builderFeeBps?: number;
}

export interface FeeBreakdown {
  platformFeeUsd: number;
  builderFeeUsd: number;
  totalFeeUsd: number;
  grossNotionalUsd: number;
  netNotionalUsd: number;
}

export interface BuyEconomics {
  grossCostUsd: number;
  totalFeeUsd: number;
  totalCostUsd: number;
  platformFeeUsd: number;
  builderFeeUsd: number;
}

export interface SellEconomics {
  grossProceedsUsd: number;
  totalFeeUsd: number;
  netProceedsUsd: number;
  platformFeeUsd: number;
  builderFeeUsd: number;
}

export interface LiquidityRoleInput {
  side: "BUY" | "SELL";
  limitPrice: number;
  bestBid: number | null;
  bestAsk: number | null;
}

export interface IFeeService {
  getMarketFeeParams(market: Pick<
    Market,
    | "feesEnabled"
    | "feeRate"
    | "feeExponent"
    | "takerOnly"
    | "makerBaseFeeBps"
    | "takerBaseFeeBps"
    | "feeCategory"
  >): FeeParams;
  calculatePlatformFee(input: TradeFeeInput): number;
  calculateBuilderFee(grossNotionalUsd: number, builderFeeBps?: number): number;
  calculateTotalFee(input: TradeFeeInput): FeeBreakdown;
  estimateLiquidityRole(input: LiquidityRoleInput): LiquidityRole;
  calculateBuyEconomics(input: TradeFeeInput): BuyEconomics;
  calculateSellEconomics(input: TradeFeeInput): SellEconomics;
}

export const FEE_FREE_PARAMS: FeeParams = {
  feesEnabled: false,
  feeRate: 0,
  feeExponent: null,
  takerOnly: true,
  makerBaseFeeBps: 0,
  takerBaseFeeBps: 0,
  category: null,
};
