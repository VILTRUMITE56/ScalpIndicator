# P1 indicator display and event outputs

This guide describes the display and telemetry added to `indie/btc_pullback_indicator_p1.indie`. It changes presentation and exports only; the generated P1 candidate rules, planned stop/target rules and B0 baseline are unchanged.

## Chart display

The default is **Compact**. In indicator settings, turn on **Research diagnostics** to show the larger diagnostics panel.

Compact mode shows the ticker and supported profile (`5m to 15m` or `15m to 1h`), current readiness and higher-timeframe bias, the source of the most recent plan, entry quote/stop/target, stop distance, gross target R, assumed cost per initial risk, the last modeled outcome, and an execution-status reminder.

Research mode adds the durable candidate ID, last decision time in UTC, eligible history hours, trend/touch/trigger and invalidation counts, candidate rejection percentage and reasons, higher-timeframe rollover state, and the event-code maps.

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
| `candidate_event_code` | `+1` qualified long, `-1` qualified short, `2` blocked by an active model, `3` blocked by cooldown, `4` rejected by stop/cost gate, `0` no candidate event on this bar. |
| `candidate_side` | `+1` long or `-1` short for any triggered candidate, including rejected candidates. |
| `candidate_touch_utc_s` | UTC Unix seconds at the opening of the pullback-touch candle. |
| `candidate_trigger_utc_s` | UTC Unix seconds at the opening of the trigger candle. |
| `candidate_decision_utc_s` | UTC Unix seconds at the next-bar decision/quote candle. |
| `candidate_entry_quote` | Planned next-bar-open quote. It is not an observed fill. |
| `candidate_stop` / `candidate_target` | Planned barrier levels when the candidate has enough valid price data to calculate them. |
| `model_outcome_event_code` | `+1` modeled target, `-1` modeled stop, `2` ambiguous candle with stop-first bound, `0` no outcome event. |
| `model_outcome_utc_s` | UTC Unix seconds for the completed candle used to detect the modeled outcome. |

The durable ID is reconstructed as `exchange_code|ticker|execution_minutesm|side|touch_utc_s|trigger_utc_s|BTC-PERP-PULLBACK-P1`. IDs are based on the rule's instrument/time inputs rather than chart bar indexes.

Candidate values appear on the event bar; non-event price/time series values are `NaN`. The outcome event is emitted when a completed candle is available, and its UTC field identifies that completed candle. A chart reload recomputes the event stream from the loaded history; the timestamp-derived IDs remain stable when the same bars and instrument metadata are present.

## Verification boundary

The revised source passed TakeProfit compile and `runtime_quick` validation on a disposable 5,000-bar working copy. The disposable copy was not saved or linked to the platform. TakeProfit runtime validation does not export plotted event values. The account/chart UI has not yet been checked after a reload or duplicate live update, and no screenshots are claimed here. Those platform checks remain required before closing GitHub issue #11.
