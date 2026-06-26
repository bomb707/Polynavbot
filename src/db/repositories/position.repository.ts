import type { Decimal } from "@prisma/client/runtime/library";
import type {
  OrderSide,
  Position,
  PositionStatus,
  Prisma,
  PrismaClient,
} from "@prisma/client";

export interface CreatePositionInput {
  marketId: string;
  outcomeId: string;
  tokenId: string;
  side: OrderSide;
  avgEntryPrice: Decimal | number;
  currentPrice?: Decimal | number | null;
  size: Decimal | number;
  costBasisUsd: Decimal | number;
  currentValueUsd?: Decimal | number | null;
  realizedPnlUsd?: Decimal | number;
  unrealizedPnlUsd?: Decimal | number | null;
  status?: PositionStatus;
  openedAt?: Date;
}

export interface UpdatePositionInput {
  avgEntryPrice?: Decimal | number;
  currentPrice?: Decimal | number | null;
  size?: Decimal | number;
  costBasisUsd?: Decimal | number;
  currentValueUsd?: Decimal | number | null;
  unrealizedPnlUsd?: Decimal | number | null;
  realizedPnlUsd?: Decimal | number;
  status?: PositionStatus;
}

export interface ClosePositionInput {
  realizedPnlUsd: Decimal | number;
  closedAt?: Date;
}

export interface IPositionRepository {
  create(data: CreatePositionInput): Promise<Position>;
  findById(id: string): Promise<Position | null>;
  findOpen(): Promise<Position[]>;
  findOpenByTokenId(tokenId: string): Promise<Position | null>;
  findByTokenId(tokenId: string): Promise<Position[]>;
  sumRealizedPnlSince(since: Date): Promise<number>;
  update(id: string, data: UpdatePositionInput): Promise<Position>;
  close(id: string, data: ClosePositionInput): Promise<Position>;
}

export function createPositionRepository(
  prisma: PrismaClient,
): IPositionRepository {
  return {
    create(data) {
      const createData: Prisma.PositionCreateInput = {
        tokenId: data.tokenId,
        side: data.side,
        avgEntryPrice: data.avgEntryPrice,
        currentPrice: data.currentPrice,
        size: data.size,
        costBasisUsd: data.costBasisUsd,
        currentValueUsd: data.currentValueUsd,
        realizedPnlUsd: data.realizedPnlUsd,
        unrealizedPnlUsd: data.unrealizedPnlUsd,
        status: data.status,
        openedAt: data.openedAt,
        market: { connect: { id: data.marketId } },
        outcome: { connect: { id: data.outcomeId } },
      };

      return prisma.position.create({ data: createData });
    },

    findById(id) {
      return prisma.position.findUnique({ where: { id } });
    },

    findOpen() {
      return prisma.position.findMany({
        where: { status: "OPEN" },
        orderBy: { openedAt: "desc" },
      });
    },

    findOpenByTokenId(tokenId) {
      return prisma.position.findFirst({
        where: { tokenId, status: "OPEN" },
        orderBy: { openedAt: "desc" },
      });
    },

    findByTokenId(tokenId) {
      return prisma.position.findMany({
        where: { tokenId },
        orderBy: { openedAt: "desc" },
      });
    },

    async sumRealizedPnlSince(since) {
      const result = await prisma.position.aggregate({
        where: { updatedAt: { gte: since } },
        _sum: { realizedPnlUsd: true },
      });

      const total = result._sum.realizedPnlUsd;
      if (total == null) {
        return 0;
      }
      return typeof total === "number" ? total : total.toNumber();
    },

    update(id, data) {
      return prisma.position.update({
        where: { id },
        data,
      });
    },

    close(id, data) {
      return prisma.position.update({
        where: { id },
        data: {
          status: "CLOSED",
          realizedPnlUsd: data.realizedPnlUsd,
          closedAt: data.closedAt ?? new Date(),
        },
      });
    },
  };
}
