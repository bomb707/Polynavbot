import type { AppContainer } from "../container.js";
import { isPaperMode } from "../config/index.js";
import { buildScoreInput, toNumber } from "../execution/entryHelpers.js";
import type { ScanOptions } from "../scanner/types.js";
import type { OrderBook } from "../polymarket/publicTypes.js";
import type { PaperRunSummary } from "../paper/paperTypes.js";

function midPrice(orderBook: OrderBook): number | null {
  if (orderBook.bestBid != null && orderBook.bestAsk != null) {
    return (orderBook.bestBid + orderBook.bestAsk) / 2;
  }
  if (orderBook.bestAsk != null) {
    return orderBook.bestAsk;
  }
  if (orderBook.bestBid != null) {
    return orderBook.bestBid;
  }
  return null;
}

export function formatPaperRunSummary(summary: PaperRunSummary): string {
  const lines = [
    "=== Paper Trading Run ===",
    "",
    `Markets scanned: ${summary.scan.marketsScanned}`,
    `Outcomes scanned: ${summary.scan.outcomesScanned}`,
    `Scanner candidates: ${summary.scan.candidatesFound}`,
    `Entry candidates (scored): ${summary.entryCandidates}`,
    `Signals created: ${summary.signalsCreated}`,
    "",
    "Orders:",
    `  Placed: ${summary.ordersPlaced}`,
    `  Filled: ${summary.ordersFilled}`,
    `  Rejected: ${summary.ordersRejected}`,
    `  Pending: ${summary.ordersPending}`,
    "",
    "Portfolio:",
    `  Cash balance: $${summary.portfolio.cashBalanceUsd.toFixed(2)}`,
    `  Realized PnL: $${summary.portfolio.totalRealizedPnlUsd.toFixed(2)}`,
    `  Unrealized PnL: $${summary.portfolio.totalUnrealizedPnlUsd.toFixed(2)}`,
    `  Open positions: ${summary.portfolio.openPositions.length}`,
  ];

  if (summary.portfolio.openPositions.length > 0) {
    lines.push("", "Open positions:");
    for (const position of summary.portfolio.openPositions) {
      const size = toNumber(position.size) ?? 0;
      const avgEntry = toNumber(position.avgEntryPrice) ?? 0;
      const unrealized = toNumber(position.unrealizedPnlUsd) ?? 0;
      lines.push(
        `  ${position.tokenId.slice(0, 12)}… size=${size.toFixed(4)} entry=${avgEntry.toFixed(4)} uPnL=$${unrealized.toFixed(2)}`,
      );
    }
  }

  return lines.join("\n");
}

export async function runPaperTrading(
  container: AppContainer,
  options?: ScanOptions,
): Promise<PaperRunSummary> {
  if (!isPaperMode(container.config)) {
    throw new Error("paper:run requires TRADING_MODE=paper");
  }

  await container.db.connect();

  const engine = container.paperTradingEngine;
  await engine.initialize();

  const scan = await container.scanner.scanMarkets(options);
  const scorer = container.longshotScorer;

  let signalsCreated = 0;
  let entryCandidates = 0;
  let ordersPlaced = 0;
  let ordersFilled = 0;
  let ordersRejected = 0;

  const booksByTokenId = new Map<string, OrderBook>();
  const previousQuotes = new Map<string, { bestBid: number | null; bestAsk: number | null }>();
  const markPrices = new Map<string, number>();

  for (const candidate of scan.candidates) {
    const market = await container.repositories.market.findById(candidate.marketId);
    const outcome = await container.repositories.outcome.findByTokenId(candidate.tokenId);

    if (!market || !outcome) {
      continue;
    }

    previousQuotes.set(candidate.tokenId, {
      bestBid: toNumber(outcome.bestBid),
      bestAsk: toNumber(outcome.bestAsk),
    });

    const orderBook = await container.publicClient.getOrderBook(candidate.tokenId);
    if (!orderBook) {
      continue;
    }

    booksByTokenId.set(candidate.tokenId, orderBook);

    const price = midPrice(orderBook) ?? candidate.price;
    markPrices.set(candidate.tokenId, price);

    const scoreInput = buildScoreInput(market, outcome, candidate, orderBook);
    const scoreResult = scorer.score(scoreInput);

    if (scoreResult.decision !== "entry_candidate") {
      continue;
    }

    entryCandidates += 1;

    const signal = await container.repositories.signal.create({
      marketId: candidate.marketId,
      outcomeId: candidate.outcomeId,
      tokenId: candidate.tokenId,
      signalType: "LONGSHOT_ENTRY",
      score: scoreResult.score,
      reason: scoreResult.reasons.join("; "),
      entryPrice: scoreResult.suggestedEntryPrice,
      suggestedSizeUsd: scoreResult.suggestedSizeUsd,
      status: "APPROVED",
    });
    signalsCreated += 1;

    const { order, rejectedReason } = await engine.placeLimitOrder({
      marketId: candidate.marketId,
      outcomeId: candidate.outcomeId,
      tokenId: candidate.tokenId,
      side: "BUY",
      limitPrice: scoreResult.suggestedEntryPrice,
      sizeUsd: scoreResult.suggestedSizeUsd,
      signalId: signal.id,
      riskContext: {
        spread: orderBook.spread,
        liquidityUsd: toNumber(outcome.liquidity),
        dataUpdatedAt: outcome.updatedAt,
        isNewEntry: true,
      },
    });

    if (rejectedReason) {
      ordersRejected += 1;
      continue;
    }

    if (!order) {
      ordersRejected += 1;
      continue;
    }

    ordersPlaced += 1;

    if (order.status === "FAILED") {
      ordersRejected += 1;
      continue;
    }

    const fillResult = await engine.simulateFill(order, { orderBook });
    if (fillResult.filled) {
      ordersFilled += 1;
    }
  }

  const extraFills = await engine.tryFillPendingOrders(booksByTokenId, previousQuotes);
  ordersFilled += extraFills.length;

  const pendingAfter = await container.repositories.order.findPendingPaperOrders();

  await engine.markAllOpenPositions(markPrices);

  const portfolio = await engine.getPortfolioSummary();

  return {
    scan,
    signalsCreated,
    entryCandidates,
    ordersPlaced,
    ordersFilled,
    ordersRejected,
    ordersPending: pendingAfter.length,
    portfolio,
  };
}
