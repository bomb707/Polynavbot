# Safety Review — Polynavbot

**Date:** 2026-06-26  
**Scope:** Production readiness, live-trading guards, idempotency, risk limits, fee correctness.

## Executive Summary

Polynavbot defaults to `TRADING_MODE=paper`. All live order placement funnels through a single CLOB choke point (`clobClient.createAndPostOrder`) guarded by `assertLiveOrderPlacementAllowed`, which requires both `TRADING_MODE=live` and `LIVE_TRADING_CONFIRMATION=I_UNDERSTAND_THE_RISKS`.

This review identified operational footguns (CLI commands named `:paper` that could place live orders) and state bugs (exit milestone flags persisted before fills). Critical issues have been fixed in this pass. Remaining items are documented as accepted risks or follow-up work.

## Guard Architecture

```
CLI / Jobs → entryEngine / exitEngine → executionEngine (mode-routed)
  ├─ paper   → paperExecutionEngine → paperTradingEngine
  ├─ dry_run → dryRunExecutionEngine (log only, no orders)
  └─ live    → liveExecutionEngine → clobClient (confirmation required)
```

## Focus Area Findings

### 1. Can live trades happen accidentally?

| Severity | Finding | Status |
|----------|---------|--------|
| Critical | `entry:paper`, `exit:paper`, `ws:monitor` had no mode guard; with live env + confirmation they placed real orders | **Fixed** — all three require `TRADING_MODE=paper` |
| Medium | No startup warning when `TRADING_MODE=live` | **Fixed** — CLI prints warning on launch |
| Low | `worker`, `scheduler`, `paper:run` already require paper mode | OK |
| Info | CLOB placement still requires exact confirmation phrase | OK |

### 2. Are private keys ever logged?

| Severity | Finding | Status |
|----------|---------|--------|
| Low | No direct `PRIVATE_KEY` logging found | OK |
| Medium | `String(error)` on CLOB/WS paths could leak SDK payloads | **Fixed** — `sanitizeError()` in CLOB/WS clients |
| Medium | No Pino redaction configured | **Fixed** — redact paths for keys, secrets, URLs |

### 3. Are API credentials ever printed?

| Severity | Finding | Status |
|----------|---------|--------|
| Low | API keys not logged; only `credsSource: env/derive` metadata | OK |
| Medium | Health check errors could echo `DATABASE_URL`/`REDIS_URL` passwords | **Fixed** — `sanitizeError()` in DB/Redis health |

### 4. Can duplicate orders be created?

| Severity | Finding | Status |
|----------|---------|--------|
| Medium | Pending BUY check + signal dedup in `entryEngine` | OK |
| Medium | TOCTOU race on concurrent entry jobs | Accepted — mitigated by BullMQ idempotency locks |
| High | No pending SELL dedup; concurrent exits could stack sells | **Fixed** — `findPendingSellByTokenId` guard |
| Medium | Live signal dedup only checks `PaperOrder` | Open — document for live operators |
| Medium | `paper:run` bypasses entry idempotency (manual path) | Accepted — debug/manual CLI |

### 5. Can risk limits be bypassed?

| Severity | Finding | Status |
|----------|---------|--------|
| Low | All execution engines call `riskEngine.checkOrder` before placement | OK |
| Medium | Exit sells passed `dataUpdatedAt: new Date()`, bypassing stale check | **Fixed** — uses `outcome.updatedAt` |
| Medium | `riskForced` path uses daily PnL only, not full risk engine | Accepted — sell still passes execution risk |
| Low | Omitted `dataUpdatedAt` skips stale check entirely | Documented — callers must pass timestamp |

### 6. Can a malformed market crash the bot?

| Severity | Finding | Status |
|----------|---------|--------|
| Low | Per-market try/catch in scanner loop | OK |
| Medium | Single page fetch failure aborted entire scan | **Fixed** — skip page and continue |
| Low | Invalid order book levels may produce NaN | Open — monitor via tests |
| Low | Debug ingest calls to `localhost:7674` in scanner | Noise only, non-fatal |

### 7. Can stale price data trigger bad trades?

| Severity | Finding | Status |
|----------|---------|--------|
| Medium | Entry uses `outcome.updatedAt` for stale check | OK |
| Medium | Exit stale bypass | **Fixed** |
| Low | WS price cache freshness not enforced on exit triggers | Open — `ws:monitor` is paper-only |

### 8. Are position sizes calculated correctly?

| Severity | Finding | Status |
|----------|---------|--------|
| Low | Risk engine caps: daily spend, exposure, theme, position size | OK |
| Low | `roundDownShares` prevents fractional overshoot | OK |
| Medium | Live mode previously used paper cash for sizing gate | **Fixed** — cash check paper-only |

### 9. Are partial exits idempotent?

| Severity | Finding | Status |
|----------|---------|--------|
| Critical | `soldAt5x/10x/25x` persisted before fill success | **Fixed** — flags set only after filled sell |
| Medium | Concurrent exit evaluations could race | Partially mitigated by pending-SELL guard |
| Low | Reconstructed exit state resets milestone flags | Open — requires DB `exitState` integrity |

### 10. Is paper mode realistic enough?

| Severity | Finding | Status |
|----------|---------|--------|
| Medium | Fill role estimated from order book at fill time | OK |
| Medium | Cash reservation uses conservative taker assumption for BUY | **Fixed** |
| Low | Paper vs backtest entry fee role differs (`mixed` = maker in backtest) | Documented — intentional divergence |

### 11. Is dry_run mode truly no-order?

| Severity | Finding | Status |
|----------|---------|--------|
| Low | `dryRunExecutionEngine` returns `status: "logged"`, never calls CLOB | OK |
| Low | Verified by `executionEngine.test.ts` | OK |

### 12. Is TRADING_MODE=live protected by explicit confirmation?

| Severity | Finding | Status |
|----------|---------|--------|
| Low | `assertLiveOrderPlacementAllowed` requires exact phrase | OK |
| Info | Cancellations use `assertLiveTradingEnabled` only (no confirmation) | Intentional |
| Info | CLOB init/read allowed without confirmation | By design |

## Fee Verification

| Check | Status |
|-------|--------|
| Paper PnL includes fees (net cash, cost basis) | OK |
| Backtest PnL includes fees on fills | OK |
| Backtest entry cash check includes fees | **Fixed** |
| Fee-free markets return zero fees | OK |
| Maker orders: zero platform fee when `takerOnly=true` | OK |
| Taker exits charged via formula or `takerBaseFeeBps` | **Improved** — honors bps when `feeRate=0` |
| Cash balance reserves fees (conservative taker on BUY) | **Fixed** |
| Reports separate gross vs net PnL | **Fixed** in paper engine |
| `feeExponent` not applied to formula | **Known limitation** — document only |

## Fixes Applied (This Pass)

1. Paper-mode guards on `entry:paper`, `exit:paper`, `ws:monitor`
2. Live-mode startup warning in CLI
3. Exit milestone flags persisted only after successful fill
4. Pending SELL deduplication
5. Exit stale-data uses `outcome.updatedAt`
6. Paper BUY cash check uses conservative taker fee estimate
7. Entry cash check gated to paper mode only
8. Backtest entry cash check fee-aware
9. Gross vs net PnL separation in paper engine
10. `takerBaseFeeBps` honored when `feeRate=0`
11. Pino log redaction + `sanitizeError()` helper
12. Scanner page-level error resilience

## Accepted Risks / Follow-Up

- Live cancellations without confirmation phrase (documented in LIVE_TRADING_CHECKLIST.md)
- `paper:run` manual path without entry dedup guards
- Live signal dedup does not check `LiveOrder`
- `feeExponent` from CLOB not applied to platform fee formula
- Paper vs backtest entry liquidity role policy differs

## Verification Commands

```bash
pnpm typecheck && pnpm lint && pnpm test
pnpm report
pnpm backtest --start 2025-01-01 --end 2025-06-01 --fee-mode mixed
```
