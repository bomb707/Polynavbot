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

export interface IMarketSnapshotRepository {
  create(data: CreateSnapshotInput): Promise<MarketSnapshot>;
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
  };
}
