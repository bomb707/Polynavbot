import type { IRepositories } from "../db/repositories/index.js";
import type { SnapshotTokenRef } from "../db/repositories/snapshot.repository.js";
import type { ILogger } from "../logger/types.js";
import type { IPublicClient } from "../polymarket/publicClient.js";
import type { ActivityItem, NormalizedMarket } from "../polymarket/publicTypes.js";

export interface WalletTokenCandidate {
  tokenId: string;
  slug: string | null;
  title: string | null;
  conditionId: string | null;
  outcomeName: string | null;
}

export interface ResolveWalletTokenRefsResult {
  refs: SnapshotTokenRef[];
  yesTokens: number;
  skippedNoTokens: number;
  skippedMissingSlug: number;
}

function inferSide(name: string): "YES" | "NO" {
  const normalized = name.trim().toLowerCase();
  if (normalized === "yes" || normalized === "y") {
    return "YES";
  }
  if (normalized === "no" || normalized === "n") {
    return "NO";
  }
  return "YES";
}

export function collectWalletTokenCandidates(
  activity: ActivityItem[],
): WalletTokenCandidate[] {
  const byToken = new Map<string, WalletTokenCandidate>();

  for (const item of activity) {
    if (!item.asset) {
      continue;
    }
    if (item.type && item.type !== "TRADE") {
      continue;
    }

    const existing = byToken.get(item.asset);
    if (existing) {
      continue;
    }

    byToken.set(item.asset, {
      tokenId: item.asset,
      slug: item.slug,
      title: item.title,
      conditionId: item.conditionId,
      outcomeName: item.outcomeName,
    });
  }

  return [...byToken.values()];
}

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

export async function resolveWalletTokenRefs(
  publicClient: IPublicClient,
  repositories: IRepositories,
  logger: ILogger,
  walletAddress: string,
  maxItems: number,
): Promise<ResolveWalletTokenRefsResult> {
  const normalizedWallet = walletAddress.trim().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(normalizedWallet)) {
    throw new Error(`Invalid mirror wallet address: ${walletAddress}`);
  }

  logger.info({ walletAddress: normalizedWallet, maxItems }, "Fetching wallet activity for backtest mirror");

  const activity = await publicClient.getAllUserActivity(normalizedWallet, maxItems);
  const candidates = collectWalletTokenCandidates(activity);

  logger.info(
    { activityItems: activity.length, uniqueTokens: candidates.length },
    "Wallet activity collected",
  );

  const refs: SnapshotTokenRef[] = [];
  let yesTokens = 0;
  let skippedNoTokens = 0;
  let skippedMissingSlug = 0;
  const slugCache = new Map<string, NormalizedMarket | null>();

  for (const candidate of candidates) {
    const side = inferSide(candidate.outcomeName ?? "Yes");
    if (side !== "YES") {
      skippedNoTokens += 1;
      continue;
    }

    if (!candidate.slug) {
      skippedMissingSlug += 1;
      continue;
    }

    let normalized = slugCache.get(candidate.slug);
    if (normalized === undefined) {
      normalized = await publicClient.getMarketBySlug(candidate.slug);
      slugCache.set(candidate.slug, normalized);
    }

    if (!normalized) {
      logger.warn(
        { slug: candidate.slug, tokenId: candidate.tokenId },
        "Skipping wallet token with unknown market slug",
      );
      continue;
    }

    const marketRefs = await persistMarketForBacktest(repositories, normalized);
    const ref = marketRefs.find((entry) => entry.tokenId === candidate.tokenId);
    if (!ref) {
      logger.warn(
        { tokenId: candidate.tokenId, slug: candidate.slug },
        "Wallet token not found in normalized market outcomes",
      );
      continue;
    }

    refs.push(ref);
    yesTokens += 1;
  }

  logger.info(
    {
      walletAddress: normalizedWallet,
      yesTokens,
      skippedNoTokens,
      skippedMissingSlug,
      tokenRefs: refs.length,
    },
    "Wallet mirror token refs resolved",
  );

  return { refs, yesTokens, skippedNoTokens, skippedMissingSlug };
}
