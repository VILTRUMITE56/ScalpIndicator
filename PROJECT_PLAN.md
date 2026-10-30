# BTC perpetual scalping indicator: research and implementation plan

Latest implementation update, 30 October 2026: the [current assessment](docs/CURRENT_ASSESSMENT.md) and [implementation plan](docs/SCALPING_IMPLEMENTATION_PLAN.md) track the B0 lifecycle changes in strategy working copy 16 and indicator working copy 24; the latest saved private indicator is platform version 19. Both copies pass compile and `runtime_quick` validation on 5,000 bars. The strategy's refreshed 5m and 15m backtests produced no completed trades and flagged insufficient history. No live/reload replay or candidate-parity audit has been completed. The [enhancement report](docs/SCALPING_ENHANCEMENT_REPORT.md) defines the remaining data foundation and bounded comparisons; older attempted variants remain part of the record.

Prepared: 30 October 2026. Status: first research scripts implemented and initial backtests run; see [RESULTS.md](RESULTS.md). The original decision gates have not been met. The latest exact higher-timeframe and diagnostic changes are summarized in the [code review and implementation plan](docs/V2_REVIEW_AND_PLAN.md); the first corrected v3 runs produced no trades.

Review update: the [code review and implementation plan](docs/V2_REVIEW_AND_PLAN.md) records the confirmed v1 overlapping-exit defect, disappearing live markers, corrected P&L accounting, and current v3 status. The exit race and marker persistence were addressed in code; execution lifecycle and higher-timeframe parity still need controlled validation before parameter work.

## Mission and definition of success

Build a TakeProfit indicator that produces confirmed LONG and SHORT signals on 5-minute and 15-minute BTC perpetual charts, with an entry reference, stop loss, take profit, and explicit no-trade conditions. Build a companion strategy with identical decision rules so the signals can be evaluated as executable trades.

The objective is positive expectancy after trading fees, spread, slippage, and applicable funding, with controlled drawdown. High win rate is a secondary measurement. No approach or parameter set in this document has demonstrated profitability. All numerical defaults and acceptance thresholds below are proposed research choices, not published performance results or guarantees.

User confirmed BTC perpetuals; exchange is undecided. Assume a linear USDT-margined contract for the initial specification. Inverse contracts require a different sizing and P&L model. Capital, fee tier, available trading hours, and acceptable drawdown remain open. Research can proceed with documented assumptions; venue-specific validation must precede live use.

## Research findings and their limits

1. Published cryptocurrency research reports both intraday momentum and reversal. This motivates testing more than one market condition; it does not validate an EMA, VWAP, or ATR scalping recipe. The publisher abstract for Wen et al., _Intraday return predictability in the cryptocurrency markets: Momentum, reversal, or both_, was accessible through search; the full paper was not accessible in this session. [Publisher record](https://www.sciencedirect.com/science/article/pii/S1062940822000833).
2. Bailey et al. show why selecting the best historical result among many configurations can create backtest overfitting. We will record every trial, limit the search, and reserve unseen periods. [Statistical Overfitting and Backtest Performance](https://www.davidhbailey.com/dhbpapers/overfitting.pdf).
3. TakeProfit supports Indie strategies, commission configuration, execution controls, and MCP backtesting. Indicators themselves cannot be backtested through the strategy tools. Indie is its own language; Python or Pine code cannot be used directly. [Strategy parameters](https://takeprofit.com/docs/indie/Strategies/Strategy-params), [strategy mechanics](https://takeprofit.com/docs/indie/Strategies/Strategy-mechanics).
4. Funding is venue- and contract-dependent. Bybit, as an example rather than an exchange recommendation, charges or credits positions held at funding times and documents varying intervals. Its liquidation uses mark price, which can differ from last traded price. These mechanics must be matched to the eventual venue. [Funding](https://www.bybit.com/en/help-center/article/Funding-fee-calculation), [mark price](https://www.bybit.com/en/help-center/article/Mark-Price-Calculation-Perpetual-Expiry-Contracts).
5. TakeProfit documentation describes plan-dependent history limits, with examples of 5,000 and 20,000 candles. At continuous 24-hour trading, 20,000 bars cover approximately 69 days at 5 minutes or 208 days at 15 minutes, before warm-up. We must verify actual account and MCP coverage rather than assume a long backtest is available. [Backtesting widget](https://takeprofit.com/docs/guide/platform/backtesting-widget/backtest-widget).

## Recommended research sequence

| Candidate              | Mechanism to test                                              | Main weakness                                    | Priority                     |
| ---------------------- | -------------------------------------------------------------- | ------------------------------------------------ | ---------------------------- |
| EMA crossover baseline | Simple directional persistence                                 | Whipsaws and delayed entries                     | Benchmark only               |
| Trend pullback         | Enter a retracement in an established higher-timeframe trend   | Fails when the trend reverses or becomes a range | First implementation         |
| Channel breakout       | Enter a close beyond the previous 20-bar range                 | False breaks and adverse fills                   | Second controlled comparison |
| Range reversion        | Return toward a rolling mean after an extreme in a flat market | Large losses when a new trend begins             | Later, only if justified     |

Start with trend pullbacks because the rules are explainable, inexpensive to compute, and easy to invalidate. This is an engineering recommendation and a hypothesis, not a research finding that pullbacks are the most profitable BTC strategy. Do not combine all candidates into an adaptive system before each has independent evidence.

Avoid adding RSI, MACD, stochastic, and several moving averages as interchangeable confirmations. Each optional filter must improve unseen results relative to the simpler model. Order flow, machine learning, open interest, and funding-based entry filters are outside the first version because they add data and validation requirements.

## First strategy specification

### Timeframes and data availability

- Configuration A: 5-minute execution with 15-minute bias.
- Configuration B: 15-minute execution with 1-hour bias.
- Treat these as separate research candidates. Do not assume the same settings or profitability transfer.
- Compute the bias from the latest fully completed higher-timeframe candle available at the decision timestamp. Verify historical and real-time alignment explicitly through Indie secondary contexts.
- Use completed execution candles for signals. Never backdate signals or confirmed swing points. Require adequate EMA/ATR warm-up, provisionally 250 higher-timeframe candles.

### Long setup

Initial fixed definitions:

1. **Bias:** completed higher-timeframe close is above EMA(50); EMA(20) is above EMA(50); EMA(50) is higher than its value three completed higher-timeframe bars earlier.
2. **Pullback:** on the execution chart, at least one of the previous three completed candles touched or crossed EMA(20) with its low, while all three closed above EMA(50).
3. **Trigger:** the current execution candle closes above EMA(20), above its own open, and above the previous candle's high. The higher-timeframe bias must still be valid.
4. **Entry:** simulate a market entry on the next bar's first tradable price, with adverse execution costs. A signal-close entry reference is informational and must not be reported as a guaranteed fill.
5. **Eligibility:** no current position, no duplicate signal from the same setup, valid data, and the stop/cost constraints below must pass. After exit, wait three completed execution bars and require a new qualifying pullback before entry.

Short rules are the exact mirror: bearish higher-timeframe alignment and slope; recent highs touch EMA(20) with closes below EMA(50); bearish close below EMA(20) and the previous low; next-bar entry.

### Stop loss and take profit

Use ATR(14) from the completed signal candle. For a long, the structural stop is the lowest low across the signal candle and previous three candles, minus 0.15 ATR. For a short, use the corresponding highest high plus 0.15 ATR. These are causal rolling extrema, not pivots that require future bars.

At the modeled entry, define distance D as the greater of the structural stop distance and 1.0 ATR. Place the final long stop at entry minus D, or the short stop at entry plus D. Reject entries if the structural stop is on the wrong side of entry, D exceeds 2.5 ATR, or a material opening gap invalidates the setup. Recalculate eligibility and size at the modeled fill; document the practical difference between this and an alert-only user's manual entry.

- Initial price risk R = D per BTC; it excludes costs for displaying target distances.
- Baseline target: all-out at 1.5R from entry. Compare 2R only as a predeclared alternative after the baseline is measured.
- Time exit: after six completed execution bars from entry, close at the next executable price if neither stop nor target has filled. This is approximately 30 minutes on 5m and 90 minutes on 15m.
- No automatic break-even stop, partial exits, or trailing stop in the baseline. Evaluate these later as separate experiments, including their extra fills and fees.
- Never widen a stop after entry. Stop orders may fill worse than the trigger during rapid moves; a drawn line does not cap realized loss.
- Stops and targets must remain active intrabar. Restricting entry decisions to closed candles must not accidentally restrict protective exits to candle closes.

### Costs and no-trade rules

Let C be the estimated round-trip cost per BTC, including entry/exit fees, spread, adverse slippage, and a funding allowance when applicable. Initially require C / D <= 0.20. This is a research filter, not evidence of an edge. Reject zero/invalid volatility, stale or missing data, and sizes that violate exchange minimums or risk constraints.

Use taker fees on both sides for the conservative market-entry baseline. Do not assume maker fills, rebates, or zero-cost exits. Until a venue and fee tier are known, run an explicitly hypothetical sensitivity grid of 5, 10, and 20 basis points round-trip for trading/execution costs, with funding modeled separately. These are scenarios, not quoted exchange fees. Once venue data is known, replace the grid with observed base costs and 1.5x/2x adverse spread/slippage scenarios.

If historical spreads or funding cannot be obtained, label the limitation and quantify the break-even cost. Do not silently treat missing costs as zero. A chart-only implementation without bid/ask data can use a conservative cost estimate; it cannot claim to measure live spread.

Test UTC time blocks, weekends versus weekdays, and volatility conditions in development data. Do not assume stock-market sessions or a daily opening bell apply to BTC. VWAP, relative volume, ADX, and macro-news blackout rules are optional later experiments; define any session reset explicitly and do not use unavailable historical information.

### Position sizing and risk controls

Provisional paper-trading settings, pending the user's risk preference:

- Risk budget: 0.25% of current equity per trade, including estimated costs.
- For a linear contract quoted in BTC, quantity is equity times risk fraction divided by (D + C), rounded down to the venue quantity step. Apply multiplier conversion if the venue expresses size in contracts.
- One position at a time, no pyramiding, averaging down, or martingale.
- Pause new entries for the rest of the UTC day after 4R of realized net losses, where daily R is fixed as 0.25% of start-of-day equity. Include modeled open loss when checking the entry budget; protective exits remain active.
- Research pause threshold: 8% equity drawdown from the running peak. These limits are proposed controls, not loss guarantees.
- Leverage does not change the risk budget. Verify margin, maintenance requirements, and a liquidation buffer beyond the stop under stress. If the platform cannot model these adequately, cap notional exposure conservatively and validate them separately before live use.

## Validation protocol

1. **Resolve the actual contract.** MCP lookup confirmed `BTC/USDT.P` perpetuals on Binance (`CXBNF8`) and Bybit (`CXBYBT`). These are candidate data feeds, not recommendations or a selected venue. Confirm settlement currency, tradability, fee tier, tick/lot sizes, funding, and stop trigger reference. Do not substitute spot candles for execution claims about a perpetual contract.
2. **Audit data.** Aim for at least 12 months spanning rising, falling, and sideways markets, subject to verified availability. Check missing/duplicate candles, UTC alignment, outliers, and warm-up. If TakeProfit history is insufficient, investigate supported historical data import or an external research harness and reproduce the final rules in Indie. Do not claim a short available history meets the 12-month objective.
3. **Freeze splits before optimization.** Reserve the latest 20% chronologically as a final untouched holdout. Within the earlier 80%, use rolling or expanding training windows followed by unseen validation windows. Keep sufficient history for warm-up, and exclude trades crossing evaluation boundaries or apply a gap at least as long as the maximum holding period. Do not randomly shuffle candles.
4. **Keep a trial registry.** Record data snapshots, venue, dates, versions, cost assumptions, inputs, and every candidate tried. Start with fixed defaults. Predeclare a small search budget, provisionally at most 12 configurations per strategy family and timeframe. Any expansion is logged as additional selection and requires fresh validation.
5. **Model execution honestly.** Verify next-bar entries and protective order timing in TakeProfit's emulator. Use finer data for candles touching both stop and target. If sequence remains unknown, use stop-first handling and report an optimistic/pessimistic sensitivity range. Do not assume a limit price touch proves a fill. Verify OCO-style cancellation and prevent same-bar exit/re-entry artifacts.
6. **Prevent repainting.** Check closed higher-timeframe inputs at boundary timestamps; compare logged real-time signals to the same chart after reload; truncate historical data at decision timestamps and verify prior signals do not change. Test entry/SL/TP parity between the indicator and strategy.
7. **Measure the whole trade.** Export the trade ledger with all fills, costs, funding, exits, and rejected orders. Report net expectancy in money and R, net profit factor, drawdown, trade count, win rate, average win/loss, losing streaks, turnover, exposure, and holding time. Split results by long/short, timeframe, venue, UTC block, and market condition.
8. **Quantify uncertainty.** Use day- or week-block resampling to preserve dependence when estimating net-expectancy confidence intervals and drawdown ranges. A positive point estimate with a confidence interval spanning zero is inconclusive. Reserve the holdout for one final locked evaluation; a failure requires a new experiment, not tuning on the holdout.
9. **Stress and attribution.** Increase costs, delay entries, test adjacent parameter values, and remove optional filters one at a time. Check whether profit depends on a handful of trades or one time period. A second venue tests portability but is not independent evidence because BTC returns are highly correlated across venues.
10. **Paper forward test.** Run the locked version for at least 4-8 weeks and at least 100 completed trades, whichever takes longer. Extend when conditions are too narrow. Log actual signal timing and realistic fills; reconcile differences from the backtest before any live pilot.

## Proposed decision gates

These are engineering screening criteria to agree before testing, not expected performance:

| Measure             | Initial gate                                                                                                   |
| ------------------- | -------------------------------------------------------------------------------------------------------------- |
| Unseen trade sample | Aim for >=300 out-of-sample trades across multiple conditions; report long/short counts separately             |
| Net expectancy      | Positive after costs, with a positive lower 95% block-bootstrap bound where sample quality supports estimation |
| Net profit factor   | >=1.25 on pooled unseen trades, with fold and direction results disclosed                                      |
| Drawdown            | <=8% at the proposed 0.25% risk sizing; assess stress drawdown separately                                      |
| Cost stress         | Positive net expectancy with twice the base adverse spread/slippage; retain actual fees and funding            |
| Stability           | Most walk-forward validation windows positive; no isolated parameter peak                                      |
| Forward operation   | Timing, fills, SL/TP, and trade accounting reconcile with the model                                            |

Passing these gates is evidence for further evaluation, not proof of future profitability. If one direction fails, report the failure; a direction-only revision is a new candidate requiring validation. If no candidate passes, the correct project result is no deployable strategy.

Win rate has no fixed target. For illustration, with full 1.5R winners, full 1R losers, and an average 0.10R cost per trade, break-even win rate is (1 + 0.10) / (1 + 1.5) = 44%. At 50% wins, expectancy is 0.15R per trade. This is arithmetic, not a forecast; time exits and variable fills require the actual realized win/loss distribution.

## Implementation stages and deliverables

| Stage                            | Work                                                                            | Deliverable / completion condition                                                       |
| -------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 1. Market and data specification | Confirm venue inputs; inventory history and cost data; freeze metrics/splits    | Venue assumptions and versioned data manifest                                            |
| 2. Baseline strategy             | Read Indie playbook, implement deterministic rules, compile through MCP         | Validated Indie strategy with sizing, protective exits, and trade ledger                 |
| 3. Controlled research           | Evaluate baseline/candidates chronologically; record every trial                | Cost-adjusted research report with uncertainty and explicit pass/fail                    |
| 4. Indicator                     | Reuse proven decision rules; verify parity                                      | Confirmed LONG/SHORT markers, entry reference, SL/TP, R ratio, and no-trade reason       |
| 5. Paper signals                 | Validate numeric signal plots and duplicate suppression; configure paper alerts | Reconciled forward log and operational report                                            |
| 6. Deployment decision           | Evaluate all gates and unresolved execution limits                              | Evidence-based recommendation for a separately authorized small live pilot, or rejection |

Build and test the strategy before spending effort on dashboard polish. No public publishing, external webhook delivery, or live orders are part of this planning task.

Suggested repository structure: `docs/` for specifications and assumptions, `indie/` for strategy and indicator sources, `research/` for evaluation code, `results/` for manifests and reports, and `forward/` for paper logs. Do not store exchange API keys in the repository.

The indicator should show LONG, SHORT, FLAT, or BLOCKED; signal timestamp; entry reference; fixed SL/TP for an active setup; and estimated cost in R. Label realized historical statistics with their tested venue/date range. Do not display an uncalibrated confidence score as a probability of winning.

## Immediate next work

The initial linear-perpetual trend-pullback strategy and both timeframe configurations are implemented. Strategy working-copy v14 and indicator working-copy v19 recalculate higher-timeframe values idempotently through live bucket updates, use one-shot pullback state with fixed expiry and invalidation, require a fresh post-consumption touch, and require the trigger candle to remain beyond both entry EMAs. The saved indicator is platform version 13. The latest same-window v14 runs produced one 5m winner and two 15m losses; both have insufficient-history flags and reported bars beyond the requested date ends. These runs are not profitability evidence. Next, apply version 13 to the BTC perpetual chart and confirm the warmup counter across realtime bucket changes and reload; independently compare higher-timeframe EMA values and candidate parity; then obtain clean history and venue costs before changing the entry hypothesis. Daily loss/equity drawdown locks remain unimplemented pending a verified account-equity or realized-P&L data source in the strategy API.

## Historical implementation deviation: v1, 30 October 2026

The v1 TakeProfit strategy used chart-timeframe bias EMA lengths 60/150 on 5m and 80/200 on 15m, as longer-horizon proxies for the proposed 15m and 1h bias. TakeProfit's Indie authoring playbook states that strategy secondary contexts with `time_frame=` are unsupported at runtime. The current v3 sources replace those proxies with manual UTC bucket updates from completed execution candles, but independent EMA parity and signal parity checks are still required.

TakeProfit's strategy order documentation says attached TP/SL are supported on limit and stop-limit entries, not market entries. The first version uses a marketable limit order with a 2 basis point price bound and attached TP/SL. A signal may not fill. The indicator shows candidate entry and SL/TP levels; it cannot know the eventual fill, open position, or exchange-side bracket state. The plan's daily loss pause, 8% research drawdown pause, live spread/funding accounting, venue quantity-step verification, no-trade reason dashboard, and exact strategy/indicator execution parity remain future work. Their absence prevents live-use approval.
