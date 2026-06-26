import type { Decimal } from "@prisma/client/runtime/library";
import type {
  LiquidityRole,
  OrderSide,
  OrderType,
  Prisma,
  PrismaClient,
  Trade,
  TradeSource,
} from "@prisma/client";

export interface CreateTradeInput {
  orderId: string;
  orderType: OrderType;
  marketId: string;
  outcomeId: string;
  tokenId: string;
  side: OrderSide;
  price: Decimal | number;
  size: Decimal | number;
  notionalUsd: Decimal | number;
  feeUsd?: Decimal | number;
  grossNotionalUsd?: Decimal | number;
  platformFeeUsd?: Decimal | number;
  builderFeeUsd?: Decimal | number;
  totalFeeUsd?: Decimal | number;
  netNotionalUsd?: Decimal | number;
  liquidityRole?: LiquidityRole;
  source: TradeSource;
  timestamp?: Date;
}

export interface ITradeRepository {
  create(data: CreateTradeInput): Promise<Trade>;
  findByOrderId(orderId: string): Promise<Trade[]>;
  findByTokenId(tokenId: string): Promise<Trade[]>;
  sumNotionalBySide(source: TradeSource, side: OrderSide): Promise<number>;
  sumNetCashFlow(source: TradeSource): Promise<number>;
  sumNotionalSince(
    source: TradeSource,
    side: OrderSide,
    since: Date,
  ): Promise<number>;
  sumRealizedPnl(): Promise<number>;
  sumTotalFeesPaid(source: TradeSource): Promise<number>;
  countByLiquidityRole(source: TradeSource): Promise<{
    maker: number;
    taker: number;
    unknown: number;
  }>;
  findAllOrdered(): Promise<Trade[]>;
}

function toNumber(value: Decimal | number | null | undefined): number {
  if (value == null) {
    return 0;
  }
  return typeof value === "number" ? value : value.toNumber();
}

export function createTradeRepository(prisma: PrismaClient): ITradeRepository {
  return {
    create(data) {
      const grossNotionalUsd = data.grossNotionalUsd ?? data.notionalUsd;
      const totalFeeUsd = data.totalFeeUsd ?? data.feeUsd ?? 0;
      const netNotionalUsd =
        data.netNotionalUsd ??
        (data.side === "BUY"
          ? toNumber(grossNotionalUsd) + toNumber(totalFeeUsd)
          : toNumber(grossNotionalUsd) - toNumber(totalFeeUsd));

      const createData: Prisma.TradeCreateInput = {
        orderId: data.orderId,
        orderType: data.orderType,
        tokenId: data.tokenId,
        side: data.side,
        price: data.price,
        size: data.size,
        notionalUsd: data.notionalUsd,
        feeUsd: data.feeUsd ?? totalFeeUsd,
        grossNotionalUsd,
        platformFeeUsd: data.platformFeeUsd ?? 0,
        builderFeeUsd: data.builderFeeUsd ?? 0,
        totalFeeUsd,
        netNotionalUsd,
        liquidityRole: data.liquidityRole,
        source: data.source,
        timestamp: data.timestamp,
        market: { connect: { id: data.marketId } },
        outcome: { connect: { id: data.outcomeId } },
      };

      return prisma.trade.create({ data: createData });
    },

    findByOrderId(orderId) {
      return prisma.trade.findMany({
        where: { orderId },
        orderBy: { timestamp: "asc" },
      });
    },

    findByTokenId(tokenId) {
      return prisma.trade.findMany({
        where: { tokenId },
        orderBy: { timestamp: "asc" },
      });
    },

    async sumNotionalBySide(source, side) {
      const result = await prisma.trade.aggregate({
        where: { source, side },
        _sum: { notionalUsd: true },
      });

      return toNumber(result._sum.notionalUsd);
    },

    async sumNetCashFlow(source) {
      const trades = await prisma.trade.findMany({
        where: { source },
        select: {
          side: true,
          netNotionalUsd: true,
          notionalUsd: true,
          totalFeeUsd: true,
          feeUsd: true,
        },
      });

      let outflow = 0;
      for (const trade of trades) {
        const gross = toNumber(trade.notionalUsd);
        const fee = toNumber(trade.totalFeeUsd) || toNumber(trade.feeUsd);
        const net = toNumber(trade.netNotionalUsd);

        if (trade.side === "BUY") {
          outflow += net > 0 ? net : gross + fee;
        } else {
          outflow -= net > 0 ? net : gross - fee;
        }
      }
      return Math.round(outflow * 1e8) / 1e8;
    },

    async sumNotionalSince(source, side, since) {
      const result = await prisma.trade.aggregate({
        where: {
          source,
          side,
          timestamp: { gte: since },
        },
        _sum: { notionalUsd: true },
      });

      return toNumber(result._sum.notionalUsd);
    },

    async sumRealizedPnl() {
      const result = await prisma.position.aggregate({
        _sum: { netRealizedPnlUsd: true, realizedPnlUsd: true },
      });

      const net = toNumber(result._sum.netRealizedPnlUsd);
      if (net !== 0) {
        return net;
      }
      return toNumber(result._sum.realizedPnlUsd);
    },

    async sumTotalFeesPaid(source) {
      const result = await prisma.trade.aggregate({
        where: { source },
        _sum: { totalFeeUsd: true, feeUsd: true },
      });
      const total = toNumber(result._sum.totalFeeUsd);
      return total > 0 ? total : toNumber(result._sum.feeUsd);
    },

    async countByLiquidityRole(source) {
      const [maker, taker, unknown] = await Promise.all([
        prisma.trade.count({ where: { source, liquidityRole: "maker" } }),
        prisma.trade.count({ where: { source, liquidityRole: "taker" } }),
        prisma.trade.count({ where: { source, liquidityRole: "unknown" } }),
      ]);
      return { maker, taker, unknown };
    },

    findAllOrdered() {
      return prisma.trade.findMany({
        orderBy: { timestamp: "desc" },
      });
    },
  };
}
