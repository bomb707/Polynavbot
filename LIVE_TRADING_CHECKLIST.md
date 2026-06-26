# Live Trading Checklist

Use this checklist before enabling real Polymarket CLOB order placement. **Default mode is `paper` — live trading is opt-in and dangerous.**

## Pre-Flight: Environment

- [ ] `TRADING_MODE=live` (not `paper` or `dry_run`)
- [ ] `LIVE_TRADING_CONFIRMATION=I_UNDERSTAND_THE_RISKS` (exact phrase)
- [ ] `PRIVATE_KEY` set (signer wallet with funds)
- [ ] `DEPOSIT_WALLET_ADDRESS` set (funder/proxy address)
- [ ] `POLY_API_KEY`, `POLY_API_SECRET`, `POLY_API_PASSPHRASE` set
- [ ] `POLY_SIGNATURE_TYPE` matches your wallet setup
- [ ] Risk limits reviewed: `MAX_DAILY_SPEND_USD`, `MAX_DAILY_LOSS_USD`, `MAX_OPEN_EXPOSURE_USD`, `MAX_POSITION_SIZE_USD`
- [ ] `.env` file permissions restricted (`chmod 600 .env`)

## Pre-Flight: Validation

- [ ] Run `pnpm health` — PostgreSQL and Redis healthy
- [ ] Run `TRADING_MODE=dry_run pnpm entry:paper --max-pages 1` — verify intended orders in logs only
- [ ] Review `pnpm scan --max-pages 5` — markets look reasonable
- [ ] Confirm CLI startup shows live-mode warning
- [ ] **Do not use** `entry:paper`, `exit:paper`, or `ws:monitor` for live trading — these commands require `TRADING_MODE=paper`

## Commands: Safe vs Live

| Command | `TRADING_MODE=paper` | `TRADING_MODE=dry_run` | `TRADING_MODE=live` |
|---------|---------------------|------------------------|---------------------|
| `scan` | Safe | Safe | Safe (read-only) |
| `health` | Safe | Safe | Safe |
| `report` | Safe | Safe | Safe |
| `backtest` | Safe | Safe | Safe |
| `paper:run` | Paper sim | **Blocked** | **Blocked** |
| `entry:paper` | Paper sim | **Blocked** | **Blocked** |
| `exit:paper` | Paper sim | **Blocked** | **Blocked** |
| `ws:monitor` | Paper sim | **Blocked** | **Blocked** |
| `worker` / `scheduler` | Paper jobs | **Blocked** | **Blocked** |

> **Note:** There is no dedicated `entry:live` CLI. Live placement occurs only if you change execution wiring or call CLOB APIs directly. The CLOB client requires the confirmation phrase for `createAndPostOrder`.

## CLOB Operations vs Confirmation

| Operation | Requires confirmation phrase? |
|-----------|------------------------------|
| Place buy/sell order | **Yes** |
| Initialize CLOB client | No |
| Read open orders / trades | No |
| Cancel order(s) | No |

## Go-Live Steps

1. Complete all pre-flight checks above
2. Start with minimal `MAX_ORDER_SIZE_USD` and `MAX_DAILY_SPEND_USD`
3. Monitor logs for `Live order placed` / rejection reasons
4. Run `pnpm report` to verify PnL and fee tracking
5. Verify open orders on Polymarket UI match database state

## Post-Deploy Monitoring

- [ ] Watch log level — avoid `LOG_LEVEL=debug` in production (verbose WS/CLOB output)
- [ ] Check `reports/latest.md` for gross vs net PnL divergence
- [ ] Monitor daily spend and loss limits via risk rejection logs
- [ ] Sync trades after live sessions (`executionEngine.syncTrades`)

## Kill Switch / Rollback

1. Set `TRADING_MODE=paper` in `.env` and restart processes
2. Cancel open orders via Polymarket UI or CLOB cancel API
3. Review open positions in database: `pnpm report`
4. If needed, run `exit:paper` after reverting to paper mode for simulated exits

## Known Limitations (Live)

- On-chain wallet balance is not modeled in entry cash checks (paper balance check is paper-only)
- Live signal dedup does not link `LiveOrder` to `signalId`
- Fee reconciliation for live fills is estimated on orders, not reconciled on-chain
- `feeExponent` from CLOB is stored but not applied to fee formula (uses standard taker formula)

## Emergency Contacts / Resources

- Polymarket CLOB docs: https://docs.polymarket.com
- Review `SAFETY_REVIEW.md` for full audit findings
- Review `TEST_PLAN.md` before each release
