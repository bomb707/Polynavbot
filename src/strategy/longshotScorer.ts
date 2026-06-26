import type { Config } from "../config/index.js";
import type {
  LongshotDecision,
  LongshotScoreInput,
  LongshotScoreResult,
} from "./longshotTypes.js";

const FAVORABLE_CATEGORY_KEYWORDS = [
  "politics",
  "election",
  "president",
  "nomination",
  "nominee",
  "leader",
  "governor",
  "senate",
  "tournament",
  "champion",
  "winner",
  "world cup",
  "super bowl",
  "olympics",
] as const;

const COIN_FLIP_LOW = 0.4;
const COIN_FLIP_HIGH = 0.6;
const SWEET_SPOT_LOW = 0.01;
const SWEET_SPOT_HIGH = 0.03;
const PUMP_MULTIPLIER = 5;
const ENTRY_THRESHOLD = 70;
const WATCHLIST_THRESHOLD = 45;
const HARD_REJECT_MAX_SCORE = 25;

export interface ILongshotScorer {
  score(input: LongshotScoreInput): LongshotScoreResult;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function daysUntil(date: Date): number {
  return (date.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function matchesFavorableCategory(category: string | null, question: string): boolean {
  const haystack = `${category ?? ""} ${question}`.toLowerCase();
  return FAVORABLE_CATEGORY_KEYWORDS.some((keyword) => haystack.includes(keyword));
}

function resolveSpread(
  pricing: LongshotScoreInput["pricing"],
): number | null {
  if (pricing.spread !== null && pricing.spread !== undefined) {
    return pricing.spread;
  }
  if (pricing.orderBook?.spread !== null && pricing.orderBook?.spread !== undefined) {
    return pricing.orderBook.spread;
  }
  return null;
}

function hasRecentPump(
  price: number,
  priceHistory: LongshotScoreInput["pricing"]["priceHistory"],
): boolean {
  if (!priceHistory || priceHistory.length < 2) {
    return false;
  }
  const localLow = Math.min(...priceHistory.map((p) => p.price));
  if (localLow <= 0) {
    return false;
  }
  return price >= PUMP_MULTIPLIER * localLow;
}

function isUnclearResolution(category: string | null, question: string): boolean {
  if (question.trim().length < 15) {
    return true;
  }
  if (!category && !matchesFavorableCategory(category, question)) {
    return true;
  }
  return false;
}

function computeSuggestedSizeUsd(
  config: Pick<Config, "MAX_POSITION_SIZE_USD" | "MIN_LIQUIDITY_USD" | "MAX_SPREAD">,
  input: LongshotScoreInput,
  spread: number | null,
  favorableCategory: boolean,
): number {
  const liquidityUsd = input.market.liquidityUsd ?? 0;
  let size = config.MAX_POSITION_SIZE_USD;

  if (spread !== null && spread > config.MAX_SPREAD * 0.5) {
    size *= 0.7;
  }
  if (liquidityUsd < config.MIN_LIQUIDITY_USD * 2) {
    size *= 0.6;
  }
  if (input.market.outcomeCount === 2) {
    size *= 0.8;
  }
  if (!favorableCategory) {
    size *= 0.85;
  }

  return round2(Math.min(size, config.MAX_POSITION_SIZE_USD));
}

export function createLongshotScorer(
  config: Pick<
    Config,
    | "MIN_ENTRY_PRICE"
    | "MAX_ENTRY_PRICE"
    | "MIN_DAYS_TO_EXPIRY"
    | "MIN_LIQUIDITY_USD"
    | "MAX_SPREAD"
    | "MAX_POSITION_SIZE_USD"
  >,
): ILongshotScorer {
  const score = (input: LongshotScoreInput): LongshotScoreResult => {
    const { market, outcome, pricing } = input;
    const reasons: string[] = [];
    const price = outcome.price;
    const spread = resolveSpread(pricing);
    const liquidityUsd = market.liquidityUsd ?? 0;
    const favorableCategory = matchesFavorableCategory(market.category, market.question);

    const suggestedEntryPrice =
      pricing.orderBook?.bestAsk ?? price ?? 0;

    const buildResult = (
      scoreValue: number,
      decision: LongshotDecision,
    ): LongshotScoreResult => ({
      score: clamp(scoreValue, 0, 100),
      decision,
      reasons,
      suggestedEntryPrice,
      suggestedSizeUsd: computeSuggestedSizeUsd(config, input, spread, favorableCategory),
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

    if (outcome.side !== "YES") {
      reasons.push("Only YES outcomes are eligible for longshot basket");
      return buildResult(HARD_REJECT_MAX_SCORE, "reject");
    }

    if (price === null) {
      reasons.push("Outcome price is missing");
      return buildResult(HARD_REJECT_MAX_SCORE, "reject");
    }

    if (price > config.MAX_ENTRY_PRICE) {
      reasons.push(
        `Price ${(price * 100).toFixed(1)}¢ exceeds max entry ${(config.MAX_ENTRY_PRICE * 100).toFixed(1)}¢`,
      );
      return buildResult(HARD_REJECT_MAX_SCORE, "reject");
    }

    if (price < config.MIN_ENTRY_PRICE) {
      reasons.push(
        `Price ${(price * 100).toFixed(1)}¢ below min entry ${(config.MIN_ENTRY_PRICE * 100).toFixed(1)}¢`,
      );
      return buildResult(HARD_REJECT_MAX_SCORE, "reject");
    }

    if (
      market.outcomeCount === 2 &&
      price >= COIN_FLIP_LOW &&
      price <= COIN_FLIP_HIGH
    ) {
      reasons.push("Binary coin-flip market around 40–60¢");
      return buildResult(HARD_REJECT_MAX_SCORE, "reject");
    }

    if (!market.endDate) {
      reasons.push("Market end date is missing");
      return buildResult(HARD_REJECT_MAX_SCORE, "reject");
    }

    const daysToExpiry = daysUntil(market.endDate);
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

    if (hasRecentPump(price, pricing.priceHistory)) {
      reasons.push("Price history shows recent pump above 5x from local low");
      return buildResult(HARD_REJECT_MAX_SCORE, "reject");
    }

    if (isUnclearResolution(market.category, market.question)) {
      reasons.push("Market has unclear resolution criteria");
      return buildResult(HARD_REJECT_MAX_SCORE, "reject");
    }

    let softScore = 50;

    if (price >= config.MIN_ENTRY_PRICE && price <= config.MAX_ENTRY_PRICE) {
      softScore += 15;
      reasons.push("Price within longshot entry band");
      if (price >= SWEET_SPOT_LOW && price <= SWEET_SPOT_HIGH) {
        softScore += 5;
        reasons.push("Price in 1¢–3¢ sweet spot");
      }
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

    if (market.outcomeCount >= 3) {
      const outcomeBonus = Math.min(10, (market.outcomeCount - 2) * 2);
      softScore += outcomeBonus;
      reasons.push("Market has multiple related outcomes");
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

    if (favorableCategory) {
      softScore += 10;
      reasons.push("Favorable market category");
    }

    if (pricing.priceHistory && pricing.priceHistory.length >= 2) {
      softScore += 5;
      reasons.push("No recent pump detected in price history");
    }

    softScore = clamp(softScore, 0, 100);

    let decision: LongshotDecision;
    if (softScore >= ENTRY_THRESHOLD) {
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
