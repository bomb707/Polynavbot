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
  listAllTokenRefs(): Promise<Array<{ tokenId: string; marketId: string; outcomeId: string }>>;
  findTokenRefsForBacktest(
    start: Date,
    end: Date,
    maxMarkets: number,
  ): Promise<Array<{ tokenId: string; marketId: string; outcomeId: string }>>;
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

    listAllTokenRefs() {
      return prisma.outcome.findMany({
        select: {
          tokenId: true,
          marketId: true,
          id: true,
        },
        orderBy: { createdAt: "asc" },
      }).then((rows) =>
        rows.map((row) => ({
          tokenId: row.tokenId,
          marketId: row.marketId,
          outcomeId: row.id,
        })),
      );
    },

    async findTokenRefsForBacktest(start, end, maxMarkets) {
      const outcomes = await prisma.outcome.findMany({
        where: {
          market: {
            enableOrderBook: true,
            OR: [{ endDate: null }, { endDate: { gte: start } }],
            createdAt: { lte: end },
          },
        },
        select: {
          tokenId: true,
          marketId: true,
          id: true,
        },
        orderBy: { createdAt: "desc" },
      });

      const refs: Array<{ tokenId: string; marketId: string; outcomeId: string }> = [];
      const seenMarkets = new Set<string>();

      for (const row of outcomes) {
        if (!seenMarkets.has(row.marketId)) {
          if (seenMarkets.size >= maxMarkets) {
            continue;
          }
          seenMarkets.add(row.marketId);
        }

        if (seenMarkets.has(row.marketId)) {
          refs.push({
            tokenId: row.tokenId,
            marketId: row.marketId,
            outcomeId: row.id,
          });
        }
      }

      return refs;
    },

    updatePricing(tokenId, pricing) {
      return prisma.outcome.update({
        where: { tokenId },
        data: pricing,
      });
    },
  };
}
