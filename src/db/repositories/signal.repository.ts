import type { Decimal } from "@prisma/client/runtime/library";
import type { Prisma, PrismaClient, Signal, SignalStatus, SignalType } from "@prisma/client";

export interface CreateSignalInput {
  marketId: string;
  outcomeId: string;
  tokenId: string;
  signalType: SignalType;
  score: Decimal | number;
  reason: string;
  entryPrice: Decimal | number;
  suggestedSizeUsd: Decimal | number;
  status?: SignalStatus;
}

export interface ISignalRepository {
  create(data: CreateSignalInput): Promise<Signal>;
  findById(id: string): Promise<Signal | null>;
  findByStatus(status: SignalStatus): Promise<Signal[]>;
  findByTokenId(tokenId: string): Promise<Signal[]>;
  updateStatus(id: string, status: SignalStatus): Promise<Signal>;
}

export function createSignalRepository(prisma: PrismaClient): ISignalRepository {
  return {
    create(data) {
      const createData: Prisma.SignalCreateInput = {
        tokenId: data.tokenId,
        signalType: data.signalType,
        score: data.score,
        reason: data.reason,
        entryPrice: data.entryPrice,
        suggestedSizeUsd: data.suggestedSizeUsd,
        status: data.status,
        market: { connect: { id: data.marketId } },
        outcome: { connect: { id: data.outcomeId } },
      };

      return prisma.signal.create({ data: createData });
    },

    findById(id) {
      return prisma.signal.findUnique({ where: { id } });
    },

    findByStatus(status) {
      return prisma.signal.findMany({
        where: { status },
        orderBy: { createdAt: "desc" },
      });
    },

    findByTokenId(tokenId) {
      return prisma.signal.findMany({
        where: { tokenId },
        orderBy: { createdAt: "desc" },
      });
    },

    updateStatus(id, status) {
      return prisma.signal.update({
        where: { id },
        data: { status },
      });
    },
  };
}
