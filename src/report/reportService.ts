import type { Position, Signal, Trade } from "@prisma/client";

import type { Config } from "../config/index.js";
import { isLiveMode, isPaperMode } from "../config/index.js";
import type { IRepositories } from "../db/repositories/index.js";
import { toNumber } from "../execution/entryHelpers.js";
import type { IExitEngine } from "../execution/exitTypes.js";
import type { IFeeService } from "../fees/feeTypes.js";
import type { IPaperTradingEngine } from "../paper/paperTypes.js";
import type {
  IReportService,
  PendingExitRow,
  PortfolioSummary,
  PositionRow,
  ReportSnapshot,
  RiskRejectionRow,
  SignalRow,
  TradeRow,
} from "./reportTypes.js";

export interface ReportServiceDeps {
  config: Config;
  repositories: IRepositories;
  paperTradingEngine: IPaperTradingEngine;
  exitEngine: IExitEngine;
  feeService: IFeeService;
}

function round8(value: number): number {
  return Math.round(value * 1e8) / 1e8;
}

function toPositionRow(position: Position, question: string): PositionRow {
  return {
    tokenId: position.tokenId,
    question,
    unrealizedPnlUsd: toNumber(position.unrealizedPnlUsd) ?? 0,
    currentPrice:
      toNumber(position.currentPrice) ?? toNumber(position.avgEntryPrice) ?? 0,
    costBasisUsd: toNumber(position.costBasisUsd) ?? 0,
  };
}

function toSignalRow(signal: Signal): SignalRow {
  return {
    id: signal.id,
    tokenId: signal.tokenId,
    signalType: signal.signalType,
    status: signal.status,
    score: toNumber(signal.score) ?? 0,
    reason: signal.reason,
    entryPrice: toNumber(signal.entryPrice) ?? 0,
    suggestedSizeUsd: toNumber(signal.suggestedSizeUsd) ?? 0,
    createdAt: signal.createdAt.toISOString(),
  };
}

function toTradeRow(trade: Trade, question: string): TradeRow {
  const grossNotional = toNumber(trade.grossNotionalUsd) ?? toNumber(trade.notionalUsd) ?? 0;
  const platformFee = toNumber(trade.platformFeeUsd) ?? 0;
  const builderFee = toNumber(trade.builderFeeUsd) ?? 0;
  const totalFee = toNumber(trade.totalFeeUsd) ?? toNumber(trade.feeUsd) ?? 0;
  const netNotional = toNumber(trade.netNotionalUsd) ?? grossNotional - totalFee;

  return {
    timestamp: trade.timestamp.toISOString(),
    tokenId: trade.tokenId,
    side: trade.side,
    price: toNumber(trade.price) ?? 0,
    size: toNumber(trade.size) ?? 0,
    notionalUsd: grossNotional,
    feeUsd: totalFee,
    platformFeeUsd: platformFee,
    builderFeeUsd: builderFee,
    totalFeeUsd: totalFee,
    netNotionalUsd: netNotional,
    liquidityRole: trade.liquidityRole,
    source: trade.source,
    question,
  };
}

export function createReportService(deps: ReportServiceDeps): IReportService {
  const { config, repositories, paperTradingEngine, exitEngine, feeService } = deps;

  async function loadMarketQuestions(marketIds: string[]): Promise<Map<string, string>> {
    const uniqueIds = [...new Set(marketIds)];
    const questions = new Map<string, string>();

    for (const marketId of uniqueIds) {
      const market = await repositories.market.findById(marketId);
      if (market) {
        questions.set(marketId, market.question);
      }
    }

    return questions;
  }

  async function estimateFutureExitFees(openPositions: Position[]): Promise<number> {
    let total = 0;
    for (const position of openPositions) {
      const market = await repositories.market.findById(position.marketId);
      const feeParams = market ? feeService.getMarketFeeParams(market) : undefined;
      const price = toNumber(position.currentPrice) ?? toNumber(position.avgEntryPrice) ?? 0;
      const size = toNumber(position.size) ?? 0;
      if (price <= 0 || size <= 0) {
        continue;
      }
      const breakdown = feeService.calculateTotalFee({
        side: "SELL",
        price,
        shares: size,
        liquidityRole: "taker",
        feeParams: feeParams ?? {
          feesEnabled: false,
          feeRate: 0,
          takerOnly: true,
          makerBaseFeeBps: 0,
          takerBaseFeeBps: 0,
        },
      });
      total += breakdown.totalFeeUsd;
    }
    return round8(total);
  }

  async function buildPortfolioSummary(
    openPositions: Position[],
  ): Promise<PortfolioSummary> {
    const openExposureUsd = round8(
      openPositions.reduce(
        (sum, position) => sum + (toNumber(position.costBasisUsd) ?? 0),
        0,
      ),
    );

    let cashBalanceUsd: number | null = null;
    let portfolioValueUsd: number | null = null;
    let realizedPnlUsd: number;
    let unrealizedPnlUsd: number;

    if (isPaperMode(config)) {
      await paperTradingEngine.initialize();
      const portfolio = await paperTradingEngine.getPortfolioSummary();

      cashBalanceUsd = portfolio.cashBalanceUsd;
      realizedPnlUsd = portfolio.totalRealizedPnlUsd;
      unrealizedPnlUsd = portfolio.totalUnrealizedPnlUsd;

      const positionsValueUsd = openPositions.reduce((sum, position) => {
        const value =
          toNumber(position.currentValueUsd) ?? toNumber(position.costBasisUsd) ?? 0;
        return sum + value;
      }, 0);

      portfolioValueUsd = round8(portfolio.cashBalanceUsd + positionsValueUsd);
    } else {
      realizedPnlUsd = round8(await repositories.trade.sumRealizedPnl());
      unrealizedPnlUsd = round8(
        openPositions.reduce(
          (sum, position) => sum + (toNumber(position.unrealizedPnlUsd) ?? 0),
          0,
        ),
      );
    }

    const totalPnlUsd = round8(realizedPnlUsd + unrealizedPnlUsd);

    const grossRealizedPnlUsd = round8(await repositories.position.sumGrossRealizedPnl());

    const netRealizedPnlUsd = round8(realizedPnlUsd);

    const grossUnrealizedPnlUsd = round8(
      openPositions.reduce(
        (sum, position) =>
          sum +
          (toNumber(position.grossUnrealizedPnlUsd) ??
            toNumber(position.unrealizedPnlUsd) ??
            0),
        0,
      ),
    );

    const estimatedNetUnrealizedPnlUsd = round8(
      openPositions.reduce(
        (sum, position) =>
          sum +
          (toNumber(position.netUnrealizedPnlUsd) ??
            toNumber(position.unrealizedPnlUsd) ??
            0),
        0,
      ),
    );

    const tradeSource = isPaperMode(config) ? "PAPER" : "LIVE";
    const totalFeesPaidUsd = round8(await repositories.trade.sumTotalFeesPaid(tradeSource));
    const roleCounts = await repositories.trade.countByLiquidityRole(tradeSource);
    const estimatedFutureExitFeesUsd = await estimateFutureExitFees(openPositions);

    const grossTotalPnl = grossRealizedPnlUsd + grossUnrealizedPnlUsd;
    const feesAsPercentOfGrossPnl =
      grossTotalPnl > 0 ? round8(totalFeesPaidUsd / grossTotalPnl) : null;

    let openOrdersCount = 0;
    if (isLiveMode(config)) {
      openOrdersCount = await repositories.order.countOpenLiveOrders();
    } else if (isPaperMode(config)) {
      openOrdersCount = await repositories.order.countOpenPaperOrders();
    }

    return {
      generatedAt: new Date().toISOString(),
      mode: config.TRADING_MODE,
      cashBalanceUsd,
      openExposureUsd,
      portfolioValueUsd,
      realizedPnlUsd,
      unrealizedPnlUsd,
      totalPnlUsd,
      grossRealizedPnlUsd,
      netRealizedPnlUsd,
      grossUnrealizedPnlUsd,
      estimatedNetUnrealizedPnlUsd,
      totalFeesPaidUsd,
      estimatedFutureExitFeesUsd,
      feesAsPercentOfGrossPnl,
      makerTradeCount: roleCounts.maker,
      takerTradeCount: roleCounts.taker,
      unknownRoleTradeCount: roleCounts.unknown,
      openPositionsCount: openPositions.length,
      openOrdersCount,
    };
  }

  return {
    async buildSnapshot(): Promise<ReportSnapshot> {
      const openPositions = await repositories.position.findOpen();
      const marketQuestions = await loadMarketQuestions(
        openPositions.map((position) => position.marketId),
      );

      const positionRows = openPositions.map((position) =>
        toPositionRow(position, marketQuestions.get(position.marketId) ?? position.tokenId),
      );

      const topWinners = [...positionRows]
        .sort((a, b) => b.unrealizedPnlUsd - a.unrealizedPnlUsd)
        .slice(0, 10);

      const topLosers = [...positionRows]
        .sort((a, b) => a.unrealizedPnlUsd - b.unrealizedPnlUsd)
        .slice(0, 10);

      const [recentSignals, riskEvents, pendingExits, trades] = await Promise.all([
        repositories.signal.findRecent(20),
        repositories.riskEvent.findRecent(20),
        exitEngine.previewExits(),
        repositories.trade.findAllOrdered(),
      ]);

      const tradeMarketQuestions = await loadMarketQuestions(
        trades.map((trade) => trade.marketId),
      );

      const riskRejections: RiskRejectionRow[] = riskEvents.map((event) => ({
        id: event.id,
        level: event.level,
        type: event.type,
        message: event.message,
        createdAt: event.createdAt.toISOString(),
      }));

      const pendingExitRows: PendingExitRow[] = pendingExits.map((exit) => ({
        tokenId: exit.tokenId,
        question: exit.question,
        action: exit.action,
        reason: exit.reason,
        sellSizeShares: exit.sellSizeShares,
        sellPrice: exit.sellPrice,
      }));

      const portfolio = await buildPortfolioSummary(openPositions);

      return {
        portfolio,
        topWinners,
        topLosers,
        recentSignals: recentSignals.map(toSignalRow),
        riskRejections,
        pendingExits: pendingExitRows,
        trades: trades.map((trade) =>
          toTradeRow(trade, tradeMarketQuestions.get(trade.marketId) ?? trade.tokenId),
        ),
      };
    },
  };
}
