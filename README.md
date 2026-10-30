# BTC perpetual pullback research

This repository contains an Indie BTC perpetual research strategy and a chart-model indicator for TakeProfit. The current strategy requires an intersecting EMA20 touch, freezes setup ATR and invalidation, requires recovery before rearming, calculates bracket risk from the worst permitted entry limit, and models exits from completed candles. Strategy working copy v16 produced no filled trades on refreshed 5m and 15m runs; both report incomplete history. The chart diagnostic panel points to the cost gate as the main blocker: 91 of 101 trigger candidates were cost-rejected, 10 stop-rejected, and none accepted. Indicator working copy v24 adds a stop-rejection breakdown and passed compile plus a 5,000-candle runtime check, but TakeProfit has not saved it because the copy is based on platform v16 while the latest saved private version is v19. See the [current assessment](docs/CURRENT_ASSESSMENT.md), [diagnostic report](docs/BACKTEST_DIAGNOSTIC_REPORT.md), and [results](RESULTS.md).

## Files

- [docs/SCALPING_ENHANCEMENT_REPORT.md](docs/SCALPING_ENHANCEMENT_REPORT.md): latest source review and researched comparison of VWAP, ADX, relative volume, RSI, Supertrend, Bollinger Bands, and breakout/retest approaches.
- [docs/SCALPING_IMPLEMENTATION_PLAN.md](docs/SCALPING_IMPLEMENTATION_PLAN.md): implementation status, remaining reliability work, exact candidate rules, data/cost evaluation, visual improvements, and bounded experiments.
- [research/ENHANCEMENT_EXPERIMENTS.json](research/ENHANCEMENT_EXPERIMENTS.json): archived A0 source hashes and current implementation versions; no new variant results are claimed.
- [PROJECT_PLAN.md](PROJECT_PLAN.md): objective, original rules, validation gates, and recorded platform-driven changes.
- [indie/btc_pullback_strategy.indie](indie/btc_pullback_strategy.indie): position sizing, bounded limit entries, attached stop and target, and pending-entry cancellation. A timer exit is disabled until safely verified.
- [indie/btc_pullback_indicator.indie](indie/btc_pullback_indicator.indie): LONG/SHORT model markers, modeled entry/SL/TP, state/cost panel, and counts for signal-stage diagnostics. It does not know exchange fills or positions.
- [RESULTS.md](RESULTS.md): validation status, backtest parameters, outcomes, and unresolved issues.
- [results/v2/backtests.json](results/v2/backtests.json): selected run metrics and history-coverage flags; full order/fill ledgers are not retained here.
- [results/v3/backtests.json](results/v3/backtests.json): full strategy v16 backtest requests and responses for the 5m and 15m diagnostic runs.
- [results/v4/backtests.json](results/v4/backtests.json): latest-window v16 runs through 30 October plus the dashboard diagnostics visible in the user's screenshot.
- [docs/BACKTEST_DIAGNOSTIC_REPORT.md](docs/BACKTEST_DIAGNOSTIC_REPORT.md): explains why the current runs remain idle and what evidence is needed before changing the cost gate.
- [docs/V2_REVIEW_AND_PLAN.md](docs/V2_REVIEW_AND_PLAN.md): prioritized code findings, execution repairs, effectiveness research, and visual design.
- [docs/V2_LAYOUT.svg](docs/V2_LAYOUT.svg): illustrative proposed chart layout, not implemented functionality.
- [research/audit_v1.mjs](research/audit_v1.mjs): reproduces the retained-report accounting and overlapping-exit audit with `node research/audit_v1.mjs`.

## TakeProfit setup

The private indicator is under the existing library title `BTC Perp Pullback Signals v1` (UID `b0WWgU3721kqgpvBweE24`; latest saved platform version 19; code title is v6 - Research). The library title cannot be renamed through the current save endpoint. The diagnostic update in working copy v24 is not published yet because its base is stale. No alerts or automation are configured.

The code supports 5-minute execution with a completed 15-minute EMA(20/50) trend, and 15-minute execution with a completed 1-hour EMA(20/50) trend. It resets the bias and warms up again after a timestamp gap; it requires 250 completed higher-timeframe bars. The dashboard shows the chart instrument, current model levels, estimated cost in R, and historical filter counts. Its markers and levels are chart-model outputs using an assumed bar-open fill, not guaranteed fills or exchange-position tracking.

The strategy working copy has script ID `6daa5166-bfc5-4960-8f84-e714a3b2aff2`, current script version 16; diagnostic indicator working copy v24 is unsaved against platform v19. TakeProfit's MCP `SaveScript` endpoint supports indicator scripts only, so the strategy remains in this repository and MCP working copy. Both v16 runs through 30 October returned zero completed trades and insufficient-history flags. Exchange fees, spread, slippage, funding, mark-price behavior, contract size, and quantity limits still need verification.
