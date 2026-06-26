import type { MarketSnapshot, Prisma, PrismaClient } from "@prisma/client";

export interface CreateSnapshotInput {
  marketId: string;
  outcomeId: string;
  tokenId: string;
  price: number;
  bestBid?: number | null;
  bestAsk?: number | null;
  spread?: number | null;
  liquidity?: number | null;
  volume?: number | null;
}

export interface SnapshotTokenRef {
  tokenId: string;
  marketId: string;
  outcomeId: string;
}

export interface IMarketSnapshotRepository {
  create(data: CreateSnapshotInput): Promise<MarketSnapshot>;
  findByTokenInRange(
    tokenId: string,
    start: Date,
    end: Date,
  ): Promise<MarketSnapshot[]>;
  findDistinctTokensInRange(start: Date, end: Date): Promise<SnapshotTokenRef[]>;
}

export function createMarketSnapshotRepository(
  prisma: PrismaClient,
): IMarketSnapshotRepository {
  return {
    create(data) {
      const createData: Prisma.MarketSnapshotCreateInput = {
        tokenId: data.tokenId,
        price: data.price,
        bestBid: data.bestBid,
        bestAsk: data.bestAsk,
        spread: data.spread,
        liquidity: data.liquidity,
        volume: data.volume,
        market: { connect: { id: data.marketId } },
        outcome: { connect: { id: data.outcomeId } },
      };

      return prisma.marketSnapshot.create({ data: createData });
    },

    findByTokenInRange(tokenId, start, end) {
      return prisma.marketSnapshot.findMany({
        where: {
          tokenId,
          timestamp: { gte: start, lte: end },
        },
        orderBy: { timestamp: "asc" },
      });
    },

    async findDistinctTokensInRange(start, end) {
      const rows = await prisma.marketSnapshot.findMany({
        where: {
          timestamp: { gte: start, lte: end },
        },
        distinct: ["tokenId"],
        select: {
          tokenId: true,
          marketId: true,
          outcomeId: true,
        },
      });
      return rows;
    },
  };
}
