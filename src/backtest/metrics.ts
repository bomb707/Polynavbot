import type { BacktestTrade, EquityPoint } from "./backtestTypes.js";

export interface RoundTrip {
  tokenId: string;
  realizedPnlUsd: number;
}

export function computeMetrics(input: {
  startingCapitalUsd: number;
  finalEquityUsd: number;
  trades: BacktestTrade[];
  equityCurve: EquityPoint[];
  openUnrealizedUsd: number;
}): {
  totalRoi: number;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  finalEquityUsd: number;
  maxDrawdown: number;
  hitRate: number;
  averageWinner: number;
  averageLoser: number;
  payoffSkew: number;
  capitalUtilization: number;
  worstLosingStreak: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
} {
  const realizedPnlUsd = round2(
    input.trades.filter((trade) => trade.side === "SELL").reduce((sum, trade) => sum + trade.realizedPnlUsd, 0),
  );
  const unrealizedPnlUsd = round2(input.openUnrealizedUsd);
  const finalEquityUsd = round2(input.finalEquityUsd);
  const totalRoi = round4(
    (finalEquityUsd - input.startingCapitalUsd) / input.startingCapitalUsd,
  );

  const roundTrips = buildRoundTrips(input.trades);
  const winners = roundTrips.filter((trip) => trip.realizedPnlUsd > 0);
  const losers = roundTrips.filter((trip) => trip.realizedPnlUsd < 0);
  const hitRate = roundTrips.length === 0 ? 0 : round4(winners.length / roundTrips.length);
  const averageWinner =
    winners.length === 0 ? 0 : round2(winners.reduce((s, t) => s + t.realizedPnlUsd, 0) / winners.length);
  const averageLoser =
    losers.length === 0 ? 0 : round2(losers.reduce((s, t) => s + t.realizedPnlUsd, 0) / losers.length);
  const payoffSkew =
    averageLoser === 0 ? (averageWinner > 0 ? Infinity : 0) : round4(averageWinner / Math.abs(averageLoser));

  const maxDrawdown = computeMaxDrawdown(input.equityCurve);
  const capitalUtilization = computeCapitalUtilization(input.equityCurve, input.startingCapitalUsd);
  const worstLosingStreak = computeWorstLosingStreak(roundTrips);

  return {
    totalRoi,
    realizedPnlUsd,
    unrealizedPnlUsd,
    finalEquityUsd,
    maxDrawdown,
    hitRate,
    averageWinner,
    averageLoser,
    payoffSkew: Number.isFinite(payoffSkew) ? payoffSkew : 0,
    capitalUtilization,
    worstLosingStreak,
    totalTrades: input.trades.length,
    winningTrades: winners.length,
    losingTrades: losers.length,
  };
}

function buildRoundTrips(trades: BacktestTrade[]): RoundTrip[] {
  const byToken = new Map<string, BacktestTrade[]>();
  for (const trade of trades) {
    const list = byToken.get(trade.tokenId) ?? [];
    list.push(trade);
    byToken.set(trade.tokenId, list);
  }

  const trips: RoundTrip[] = [];
  for (const [tokenId, tokenTrades] of byToken) {
    const sells = tokenTrades.filter((trade) => trade.side === "SELL");
    if (sells.length === 0) {
      continue;
    }
    const pnl = round2(sells.reduce((sum, trade) => sum + trade.realizedPnlUsd, 0));
    trips.push({ tokenId, realizedPnlUsd: pnl });
  }
  return trips;
}

function computeMaxDrawdown(curve: EquityPoint[]): number {
  if (curve.length === 0) {
    return 0;
  }
  let peak = curve[0]!.equityUsd;
  let maxDrawdown = 0;
  for (const point of curve) {
    peak = Math.max(peak, point.equityUsd);
    if (peak > 0) {
      maxDrawdown = Math.max(maxDrawdown, (peak - point.equityUsd) / peak);
    }
  }
  return round4(maxDrawdown);
}

function computeCapitalUtilization(curve: EquityPoint[], startingCapitalUsd: number): number {
  if (curve.length === 0 || startingCapitalUsd <= 0) {
    return 0;
  }
  const avgDeployed =
    curve.reduce((sum, point) => sum + point.deployedUsd, 0) / curve.length;
  return round4(avgDeployed / startingCapitalUsd);
}

function computeWorstLosingStreak(roundTrips: RoundTrip[]): number {
  let current = 0;
  let worst = 0;
  for (const trip of roundTrips) {
    if (trip.realizedPnlUsd < 0) {
      current += 1;
      worst = Math.max(worst, current);
    } else {
      current = 0;
    }
  }
  return worst;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
