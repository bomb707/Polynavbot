import type { IMarketScanner, ScanOptions, ScanSummary, SkipReason } from "./types.js";
import { SKIP_REASONS } from "./types.js";

export interface CompositeScannerDeps {
  gammaScanner: IMarketScanner;
  walletScanner: IMarketScanner;
}

function emptySkipCounts(): Record<SkipReason, number> {
  return Object.fromEntries(SKIP_REASONS.map((r) => [r, 0])) as Record<
    SkipReason,
    number
  >;
}

function mergeSkipCounts(
  target: Record<SkipReason, number>,
  source: Record<SkipReason, number>,
): void {
  for (const reason of SKIP_REASONS) {
    target[reason] += source[reason] ?? 0;
  }
}

export function createCompositeScanner(deps: CompositeScannerDeps): IMarketScanner {
  const { gammaScanner, walletScanner } = deps;

  return {
    scanMarkets: async (options?: ScanOptions): Promise<ScanSummary> => {
      const [walletSummary, gammaSummary] = await Promise.all([
        walletScanner.scanMarkets(options),
        gammaScanner.scanMarkets(options),
      ]);

      const seen = new Set<string>();
      const candidates = [];

      for (const candidate of walletSummary.candidates) {
        if (seen.has(candidate.tokenId)) {
          continue;
        }
        seen.add(candidate.tokenId);
        candidates.push(candidate);
      }

      for (const candidate of gammaSummary.candidates) {
        if (seen.has(candidate.tokenId)) {
          continue;
        }
        seen.add(candidate.tokenId);
        candidates.push(candidate);
      }

      candidates.sort((a, b) => b.outcomeCount - a.outcomeCount);

      const skipped = emptySkipCounts();
      mergeSkipCounts(skipped, walletSummary.skipped);
      mergeSkipCounts(skipped, gammaSummary.skipped);

      return {
        marketsScanned: walletSummary.marketsScanned + gammaSummary.marketsScanned,
        outcomesScanned: walletSummary.outcomesScanned + gammaSummary.outcomesScanned,
        candidatesFound: candidates.length,
        skipped,
        candidates,
      };
    },

    scanMarketPage: (limit, offset) => gammaScanner.scanMarketPage(limit, offset),

    evaluateMarket: (rawMarket) => gammaScanner.evaluateMarket(rawMarket),
  };
}
