import type { OrderSide, OrderStatus, PaperOrder, Position } from "@prisma/client";

import type { Config } from "../config/index.js";
import { isPaperMode } from "../config/index.js";
import type { IRepositories } from "../db/repositories/index.js";
import type { ILogger } from "../logger/types.js";
import type { OrderBook } from "../polymarket/publicTypes.js";
import type { IRiskEngine } from "../risk/riskTypes.js";
import type {
  FillSimulationResult,
  IPaperTradingEngine,
  PortfolioSummary,
} from "./paperTypes.js";

const SIZE_EPSILON = 1e-8;

export interface PaperTradingEngineDeps {
  config: Config;
  repositories: IRepositories;
  logger: ILogger;
  riskEngine: IRiskEngine;
}

function toNumber(value: { toNumber(): number } | number): number {
  return typeof value === "number" ? value : value.toNumber();
}

function round8(value: number): number {
  return Math.round(value * 1e8) / 1e8;
}

function isNearZero(value: number): boolean {
  return Math.abs(value) < SIZE_EPSILON;
}

function topOfBookSize(orderBook: OrderBook, side: OrderSide): number {
  if (side === "BUY") {
    return orderBook.asks[0]?.size ?? 0;
  }
  return orderBook.bids[0]?.size ?? 0;
}

function shouldFillBuy(
  limitPrice: number,
  bestAsk: number | null,
  previousBestAsk: number | null | undefined,
  passiveFillOnCross: boolean,
): boolean {
  if (bestAsk == null) {
    return false;
  }
  if (bestAsk <= limitPrice) {
    return true;
  }
  if (
    passiveFillOnCross &&
    previousBestAsk != null &&
    previousBestAsk > limitPrice &&
    bestAsk <= limitPrice
  ) {
    return true;
  }
  return false;
}

function shouldFillSell(
  limitPrice: number,
  bestBid: number | null,
  previousBestBid: number | null | undefined,
  passiveFillOnCross: boolean,
): boolean {
  if (bestBid == null) {
    return false;
  }
  if (bestBid >= limitPrice) {
    return true;
  }
  if (
    passiveFillOnCross &&
    previousBestBid != null &&
    previousBestBid < limitPrice &&
    bestBid >= limitPrice
  ) {
    return true;
  }
  return false;
}

export function createPaperTradingEngine(
  deps: PaperTradingEngineDeps,
): IPaperTradingEngine {
  const { config, repositories, logger, riskEngine } = deps;
  let cashBalanceUsd = config.PAPER_STARTING_BALANCE_USD;

  async function loadCashBalance(): Promise<void> {
    const buyNotional = await repositories.trade.sumNotionalBySide("PAPER", "BUY");
    const sellNotional = await repositories.trade.sumNotionalBySide("PAPER", "SELL");
    cashBalanceUsd = round8(
      config.PAPER_STARTING_BALANCE_USD - buyNotional + sellNotional,
    );
  }

  async function getFilledSize(orderId: string): Promise<number> {
    const trades = await repositories.trade.findByOrderId(orderId);
    return round8(trades.reduce((sum, trade) => sum + toNumber(trade.size), 0));
  }

  async function applyBuyFill(
    order: PaperOrder,
    fillSize: number,
    fillPrice: number,
    notionalUsd: number,
  ): Promise<Position> {
    cashBalanceUsd = round8(cashBalanceUsd - notionalUsd);

    const existing = await repositories.position.findOpenByTokenId(order.tokenId);
    if (existing) {
      const existingSize = toNumber(existing.size);
      const existingCost = toNumber(existing.costBasisUsd);
      const newSize = round8(existingSize + fillSize);
      const newCost = round8(existingCost + notionalUsd);
      const avgEntryPrice = round8(newCost / newSize);

      return repositories.position.update(existing.id, {
        size: newSize,
        costBasisUsd: newCost,
        avgEntryPrice,
        currentPrice: fillPrice,
        currentValueUsd: round8(newSize * fillPrice),
        unrealizedPnlUsd: round8(newSize * fillPrice - newCost),
      });
    }

    return repositories.position.create({
      marketId: order.marketId,
      outcomeId: order.outcomeId,
      tokenId: order.tokenId,
      side: "BUY",
      avgEntryPrice: fillPrice,
      currentPrice: fillPrice,
      size: fillSize,
      costBasisUsd: notionalUsd,
      currentValueUsd: notionalUsd,
      unrealizedPnlUsd: 0,
      realizedPnlUsd: 0,
    });
  }

  async function applySellFill(
    order: PaperOrder,
    fillSize: number,
    fillPrice: number,
    notionalUsd: number,
  ): Promise<Position | undefined> {
    cashBalanceUsd = round8(cashBalanceUsd + notionalUsd);

    const existing = await repositories.position.findOpenByTokenId(order.tokenId);
    if (!existing) {
      logger.warn({ orderId: order.id, tokenId: order.tokenId }, "Sell fill without open position");
      return undefined;
    }

    const existingSize = toNumber(existing.size);
    const avgEntryPrice = toNumber(existing.avgEntryPrice);
    const realizedIncrement = round8((fillPrice - avgEntryPrice) * fillSize);
    const newRealized = round8(toNumber(existing.realizedPnlUsd) + realizedIncrement);
    const remainingSize = round8(existingSize - fillSize);

    if (isNearZero(remainingSize) || remainingSize < 0) {
      return repositories.position.close(existing.id, {
        realizedPnlUsd: newRealized,
      });
    }

    const remainingCost = round8(avgEntryPrice * remainingSize);
    return repositories.position.update(existing.id, {
      size: remainingSize,
      costBasisUsd: remainingCost,
      realizedPnlUsd: newRealized,
      currentPrice: fillPrice,
      currentValueUsd: round8(remainingSize * fillPrice),
      unrealizedPnlUsd: round8(remainingSize * fillPrice - remainingCost),
    });
  }

  return {
    async initialize() {
      await loadCashBalance();
    },

    getCashBalance() {
      return cashBalanceUsd;
    },

    async placeLimitOrder(input) {
      const baseOrder = {
        marketId: input.marketId,
        outcomeId: input.outcomeId,
        tokenId: input.tokenId,
        side: input.side,
        signalId: input.signalId,
      };

      if (!isPaperMode(config)) {
        const order = await repositories.order.createPaperOrder({
          ...baseOrder,
          price: input.limitPrice,
          size: 0,
          notionalUsd: 0,
          status: "FAILED",
        });
        return { order, rejectedReason: "TRADING_MODE is not paper" };
      }

      if (input.limitPrice <= 0 || input.sizeUsd <= 0) {
        return { rejectedReason: "Invalid price or size" };
      }

      const riskContext = input.riskContext ?? { isNewEntry: input.side === "BUY" };
      let effectiveSizeUsd = input.sizeUsd;

      if (!input.skipRiskCheck) {
        const riskResult = await riskEngine.checkOrder({
          marketId: input.marketId,
          outcomeId: input.outcomeId,
          tokenId: input.tokenId,
          side: input.side,
          limitPrice: input.limitPrice,
          sizeUsd: input.sizeUsd,
          isNewEntry: riskContext.isNewEntry,
          spread: riskContext.spread,
          liquidityUsd: riskContext.liquidityUsd,
          dataUpdatedAt: riskContext.dataUpdatedAt,
        });

        if (!riskResult.allowed) {
          return { rejectedReason: riskResult.reason };
        }

        effectiveSizeUsd = riskResult.adjustedSizeUsd ?? input.sizeUsd;
      }

      const size = round8(effectiveSizeUsd / input.limitPrice);
      const notionalUsd = round8(effectiveSizeUsd);

      if (input.side === "BUY" && notionalUsd > cashBalanceUsd) {
        const order = await repositories.order.createPaperOrder({
          ...baseOrder,
          price: input.limitPrice,
          size,
          notionalUsd,
          status: "FAILED",
        });
        return { order, rejectedReason: "Insufficient cash balance" };
      }

      if (input.side === "SELL") {
        const position = await repositories.position.findOpenByTokenId(input.tokenId);
        const availableSize = position ? toNumber(position.size) : 0;
        if (size > availableSize + SIZE_EPSILON) {
          const order = await repositories.order.createPaperOrder({
            ...baseOrder,
            price: input.limitPrice,
            size,
            notionalUsd,
            status: "FAILED",
          });
          return { order, rejectedReason: "Insufficient position size" };
        }
      }

      const order = await repositories.order.createPaperOrder({
        ...baseOrder,
        price: input.limitPrice,
        size,
        notionalUsd,
        status: "PENDING",
      });

      return { order };
    },

    async simulateFill(order, ctx) {
      const noFill: FillSimulationResult = {
        filled: false,
        fillSize: 0,
        fillPrice: 0,
        orderStatus: order.status,
      };

      if (order.status === "FILLED" || order.status === "CANCELLED" || order.status === "FAILED") {
        return noFill;
      }

      const limitPrice = toNumber(order.price);
      const orderSize = toNumber(order.size);
      const alreadyFilled = await getFilledSize(order.id);
      const remainingSize = round8(orderSize - alreadyFilled);

      if (remainingSize <= SIZE_EPSILON) {
        return noFill;
      }

      const { orderBook, previousBestBid, previousBestAsk } = ctx;
      const passiveFillOnCross = config.PAPER_PASSIVE_FILL_ON_CROSS;

      let canFill = false;
      let fillPrice = 0;

      if (order.side === "BUY") {
        canFill = shouldFillBuy(
          limitPrice,
          orderBook.bestAsk,
          previousBestAsk,
          passiveFillOnCross,
        );
        fillPrice = orderBook.bestAsk ?? limitPrice;
      } else {
        canFill = shouldFillSell(
          limitPrice,
          orderBook.bestBid,
          previousBestBid,
          passiveFillOnCross,
        );
        fillPrice = orderBook.bestBid ?? limitPrice;
      }

      if (!canFill) {
        return noFill;
      }

      const availableSize = topOfBookSize(orderBook, order.side);
      const fillSize = round8(Math.min(remainingSize, availableSize > 0 ? availableSize : remainingSize));
      const notionalUsd = round8(fillSize * fillPrice);

      const trade = await repositories.trade.create({
        orderId: order.id,
        orderType: "PAPER",
        marketId: order.marketId,
        outcomeId: order.outcomeId,
        tokenId: order.tokenId,
        side: order.side,
        price: fillPrice,
        size: fillSize,
        notionalUsd,
        source: "PAPER",
      });

      const newFilledTotal = round8(alreadyFilled + fillSize);
      const isFullyFilled = newFilledTotal >= orderSize - SIZE_EPSILON;
      const newStatus: OrderStatus = isFullyFilled ? "FILLED" : "PARTIALLY_FILLED";

      await repositories.order.updatePaperFill(order.id, {
        status: newStatus,
        filledAt: isFullyFilled ? new Date() : undefined,
      });

      let position: Position | undefined;
      if (order.side === "BUY") {
        position = await applyBuyFill(order, fillSize, fillPrice, notionalUsd);
      } else {
        position = await applySellFill(order, fillSize, fillPrice, notionalUsd);
      }

      if (isFullyFilled && order.signalId) {
        await repositories.signal.updateStatus(order.signalId, "EXECUTED");
      }

      logger.info(
        {
          orderId: order.id,
          side: order.side,
          fillSize,
          fillPrice,
          status: newStatus,
        },
        "Paper order fill simulated",
      );

      return {
        filled: true,
        fillSize,
        fillPrice,
        tradeId: trade.id,
        position,
        orderStatus: newStatus,
      };
    },

    async tryFillPendingOrders(booksByTokenId, previousQuotes) {
      const pending = await repositories.order.findPendingPaperOrders();
      const results: FillSimulationResult[] = [];

      for (const order of pending) {
        const book = booksByTokenId.get(order.tokenId);
        if (!book) {
          continue;
        }

        const prev = previousQuotes?.get(order.tokenId);
        const result = await this.simulateFill(order, {
          orderBook: book,
          previousBestBid: prev?.bestBid,
          previousBestAsk: prev?.bestAsk,
        });

        if (result.filled) {
          results.push(result);
        }
      }

      return results;
    },

    async markToMarket(tokenId, currentPrice) {
      const position = await repositories.position.findOpenByTokenId(tokenId);
      if (!position) {
        return null;
      }

      const size = toNumber(position.size);
      const costBasis = toNumber(position.costBasisUsd);
      const currentValueUsd = round8(size * currentPrice);
      const unrealizedPnlUsd = round8(currentValueUsd - costBasis);

      return repositories.position.update(position.id, {
        currentPrice,
        currentValueUsd,
        unrealizedPnlUsd,
      });
    },

    async markAllOpenPositions(pricesByTokenId) {
      const open = await repositories.position.findOpen();
      const updated: Position[] = [];

      for (const position of open) {
        const price = pricesByTokenId.get(position.tokenId);
        if (price == null) {
          continue;
        }
        const marked = await this.markToMarket(position.tokenId, price);
        if (marked) {
          updated.push(marked);
        }
      }

      return updated;
    },

    async getPortfolioSummary(): Promise<PortfolioSummary> {
      const openPositions = await repositories.position.findOpen();
      const totalRealizedPnlUsd = await repositories.trade.sumRealizedPnl();
      const totalUnrealizedPnlUsd = round8(
        openPositions.reduce(
          (sum, position) => sum + (position.unrealizedPnlUsd ? toNumber(position.unrealizedPnlUsd) : 0),
          0,
        ),
      );

      return {
        cashBalanceUsd,
        openPositions,
        totalRealizedPnlUsd,
        totalUnrealizedPnlUsd,
      };
    },
  };
}
