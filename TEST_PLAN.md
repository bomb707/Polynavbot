# Test Plan — Polynavbot Safety & Fees

## Automated Suite

Run before every release:

```bash
pnpm typecheck
pnpm lint
pnpm test
```

## Live Trading Guards

| Test | File | Assertion |
|------|------|-----------|
| Paper mode blocks CLOB placement | `clobClient.test.ts` | `createLimitBuyOrder` throws `LiveTradingDisabledError` |
| Live without confirmation blocks placement | `clobClient.test.ts` | Throws `LiveTradingNotConfirmedError` |
| Live with confirmation allows placement | `clobClient.test.ts` | Order placed when phrase set |
| Paper engine never calls CLOB | `executionEngine.test.ts` | CLOB mock not invoked |
| Dry run logs only | `executionEngine.test.ts` | `status: "logged"`, no CLOB |
| CLI paper commands reject live mode | `cliGuards.test.ts` | `entry:paper`, `exit:paper`, `ws:monitor` throw |

## Idempotency

| Test | File | Assertion |
|------|------|-----------|
| Pending BUY blocks duplicate entry | `entryEngine.test.ts` | Rejected at idempotency stage |
| Milestone flag not set on failed sell | `exitEngine.test.ts` | `soldAt5x` remains false when fill fails |
| Milestone flag set on successful sell | `exitEngine.test.ts` | `soldAt5x` true after fill |
| Duplicate 5x blocked when flag set | `exitEngine.test.ts` | No second partial exit |
| Pending SELL blocks duplicate exit | `exitEngine.test.ts` | No order placed when pending sell exists |

## Risk & Stale Data

| Test | File | Assertion |
|------|------|-----------|
| Risk rejection at order stage | `entryEngine.test.ts` | Daily spend limit collected |
| Spread/liquidity limits | `riskEngine.test.ts` | Various rejection paths |
| Exit uses outcome timestamp | `exitEngine.test.ts` | `dataUpdatedAt` not `new Date()` |

## Fee Scenarios

| Test | File | Assertion |
|------|------|-----------|
| Maker buy zero platform fee | `feeService.test.ts` | `platformFeeUsd = 0` |
| Taker buy formula | `feeService.test.ts` | Known price/shares result |
| Fee-free market | `feeService.test.ts` | All fees zero |
| Builder fee stacks | `feeService.test.ts` | Platform + builder |
| Backtest mixed mode | `feeMode.test.ts` | Entry fee 0, exit fee > 0 |
| Paper cash includes fees | `paperTradingEngine.test.ts` | Insufficient cash with fees message |
| Conservative taker cash reserve | `paperTradingEngine.test.ts` | BUY rejected when taker fees exceed cash |
| `takerBaseFeeBps`-only market | `feeService.test.ts` | Fee from bps when rate is 0 |

## Paper Trading

| Test | File | Assertion |
|------|------|-----------|
| BUY fill deducts cash | `paperTradingEngine.test.ts` | Cash decreases by fill cost |
| SELL realizes net PnL | `paperTradingEngine.test.ts` | Realized PnL updated |
| Partial fill | `paperTradingEngine.test.ts` | `PARTIALLY_FILLED` status |
| Passive cross fill | `paperTradingEngine.test.ts` | Fill on ask cross |

## Reports

| Test | File | Assertion |
|------|------|-----------|
| Gross/net PnL sections | `reportFormatter.test.ts` | Contains fee and PnL fields |
| Trade CSV fee columns | `reportWriter.test.ts` | CSV includes fee columns |
| Portfolio fee aggregates | `reportService.test.ts` | Snapshot builds with fee fields |

## Scanner Resilience

| Test | File | Assertion |
|------|------|-----------|
| Malformed market skipped | `marketScanner.test.ts` | Scan continues |
| Page fetch failure skipped | `marketScanner.test.ts` | Scan continues after page error |

## Backtest

| Test | File | Assertion |
|------|------|-----------|
| Engine runs end-to-end | `backtestEngine.test.ts` | Produces metrics |
| Metrics include fees | `metrics.test.ts` | `totalFeesPaidUsd`, `grossRoi` |

## Manual Smoke Tests

### Paper mode (default)

```bash
pnpm health
pnpm scan --max-pages 1
pnpm entry:paper --max-pages 1
pnpm exit:paper
pnpm report
```

### Dry run

```bash
TRADING_MODE=dry_run pnpm entry:paper --max-pages 1
# Expect "Dry run: would place limit order" in logs, no DB orders filled
```

### Live guard verification (no real orders)

```bash
TRADING_MODE=live PRIVATE_KEY=... pnpm entry:paper
# Expect: "entry:paper requires TRADING_MODE=paper"
```

### Backtest with fees

```bash
pnpm backtest --start 2025-01-01 --end 2025-06-01 --fee-mode mixed
```

## Regression Checklist

- [ ] `pnpm test` — all green
- [ ] `pnpm report` — gross/net PnL and fee sections present
- [ ] `entry:paper` fails in live mode
- [ ] `ws:monitor` fails in live mode
- [ ] Failed exit sell does not set `soldAt5x`
