-- CreateEnum
CREATE TYPE "LiquidityRole" AS ENUM ('maker', 'taker', 'unknown');

-- AlterTable
ALTER TABLE "LiveOrder" ADD COLUMN     "estimatedBuilderFeeUsd" DECIMAL(18,8) NOT NULL DEFAULT 0,
ADD COLUMN     "estimatedPlatformFeeUsd" DECIMAL(18,8) NOT NULL DEFAULT 0,
ADD COLUMN     "estimatedTotalFeeUsd" DECIMAL(18,8) NOT NULL DEFAULT 0,
ADD COLUMN     "liquidityRole" "LiquidityRole" NOT NULL DEFAULT 'unknown';

-- AlterTable
ALTER TABLE "Market" ADD COLUMN     "feeCategory" TEXT,
ADD COLUMN     "feeExponent" INTEGER,
ADD COLUMN     "feeLastFetchedAt" TIMESTAMP(3),
ADD COLUMN     "feeRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "feesEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "makerBaseFeeBps" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "takerBaseFeeBps" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "takerOnly" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "PaperOrder" ADD COLUMN     "estimatedBuilderFeeUsd" DECIMAL(18,8) NOT NULL DEFAULT 0,
ADD COLUMN     "estimatedPlatformFeeUsd" DECIMAL(18,8) NOT NULL DEFAULT 0,
ADD COLUMN     "estimatedTotalFeeUsd" DECIMAL(18,8) NOT NULL DEFAULT 0,
ADD COLUMN     "liquidityRole" "LiquidityRole" NOT NULL DEFAULT 'unknown';

-- AlterTable
ALTER TABLE "Position" ADD COLUMN     "grossRealizedPnlUsd" DECIMAL(18,8) NOT NULL DEFAULT 0,
ADD COLUMN     "grossUnrealizedPnlUsd" DECIMAL(18,8),
ADD COLUMN     "netRealizedPnlUsd" DECIMAL(18,8) NOT NULL DEFAULT 0,
ADD COLUMN     "netUnrealizedPnlUsd" DECIMAL(18,8),
ADD COLUMN     "totalFeesPaidUsd" DECIMAL(18,8) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Trade" ADD COLUMN     "builderFeeUsd" DECIMAL(18,8) NOT NULL DEFAULT 0,
ADD COLUMN     "grossNotionalUsd" DECIMAL(18,8) NOT NULL DEFAULT 0,
ADD COLUMN     "liquidityRole" "LiquidityRole" NOT NULL DEFAULT 'unknown',
ADD COLUMN     "netNotionalUsd" DECIMAL(18,8) NOT NULL DEFAULT 0,
ADD COLUMN     "platformFeeUsd" DECIMAL(18,8) NOT NULL DEFAULT 0,
ADD COLUMN     "totalFeeUsd" DECIMAL(18,8) NOT NULL DEFAULT 0;

-- Backfill trade fee columns from legacy fields
UPDATE "Trade"
SET
  "grossNotionalUsd" = "notionalUsd",
  "totalFeeUsd" = "feeUsd",
  "netNotionalUsd" = CASE
    WHEN "side" = 'BUY' THEN "notionalUsd" + "feeUsd"
    ELSE "notionalUsd" - "feeUsd"
  END
WHERE "grossNotionalUsd" = 0;

-- Backfill position gross/net PnL from legacy fields
UPDATE "Position"
SET
  "grossRealizedPnlUsd" = "realizedPnlUsd",
  "netRealizedPnlUsd" = "realizedPnlUsd",
  "grossUnrealizedPnlUsd" = "unrealizedPnlUsd",
  "netUnrealizedPnlUsd" = "unrealizedPnlUsd";
