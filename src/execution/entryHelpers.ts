import type { Market, Outcome } from "@prisma/client";

import type { CandidateOutcome } from "../scanner/types.js";
import type { LongshotScoreInput } from "../strategy/longshotTypes.js";
import type { TailNoScoreInput } from "../strategy/tailNoTypes.js";
import type { OrderBook } from "../polymarket/publicTypes.js";

export function toNumber(
  value: { toNumber(): number } | number | null | undefined,
): number | null {
  if (value == null) {
    return null;
  }
  return typeof value === "number" ? value : value.toNumber();
}

export function buildLongshotScoreInput(
  market: Market,
  outcome: Outcome,
  candidate: CandidateOutcome,
  orderBook: OrderBook,
): LongshotScoreInput {
  return {
    market: {
      question: market.question,
      category: market.category,
      active: market.active,
      closed: market.closed,
      archived: market.archived,
      enableOrderBook: market.enableOrderBook,
      endDate: market.endDate,
      outcomeCount: candidate.outcomeCount,
      liquidityUsd: toNumber(outcome.liquidity),
      volumeUsd: toNumber(outcome.volume),
    },
    outcome: {
      tokenId: outcome.tokenId,
      name: outcome.name,
      side: outcome.side,
      price: toNumber(outcome.currentPrice),
    },
    pricing: {
      orderBook,
      spread: orderBook.spread,
    },
  };
}

export async function resolveYesCounterpartPrice(
  repositories: import("../db/repositories/index.js").IRepositories,
  marketId: string,
): Promise<number | null> {
  const outcomes = await repositories.outcome.findByMarketId(marketId);
  const yesOutcome = outcomes.find((o) => o.side === "YES");
  return yesOutcome ? toNumber(yesOutcome.currentPrice) : null;
}

export function buildTailNoScoreInput(
  market: Market,
  outcome: Outcome,
  candidate: CandidateOutcome,
  orderBook: OrderBook,
  yesCounterpartPrice: number | null,
): TailNoScoreInput {
  return {
    market: {
      question: market.question,
      category: market.category,
      active: market.active,
      closed: market.closed,
      archived: market.archived,
      enableOrderBook: market.enableOrderBook,
      endDate: market.endDate,
      outcomeCount: candidate.outcomeCount,
      liquidityUsd: toNumber(outcome.liquidity),
      volumeUsd: toNumber(outcome.volume),
    },
    outcome: {
      tokenId: outcome.tokenId,
      name: outcome.name,
      side: outcome.side,
      price: toNumber(outcome.currentPrice),
    },
    yesCounterpartPrice,
    pricing: {
      orderBook,
      spread: orderBook.spread,
    },
  };
}

/** @deprecated Use buildLongshotScoreInput */
export const buildScoreInput = buildLongshotScoreInput;

export function roundDownShares(shares: number, decimals = 8): number {
  const factor = 10 ** decimals;
  return Math.floor(shares * factor) / factor;
}

export function entrySignalTypeForSide(side: "YES" | "NO"): "LONGSHOT_ENTRY" | "TAIL_NO_ENTRY" {
  return side === "NO" ? "TAIL_NO_ENTRY" : "LONGSHOT_ENTRY";
}
