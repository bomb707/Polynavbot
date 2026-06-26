import type { Decimal } from "@prisma/client/runtime/library";
import type {
  LiveOrder,
  OrderSide,
  OrderStatus,
  PaperOrder,
  Prisma,
  PrismaClient,
} from "@prisma/client";

export interface CreatePaperOrderInput {
  signalId?: string | null;
  marketId: string;
  outcomeId: string;
  tokenId: string;
  side: OrderSide;
  price: Decimal | number;
  size: Decimal | number;
  notionalUsd: Decimal | number;
  status?: OrderStatus;
}

export interface CreateLiveOrderInput {
  externalOrderId?: string | null;
  marketId: string;
  outcomeId: string;
  tokenId: string;
  side: OrderSide;
  price: Decimal | number;
  size: Decimal | number;
  notionalUsd: Decimal | number;
  status?: OrderStatus;
  rawResponse?: Prisma.InputJsonValue;
}

export interface IOrderRepository {
  createPaperOrder(data: CreatePaperOrderInput): Promise<PaperOrder>;
  createLiveOrder(data: CreateLiveOrderInput): Promise<LiveOrder>;
  findPaperById(id: string): Promise<PaperOrder | null>;
  findLiveById(id: string): Promise<LiveOrder | null>;
  findLiveByExternalId(externalOrderId: string): Promise<LiveOrder | null>;
  findPendingPaperOrders(): Promise<PaperOrder[]>;
  findPendingBuyByTokenId(tokenId: string): Promise<PaperOrder | null>;
  countPendingPaperOrders(): Promise<number>;
  updatePaperStatus(
    id: string,
    status: OrderStatus,
    filledAt?: Date,
  ): Promise<PaperOrder>;
  updatePaperFill(
    id: string,
    data: { status: OrderStatus; filledAt?: Date },
  ): Promise<PaperOrder>;
  updateLiveStatus(id: string, status: OrderStatus): Promise<LiveOrder>;
}

export function createOrderRepository(prisma: PrismaClient): IOrderRepository {
  return {
    createPaperOrder(data) {
      const createData: Prisma.PaperOrderCreateInput = {
        tokenId: data.tokenId,
        side: data.side,
        price: data.price,
        size: data.size,
        notionalUsd: data.notionalUsd,
        status: data.status,
        market: { connect: { id: data.marketId } },
        outcome: { connect: { id: data.outcomeId } },
        ...(data.signalId
          ? { signal: { connect: { id: data.signalId } } }
          : {}),
      };

      return prisma.paperOrder.create({ data: createData });
    },

    createLiveOrder(data) {
      const createData: Prisma.LiveOrderCreateInput = {
        externalOrderId: data.externalOrderId,
        tokenId: data.tokenId,
        side: data.side,
        price: data.price,
        size: data.size,
        notionalUsd: data.notionalUsd,
        status: data.status,
        rawResponse: data.rawResponse,
        market: { connect: { id: data.marketId } },
        outcome: { connect: { id: data.outcomeId } },
      };

      return prisma.liveOrder.create({ data: createData });
    },

    findPaperById(id) {
      return prisma.paperOrder.findUnique({ where: { id } });
    },

    findLiveById(id) {
      return prisma.liveOrder.findUnique({ where: { id } });
    },

    findLiveByExternalId(externalOrderId) {
      return prisma.liveOrder.findUnique({ where: { externalOrderId } });
    },

    findPendingPaperOrders() {
      return prisma.paperOrder.findMany({
        where: {
          status: { in: ["PENDING", "PARTIALLY_FILLED"] },
        },
        orderBy: { createdAt: "asc" },
      });
    },

    findPendingBuyByTokenId(tokenId) {
      return prisma.paperOrder.findFirst({
        where: {
          tokenId,
          side: "BUY",
          status: { in: ["PENDING", "PARTIALLY_FILLED"] },
        },
        orderBy: { createdAt: "desc" },
      });
    },

    countPendingPaperOrders() {
      return prisma.paperOrder.count({
        where: {
          status: { in: ["PENDING", "PARTIALLY_FILLED"] },
        },
      });
    },

    updatePaperStatus(id, status, filledAt) {
      return prisma.paperOrder.update({
        where: { id },
        data: { status, filledAt },
      });
    },

    updatePaperFill(id, data) {
      return prisma.paperOrder.update({
        where: { id },
        data: { status: data.status, filledAt: data.filledAt },
      });
    },

    updateLiveStatus(id, status) {
      return prisma.liveOrder.update({
        where: { id },
        data: { status },
      });
    },
  };
}
