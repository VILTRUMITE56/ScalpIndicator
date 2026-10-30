# Implementation plan: a reliable BTC perpetual scalping indicator

Prepared 30 October 2026. The first B0 lifecycle corrections are implemented in local sources and TakeProfit working copies. Strategy working copy v16 and indicator working copy v24 compile; the indicator also passed runtime_quick on 5,000 bars. The latest saved private indicator version is v19, while v24 is unsaved because it is based on v16. Strategy v16 backtests through 30 October returned no completed trades and insufficient-history flags. Dashboard counts show the cost gate rejects most visible trigger candidates. No thresholds changed. See the [implementation status](CURRENT_ASSESSMENT.md), [diagnostic report](BACKTEST_DIAGNOSTIC_REPORT.md), and [full snapshots](../results/v4/backtests.json).

The [planned experiment registry](../research/ENHANCEMENT_EXPERIMENTS.json) records the current source hashes, profiles, hypotheses, starting parameters, and trial limits in machine-readable form. Its entries are proposals, not executed results.

The aim is an understandable indicator with reproducible LONG/SHORT candidates and usable entry, SL, and TP information, supported by a strategy that has positive expectancy after realistic costs. No addition below is assumed to improve profitability. Implement the engineering foundation first, then select trading features from evidence.

The current code implements only the first signal lifecycle slice: actual EMA20 candle intersection, source-bar age, touch-time ATR and fixed invalidation, recovery before rearming, trigger-bar invalidation checks, conservative closed-candle model outcomes, sizing and protection from the worst permitted entry limit, and separate setup/blocker counts in the chart panel. This does not complete M0-M2: the independent event ledger, live/reload replay, deterministic execution cases, and candidate parity are still outstanding. ADX, VWAP, relative volume, entry-extension, and breakout/retest variants have not been added to the trading gates.

## 1. Freeze the starting point and define the event contract

Archive source hashes for strategy working copy 14 and indicator working copy 19/platform version 13, plus retained results and assumptions. Call this archived reference A0. It is not the candidate to deploy. Keep previous trials visible when registering new research.

Use one local source definition to generate the common Indie calculation/state block into both scripts. Prefer generation to an unverified runtime import across private scripts. Compare generated candidate events against an independently written reference calculation; identical generated code alone cannot reveal a shared conceptual bug.

Proposed files:

| Deliverable | Purpose |
| --- | --- |
| `research/specs/baseline.json` | Versioned lifecycle, parameters, time conventions, cost and order assumptions |
| `research/templates/signal_core.indie.inc` and `research/generate_indie.py` | Shared block and deterministic generation of the two existing Indie files |
| `research/reference/` | Independent feature calculations, event-driven evaluation, cash/equity and fill ledger |
| `research/data/manifest.json` | Venue, contract, files, checksums, units, gaps, first/last timestamps, and data availability |
| `tests/fixtures/` | Small deterministic lifecycle, timing, resampling, and execution scenarios |
| `results/<run_id>/` | Full request/response, sources, candidates, orders, fills, costs, equity, coverage, and summary |

Candidate identity must use venue, contract, timeframe, side, touch/breakout UTC timestamp, trigger UTC timestamp, and rule version. Do not use chart bar index as a durable identity. Separate setup identity from trigger identity and execution order identity.

Each event records data readiness, all feature values available at the decision, setup state, fixed invalidation, trigger time, decision time, entry reference, stop, target, risk distance, estimated cost/R, and every applicable blocker. Execution events add submission, acceptance, cancellation request/acknowledgment, fills, position transitions, fees, and exits. A signal candidate exists before portfolio/execution gates; a chart marker does not prove a fill.

## 2. Implement the corrected baseline B0 before optional features

This is a specified behavioral revision, not a promise to preserve every A0 trade. The old rolling touch detector and detection-based expiry are ambiguous; archive them and measure the effects of the replacement separately from new indicators.

Let `t` be the last completed execution candle. In Indie on the first update of the next candle, it is normally `[1]`. Retain completed 15m bias for 5m execution, completed 1h bias for 15m execution, EMA(20/50), ATR(14), and a 1.5R target. Verify the HTF EMA seed and exact UTC bucket membership with independent resampling.

For a long setup, with a mirrored definition for shorts:

1. **Ready:** require valid data and long HTF bias. After any termination, require a later completed recovery close above EMA20 before accepting a subsequent touch. A recovery and new touch must occur on different candles.
2. **Touch:** the first later candle `u` must actually intersect EMA20: `low[u] <= EMA20[u] <= high[u]`. Its close and the preceding two closes must be above their EMA50 values. Missing history is not eligible.
3. **Store:** fix `touch_time=u`, `setup_ATR=ATR[u]`, and the structural low from at most the last three completed candles ending at u, clipped to the current recovery episode. Store the exact anchor interval. Freeze invalidation at `structural_low - 0.10 * setup_ATR` and the structural stop reference at `structural_low - 0.15 * setup_ATR`.
4. **Expire/invalidate first:** permit trigger candles u+1 through u+6. Expire before evaluating u+7. On every step, reject a broken fixed invalidation, close at/below EMA50, HTF bias failure, or data gap before evaluating a trigger. No arming-and-trigger shortcut on u.
5. **Trigger:** completed close above EMA20 and EMA50, above that candle's open, and above the previous completed candle's high. Emit at most one candidate per setup; consume it even when execution is blocked, with the reason recorded.
6. **Entry/risk:** use the observed decision reference as a quote, not a fill. Preserve the existing ATR floor, 2.5 ATR stop cap, 0.20 cost/R gate, and 0.25% research risk budget until costs are verified. Calculate permissible size from the worst entry allowed by the limit plus rounding/fees. Reconcile actual fill risk. A wrong-side protective level or invalid minimum order rejects the order.

An entry gap that invalidates the setup or exceeds the defined risk budget must reject execution. Do not silently move protection farther away to recover eligibility. A loss or drawdown entry lock must leave existing protection working.

For chart outcomes, retain immutable planned levels and distinguish `CANDIDATE`, `ASSUMED OPEN`, `OBSERVED FILL`, `MODEL TP/SL`, and `AMBIGUOUS`. The standalone indicator ordinarily has no observed fill data. Candle-only outcomes commit after close using the declared ambiguity policy; a tick-path outcome is a distinct observation and cannot be reconstructed from OHLC alone. A candidate emitted at the next bar's first update must not use that bar's eventual high, low, close, or full volume.

## 3. Instrument rejection and execution before optimization

Record eligible hours after warmup, missing buckets, touches, armed setups, invalidations, expiry, triggers, optional-filter rejects, stop/cost/size blocks, active-position/cooldown blocks, submitted orders, canceled/unfilled orders, fills, and exits. Report counts by long/short, profile, UTC block, and volatility bucket. Counts of bars and counts of candidates need separate denominators.

For every completed trade, retain initial risk, realized reward/R, maximum adverse/favorable excursion, time to target/stop, holding duration, funding events, entry delay, and slippage. This distinguishes poor entries from poor exits or expensive execution. Preserve exit-bar levels even when entry and exit share a candle.

Implement a simulated equity and fee ledger in the reference engine. For native risk controls, first probe `Trading.cash`, position size/price, and available order fields during entry, partial fill, mark changes, close, and commission charging. The inspected documentation does not establish a direct equity or daily-P&L series. Do not label a cash proxy as equity. Planned entry locks are 4R daily net loss with daily R fixed at 0.25% of start-day equity, and 8% drawdown from peak equity; their reset and open-loss treatment must be documented and tested.

Keep timed exits out of the native baseline until a verified position-reducing close cannot reverse or increase exposure when a bracket fills first. Do not repeat the previously defective ordinary opposite-order close. First measure duration and target attainment; only then register a separate time-exit experiment with safe cancellation/acknowledgment and protection handling. [TakeProfit order mechanics](https://takeprofit.com/docs/indie/Strategies/Orders).

## 4. Establish a usable data and cost foundation

Use BTCUSDT USD-M perpetual history on the chosen research venue, initially Binance to match the current chart. This does not select the user's eventual execution venue. Request 18-24 complete months where available, and reject any claim of adequate coverage until the files are checked. Include at least 250 complete HTF bars before each scored window, plus feature warmup. Resample 5m, 15m, and 1h from the same verified one-minute feed.

The public futures archive provides candles, trades, checksums, and taker-volume fields; use the futures namespace and verify timestamp units from samples. Do not apply the spot microsecond convention blindly to futures. One-minute candles still leave some intrabar paths ambiguous. [Binance public data](https://github.com/binance/binance-public-data).

Keep market, mark, and index prices distinct. Obtain actual funding timestamps/rates rather than assuming every position avoids funding or every contract uses an immutable eight-hour schedule. Snapshot contract filters; use price tick and quantity step rules rather than decimal display precision. [Binance futures market-data reference](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data).

Define cost components separately: entry fee, exit fee, effective spread, adverse slippage, and funding. Avoid counting spread twice when using bid/ask executions. Until measured, label 10/15/20 bp round-trip scenarios as hypothetical total execution costs and include funding separately. Stress measured adverse spread/slippage at 1.5x and 2x while preserving fees. Unknown historical spread is an explicit limitation, not zero.

Archive full raw native reports and every page of the trade/order ledger before temporary instance IDs expire. Reconcile requested and actual candle bounds, in-window orders, warmup trades, and positions crossing the end date. Exclude trades crossing validation boundaries or use a preregistered close-and-charge convention. Report open marked equity, not only closed P&L. Do not pool incomparable native and external execution results.

## 5. Define the initial research features

All thresholds below are proposed experiment settings, not recommended live settings. Evaluate each on closed data; compute stateful algorithms on every bar even if the trading gate is off. Missing feature data blocks that variant and is counted separately.

| Variant | Change relative to B0 | Exact first experiment |
| --- | --- | --- |
| B0 | Corrected EMA pullback baseline | Rules above; target 1.5R; all optional filters off |
| B1 | Trend strength | Execution-timeframe ADX(14,14) at t >= 20. Keep EMA bias for direction. No additional DI or rising-ADX condition in this trial. |
| B2 | Intraday price location | Long close[t] > daily VWAP[t]; short close[t] < VWAP[t]. Use HLC3 and source-exchange volume, reset at 00:00 UTC, and require six completed candles in the same anchor period. |
| B3 | Relative participation | `RVOL[t] = volume[t] / mean(volume[t-20:t-1]) >= 1.2`. Require 20 valid preceding bars and positive denominator. Do not use a forming candle's volume. |
| B4 | Avoid extended entries | `side * (close[t] - EMA20[t]) / ATR[t] <= 1.0`, with side +1/-1. Existing directional trigger supplies the positive-side condition. |
| B5 | Different entry family: breakout/retest | Replace the EMA-touch/recovery entry with the definition below, retain the HTF direction and common execution/risk/cost rules. |

For B2, do not accidentally compare a new UTC day's entry with a prior day's finished VWAP and call it the current day's value. The six-bar readiness rule is an explicit restriction to measure. Verify the built-in anchor behavior/casing with a UTC-midnight fixture; if it does not match, implement the specified UTC accumulator and compare it independently. The TakeProfit reference's prose, example, and embedded source differ on the day/session anchor. [Algorithm reference](https://takeprofit.com/docs/indie/Library-reference/package-indie-algorithms).

For B5 long: on completed candle b, close must break above the highest high of the preceding 20 candles, excluding b, with long HTF bias. Freeze that level L and ATR[b]. Accept the first later candle r in b+1 through b+3 with low within `[L - 0.10*ATR[b], L + 0.10*ATR[b]]`, a close above L, and a bullish body. A breach below the lower boundary before acceptance invalidates the setup. A same-bar breakout/retest is not accepted. Short rules mirror these. Anchor protection to the retest extreme plus the defined 0.15 ATR[r] buffer, then apply the common ATR floor/cap and cost rules. Retain one position, no pyramiding, fixed 1.5R target, and entry-order reconciliation.

RSI, MACD, Stochastic, Supertrend, Bollinger mean reversion/squeeze, room-to-target filters, and order-flow features are deferred. They are not extra hidden votes in B0-B5. Register a new experiment before adding any of them.

## 6. Bound the search and evaluate honestly

This replaces earlier unexecuted candidate grids. Every prior attempted strategy version remains in the trial history.

| Stage | Maximum new configurations | Rule |
| --- | ---: | --- |
| A: B0-B5 on 5m and 15m | 12 | Fixed definitions; compare each with the same profile's B0 on the same scored dates/costs |
| B: one combined candidate per profile | 2 | At most two additions from B1-B4, only with separate positive development evidence. No enumeration of all combinations. |
| C: target comparison on one selected entry per profile | 4 | Add 1.2R and 2R to the existing 1.5R case. Do not optimize stops or time exits simultaneously. |
| D: declared local sensitivity checks | 4 | At most two neighboring settings per profile for one selected parameter. Report degradation; do not substitute a lucky neighbor as the final winner. |
| Total maximum | 22 | Conditional stages can stop early; no profitable configuration is also a valid outcome |

Each fee/stress scenario, fold, and neighbor receives its own run ID. Neighbor selection must be frozen before viewing those results. All failed variants and all rule changes count. If the budget is exhausted, write a new research proposal and preserve the failed results before expanding it.

Use chronological folds, initially nine months for development followed by three months for evaluation, rolling forward where coverage permits. Treat previously inspected September/October 2026 windows as development evidence. Do not relabel them as an untouched holdout. Reserve a demonstrably unseen final period before opening it; if that is unavailable, use a prospective period beginning after code and parameters are locked. Scored bars must have adequate earlier warmup, but warmup trades do not contribute P&L.

Report net expectancy in cash and initial-risk R, profit factor, equity drawdown including open positions, number of trades, exposure, opportunities/fills, holding durations, direction results, and period stability. Use paired day/week block resampling for baseline-versus-variant differences and disclose sample uncertainty. A filter that removes nearly everything or improves win rate while reducing net expectancy is not a successful enhancement. Record a cost break-even estimate and the observed distribution of cost/R.

Screening targets inherited from the project are positive net expectancy with a positive lower uncertainty bound when estimable, PF >= 1.25, drawdown <= 8% at 0.25% intended risk, and positive expectancy under doubled adverse spread/slippage. Seek about 300 out-of-sample completed trades with adequate coverage for any timeframe/direction claim. These are gates to investigate, not profit promises or a reason to force activity. A sparse sample remains inconclusive. Do not pool the two timeframes to conceal a failing one. [Research on selection bias](https://www.davidhbailey.com/dhbpapers/backtest-prob.pdf).

Then require at least eight calendar weeks and 100 completed reconciled paper trades, whichever takes longer; extend the observation if coverage or sample requirements remain unmet. A clean historical result does not replace observed signal and fill reconciliation.

## 7. Make the indicator easier to use

Default compact view: instrument/profile, bias, persistent state/blocker, entry reference/SL/TP, stop distance in percent and R, target R, cost/R, and data readiness. An expandable research view holds feature values, candidate counts, rejection rates, coverage, and immutable event IDs. Persist blocker text until a new decision supersedes it.

Use optional thin EMA/VWAP lines, clear LONG/SHORT labels, bounded entry/SL/TP segments, and optional risk/reward shading. Stop extending a setup when it completes, but retain its levels and outcome on that candle. Show setup age as candles remaining and a UTC timestamp; bar-index IDs can remain internal diagnostics. An exit with unknown ordering says AMBIGUOUS. Display the selected entry family and rule version.

Expose stable numeric candidate/event outputs for future paper alerts, separate from price plots so zero-valued event flags do not distort chart scaling. Alert identity uses the candidate ID and event type; duplicate realtime updates must not resend it. This plan does not configure alerts or order automation.

Do not display an uncalibrated confidence percentage. Estimated break-even win rate is a payoff calculation and must remain labeled that way.

## 8. Acceptance checks and implementation order

| Milestone | Required evidence |
| --- | --- |
| M0: reproducible baseline | Source hashes, assumptions, trial registry, raw-report schema, actual coverage audit |
| M1: shared candidate engine | Same candidate IDs/levels from both generated scripts; independent reference agreement; explicit touch/expiry/invalidation rules |
| M2: realtime and execution correctness | Repeated updates, reload, timestamp gaps, invalidating trigger wicks, and same-bar outcomes covered; fill/cancel/bracket invariants hold |
| M3: data/cost/risk ledger | No unexplained coverage or accounting difference; tick/lot rounding and fees reconciled; funding and open equity accounted for; native risk-control limitations explicit |
| M4: controlled comparisons | All B0-B5 runs registered; complete metrics and uncertainty; optional combinations/exits only after their gates |
| M5: chart and paper parity | Compact/persistent panel, bounded levels, stable events, and reconciled forward log |

Essential deterministic cases: first touch plus invalidating recovery wick; six-bar expiry boundary; continuous touches and genuine recovery/rearm; mirror long/short behavior; duplicate tick; HTF midnight/bucket boundary; missing/duplicate candles; insufficient seed data; VWAP reset; zero/missing volume; trigger-excluded Donchian/RVOL windows; tick rounding; below-minimum quantity; partial fill followed by cancellation; late fill after cancel request; bracket exit and timer coincidence; gap through stop; target-then-stop and stop-then-target paths; daily-lock reset while protection is active; and final-window open exposure.

Use full-history versus truncated-history comparisons to detect future data use. Native compile and runtime checks are necessary but do not replace semantic fixtures or a live/reload observation. Verify visible outputs and actual eligible candidates, not only absence of runtime errors.

Recommended next implementation batch: finish M0-M2 with an independent event ledger, same-event parity between indicator and strategy, component-level stop rejection reasons, true rejection denominators, and chart reload/realtime review. Then complete M3 data, cost, and risk reconciliation, including verified venue cost inputs. Do not relax the 0.20R cost gate based only on the high rejection rate. Rebase and save the diagnostic v24 indicator edit onto private platform v19 before treating its stop-reason split as live. Start B0-B5 selection only after M3 produces a trustworthy reference. New feature gates remain disabled until that point.
