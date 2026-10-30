# Contract rounding, fill risk and loss-control reference

Generated: 2026-10-30T16:27:46.738Z

Status: PAPER_REFERENCE_FIXTURES_PASS_LIVE_VENUE_FILTERS_AND_PERSONAL_LOCKS_UNCONFIRMED. This is an offline paper/reference model; it is not connected to a trading account.

## What is implemented

- Explicit linear base-quantity and inverse fixed-quote-face PnL models.
- Decimal-grid rounding for entry, stop, target and quantity using venue filter origins; post-rounding direction, limit/market lot, minimum entry/protective-exit notional and risk checks.
- All-in stop-loss sizing includes explicit per-side fee rates, adverse entry/stop slippage and a required funding reserve. It rejects missing assumptions, over-budget minimum orders, invalid levels and risk above the user-reported $1 cap.
- Paper ledger tracks partial fills, weighted entry, per-fill fees, realized and open marked PnL, signed funding, marked equity and protection coverage; rejects over-close without ledger mutation.
- Parameterized daily and drawdown entry locks preserve protective orders, reject new entries when latched, and record pending-entry cancel requests without dropping identity. UTC reset uses the boundary mark; drawdown requires an explicit flat/no-pending reset.
- No time exit or signal change was added. Personal daily/drawdown values remain null and therefore disabled.

## Results and unresolved inputs

- Synthetic deterministic fixtures: 22/22 pass. Fixture filter values are test data only.
- Live Binance BTCUSDT filter snapshot: not captured. The official public exchangeInfo endpoint returned HTTP 451 from this environment. The capture script is included and writes a snapshot only after validating a successful live response.
- Account maker/taker fees, user fills, historical slippage/spread and funding reserve remain unavailable. Sizing is blocked unless fees, slippage and funding reserve are explicitly supplied.
- Personal daily-loss/drawdown limits remain unset by user instruction. The generic fixture thresholds are synthetic test inputs, not suggested personal limits.
- The $1 stop budget is an intended model cap. A gap, liquidation, exchange failure or fill race can exceed it; existing protection is kept and no unverified flatten order is invented.
- TakeProfit strategy API exposes strategy cash, position information and instrument min order size/value. It does not document account equity, daily realized PnL, peak equity, exact BTCUSDT tick/lot filters or user margin tier as script fields.

## Issue #8 acceptance state

- Reference rounding and post-rounding risk eligibility: fixture-verified with synthetic venue filters; current venue rules are still unverified.
- Fill reconciliation: paper ledger behavior is fixture-verified; no user/exchange fill records were supplied.
- Daily/drawdown policy: generic lock and reset behavior is fixture-verified; the user deliberately left personal thresholds unset, so account locks are disabled.
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
| daily_lock_open_loss_pending_cancel_protection_and_utc_reset | PASS |
| utc_rollover_baseline_includes_new_mark | PASS |
| drawdown_lock_latches_until_explicit_flat_reset | PASS |
| partial_fill_after_cancel_request_is_tracked_and_protected | PASS |
| latched_lock_rejects_new_pending_entry | PASS |
| entry_increment_without_protection_is_reported | PASS |
| overclose_rejected_without_mutating_ledger | PASS |
| gap_through_stop_exposes_budget_limit_and_locks_entries | PASS |
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

The reference rounding, fill, equity and lock behavior is testable and the synthetic fixtures pass. Issue #8 cannot be fully closed yet: current Binance filters, account fill/cost data, and user-approved personal daily/drawdown thresholds are absent. Keep the live risk/venue items open; do not enable live sizing from these fixtures.
