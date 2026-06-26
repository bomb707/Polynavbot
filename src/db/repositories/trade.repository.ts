import type { Decimal } from "@prisma/client/runtime/library";
import type {
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
  source: TradeSource;
  timestamp?: Date;
}

export interface ITradeRepository {
  create(data: CreateTradeInput): Promise<Trade>;
  findByOrderId(orderId: string): Promise<Trade[]>;
  findByTokenId(tokenId: string): Promise<Trade[]>;
  sumNotionalBySide(source: TradeSource, side: OrderSide): Promise<number>;
  sumNotionalSince(
    source: TradeSource,
    side: OrderSide,
    since: Date,
  ): Promise<number>;
  sumRealizedPnl(): Promise<number>;
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
      const createData: Prisma.TradeCreateInput = {
        orderId: data.orderId,
        orderType: data.orderType,
        tokenId: data.tokenId,
        side: data.side,
        price: data.price,
        size: data.size,
        notionalUsd: data.notionalUsd,
        feeUsd: data.feeUsd,
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
        _sum: { realizedPnlUsd: true },
      });

      return toNumber(result._sum.realizedPnlUsd);
    },

    findAllOrdered() {
      return prisma.trade.findMany({
        orderBy: { timestamp: "desc" },
      });
    },
  };
}
