import type { OrderSide } from "@prisma/client";

import type { PositionExitState } from "../db/repositories/position.repository.js";
import type {
  BacktestOrder,
  BacktestPosition,
  BacktestTrade,
  EquityPoint,
} from "./backtestTypes.js";
import { conservativeBidPrice } from "./syntheticOrderBook.js";
import type { BacktestConfig, PriceBar } from "./backtestTypes.js";

function round8(value: number): number {
  return Math.round(value * 1e8) / 1e8;
}

let orderCounter = 0;
let tradeCounter = 0;

export function nextOrderId(): string {
  orderCounter += 1;
  return `bt-order-${orderCounter}`;
}

export function nextTradeId(): string {
  tradeCounter += 1;
  return `bt-trade-${tradeCounter}`;
}

export function resetBacktestCounters(): void {
  orderCounter = 0;
  tradeCounter = 0;
}

export class BacktestPortfolio {
  readonly trades: BacktestTrade[] = [];
  readonly equityCurve: EquityPoint[] = [];
  readonly marketCategories = new Map<string, string | null>();

  constructor(
    readonly startingCapitalUsd: number,
    public cashUsd: number,
    readonly positions = new Map<string, BacktestPosition>(),
    public pendingOrders: BacktestOrder[] = [],
    public todayBuyNotional = 0,
    private lastDayKey = "",
  ) {}

  hasOpenPosition(tokenId: string): boolean {
    return this.positions.has(tokenId);
  }

  hasPendingBuy(tokenId: string): boolean {
    return this.pendingOrders.some(
      (order) =>
        order.tokenId === tokenId &&
        order.side === "BUY" &&
        order.filledShares < order.sizeShares,
    );
  }

  placeOrder(order: BacktestOrder): void {
    this.pendingOrders.push(order);
  }

  prunePendingOrders(): void {
    this.pendingOrders = pruneFilledOrders(this.pendingOrders);
  }

  recordEquity(timestamp: Date, barsByToken: Map<string, PriceBar>, config: BacktestConfig): void {
    let deployed = 0;
    for (const position of this.positions.values()) {
      const bar = barsByToken.get(position.tokenId);
      const mark = bar ? conservativeBidPrice(bar, config) : position.avgEntryPrice;
      deployed += mark * position.sizeShares;
    }
    this.equityCurve.push({
      timestamp,
      equityUsd: round8(this.cashUsd + deployed),
      cashUsd: round8(this.cashUsd),
      deployedUsd: round8(deployed),
    });
  }

  resetDailySpend(timestamp: Date): void {
    const dayKey = timestamp.toISOString().slice(0, 10);
    if (dayKey !== this.lastDayKey) {
      this.todayBuyNotional = 0;
      this.lastDayKey = dayKey;
    }
  }

  applyBuyFill(
    order: BacktestOrder,
    fillPrice: number,
    fillSize: number,
    timestamp: Date,
    question: string,
    reason: string,
  ): BacktestTrade {
    const notional = round8(fillPrice * fillSize);
    this.cashUsd = round8(this.cashUsd - notional);
    this.todayBuyNotional = round8(this.todayBuyNotional + notional);
    order.filledShares = round8(order.filledShares + fillSize);

    const existing = this.positions.get(order.tokenId);
    if (existing) {
      const newSize = round8(existing.sizeShares + fillSize);
      const newCost = round8(existing.costBasisUsd + notional);
      existing.sizeShares = newSize;
      existing.costBasisUsd = newCost;
      existing.avgEntryPrice = round8(newCost / newSize);
      existing.exitState.originalSize = newSize;
    } else {
      this.positions.set(order.tokenId, {
        tokenId: order.tokenId,
        marketId: order.marketId,
        outcomeId: order.outcomeId,
        sizeShares: fillSize,
        avgEntryPrice: fillPrice,
        costBasisUsd: notional,
        exitState: {
          originalSize: fillSize,
          soldAt5x: false,
          soldAt10x: false,
          soldAt25x: false,
          hasReached5x: false,
          recentHighPrice: fillPrice,
        },
        openedAt: timestamp,
      });
    }

    return {
      id: nextTradeId(),
      timestamp,
      tokenId: order.tokenId,
      marketId: order.marketId,
      outcomeId: order.outcomeId,
      question,
      side: "BUY",
      price: fillPrice,
      sizeShares: fillSize,
      notionalUsd: notional,
      realizedPnlUsd: 0,
      reason,
    };
  }

  applySellFill(
    order: BacktestOrder,
    fillPrice: number,
    fillSize: number,
    timestamp: Date,
    question: string,
    reason: string,
  ): BacktestTrade {
    const position = this.positions.get(order.tokenId);
    if (!position) {
      throw new Error(`No position for sell fill ${order.tokenId}`);
    }

    const notional = round8(fillPrice * fillSize);
    const realizedPnl = round8((fillPrice - position.avgEntryPrice) * fillSize);
    this.cashUsd = round8(this.cashUsd + notional);
    order.filledShares = round8(order.filledShares + fillSize);

    const remaining = round8(position.sizeShares - fillSize);
    if (remaining <= 1e-8) {
      this.positions.delete(order.tokenId);
    } else {
      const remainingCost = round8(position.costBasisUsd * (remaining / position.sizeShares));
      position.sizeShares = remaining;
      position.costBasisUsd = remainingCost;
      position.avgEntryPrice = round8(remainingCost / remaining);
    }

    return {
      id: nextTradeId(),
      timestamp,
      tokenId: order.tokenId,
      marketId: order.marketId,
      outcomeId: order.outcomeId,
      question,
      side: "SELL",
      price: fillPrice,
      sizeShares: fillSize,
      notionalUsd: notional,
      realizedPnlUsd: realizedPnl,
      reason,
    };
  }

  closeRemainingAtBid(
    tokenId: string,
    bar: PriceBar,
    timestamp: Date,
    question: string,
    config: BacktestConfig,
    reason: string,
  ): BacktestTrade | null {
    const position = this.positions.get(tokenId);
    if (!position) {
      return null;
    }
    const fillPrice = conservativeBidPrice(bar, config);
    const order: BacktestOrder = {
      id: nextOrderId(),
      tokenId,
      marketId: position.marketId,
      outcomeId: position.outcomeId,
      side: "SELL",
      limitPrice: fillPrice,
      sizeShares: position.sizeShares,
      filledShares: 0,
      createdAt: timestamp,
      reason,
    };
    const trade = this.applySellFill(
      order,
      fillPrice,
      position.sizeShares,
      timestamp,
      question,
      reason,
    );
    this.trades.push(trade);
    return trade;
  }

  getState(): {
    cashUsd: number;
    positions: Map<string, BacktestPosition>;
    pendingOrders: BacktestOrder[];
    todayBuyNotional: number;
  } {
    return {
      cashUsd: this.cashUsd,
      positions: this.positions,
      pendingOrders: this.pendingOrders,
      todayBuyNotional: this.todayBuyNotional,
    };
  }
}

export function pruneFilledOrders(orders: BacktestOrder[]): BacktestOrder[] {
  return orders.filter((order) => order.filledShares < order.sizeShares - 1e-8);
}

export function updateExitState(
  state: PositionExitState,
  currentPrice: number,
  avgEntry: number,
): PositionExitState {
  return {
    ...state,
    hasReached5x: state.hasReached5x || currentPrice >= avgEntry * 5,
    recentHighPrice: Math.max(state.recentHighPrice, currentPrice),
  };
}

export type { OrderSide };
