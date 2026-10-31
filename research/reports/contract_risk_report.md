# Contract rounding, fill risk and loss-control reference

Generated: 2026-10-31T04:35:11.097Z

Status: PAPER_REFERENCE_FIXTURES_PASS_LIVE_VENUE_UNCONFIRMED_PERSONAL_LOCKS_DISABLED_BY_USER_CHOICE. This is an offline paper/reference model; it is not connected to a trading account.

## What is implemented

- Explicit linear base-quantity and inverse fixed-quote-face PnL models.
- Decimal-grid rounding for entry, stop, target and quantity using venue filter origins; post-rounding direction, limit/market lot, minimum entry/protective-exit notional and risk checks.
- All-in stop-loss sizing includes explicit per-side fee rates, adverse entry/stop slippage and a required funding reserve. It rejects missing assumptions, over-budget minimum orders, invalid levels and risk above the user-reported $1 cap.
- Paper ledger tracks partial fills, weighted entry, per-fill fees, realized and open marked PnL, signed funding, marked equity and protection coverage; rejects over-close without ledger mutation.
- Open-risk reconciliation uses supplied fills and fees, partial exits, funding, current marked equity, planned size, a stressed stop fill and current protection coverage. It reports over-budget, unprotected and over-plan positions.
- Optional per-trade loss locks latch on a marked or realized all-in loss breach, retain protection and require an explicit flat/no-pending reset. Daily/drawdown locks remain separately configurable.
- Parameterized daily and drawdown entry locks preserve protective orders, reject new entries when latched, and record pending-entry cancel requests without dropping identity. UTC reset uses the boundary mark; drawdown requires an explicit flat/no-pending reset.
- No time exit or signal change was added. Personal daily/drawdown values remain null and therefore disabled.

## Results and unresolved inputs

- Synthetic deterministic fixtures: 24/24 pass. Fixture filter values are test data only.
- Binance BTCUSDT metadata was captured from the official public exchangeInfo endpoint at 2026-10-31T04:33:14.976Z. The exchangeInfo response and subsequent /time reference were -0.295 seconds apart, within the 300-second gate. The snapshot records the dynamic PERCENT_PRICE filter; the native adapter does not enforce that reference-price-based filter. This is the Binance research proxy only.
- TakeProfit diagnostic backtest: 5m produced 0 trades; 15m produced 1 simulated short, stopped for -$0.3649 net with $0.0803 commission. Both bounded windows are flagged history-insufficient. The single 15m entry and stop share a timestamp, so intrabar execution is unresolved. See `research/reports/p1_native_risk_backtest_summary.json`; these are simulator fills, not exchange fills or profitability evidence.
- Account maker/taker fees, user fills, historical slippage/spread and funding reserve remain unavailable. Sizing is blocked unless fees, slippage and funding reserve are explicitly supplied. Reconciliation fixtures use synthetic fills and costs only.
- Personal daily-loss/drawdown limits remain intentionally disabled by the user. Generic fixture thresholds test control behavior only; they are not personal limits, and no personal lock is active.
- The $1 stop budget is an intended model cap. A gap, liquidation, exchange failure or fill race can exceed it; existing protection is kept and no unverified flatten order is invented.
- TakeProfit documents `self.info.tick_size` and `self.info.price_precision` through `Context.info` (inherited by `MainStrategyContext`) and exposes strategy min order size/value. The native adapter uses chart tick data plus configured Binance research-proxy quantity filters; the chart context does not expose Binance LOT_SIZE or MARKET_LOT_SIZE automatically. Account fees, marked account equity, daily PnL, peak equity and user margin tier remain unavailable as documented script fields.

## Issue #8 acceptance state

- Reference rounding and post-rounding risk eligibility: fixture-verified with synthetic filters; current Binance research-proxy filters were captured, but actual execution venue rules remain unconfirmed.
- Supplied-fill reconciliation: fixture-verified for partial fills, fees, funding, marked equity, stressed stop loss, planned size and protective coverage; user/exchange fill records remain absent.
- Native execution adapter: source now uses the chart tick size, conservative directional price rounding, a configurable common quantity step, captured minimum quantity/notional and market maximum defaults, and post-rounding risk sizing capped at the user-confirmed $1 research budget. The exact local source compiled and passed runtime_quick on a disposable TakeProfit copy (5,000 bars). The 5m/15m bounded backtest emitted no 5m trades and one losing 15m simulator trade; both history windows are insufficient. The dynamic PERCENT_PRICE filter is not implemented by the native adapter. Keep it research-only.
- Daily/drawdown policy: the user-approved choice to leave personal thresholds unset is recorded; generic lock and reset behavior is fixture-verified, while personal account locks remain disabled.
- Holding policy: TP/SL-only with no maximum hold is recorded as BTC-PERP-EXIT-TP-SL-ONLY-1; changes require a separate experiment.
- Profitability: not evaluated by these engineering fixtures.

## Fixture coverage

| Fixture | Result |
|---|---|
| linear_long_rounding_directions | PASS |
| linear_short_rounding_directions | PASS |
| nonzero_filter_origins_and_common_limit_market_lot_grid | PASS |
| minimum_quantity_rejected_not_rounded_up | PASS |
| minimum_entry_notional_rejected_with_false_status | PASS |
| protective_exit_minimum_notional_rejected | PASS |
| size_recomputed_after_rounding_and_all_in_costs | PASS |
| short_size_recomputed_after_rounding_and_all_in_costs | PASS |
| minimum_order_over_budget_rejected | PASS |
| inverse_contract_formula_explicit | PASS |
| partial_fills_fees_funding_marked_equity_and_protection | PASS |
| reconcile_partial_fills_fees_funding_mark_and_protection | PASS |
| actual_partial_fill_stop_stress_detects_over_budget_exposure | PASS |
| daily_lock_open_loss_pending_cancel_protection_and_utc_reset | PASS |
| utc_rollover_baseline_includes_new_mark | PASS |
| drawdown_lock_latches_until_explicit_flat_reset | PASS |
| partial_fill_after_cancel_request_is_tracked_and_protected | PASS |
| latched_lock_rejects_new_pending_entry | PASS |
| entry_increment_without_protection_is_reported | PASS |
| overclose_rejected_without_mutating_ledger | PASS |
| gap_through_stop_exposes_budget_locks_entries_and_preserves_protection | PASS |
| missing_funding_reserve_blocks_risk_sizing | PASS |
| missing_account_fees_or_slippage_blocks_risk_sizing | PASS |
| wrong_side_protective_level_rejected | PASS |

## Reproduce

```powershell
node research/risk_controls_reference.mjs
node research/capture_binance_contract_snapshot.mjs
```

The capture command requires access to the public Binance USD-M exchangeInfo endpoint. It never uses account credentials and refuses to write a partial or synthetic snapshot.

## Decision

The reference rounding, supplied-fill reconciliation, equity and lock behavior is fixture-verified. A fresh Binance research-proxy snapshot is captured, and the native grid adapter compiles, runs and places a simulated 15m order on an ephemeral copy. Issue #8 cannot be fully closed yet: the adapter does not check the dynamic PERCENT_PRICE filter, the only bounded 15m sample is one loss with same-bar ambiguity, and account fills, fees, spread, slippage and funding remain unobserved. The execution venue is not confirmed. The user-approved choice to keep personal daily/drawdown locks disabled is recorded; do not present those controls as active protection. Do not enable live sizing from simulator fills or unconfirmed account settings.
