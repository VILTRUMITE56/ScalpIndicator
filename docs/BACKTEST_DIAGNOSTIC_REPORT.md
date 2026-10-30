# BTC perpetual backtest and signal diagnostics

Updated 30 October 2026. This report explains the latest strategy v16 backtest runs and the blocker counts visible in the user-provided TakeProfit chart screenshot. It is a diagnostic report; there are no completed trades from which to estimate accuracy or profitability.

## Latest strategy backtests

Both runs used strategy working copy v16 on Binance `BTC/USDT.P` (`CXBNF8`) with $10,000 initial capital, 0.25% risk, 0.15% cost eligibility input, 0.05% commission per execution, 0.001 quantity step, and 1x leverage. Both ended at 30 October 2026 10:30 UTC.

| Chart | Requested window (UTC) | Orders | Filled trades | Strategy P&L | Buy-and-hold | History sufficient? |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| 5m | 13 Oct 12:00–30 Oct 10:30 | 0 | 0 | $0.00 | -6.93% | No |
| 15m | 9 Sep 12:00–30 Oct 10:30 | 1 canceled | 0 | $0.00 | -2.04% | No |

The 15m order was a 0.029 BTC short limit at $80,988.69902, created 15 October at 03:30 UTC and canceled at 04:00 UTC without a fill. Both runs set `is_history_depth_sufficient=false` and `has_more_items_on_the_left=true`. There were no completed trades, so win rate, expectancy, profit factor, and per-trade drawdown are undefined. The zero P&L represents idle strategy exposure, not a break-even trading result.

The latest requests use nearly the full 5,060-bar account limit. The account rejected the larger history-depth selectors and wider date windows. Moving the start forward captures newer data but does not solve the incomplete-history limitation. Full requests, metrics, and order/trade pages are archived in [results/v4/backtests.json](../results/v4/backtests.json); the prior-window reports are in [results/v3/backtests.json](../results/v3/backtests.json).

## What the chart counters show

The attached 5m screenshot's panel reports:

| Diagnostic | Count |
| --- | ---: |
| Trend bars | 3,502 |
| Pullback events | 254 |
| Trigger candidates | 101 |
| Accepted chart-model candidates | 0 |
| Stop rejects | 10 |
| Cost rejects | 91 |
| Completed higher-timeframe bars | 1,666 |

The 101 candidates split into 91 cost rejects (90.1%) and 10 stop rejects (9.9%). The higher-timeframe count exceeds the strategy's 250-bar warmup requirement. In this displayed chart history, warmup was not the blocker; the cost-to-risk gate was the dominant filter. The screenshot counters come from the chart-model indicator, not the strategy fill ledger, and its exact dates are not available, so they should not be treated as counts from the precise backtest windows.

The current cost rule allows estimated round-trip cost up to 0.20R. With a 0.15% cost input, a candidate needs a stop distance of at least 0.75% of entry to pass (`0.15% / 0.20`). Since stop distance is also capped at 2.5 ATR, ATR must be at least 0.30% of entry for a candidate to pass both constraints. Those are necessary conditions, not a recommendation to loosen either threshold.

The 10 stop rejects are aggregated in the screenshot panel. The indicator code counts invalid stop geometry and stop distance above 2.5 ATR in the same bucket. Strategy order sizing and instrument minimums are additional later gates; indicator acceptance does not confirm an exchange-acceptable order or fill.

The local indicator and TakeProfit working copy v24 now retain the aggregate stop-reject total and add a split between invalid geometry and stops over 2.5 ATR. The edit passed compile and runtime_quick validation on 5,000 bars. It is not saved to the private indicator: the working copy is based on platform v16 while the latest saved platform version is v19, and TakeProfit will not load v19 over the unsaved copy. The existing saved chart indicator still has only the aggregate counter.

## Conclusions and next actions

1. Keep the current 0.20R gate unchanged until the chosen venue's maker/taker fees, spread, slippage, and funding assumptions are measured. The configured 0.15% is not fully charged to historical P&L; the strategy charges 0.05% commission per execution but the report lacks historical spread, slippage, and funding.
2. Add separate counts for invalid stop geometry and stops over 2.5 ATR. If no strategy order follows an indicator-accepted candidate, record the order stage that blocked it: cooldown/position, non-positive risk size, quantity step, minimum size/value, submission, cancellation, rejection, or fill.
3. Obtain a longer, correctly bounded history source. Current TakeProfit plan limits stop both requested windows at about 5,060 bars and reports older bars remain. Do not stitch independently reset strategy runs and treat them as one continuous equity curve without warmup and state reconciliation.
4. After the cost ledger and candidate parity are verified, run a pre-registered cost sensitivity as a diagnostic, using separate fee, spread, slippage, and funding fields. Preserve the baseline and test on fixed chronological windows with an untouched final period.

Do not describe this indicator as profitable based on these runs. They contain no filled trades and incomplete history.
