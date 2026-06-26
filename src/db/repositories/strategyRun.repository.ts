import type { Prisma, PrismaClient, StrategyRun, StrategyRunMode } from "@prisma/client";

export interface CreateStrategyRunInput {
  mode: StrategyRunMode;
  metadata?: Prisma.InputJsonValue;
}

export interface FinishStrategyRunInput {
  marketsScanned?: number;
  signalsCreated?: number;
  ordersCreated?: number;
  errorsCount?: number;
  metadata?: Prisma.InputJsonValue;
}

export interface IStrategyRunRepository {
  create(data: CreateStrategyRunInput): Promise<StrategyRun>;
  finish(id: string, data: FinishStrategyRunInput): Promise<StrategyRun>;
}

export function createStrategyRunRepository(prisma: PrismaClient): IStrategyRunRepository {
  return {
    create(data) {
      return prisma.strategyRun.create({
        data: {
          mode: data.mode,
          metadata: data.metadata,
        },
      });
    },

    finish(id, data) {
      return prisma.strategyRun.update({
        where: { id },
        data: {
          finishedAt: new Date(),
          marketsScanned: data.marketsScanned,
          signalsCreated: data.signalsCreated,
          ordersCreated: data.ordersCreated,
          errorsCount: data.errorsCount,
          metadata: data.metadata,
        },
      });
    },
  };
}
