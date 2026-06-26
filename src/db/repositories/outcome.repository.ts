import type { Decimal } from "@prisma/client/runtime/library";
import type { Outcome, OutcomeSide, Prisma, PrismaClient } from "@prisma/client";

export interface UpsertOutcomeInput {
  marketId: string;
  tokenId: string;
  name: string;
  side: OutcomeSide;
  currentPrice?: Decimal | number | null;
  bestBid?: Decimal | number | null;
  bestAsk?: Decimal | number | null;
  spread?: Decimal | number | null;
  liquidity?: Decimal | number | null;
  volume?: Decimal | number | null;
}

export interface UpdateOutcomePricingInput {
  currentPrice?: Decimal | number | null;
  bestBid?: Decimal | number | null;
  bestAsk?: Decimal | number | null;
  spread?: Decimal | number | null;
  liquidity?: Decimal | number | null;
  volume?: Decimal | number | null;
}

export interface IOutcomeRepository {
  upsertByTokenId(data: UpsertOutcomeInput): Promise<Outcome>;
  findByTokenId(tokenId: string): Promise<Outcome | null>;
  findByMarketId(marketId: string): Promise<Outcome[]>;
  updatePricing(
    tokenId: string,
    pricing: UpdateOutcomePricingInput,
  ): Promise<Outcome>;
}

export function createOutcomeRepository(
  prisma: PrismaClient,
): IOutcomeRepository {
  return {
    async upsertByTokenId(data) {
      const createData: Prisma.OutcomeCreateInput = {
        tokenId: data.tokenId,
        name: data.name,
        side: data.side,
        currentPrice: data.currentPrice,
        bestBid: data.bestBid,
        bestAsk: data.bestAsk,
        spread: data.spread,
        liquidity: data.liquidity,
        volume: data.volume,
        market: { connect: { id: data.marketId } },
      };

      return prisma.outcome.upsert({
        where: { tokenId: data.tokenId },
        create: createData,
        update: {
          name: data.name,
          side: data.side,
          currentPrice: data.currentPrice,
          bestBid: data.bestBid,
          bestAsk: data.bestAsk,
          spread: data.spread,
          liquidity: data.liquidity,
          volume: data.volume,
        },
      });
    },

    findByTokenId(tokenId) {
      return prisma.outcome.findUnique({ where: { tokenId } });
    },

    findByMarketId(marketId) {
      return prisma.outcome.findMany({
        where: { marketId },
        orderBy: { createdAt: "asc" },
      });
    },

    updatePricing(tokenId, pricing) {
      return prisma.outcome.update({
        where: { tokenId },
        data: pricing,
      });
    },
  };
}
