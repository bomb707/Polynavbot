import type { ILogger } from "../logger/types.js";
import type { Market } from "../polymarket/types.js";
import { createLongshotScorer, type ILongshotScorer } from "./longshotScorer.js";
import type {
  LongshotDecision,
  LongshotScoreInput,
  LongshotScoreResult,
} from "./longshotTypes.js";
import { createTailNoScorer, type ITailNoScorer } from "./tailNoScorer.js";
import type {
  TailNoDecision,
  TailNoScoreInput,
  TailNoScoreResult,
} from "./tailNoTypes.js";
import type { IStrategy } from "./types.js";

export { createLongshotScorer, type ILongshotScorer };
export { createTailNoScorer, type ITailNoScorer };
export type { LongshotDecision, LongshotScoreInput, LongshotScoreResult };
export type { TailNoDecision, TailNoScoreInput, TailNoScoreResult };

/** Future: longshot entry/exit rules. */
export function createStrategy(logger: ILogger): IStrategy {
  return {
    async evaluate(_markets: Market[]) {
      logger.debug("Strategy stub: evaluate called");
      return [];
    },
  };
}
