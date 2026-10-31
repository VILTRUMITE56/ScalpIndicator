# P1 indicator display and event outputs

This guide describes the display and telemetry in `indie/btc_pullback_indicator_p1.indie` and the separate order-eligibility diagnostics exported by `indie/btc_pullback_strategy_p1.indie`. The indicator now includes the optional, off-by-default B4 anti-chase filter. Its default-off state preserves the P1 baseline; enabling it changes indicator qualification only. The P1 strategy does not apply B4, so do not expect parity while the indicator setting is enabled.

## Chart display

The default is **Compact**. In indicator settings, turn on **Research diagnostics** to show the larger diagnostics panel. Higher-timeframe EMA lines are hidden by default; enable **Show higher-timeframe EMAs** to display them. This setting changes only plotting; the higher-timeframe bias calculation always runs.

Compact mode shows the ticker and supported profile (`5m to 15m` or `15m to 1h`), current readiness and higher-timeframe bias, the source of the most recent plan, entry quote/stop/target, stop distance, gross target R, assumed cost per initial risk, the last modeled outcome, and an execution-status reminder.

Research mode adds the durable candidate ID, last decision time in UTC, eligible history hours, trend/touch/trigger and invalidation counts, candidate rejection percentage and reasons, higher-timeframe rollover state, and the event-code maps. It also reports B4 state, B4 rejection count, the latest trigger's signed EMA20 distance in ATR, and the primary reason code.

## State labels

- `QUALIFIED` means the candidate passed the indicator's research gates and has a planned next-bar-open quote. The indicator did not submit an exchange order.
- `ASSUMED ENTRY` means the OHLC model treats the planned quote as filled. It is not an observed exchange fill.
- `MODEL TP | OHLC` and `MODEL SL | OHLC` are simulated barrier outcomes. `AMBIGUOUS | STOP-BOUND OHLC` means both barriers were touched in one candle and the model reports the stop-first bound.
- A completed plan can remain visible as `LATEST QUALIFIED PLAN`; it is historical context, not a fresh entry instruction. A rejected candidate is labeled `LATEST BLOCKED CANDIDATE`.
- There is no `ORDER SUBMITTED` or `OBSERVED FILL` state because this indicator has no order-routing or account-fill feed.

## Stable numeric outputs

The following plot IDs are separate numeric series. All use hidden display options, so they do not add chart lines, status-line values, or price labels.

| Plot ID | Meaning |
| --- | --- |
| `candidate_event_code` | `+1` qualified long, `-1` qualified short, `2` blocked by an active model, `3` blocked by cooldown, `4` rejected by a risk/extension gate, `0` no candidate event on this bar. |
| `candidate_side` | `+1` long or `-1` short for any triggered candidate, including rejected candidates. |
| `candidate_touch_utc_s` | UTC Unix seconds at the opening of the pullback-touch candle. |
| `candidate_trigger_utc_s` | UTC Unix seconds at the opening of the trigger candle. |
| `candidate_decision_utc_s` | UTC Unix seconds at the next-bar decision/quote candle. |
| `candidate_entry_quote` | Planned next-bar-open quote. It is not an observed fill. |
| `candidate_stop` / `candidate_target` | Planned barrier levels when the candidate has enough valid price data to calculate them. |
| `candidate_reason_code` | `1` accepted by the indicator, `10` invalid entry/setup ATR, `11` invalid stop, `12` stop beyond 2.5 ATR, `13` cost/R gate, `14` B4 extension gate, `20` active modeled position, `22` cooldown, `0` no event. |
| `candidate_entry_extension_atr` | Trigger close's signed distance from EMA20 divided by trigger ATR(14); positive values measure extension in the signal direction. Emitted for each triggered candidate, whether B4 is enabled or not. |
| `model_outcome_event_code` | `+1` modeled target, `-1` modeled stop, `2` ambiguous candle with stop-first bound, `0` no outcome event. |
| `model_outcome_utc_s` | UTC Unix seconds for the completed candle used to detect the modeled outcome. |

The durable ID is reconstructed as `exchange_code|ticker|execution_minutesm|side|touch_utc_s|trigger_utc_s|BTC-PERP-PULLBACK-P1`. IDs are based on the rule's instrument/time inputs rather than chart bar indexes.

## B4 anti-chase experiment

The indicator setting **B4 research: reject entries >1.0 ATR from EMA20** defaults to off. When enabled, a candidate is rejected only when its completed trigger close is more than 1.0 trigger-bar ATR(14) from EMA20 in the signal direction. Exactly 1.0 ATR passes. The threshold was registered before implementation; the filter has not been evaluated for net profitability and must not be presented as a proven edge. Keep it off for baseline comparison. The companion P1 strategy remains unchanged, so enabling B4 makes indicator and strategy candidates differ.

Candidate values appear on the event bar; non-event price/time series values are `NaN`. The outcome event is emitted when a completed candle is available, and its UTC field identifies that completed candle. A chart reload recomputes the event stream from the loaded history; the timestamp-derived IDs remain stable when the same bars and instrument metadata are present.

## Strategy execution outputs

The P1 strategy exposes three hidden numeric output series:

| Plot ID | Meaning |
| --- | --- |
| `execution_candidate_event_code` | `1` means the strategy evaluated a candidate on this calculation; `0` means no candidate event. This does not confirm order acceptance or a fill. |
| `execution_candidate_reason_code` | A reason from the map below. Code `2` means a submission request was issued by the script; it does not confirm that TakeProfit or an exchange accepted or filled it. |
| `execution_candidate_trigger_utc_s` | UTC Unix seconds at the trigger candle open, to join the execution decision to the indicator's stable candidate timestamps. |

Strategy reason codes: `10` invalid entry/ATR, `11` invalid stop, `12` stop beyond ATR cap, `13` candidate cost/R gate, `20` position already open, `21` pending/resolved order, `22` cooldown, `23` unavailable strategy cash, `24` invalid contract filters, `25` invalid rounded-level geometry, `26` quantity or protective notional below minimum, `27` above configured maximum quantity, `28` modeled all-in stop risk over budget, and `29` nonpositive calculated size. The full contract is in [`candidate_contract_p1.json`](../research/specs/candidate_contract_p1.json).

The risk check reserves the selected round-trip scenario once against modeled stop risk. TakeProfit separately books configured simulator commission on completed execution. At the base 15 bp assumption, the 10 bp commission reference is part of the 15 bp scenario; the extra 5 bp is a hypothetical risk reserve, not a second P&L debit. Funding remains separate.

## Verification boundary

The connected v29 working copy now matches this local source and passed compile, but its save was rejected because it is based on saved v16 while v19 is latest. Runtime validation for this B4 change has not been run. TakeProfit runtime validation does not export plotted event values. The account/chart UI has not been checked after a reload or duplicate live update; those platform checks remain required before closing GitHub issue #11.
