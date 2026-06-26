import type { Market, Outcome } from "@prisma/client";

import type { IRepositories } from "../db/repositories/index.js";
import type { SnapshotTokenRef } from "../db/repositories/snapshot.repository.js";
import type { IPublicClient } from "../polymarket/publicClient.js";
import type { NormalizedMarket } from "../polymarket/publicTypes.js";

export async function persistMarketForBacktest(
  repositories: IRepositories,
  normalized: NormalizedMarket,
): Promise<SnapshotTokenRef[]> {
  const market = await repositories.market.upsertByPolymarketId({
    polymarketMarketId: normalized.polymarketMarketId,
    conditionId: normalized.conditionId,
    question: normalized.question,
    slug: normalized.slug,
    category: normalized.category,
    active: normalized.active,
    closed: normalized.closed,
    archived: normalized.archived,
    enableOrderBook: normalized.enableOrderBook,
    endDate: normalized.endDate,
  });

  const refs: SnapshotTokenRef[] = [];
  for (const outcome of normalized.outcomes) {
    const saved = await repositories.outcome.upsertByTokenId({
      marketId: market.id,
      tokenId: outcome.tokenId,
      name: outcome.name,
      side: outcome.side,
      currentPrice: outcome.price,
      liquidity: normalized.liquidityUsd,
      volume: normalized.volumeUsd,
    });
    refs.push({
      tokenId: saved.tokenId,
      marketId: market.id,
      outcomeId: saved.id,
    });
  }

  return refs;
}

export async function saveMarketAndOutcomes(
  repositories: IRepositories,
  normalized: NormalizedMarket,
): Promise<{ market: Market; outcomes: Outcome[] }> {
  const market = await repositories.market.upsertByPolymarketId({
    polymarketMarketId: normalized.polymarketMarketId,
    conditionId: normalized.conditionId,
    question: normalized.question,
    slug: normalized.slug,
    category: normalized.category,
    active: normalized.active,
    closed: normalized.closed,
    archived: normalized.archived,
    enableOrderBook: normalized.enableOrderBook,
    endDate: normalized.endDate,
  });

  const outcomes: Outcome[] = [];
  for (const outcome of normalized.outcomes) {
    const saved = await repositories.outcome.upsertByTokenId({
      marketId: market.id,
      tokenId: outcome.tokenId,
      name: outcome.name,
      side: outcome.side,
      currentPrice: outcome.price,
    });
    outcomes.push(saved);
  }

  return { market, outcomes };
}

export async function syncMarketFeeParams(
  repositories: IRepositories,
  publicClient: IPublicClient,
  market: Market,
  conditionId: string,
  feeCache: Map<string, Date>,
  feeRefreshMs: number,
): Promise<void> {
  const cachedAt = feeCache.get(conditionId);
  if (cachedAt && Date.now() - cachedAt.getTime() < feeRefreshMs) {
    return;
  }

  if (
    market.feeLastFetchedAt &&
    Date.now() - market.feeLastFetchedAt.getTime() < feeRefreshMs
  ) {
    feeCache.set(conditionId, market.feeLastFetchedAt);
    return;
  }

  const info = await publicClient.getClobMarketInfo(conditionId);
  if (!info) {
    return;
  }

  await repositories.market.updateFeeParams(market.id, {
    feesEnabled: info.feesEnabled,
    feeRate: info.feeDetails?.feeRate ?? 0,
    feeExponent: info.feeDetails?.feeExponent ?? null,
    takerOnly: info.feeDetails?.takerOnly ?? true,
    makerBaseFeeBps: info.makerBaseFeeBps,
    takerBaseFeeBps: info.takerBaseFeeBps,
    feeCategory: info.feeCategory,
    feeLastFetchedAt: new Date(),
  });

  feeCache.set(conditionId, new Date());
}
