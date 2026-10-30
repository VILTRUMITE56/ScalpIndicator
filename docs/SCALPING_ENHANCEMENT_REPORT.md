# BTC perpetual scalping: enhancement research and code review

Research date: 30 October 2026, Asia/Manila. Implementation status updated the same day.

This review looks for ways to make the current BTC perpetual pullback indicator more reliable and more testable. It does not identify a proven profitable indicator. The code corrections below address signal and modeling problems; only unseen, realistic-cost results can establish whether they improve performance.

At the time of the research review, the source versions were strategy working copy 14, indicator working copy 19, and private indicator platform version 13. The follow-up strategy is working copy 16; the diagnostic indicator working copy is version 24 and the latest saved private version is 19. Both current working copies compile, and indicator v24 passed a 5,000-candle runtime check. The v16 backtests on 5m and 15m produced no completed trades and flag insufficient history. The chart dashboard reports cost rejection dominates in its loaded 5m history. Full reports are archived in [results/v3/backtests.json](../results/v3/backtests.json) and [results/v4/backtests.json](../results/v4/backtests.json); no performance estimate is available. The diagnostic indicator edit is not saved to the private script because of the stale platform version conflict.

## What the current strategy does

The baseline uses EMA(20/50) on the execution chart, a completed higher-timeframe EMA trend (15m bias for 5m entries, 1h bias for 15m entries), an EMA20 pullback and price recovery trigger, ATR-based stop limits, a 1.5R target, and a cost-to-risk eligibility gate. The strategy uses a bounded limit entry with attached stop and target. The chart indicator models an entry at the next bar open and cannot see exchange fills.

The v16 diagnostic runs had zero completed trades in both timeframes; the 15m report recorded one canceled, unfilled short limit. Both initial and refreshed reports flag insufficient history. In the user-provided 5m dashboard screenshot, 91 of 101 trigger candidates (90.1%) are cost-rejected and 10 (9.9%) are stop-rejected; none are accepted. The retained strategy v14 runs had one winning 5m trade (+$32.49) and two losing 15m trades (-$39.82 total). These earlier runs predate the current source and cannot demonstrate accuracy, expectancy, or profitability. Details are in the [v16 diagnostic reports](../results/v3/backtests.json), [latest rerun](../results/v4/backtests.json), and [retained v14 results](../results/v2/backtests.json).

## Source findings and implementation state

| Finding | Effect | Current status |
| --- | --- | --- |
| A fresh setup could be armed after invalidation had already been checked, letting an invalidating trigger candle through. | Some signals could survive structural failure on the same completed candle. | The source now checks fixed invalidation after arming and again before accepting a trigger. Runtime replay remains outstanding. |
| The chart model could settle a trade on a forming candle, while a history reload used final OHLC and could choose a different result. | Live and reloaded model outcomes could disagree. | Outcomes now update from completed candles; if a candle crosses both stop and target, the chart labels it ambiguous and selects stop first. |
| The strategy sized around the decision-bar open while the bounded limit could enter at a different price. | Actual risk and target distance could differ from the intended values. | Sizing and attached levels now use the worst entry permitted by the submitted limit. Actual fills, partial fills, and venue rounding still need reconciliation. |
| The touch scanner accepted a one-sided EMA comparison and used a rolling window without a clean recovery/rearm definition. | Wicks that did not cross the EMA could count, and old touches could be reused. | The touch now requires the candle range to intersect EMA20; setup age comes from the touch bar; a later EMA20 recovery is required before rearming. |
| The structural invalidation buffer used ATR from the current decision instead of from the setup. | The invalidation level could move while the setup was waiting. | ATR, structural invalidation, and stop reference are stored at the touch and held fixed for that setup. |
| Blocker text and rejection counts were difficult to interpret. | A user could not tell whether no signal meant no setup, active exposure, cooldown, stop, or cost. | The chart status persists for the current candle and the panel counts trend, pullback, trigger, accepted, active-model, cooldown, stop, and cost events. The user screenshot shows the visible candidate denominator; rejection percentages and eligible-bar coverage are not yet shown. Indicator v24 adds invalid-stop versus wide-stop counts, but is not saved to the latest private version yet. |
| Quantity-step/minimum checks do not cover the chosen exchange’s full contract rules. There is no confirmed price-tick rounding or strict BTC-perpetual instrument guard. | A valid-looking model level or size may not be placeable on the eventual venue. | Open. Verify exact contract filters and enforce them before using orders. |
| A higher-timeframe data gap resets the indicator and requires a long warmup. | Signals are unavailable until the required completed higher-timeframe history is rebuilt. | Existing behavior remains. The 250-bar warmup and bucket alignment still need comparison against independently resampled data. |
| There is no verified daily-loss or peak-equity entry lock, and no safe time exit. | Positions may remain open longer than intended; careless opposite-order exits can create unintended exposure. | The strategy remains bracket-only. Do not add a timed close until position-reducing and cancellation/fill-race behavior is demonstrated. |

The most consequential remaining gaps are independent signal parity between the two scripts, runtime and reload behavior, execution reconciliation, complete market history, and venue cost accounting. The screenshot explains the leading filter bottleneck, but zero-fill backtests do not test whether the strategy would have positive expectancy. Compile success does not prove these properties.

## Scalping methods worth comparing

The popularity of an indicator does not establish a trading edge. Binance’s scalping overview names moving averages, RSI, Bollinger Bands, VWAP, MACD, and market microstructure as tools traders may use; that is a list of approaches, not measured evidence for this strategy. [Binance Academy: crypto scalping](https://academy.binance.com/en/articles/what-is-scalping-trading-in-cryptocurrency).

| Method | How it could complement this baseline | Recommendation |
| --- | --- | --- |
| EMA trend pullback | Simple directional bias and a clear invalidation structure. | Keep as B0 benchmark; first prove the lifecycle and fill model. |
| ADX(14,14) | Measures trend strength, which is different from the existing EMA direction. | Test alone at ADX >= 20. It may filter range noise but can arrive late; the threshold is a hypothesis. [Fidelity ADX guide](https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/ADX). |
| UTC-day VWAP | Shows price location relative to volume-weighted intraday value. | Test long closes above and short closes below UTC-day VWAP, with six completed bars after reset. Use HLC3 and the instrument’s actual volume. Confirm the exact UTC reset. [TradingView VWAP](https://www.tradingview.com/support/solutions/43000502018-volume-weighted-average-price-vwap/). |
| Relative volume | Measures participation versus recent bars. | Test trigger-bar volume against the prior 20 completed-bar mean, excluding the trigger candle, at a starting ratio of 1.2. High volume is not directional by itself. [TradingView relative volume](https://www.tradingview.com/support/solutions/43000635874-how-do-we-calculate-relative-volume-and-relative-volume-at-time/). |
| ATR-normalized entry extension | Avoids entering after price has moved far from EMA20. | Test a separate rule limiting signed close-to-EMA20 distance to 1 ATR. This is a proposed filter, not an established profitable pattern. |
| Donchian breakout then retest | Gives a separate continuation entry family rather than chasing a large recovery bar. | Test separately: 20-bar channel excluding the breakout candle, then a bounded retest within three bars. Freeze the level at breakout. [TradingView Donchian Channels](https://www.tradingview.com/support/solutions/43000502253-donchian-channels-dc/). |

Defer RSI, Stochastic, MACD, Supertrend, Bollinger squeeze/reversion, order-flow, and CVD additions for now. They either overlap information already in the EMA/ATR baseline or require a distinct strategy and data model. Test one feature at a time; do not stack popular indicators as extra votes. RSI can remain extreme during a strong trend, and a band touch alone is not a reversal. [Fidelity RSI guide](https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/RSI), [TradingView Supertrend](https://www.tradingview.com/support/solutions/43000634738-supertrend/), [Bollinger Band rules](https://www.bollingerbands.com/bollinger-band-rules).

TakeProfit documents built-in ADX, VWAP, RSI, Bollinger, and Supertrend algorithms. That confirms platform availability, not performance. Its VWAP documentation has anchor terminology that should be checked with a UTC-midnight fixture before relying on a built-in. [TakeProfit algorithm reference](https://takeprofit.com/docs/indie/Library-reference/package-indie-algorithms).

## Costs explain why the current baseline is sparse

The default total round-trip cost assumption is 0.15% of price. A candidate passes the cost gate only if estimated cost is at most 0.20R, while the stop cannot exceed 2.5 ATR. This implies a stop of at least 0.75% of entry price and ATR of at least 0.30% of price as necessary conditions. At a hypothetical BTC price of $80,000, that is at least $600 to the stop and $900 to a 1.5R target. These are necessary, not sufficient, conditions.

The strategy commission is 0.05% per execution, about 0.10% round trip. The remaining 0.05% in the cost assumption is not actually charged in the retained backtest P&L; historical spread, slippage, and funding are not modeled. Do not lower the cost assumption just to create more trades. Replace it with verified venue fees and separate spread, slippage, and funding when those inputs are available.

## Recommended implementation sequence

1. Finish the B0 engineering foundation: independent candidate/event ledger, timestamp-based identity, and explicit rejection denominators.
2. Verify the data feed, UTC bar coverage, higher-timeframe calculations, fee/contract rules, and fills against a documented venue.
3. Run B0 through B5 separately on both 5m and 15m, using the same chronological windows and costs. Do not select a winner from the previously reviewed September/October windows and call it an untouched holdout.
4. Only consider combinations or target alternatives after a feature shows separate evidence. Preserve every unsuccessful run and cap the search as described in the [implementation plan](SCALPING_IMPLEMENTATION_PLAN.md).
5. Compare the chart and strategy candidates, levels, and execution events; then require at least eight weeks and 100 reconciled paper trades before any deployment decision.

Bailey and coauthors explain how selecting among many backtested configurations can overfit noise. Keep the search bounded and reserve an unseen or prospective evaluation period. [The Probability of Backtest Overfitting](https://www.davidhbailey.com/dhbpapers/backtest-prob.pdf). Cryptocurrency technical-rule studies that include costs and out-of-sample methods motivate testing simple rules, but do not validate this exact Binance perpetual strategy or its 5m/15m parameters. [Froemmel and Deprez study](https://www.sciencedirect.com/science/article/pii/S1059056024003010).

## Conclusion

The current changes make several setup and chart-model rules more explicit and conservative. The v16 backtests had no fills and incomplete history, so they are not evidence of improved returns. Verify venue costs before considering a cost-gate sensitivity; split invalid-stop and excessive-stop-width counts after rebasing the diagnostic edit to the latest private version. The updated sources need runtime replay, candidate parity, realistic cost data, and adequately covered out-of-sample evaluation before any claim that this indicator is accurate or profitable.
