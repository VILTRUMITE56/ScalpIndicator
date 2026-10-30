# Order lifecycle and protective-exit validation

Contract: `BTC-PERP-ORDER-LIFECYCLE-P1`.

- Deterministic lifecycle fixtures passed: 12.
- Fixture events recorded: 88.
- Aligned lower-interval trade/mark bars replayed: 1,051,200 1m bars.
- Risk-pass candidate plans path-checked: 304 (5m and 15m).

## Deterministic fixture coverage

- `repeated_updates_and_reload`: 9 events; final position 0; submission_count=1; reload_suffix_equal=true.
- `delayed_ack_and_fill`: 8 events; final position 1; delayed_updates_before_ack=2; exposure_after_fill=1.
- `partial_fill_cancel_race_and_protected_exit`: 17 events; final position 0; max_exposure=0.6.
- `rejection`: 4 events; final position 0; exposure_after_rejection=0; bracket_after_rejection=false.
- `same_bar_entry_and_take_profit`: 6 events; final position 0; outcome=TARGET; entry_bar=30; exit_bar=30.
- `unfilled_expiry_and_cancel_ack`: 7 events; final position 0; exposure=0.
- `lower_interval_target_first`: 6 events; final position 0; outcome=TARGET; ambiguity_retained=false; conservative_bound=.
- `lower_interval_stop_first`: 6 events; final position 0; outcome=STOP; ambiguity_retained=false; conservative_bound=.
- `lower_interval_same_minute_ambiguous`: 6 events; final position 0; outcome=AMBIGUOUS; ambiguity_retained=true; conservative_bound=STOP_FIRST.
- `gap_through_stop`: 6 events; final position 0; outcome=GAP_STOP; hypothetical_fill=95; stop_price=98.
- `exit_cannot_reverse_or_increase`: 6 events; final position 0; invalid_overclose_rejected=true.
- `post_ack_late_fill_fails_closed`: 7 events; final position 0; post_ack_fill_rejected=true.

## Lower-interval conditional barrier paths

These paths assume a fill at each planned next-bar-open quote. They do not establish that the strategy limit order filled, and they are not realized trade results.

| Data source | Candidates | Target first | Stop first | Gap stop | Ambiguous within 1m | Open at data end |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| trade_1m | 304 | 118 | 186 | 0 | 0 | 0 |
| mark_1m | 304 | 116 | 187 | 1 | 0 | 0 |

The trade and mark streams are evaluated separately because trigger-price choice is an execution rule. A 1m candle touching both levels remains `AMBIGUOUS`; the event ledger separately carries the conservative stop-first bound. Minute ordering cannot reveal the tick sequence within that minute.

## Strategy changes and platform semantics

The P1 strategy now recognizes the documented active and terminal order statuses explicitly, keeps the entry guard active through cancel acknowledgment, and requests cancellation of an unfilled parent remainder after an observed partial protective reduction or flat transition. It also stamps the exit cooldown when `PARTIALLY_FILLED_CLOSED` resolves flat in the same bar, even if no calculation observed the transient open position. Unknown order states fail closed.

TakeProfit documents that strategy actions become effective on the next price update. Its backtesting emulator models TP/SL as position-level OCO brackets whose quantity follows current exposure. Live bracket handling belongs to the chosen exchange; Binance is still only the research proxy. A close/cancel sequence for timed exits has not been implemented, so timed exits remain deferred.

TakeProfit working-copy checks: strategy v21 compile/runtime_quick/runtime_full passed on 5,000 series items; indicator v28 compile/runtime_quick passed on 5,000 items. Indicator runtime_full returned an infrastructure response (`[wasm] Compilation is not finished yet, retry later`) and was not retried. The fixed 5m platform backtest returned zero trades/orders, insufficient history, and a last bar outside its requested window; it is not lifecycle evidence.

## Reproduction

```powershell
node research/generate_candidate_logic.mjs --check
node research/order_lifecycle_check.mjs
```

The first command checks generated indicator/strategy candidate-core parity. The second runs the deterministic lifecycle/accounting fixtures and regenerates both CSV ledgers and this report. TakeProfit compile/runtime/backtest results are recorded separately in `ORDER_LIFECYCLE_MANIFEST.json`.

## Limits

- No observed exchange fills are used. Planned entry quotes are not fills.
- The emulator safety findings do not establish Binance attached-order behavior or live stop execution.
- No profitability, win-rate, expectancy, or maximum-hold result is claimed.
