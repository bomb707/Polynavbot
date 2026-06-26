/*
  Warnings:

  - You are about to drop the `HealthCheck` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "OutcomeSide" AS ENUM ('YES', 'NO');

-- CreateEnum
CREATE TYPE "OrderSide" AS ENUM ('BUY', 'SELL');

-- CreateEnum
CREATE TYPE "SignalType" AS ENUM ('LONGSHOT_ENTRY', 'EXIT', 'REBALANCE');

-- CreateEnum
CREATE TYPE "SignalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXECUTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'OPEN', 'PARTIALLY_FILLED', 'FILLED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "PositionStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "OrderType" AS ENUM ('PAPER', 'LIVE');

-- CreateEnum
CREATE TYPE "TradeSource" AS ENUM ('PAPER', 'LIVE');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('INFO', 'WARNING', 'ERROR', 'CRITICAL');

-- CreateEnum
CREATE TYPE "RiskEventType" AS ENUM ('DAILY_LIMIT', 'POSITION_LIMIT', 'MARKET_EXPOSURE', 'THEME_EXPOSURE', 'SPREAD', 'LIQUIDITY', 'OTHER');

-- CreateEnum
CREATE TYPE "StrategyRunMode" AS ENUM ('paper', 'dry_run', 'live');

-- DropTable
DROP TABLE "HealthCheck";

-- CreateTable
CREATE TABLE "Market" (
    "id" TEXT NOT NULL,
    "polymarketMarketId" TEXT NOT NULL,
    "conditionId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "slug" TEXT,
    "category" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "closed" BOOLEAN NOT NULL DEFAULT false,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "enableOrderBook" BOOLEAN NOT NULL DEFAULT true,
    "endDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Market_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Outcome" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "side" "OutcomeSide" NOT NULL,
    "currentPrice" DECIMAL(18,8),
    "bestBid" DECIMAL(18,8),
    "bestAsk" DECIMAL(18,8),
    "spread" DECIMAL(18,8),
    "liquidity" DECIMAL(18,8),
    "volume" DECIMAL(18,8),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Outcome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketSnapshot" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "outcomeId" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "price" DECIMAL(18,8) NOT NULL,
    "bestBid" DECIMAL(18,8),
    "bestAsk" DECIMAL(18,8),
    "spread" DECIMAL(18,8),
    "liquidity" DECIMAL(18,8),
    "volume" DECIMAL(18,8),
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Signal" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "outcomeId" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "signalType" "SignalType" NOT NULL,
    "score" DECIMAL(18,8) NOT NULL,
    "reason" TEXT NOT NULL,
    "entryPrice" DECIMAL(18,8) NOT NULL,
    "suggestedSizeUsd" DECIMAL(18,8) NOT NULL,
    "status" "SignalStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Signal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaperOrder" (
    "id" TEXT NOT NULL,
    "signalId" TEXT,
    "marketId" TEXT NOT NULL,
    "outcomeId" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "side" "OrderSide" NOT NULL,
    "price" DECIMAL(18,8) NOT NULL,
    "size" DECIMAL(18,8) NOT NULL,
    "notionalUsd" DECIMAL(18,8) NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "filledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaperOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiveOrder" (
    "id" TEXT NOT NULL,
    "externalOrderId" TEXT,
    "marketId" TEXT NOT NULL,
    "outcomeId" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "side" "OrderSide" NOT NULL,
    "price" DECIMAL(18,8) NOT NULL,
    "size" DECIMAL(18,8) NOT NULL,
    "notionalUsd" DECIMAL(18,8) NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "rawResponse" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiveOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Position" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "outcomeId" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "side" "OrderSide" NOT NULL,
    "avgEntryPrice" DECIMAL(18,8) NOT NULL,
    "currentPrice" DECIMAL(18,8),
    "size" DECIMAL(18,8) NOT NULL,
    "costBasisUsd" DECIMAL(18,8) NOT NULL,
    "currentValueUsd" DECIMAL(18,8),
    "realizedPnlUsd" DECIMAL(18,8) NOT NULL DEFAULT 0,
    "unrealizedPnlUsd" DECIMAL(18,8),
    "status" "PositionStatus" NOT NULL DEFAULT 'OPEN',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Position_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trade" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderType" "OrderType" NOT NULL,
    "marketId" TEXT NOT NULL,
    "outcomeId" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "side" "OrderSide" NOT NULL,
    "price" DECIMAL(18,8) NOT NULL,
    "size" DECIMAL(18,8) NOT NULL,
    "notionalUsd" DECIMAL(18,8) NOT NULL,
    "feeUsd" DECIMAL(18,8) NOT NULL DEFAULT 0,
    "source" "TradeSource" NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Trade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskEvent" (
    "id" TEXT NOT NULL,
    "level" "RiskLevel" NOT NULL,
    "type" "RiskEventType" NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrategyRun" (
    "id" TEXT NOT NULL,
    "mode" "StrategyRunMode" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "marketsScanned" INTEGER NOT NULL DEFAULT 0,
    "signalsCreated" INTEGER NOT NULL DEFAULT 0,
    "ordersCreated" INTEGER NOT NULL DEFAULT 0,
    "errorsCount" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,

    CONSTRAINT "StrategyRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Market_polymarketMarketId_key" ON "Market"("polymarketMarketId");

-- CreateIndex
CREATE INDEX "Market_polymarketMarketId_idx" ON "Market"("polymarketMarketId");

-- CreateIndex
CREATE INDEX "Market_active_idx" ON "Market"("active");

-- CreateIndex
CREATE INDEX "Market_endDate_idx" ON "Market"("endDate");

-- CreateIndex
CREATE INDEX "Market_createdAt_idx" ON "Market"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Outcome_tokenId_key" ON "Outcome"("tokenId");

-- CreateIndex
CREATE INDEX "Outcome_marketId_idx" ON "Outcome"("marketId");

-- CreateIndex
CREATE INDEX "Outcome_tokenId_idx" ON "Outcome"("tokenId");

-- CreateIndex
CREATE INDEX "Outcome_updatedAt_idx" ON "Outcome"("updatedAt");

-- CreateIndex
CREATE INDEX "MarketSnapshot_marketId_idx" ON "MarketSnapshot"("marketId");

-- CreateIndex
CREATE INDEX "MarketSnapshot_outcomeId_idx" ON "MarketSnapshot"("outcomeId");

-- CreateIndex
CREATE INDEX "MarketSnapshot_tokenId_idx" ON "MarketSnapshot"("tokenId");

-- CreateIndex
CREATE INDEX "MarketSnapshot_timestamp_idx" ON "MarketSnapshot"("timestamp");

-- CreateIndex
CREATE INDEX "Signal_marketId_idx" ON "Signal"("marketId");

-- CreateIndex
CREATE INDEX "Signal_outcomeId_idx" ON "Signal"("outcomeId");

-- CreateIndex
CREATE INDEX "Signal_tokenId_idx" ON "Signal"("tokenId");

-- CreateIndex
CREATE INDEX "Signal_status_idx" ON "Signal"("status");

-- CreateIndex
CREATE INDEX "Signal_createdAt_idx" ON "Signal"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaperOrder_signalId_key" ON "PaperOrder"("signalId");

-- CreateIndex
CREATE INDEX "PaperOrder_signalId_idx" ON "PaperOrder"("signalId");

-- CreateIndex
CREATE INDEX "PaperOrder_marketId_idx" ON "PaperOrder"("marketId");

-- CreateIndex
CREATE INDEX "PaperOrder_outcomeId_idx" ON "PaperOrder"("outcomeId");

-- CreateIndex
CREATE INDEX "PaperOrder_tokenId_idx" ON "PaperOrder"("tokenId");

-- CreateIndex
CREATE INDEX "PaperOrder_status_idx" ON "PaperOrder"("status");

-- CreateIndex
CREATE INDEX "PaperOrder_createdAt_idx" ON "PaperOrder"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LiveOrder_externalOrderId_key" ON "LiveOrder"("externalOrderId");

-- CreateIndex
CREATE INDEX "LiveOrder_externalOrderId_idx" ON "LiveOrder"("externalOrderId");

-- CreateIndex
CREATE INDEX "LiveOrder_marketId_idx" ON "LiveOrder"("marketId");

-- CreateIndex
CREATE INDEX "LiveOrder_outcomeId_idx" ON "LiveOrder"("outcomeId");

-- CreateIndex
CREATE INDEX "LiveOrder_tokenId_idx" ON "LiveOrder"("tokenId");

-- CreateIndex
CREATE INDEX "LiveOrder_status_idx" ON "LiveOrder"("status");

-- CreateIndex
CREATE INDEX "LiveOrder_createdAt_idx" ON "LiveOrder"("createdAt");

-- CreateIndex
CREATE INDEX "Position_marketId_idx" ON "Position"("marketId");

-- CreateIndex
CREATE INDEX "Position_outcomeId_idx" ON "Position"("outcomeId");

-- CreateIndex
CREATE INDEX "Position_tokenId_idx" ON "Position"("tokenId");

-- CreateIndex
CREATE INDEX "Position_status_idx" ON "Position"("status");

-- CreateIndex
CREATE INDEX "Position_openedAt_idx" ON "Position"("openedAt");

-- CreateIndex
CREATE INDEX "Position_updatedAt_idx" ON "Position"("updatedAt");

-- CreateIndex
CREATE INDEX "Trade_orderId_idx" ON "Trade"("orderId");

-- CreateIndex
CREATE INDEX "Trade_marketId_idx" ON "Trade"("marketId");

-- CreateIndex
CREATE INDEX "Trade_outcomeId_idx" ON "Trade"("outcomeId");

-- CreateIndex
CREATE INDEX "Trade_tokenId_idx" ON "Trade"("tokenId");

-- CreateIndex
CREATE INDEX "Trade_timestamp_idx" ON "Trade"("timestamp");

-- CreateIndex
CREATE INDEX "RiskEvent_level_idx" ON "RiskEvent"("level");

-- CreateIndex
CREATE INDEX "RiskEvent_type_idx" ON "RiskEvent"("type");

-- CreateIndex
CREATE INDEX "RiskEvent_createdAt_idx" ON "RiskEvent"("createdAt");

-- CreateIndex
CREATE INDEX "StrategyRun_mode_idx" ON "StrategyRun"("mode");

-- CreateIndex
CREATE INDEX "StrategyRun_startedAt_idx" ON "StrategyRun"("startedAt");

-- AddForeignKey
ALTER TABLE "Outcome" ADD CONSTRAINT "Outcome_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketSnapshot" ADD CONSTRAINT "MarketSnapshot_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketSnapshot" ADD CONSTRAINT "MarketSnapshot_outcomeId_fkey" FOREIGN KEY ("outcomeId") REFERENCES "Outcome"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Signal" ADD CONSTRAINT "Signal_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Signal" ADD CONSTRAINT "Signal_outcomeId_fkey" FOREIGN KEY ("outcomeId") REFERENCES "Outcome"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperOrder" ADD CONSTRAINT "PaperOrder_signalId_fkey" FOREIGN KEY ("signalId") REFERENCES "Signal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperOrder" ADD CONSTRAINT "PaperOrder_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperOrder" ADD CONSTRAINT "PaperOrder_outcomeId_fkey" FOREIGN KEY ("outcomeId") REFERENCES "Outcome"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveOrder" ADD CONSTRAINT "LiveOrder_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveOrder" ADD CONSTRAINT "LiveOrder_outcomeId_fkey" FOREIGN KEY ("outcomeId") REFERENCES "Outcome"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_outcomeId_fkey" FOREIGN KEY ("outcomeId") REFERENCES "Outcome"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_outcomeId_fkey" FOREIGN KEY ("outcomeId") REFERENCES "Outcome"("id") ON DELETE CASCADE ON UPDATE CASCADE;
