import type { Market, Prisma, PrismaClient } from "@prisma/client";

export interface UpsertMarketInput {
  polymarketMarketId: string;
  conditionId: string;
  question: string;
  slug?: string | null;
  category?: string | null;
  active?: boolean;
  closed?: boolean;
  archived?: boolean;
  enableOrderBook?: boolean;
  endDate?: Date | null;
}

export interface IMarketRepository {
  upsertByPolymarketId(data: UpsertMarketInput): Promise<Market>;
  findById(id: string): Promise<Market | null>;
  findByPolymarketId(polymarketMarketId: string): Promise<Market | null>;
  listActive(): Promise<Market[]>;
}

export function createMarketRepository(prisma: PrismaClient): IMarketRepository {
  return {
    async upsertByPolymarketId(data) {
      const createData: Prisma.MarketCreateInput = {
        polymarketMarketId: data.polymarketMarketId,
        conditionId: data.conditionId,
        question: data.question,
        slug: data.slug,
        category: data.category,
        active: data.active ?? true,
        closed: data.closed ?? false,
        archived: data.archived ?? false,
        enableOrderBook: data.enableOrderBook ?? true,
        endDate: data.endDate,
      };

      return prisma.market.upsert({
        where: { polymarketMarketId: data.polymarketMarketId },
        create: createData,
        update: {
          conditionId: data.conditionId,
          question: data.question,
          slug: data.slug,
          category: data.category,
          active: data.active,
          closed: data.closed,
          archived: data.archived,
          enableOrderBook: data.enableOrderBook,
          endDate: data.endDate,
        },
      });
    },

    findById(id) {
      return prisma.market.findUnique({ where: { id } });
    },

    findByPolymarketId(polymarketMarketId) {
      return prisma.market.findUnique({ where: { polymarketMarketId } });
    },

    listActive() {
      return prisma.market.findMany({
        where: { active: true, closed: false, archived: false },
        orderBy: { createdAt: "desc" },
      });
    },
  };
}
