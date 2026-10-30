# BTC perpetual pullback: implementation and retained results

Date: 30 October 2026. These are implementation checks, not evidence of a profitable strategy.

**Current source update, 30 October 2026:** Strategy working copy v16 and indicator working copy v24 include the B0 lifecycle corrections described in [the current assessment](docs/CURRENT_ASSESSMENT.md). Both pass compile and `runtime_quick` validation on 5,000 candles. Indicator v24 is not saved to the private indicator: the working copy is based on platform v16 while the latest saved version is v19. Strategy v16 has diagnostic backtests on both timeframes, recorded below and in full in [results/v4/backtests.json](results/v4/backtests.json). No live/reload replay or candidate-parity audit has been run. The retained v14 results are historical and must not be attributed to v16.

**Audit correction, 30 October 2026:** The initial table reported `realized_pnl` under a net P&L heading and omitted open positions. Both sensitivity runs contain an exit race: the protective exit and an ordinary timed close both filled, opening an unintended long. These runs are invalid for evaluating the intended scalping strategy. See [the code review and v2 plan](docs/V2_REVIEW_AND_PLAN.md), the original snapshots in `results/v1/`, and the reproducible `research/audit_v1.mjs` ledger audit.

## Artifacts

- `indie/btc_pullback_strategy.indie`: TakeProfit working copy `6daa5166-bfc5-4960-8f84-e714a3b2aff2`, current script version 16. The current source passes compile and `runtime_quick` validation on 5,000 bars. Strategy saving is unsupported by the MCP endpoint, so it remains in the working copy and repository. The earlier v14 source also passed `runtime_quick` on 5,000 bars.
- `indie/btc_pullback_indicator.indie`: TakeProfit working copy `dd7d1e3f-a6db-4f3a-8a50-2b8f551e9db3`, diagnostic version 24. It compiles and passes `runtime_quick` on 5,000 candles. Its stop-rejection panel now separates invalid geometry from stops wider than 2.5 ATR. Latest saved private version is 19; saving v24 was rejected because the working copy is based on version 16, and TakeProfit refused to load v19 while the copy has unsaved edits. The panel change is not published to the saved private script.
- Both scripts now compute a completed UTC 15m EMA(20/50) bias on 5m execution charts and a completed UTC 1h EMA(20/50) bias on 15m charts. The indicator adds a chart-model state panel, assumed entry/SL/TP levels, and cumulative filter-stage bar counts. It does not read exchange fills or positions. No alerts or automation were created.

## Current strategy v16 diagnostic backtests

Both runs used Binance `BTC/USDT.P` (`CXBNF8`), $10,000 initial capital, 0.25% risk, 0.15% round-trip cost eligibility assumption, 0.05% commission per execution, 0.001 quantity step, and 1x leverage. Orders used market-price setting; intrabar order filter was `No Filter`.

| Chart | Requested window | Orders | Completed trades | Total P&L | Buy-and-hold over same window | History sufficient? |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| 5m | 10-26 Oct 2026 | 0 | 0 | $0.00 | -2.98% | No |
| 15m | 5 Sep-26 Oct 2026 | 1 canceled | 0 | $0.00 | +0.63% | No |

The only 15m order was a 0.029 BTC short limit at $80,988.69902, submitted 15 October 03:30 UTC and canceled at 04:00 UTC without a fill. With no closed trades, win rate, expectancy, and profit factor are undefined; zero P&L means the strategy stayed idle, not that it broke even while trading. Both reports set `is_history_depth_sufficient=false` and `has_more_items_on_the_left=true`. Account history-depth selectors were rejected, and requests beyond 5,060 bars were rejected. The windows are diagnostic and cannot support a profitability or accuracy claim.

The 0.15% cost input is used for eligibility/sizing. The strategy charges its configured commission, but these reports do not include historical spread, slippage, or funding cash flows. The full requests, metrics, orders, trade pages, and account-limit attempts are archived in [results/v3/backtests.json](results/v3/backtests.json).

## Updated-window rerun through 30 October

To include the latest chart data, strategy v16 was rerun through `2026-10-30T10:30:00Z`, with the same Binance symbol, risk, commission, cost, quantity, and fill assumptions. The starting dates were moved forward to stay within the account's 5,060-bar request limit.

| Chart | Requested window (UTC) | Orders | Filled trades | Strategy P&L | Buy-and-hold | History sufficient? |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| 5m | Oct 13 12:00–Oct 30 10:30 | 0 | 0 | $0.00 | -6.93% | No |
| 15m | Sep 9 12:00–Oct 30 10:30 | 1 canceled | 0 | $0.00 | -2.04% | No |

The 15m report again shows the 0.029 BTC short limit at $80,988.69902 on 15 October, canceled unfilled. Both reports end at 10:30 UTC on 30 October, set `is_history_depth_sufficient=false`, and report `has_more_items_on_the_left=true`. With no filled trades, strategy performance statistics remain undefined. These refreshed runs are in [results/v4/backtests.json](results/v4/backtests.json).

The user-provided 5m chart screenshot shows 1,666 completed higher-timeframe bars and dashboard counts of 3,502 trend bars, 254 pullback events, and 101 trigger candidates. It reports 0 accepted, 10 stop rejections, and 91 cost rejections. In that chart history, 90.1% of trigger candidates were rejected by the cost gate and 9.9% by the aggregated stop gate. This is an indicator chart-model diagnostic, not a strategy order/fill report, and its displayed history is not proven to match the exact requested backtest window. See the [diagnostic interpretation](docs/BACKTEST_DIAGNOSTIC_REPORT.md).

The follow-up dashboard edit keeps the total stop-reject count while adding separate counts for invalid stop geometry and stops over 2.5 ATR. It changes no signal rule or threshold. The update is validated in working copy v24 but was not saved to the private platform because of the stale-version conflict described below.

## Backtest setup

Symbol: `BTC/USDT.P` Binance perpetual, TakeProfit exchange code `CXBNF8`. Initial capital: $10,000. Test period requested: 1–15 October 2026 for 5m; 1 September–15 October 2026 for 15m. The platform denied an initial 5m request for 12,960 bars because only 5,060 were available under the account plan. Its reports include `is_history_depth_sufficient=false`; results have limited data coverage. No untouched holdout or walk-forward analysis has been completed.

Commission: 0.05% per execution, approximately 0.10% round trip, configured in the strategy. `cost_fraction` is a **signal and sizing assumption**, not an additional fee charged in the backtest. The base value of 0.15% per round trip includes a hypothetical allowance beyond the commission; the 0.05% sensitivity reduces this filter to less than the modeled 0.10% commission and is deliberately optimistic for trade selection. The backtest does not have historical bid/ask spread, independent slippage, or funding cash flows. Its profit and loss therefore cannot establish live net profitability.

| Chart | Bias EMA | Cost filter input | Closed trades | Win rate | Realized P&L | Profit factor | Commission | Max drawdown |
| ----- | -------- | ----------------- | ------------: | -------: | -----------: | ------------: | ---------: | -----------: |
| 5m    | 60/150   | 0.15% base        |             0 |      n/a |        $0.00 |           n/a |      $0.00 |           0% |
| 15m   | 80/200   | 0.15% base        |             3 |    33.3% |      -$24.98 |          0.14 |      $7.67 |        0.29% |
| 5m    | 60/150   | 0.05% sensitivity |            17 |    29.4% |     -$110.44 |          0.32 |    $107.46 |        3.07% |
| 15m   | 80/200   | 0.05% sensitivity |             5 |    20.0% |      -$55.81 |          0.36 |     $30.88 |        5.12% |

The values above are the original report fields, including closed-trade metrics from defective sensitivity runs. Full snapshot accounting is:

| Run             | Realized P&L | Open P&L | Total P&L | Final reported equity | Open exposure             |
| --------------- | -----------: | -------: | --------: | --------------------: | ------------------------- |
| 5m base         |        $0.00 |    $0.00 |     $0.00 |            $10,000.00 | None                      |
| 15m base        |      -$24.98 |    $0.00 |   -$24.98 |             $9,975.02 | None                      |
| 5m sensitivity  |     -$110.44 | -$162.63 |  -$273.07 |             $9,726.93 | Unintended 0.058 BTC long |
| 15m sensitivity |      -$55.81 | +$345.54 |  +$289.73 |            $10,289.73 | Unintended 0.077 BTC long |

In the 5m ledger, stop order 66 and time-exit order 67 both bought at 2026-10-08 05:20 UTC, closing short trade 17 and opening long trade 18. In the 15m ledger, take-profit order 15 and time-exit order 17 both bought at 2026-09-09 19:45 UTC, closing short trade 5 and opening long trade 6. The positive 15m total includes unintended exposure and is not evidence of a profitable scalping system.

All four runs were created on 30 October 2026 Manila time. TakeProfit's `last_bar_at` fields in the reports are later than the requested end dates, while the inspected trade timestamps fall inside the requested windows. This report preserves the requested windows and flags the inconsistent metadata for audit before deeper research.

Backtest instance IDs (temporary; the platform response includes expiry times): 5m base `d7bb8a67-146d-4d6b-94dc-a3a785fde814`; 15m base `553f1ea5-7f53-43e2-9ca8-442eacff770f`; 5m sensitivity `26ab213e-aab3-47ab-b6dd-b9cd61871100`; 15m sensitivity `e089da5d-2f8b-45d6-af84-9bd27f31d138`. Do not silently regenerate an expired run as though it were the original snapshot.

## Interpretation and next gate

The first section records v1 history: base 5m had no trades, base 15m had three losing trades, and both sensitivity runs had invalid overlapping exits. The corrected v3 results below also have no trades. No performance gate in `PROJECT_PLAN.md` has been passed, and there is no basis to publish a win-rate or profit claim.

The v1 exit race and marker-persistence issue have been addressed in code, and manual completed higher-timeframe bias is now implemented. The lifecycle still needs controlled fill/cancel tests; the current backtests did not place an order. Next, verify the higher-timeframe EMA values independently, use the indicator's filter counters to locate where setups disappear, and resolve history-window/report-timestamp inconsistencies. Then obtain a clean data window and venue cost assumptions before any candidate comparison or paper test. Do not tune the current limited window to make results positive.

## Corrected v3 implementation runs

The initial corrected strategy working copy v7 was backtested on Binance `BTC/USDT.P` with the attached SL/TP exits and no timer-based market close. Run snapshots and identifiers are recorded in [results/v2/backtests.json](results/v2/backtests.json).

| Chart |               Cost filter | Trades | Total P&L | History sufficient? |
| ----- | ------------------------: | -----: | --------: | ------------------- |
| 5m    | 0.15% round-trip estimate |      0 |     $0.00 | No                  |
| 15m   | 0.15% round-trip estimate |      0 |     $0.00 | No                  |
| 5m    | 0.10% fee-only diagnostic |      0 |     $0.00 | No                  |
| 15m   | 0.10% fee-only diagnostic |      0 |     $0.00 | No                  |

The 10 bp diagnostic matches modeled 5 bp-per-side commissions but excludes spread, slippage, and funding. Its purpose was to check whether the 15 bp eligibility filter alone caused inactivity; it did not. No performance metric can be estimated from zero trades. All six reports flag insufficient history, and their `last_bar_at` values fall after the requested end dates, so these reports are not a trustworthy profit evaluation.

After the screenshot showed zero completed higher-timeframe buckets on a recognized 5m chart, timestamp boundary detection was changed to integer bucket-ID transitions. Strategy v8 was re-run at the 15 bp assumption on both timeframes; both returned zero trades with insufficient history flags. A later screenshot showed the counter stuck at 1 because integer `MutSeries` values were being reset on every calculation. The initialization was corrected to `MutSeries[int].new(init=0)` in strategy v9 and indicator v12.

The next measurement is the indicator's on-chart pipeline counters: confirm completed higher-timeframe bar count, then identify whether trend, pullback, trigger, stop, or cost filters leave no candidate setups. Independently compare the custom higher-timeframe EMA stream to resampled reference data before changing the entry rules. Do not loosen constraints until the rejection stage and a corrected data window are known.

## Latest counter fix and strategy v9 runs

On 30 October 2026, the persistent integer series used for the HTF warm-up and diagnostic counts were changed to explicit `init=0`. TakeProfit reports the indicator working copy v12 saved as private platform version 8; the strategy working copy is v9. Both compile, and both pass `runtime_quick` on 5,000 bars. The user's 5m screenshot was captured before platform version 8 was saved and still showed `HTF WARMUP | 1/250`; it cannot confirm the fix. Reload/add platform version 8 and verify that the count increases across completed 15m bars. The model requires 250 completed HTF bars (about 62.5 hours of 15m candles) before enabling entries.

Two base-cost strategy v9 backtests were run with a 15 bp round-trip cost filter, 5 bp per-side modeled commissions, 0.25% risk, and 0.001 quantity step:

| Chart | Window | Trades | Win rate | Total P&L | Expectancy | Profit factor | Max drawdown | History sufficient? |
| ----- | ------ | -----: | -------: | --------: | ---------: | ------------: | -----------: | ------------------- |
| 5m | 1–15 Oct 2026 | 0 | n/a | $0.00 | n/a | n/a | 0% | No |
| 15m | 1 Sep–15 Oct 2026 | 4 | 25% | -$31.30 (-0.31%) | -$7.82/trade | 0.47 | 0.93% | No |

The 15m sample includes two losing longs and two shorts; long P&L was -$40.42 and short P&L +$9.12. The 5m result is inactive, and the 15m result is negative. Both reports flag insufficient history and their last-bar metadata extend past the requested date windows. These results reject any profitability claim; they are too limited and inconsistently bounded to estimate durable performance. Snapshot IDs and metrics are recorded in `results/v2/backtests.json`.

## Confirmed setup implementation v4

On 30 October 2026, both scripts were updated to read the chart timeframe from `self.time_frame.to_seconds()` instead of guessing it from the latest candle interval. Higher-timeframe bucket changes are processed once on a new execution bar; missing or incomplete candles reset the bias and pullback state. Both versions now arm a qualifying pullback for at most six execution bars, consume it on the first trigger, and require a fresh pullback for another signal. The indicator uses the same bracket-only lifetime and post-exit cooldown as the strategy, plots the modeled entry while active, and groups the panel around status, data, pipeline, levels, and estimated break-even. The strategy guards quantity rounding against nonpositive size.

TakeProfit confirms strategy working copy v12 and indicator working copy v15 compile and pass `runtime_quick` on 5,000 bars. The indicator is saved privately as platform version 9. Same-window base-cost strategy v12 results:

| Chart | Trades | Win rate | Total P&L | Expectancy | Profit factor | Max drawdown | History sufficient? |
| ----- | -----: | -------: | --------: | ---------: | ------------: | -----------: | ------------------- |
| 5m | 0 | n/a | $0.00 | n/a | n/a | 0% | No |
| 15m | 8 | 25% | -$45.28 | -$5.66/trade | 0.58 | 1.09% | No |

The 15m run had 2 wins and 6 losses, with $20.42 modeled commissions. Its `last_bar_at` is 19 October, beyond the requested 15 October endpoint. The 5m run ends at 26 October, also beyond its requested window. These short reports are useful for checking that the execution no longer raises the prior NaN-to-integer runtime error, but neither report is a valid profitability estimate. Run IDs are stored in `results/v2/backtests.json`.

## Intermediate rollback, lifecycle, and trigger fixes: strategy v13 / indicator v17

On 30 October 2026, the higher-timeframe series assignments were changed to recompute from the previous committed state on every update within the new UTC bucket; the one-time new-bar event now gates only plain diagnostic metadata. Indicator event counters explicitly carry forward and increment idempotently, and event flags reset on every execution bar. Pullbacks now consume a distinct touch once, expire after six bars, invalidate on slow-EMA loss or structural breach, and preserve the original pullback extreme for the stop anchor. Both scripts require the trigger candle to close beyond both entry EMAs. The indicator panel now includes the setup source-bar ID, age, invalidation threshold, and research/assumed-fill mode.

Both latest working copies passed TakeProfit compile and `runtime_quick` validation on 5,000 candles. The indicator was saved as private platform version 11. Same-window version 13 backtests, with 5 bp commission per execution, 0.25% risk, and a 15 bp round-trip eligibility estimate:

| Chart | Trades | Wins | Total P&L | Profit factor | Max drawdown | History sufficient? | Report last bar |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| 5m, 1-15 Oct 2026 | 1 | 1 | +$32.49 | Undefined | 0.30% | No | 26 Oct 2026 |
| 15m, 1 Sep-15 Oct 2026 | 3 | 1 | -$12.04 | 0.70 | 0.54% | No | 19 Oct 2026 |

The single 5m win cannot estimate expectancy or accuracy. The 15m sample has -$4.01 expectancy per trade. Both reports say history is insufficient and their final bars extend past the requested end dates. They are implementation checks, not profitability evidence. These v13 runs are superseded by the fresh-touch v14 results below. Full snapshots are in `results/v2/backtests.json`; updated code assessment is in `docs/CURRENT_ASSESSMENT.md`.

## Current fresh-touch lifecycle: strategy v14 / indicator v19

The consumed-touch watermark now advances to the decision bar after expiry, structural invalidation, or trigger consumption. This prevents a touch already observed in the rolling lookback from immediately rearming as a new setup; a later touch is required. Both scripts compile and pass TakeProfit `runtime_quick` on 5,000 candles. The indicator is saved as private platform version 13; its code title says v5 - Research while the existing library title remains v1.

Same-window version 14 backtests on Binance `BTC/USDT.P`, with $10,000 initial capital, 0.25% risk, 5 bp commission per execution, and 15 bp round-trip eligibility estimate:

| Chart | Trades | Wins | Total P&L | Profit factor | Max drawdown | History sufficient? | Report last bar |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| 5m, 1-15 Oct 2026 | 1 | 1 | +$32.49 | Undefined | 0.30% | No | 26 Oct 2026 |
| 15m, 1 Sep-15 Oct 2026 | 2 | 0 | -$39.82 | 0.00 | 0.40% | No | 19 Oct 2026 |

The 5m result is a single short winner and cannot estimate accuracy, expectancy, or profit factor. Both 15m trades lost. The reports still flag insufficient history and extend beyond their requested end dates. The 15m outcome is negative and does not support a profitable claim; neither sample is suitable for strategy selection. Snapshot IDs and metrics are recorded in `results/v2/backtests.json`.
