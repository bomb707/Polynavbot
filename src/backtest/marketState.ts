import type { BacktestMarketMeta, PriceBar } from "./backtestTypes.js";

export function filterBarsInRange(bars: PriceBar[], start: Date, end: Date): PriceBar[] {
  const startMs = start.getTime();
  const endMs = end.getTime();
  return bars.filter((bar) => {
    const ts = bar.timestamp.getTime();
    return ts >= startMs && ts <= endMs;
  });
}

/** Treat markets as open during backtest when asOf is before endDate (ignores current closed flag). */
export function isMarketOpenAt(meta: BacktestMarketMeta, asOf: Date): boolean {
  if (meta.archived || !meta.enableOrderBook) {
    return false;
  }
  if (meta.endDate && asOf.getTime() >= meta.endDate.getTime()) {
    return false;
  }
  return true;
}

export function resolveHistoricalMarketFlags(
  meta: BacktestMarketMeta,
  asOf: Date,
): Pick<BacktestMarketMeta, "active" | "closed"> {
  const open = isMarketOpenAt(meta, asOf);
  return {
    active: open,
    closed: !open,
  };
}

export class EntryRejectionTracker {
  private readonly counts = new Map<string, number>();

  record(reason: string): void {
    this.counts.set(reason, (this.counts.get(reason) ?? 0) + 1);
  }

  toSortedRecord(): Record<string, number> {
    return Object.fromEntries(
      [...this.counts.entries()].sort((a, b) => b[1] - a[1]),
    );
  }

  total(): number {
    let sum = 0;
    for (const count of this.counts.values()) {
      sum += count;
    }
    return sum;
  }
}
