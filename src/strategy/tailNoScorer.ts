import type { Config } from "../config/index.js";
import type {
  TailNoDecision,
  TailNoScoreInput,
  TailNoScoreResult,
} from "./tailNoTypes.js";

const FAVORABLE_CATEGORY_KEYWORDS = [
  "politics",
  "election",
  "president",
  "nomination",
  "nominee",
  "leader",
  "governor",
  "senate",
  "sports",
  "tournament",
  "champion",
  "winner",
  "world cup",
  "super bowl",
  "olympics",
  "nba",
  "nfl",
  "mlb",
] as const;

const COIN_FLIP_LOW = 0.4;
const COIN_FLIP_HIGH = 0.6;
const WATCHLIST_THRESHOLD = 45;
const HARD_REJECT_MAX_SCORE = 25;

export interface ITailNoScorer {
  score(input: TailNoScoreInput): TailNoScoreResult;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function daysUntil(date: Date, asOf: Date = new Date()): number {
  return (date.getTime() - asOf.getTime()) / (1000 * 60 * 60 * 24);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function matchesFavorableCategory(category: string | null, question: string): boolean {
  const haystack = `${category ?? ""} ${question}`.toLowerCase();
  return FAVORABLE_CATEGORY_KEYWORDS.some((keyword) => haystack.includes(keyword));
}

function resolveSpread(pricing: TailNoScoreInput["pricing"]): number | null {
  if (pricing.spread !== null && pricing.spread !== undefined) {
    return pricing.spread;
  }
  if (pricing.orderBook?.spread !== null && pricing.orderBook?.spread !== undefined) {
    return pricing.orderBook.spread;
  }
  return null;
}

function computeSuggestedSizeUsd(
  config: Pick<Config, "MAX_POSITION_SIZE_USD" | "MIN_LIQUIDITY_USD" | "MAX_SPREAD">,
  input: TailNoScoreInput,
  spread: number | null,
): number {
  const liquidityUsd = input.market.liquidityUsd ?? 0;
  let size = config.MAX_POSITION_SIZE_USD;

  if (spread !== null && spread > config.MAX_SPREAD * 0.5) {
    size *= 0.75;
  }
  if (liquidityUsd < config.MIN_LIQUIDITY_USD * 2) {
    size *= 0.6;
  }

  return round2(Math.min(size, config.MAX_POSITION_SIZE_USD));
}

export function createTailNoScorer(
  config: Pick<
    Config,
    | "NO_MIN_ENTRY_PRICE"
    | "NO_MAX_ENTRY_PRICE"
    | "MIN_DAYS_TO_EXPIRY"
    | "MIN_LIQUIDITY_USD"
    | "MAX_SPREAD"
    | "MAX_POSITION_SIZE_USD"
    | "MIN_ENTRY_PRICE"
    | "MAX_ENTRY_PRICE"
    | "TAIL_NO_ENTRY_THRESHOLD"
  >,
): ITailNoScorer {
  const score = (input: TailNoScoreInput): TailNoScoreResult => {
    const { market, outcome, pricing } = input;
    const reasons: string[] = [];
    const price = outcome.price;
    const spread = resolveSpread(pricing);
    const liquidityUsd = market.liquidityUsd ?? 0;

    const suggestedEntryPrice = pricing.orderBook?.bestAsk ?? price ?? 0;

    const buildResult = (
      scoreValue: number,
      decision: TailNoDecision,
    ): TailNoScoreResult => ({
      score: clamp(scoreValue, 0, 100),
      decision,
      reasons,
      suggestedEntryPrice,
      suggestedSizeUsd: computeSuggestedSizeUsd(config, input, spread),
    });

    if (!market.active || market.closed || market.archived) {
      reasons.push("Market is inactive, closed, or archived");
      return buildResult(HARD_REJECT_MAX_SCORE, "reject");
    }

    if (!market.enableOrderBook) {
      reasons.push("Market does not have order book enabled");
      return buildResult(HARD_REJECT_MAX_SCORE, "reject");
    }

    if (!outcome.tokenId) {
      reasons.push("Outcome is missing token ID");
      return buildResult(HARD_REJECT_MAX_SCORE, "reject");
    }

    if (outcome.side !== "NO") {
      reasons.push("Only NO outcomes are eligible for tail-fade");
      return buildResult(HARD_REJECT_MAX_SCORE, "reject");
    }

    if (price === null) {
      reasons.push("Outcome price is missing");
      return buildResult(HARD_REJECT_MAX_SCORE, "reject");
    }

    if (price > config.NO_MAX_ENTRY_PRICE) {
      reasons.push(
        `Price ${(price * 100).toFixed(1)}¢ exceeds max NO entry ${(config.NO_MAX_ENTRY_PRICE * 100).toFixed(1)}¢`,
      );
      return buildResult(HARD_REJECT_MAX_SCORE, "reject");
    }

    if (price < config.NO_MIN_ENTRY_PRICE) {
      reasons.push(
        `Price ${(price * 100).toFixed(1)}¢ below min NO entry ${(config.NO_MIN_ENTRY_PRICE * 100).toFixed(1)}¢`,
      );
      return buildResult(HARD_REJECT_MAX_SCORE, "reject");
    }

    if (
      market.outcomeCount === 2 &&
      price >= COIN_FLIP_LOW &&
      price <= COIN_FLIP_HIGH &&
      input.yesCounterpartPrice !== null &&
      input.yesCounterpartPrice >= COIN_FLIP_LOW &&
      input.yesCounterpartPrice <= COIN_FLIP_HIGH
    ) {
      reasons.push("Binary coin-flip market around 40–60¢ on both sides");
      return buildResult(HARD_REJECT_MAX_SCORE, "reject");
    }

    if (
      input.yesCounterpartPrice !== null &&
      input.yesCounterpartPrice >= config.MIN_ENTRY_PRICE &&
      input.yesCounterpartPrice <= config.MAX_ENTRY_PRICE
    ) {
      reasons.push("YES counterpart already in longshot band");
      return buildResult(HARD_REJECT_MAX_SCORE, "reject");
    }

    if (!market.endDate) {
      reasons.push("Market end date is missing");
      return buildResult(HARD_REJECT_MAX_SCORE, "reject");
    }

    const daysToExpiry = daysUntil(market.endDate, input.asOf);
    if (daysToExpiry < config.MIN_DAYS_TO_EXPIRY) {
      reasons.push(
        `End date too soon (${Math.floor(daysToExpiry)} days, min ${config.MIN_DAYS_TO_EXPIRY})`,
      );
      return buildResult(HARD_REJECT_MAX_SCORE, "reject");
    }

    if (liquidityUsd < config.MIN_LIQUIDITY_USD) {
      reasons.push(
        `Liquidity too low ($${liquidityUsd.toFixed(0)}, min $${config.MIN_LIQUIDITY_USD})`,
      );
      return buildResult(HARD_REJECT_MAX_SCORE, "reject");
    }

    if (spread !== null && spread > config.MAX_SPREAD) {
      reasons.push(
        `Spread too wide (${(spread * 100).toFixed(1)}¢, max ${(config.MAX_SPREAD * 100).toFixed(1)}¢)`,
      );
      return buildResult(HARD_REJECT_MAX_SCORE, "reject");
    }

    if (!matchesFavorableCategory(market.category, market.question)) {
      reasons.push("Market category not favorable for tail-fade");
      return buildResult(HARD_REJECT_MAX_SCORE, "reject");
    }

    let softScore = 50;

    if (price >= config.NO_MIN_ENTRY_PRICE && price <= config.NO_MAX_ENTRY_PRICE) {
      softScore += 15;
      reasons.push("Price within NO tail-fade band");
    }

    const expiryBonus = clamp(
      ((daysToExpiry - config.MIN_DAYS_TO_EXPIRY) / 90) * 15,
      0,
      15,
    );
    if (expiryBonus > 0) {
      softScore += expiryBonus;
      reasons.push("Long time to expiry");
    }

    const liquidityBonus = clamp(
      ((liquidityUsd - config.MIN_LIQUIDITY_USD) / config.MIN_LIQUIDITY_USD) * 10,
      0,
      10,
    );
    if (liquidityBonus > 0) {
      softScore += liquidityBonus;
      reasons.push("Reasonable liquidity");
    }

    if (spread !== null) {
      const spreadBonus = clamp(10 * (1 - spread / config.MAX_SPREAD), 0, 10);
      softScore += spreadBonus;
      reasons.push("Tight enough spread");
    }

    const volumeUsd = market.volumeUsd ?? 0;
    if (volumeUsd > 0) {
      softScore += 5;
      reasons.push("Active volume");
    }

    softScore += 10;
    reasons.push("Favorable market category");

    softScore = clamp(softScore, 0, 100);

    let decision: TailNoDecision;
    if (softScore >= config.TAIL_NO_ENTRY_THRESHOLD) {
      decision = "entry_candidate";
    } else if (softScore >= WATCHLIST_THRESHOLD) {
      decision = "watchlist";
    } else {
      decision = "reject";
      reasons.push("Score below watchlist threshold");
    }

    return buildResult(softScore, decision);
  };

  return { score };
}
