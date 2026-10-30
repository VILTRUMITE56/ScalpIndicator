# BTC perpetual pullback research

The [project assessment and upgrade roadmap](docs/PROJECT_LEVEL_UP_ASSESSMENT.md) evaluates the current evidence, compares established indicator families, derives the default cost/ATR feasibility constraint, and prioritizes the next work. Economic feasibility, shared signal/entry rules, and reliable data come before adding optional filters.

This repository contains a frozen B0 reference and a versioned P1 candidate implementation for a TakeProfit BTC perpetual research indicator and strategy. P1 unifies touch/recovery/trigger state and planned entry/SL/TP through one generated Indie block. The next-bar open is a plan quote; the strategy's ±2 bp limit is an execution quote, and actual fills remain unknown. The independent two-year replay reconciles 6,912 candidates and passes full-versus-truncated candidate/level comparisons, but cost gates reject most candidates and the run provides no profitability evidence. See the [P1 contract and reproduction guide](research/README_CANDIDATE_P1.md), [candidate report](research/reports/candidate_parity_report.md), [current assessment](docs/CURRENT_ASSESSMENT.md), and [results](RESULTS.md).

## Files

- [docs/SCALPING_ENHANCEMENT_REPORT.md](docs/SCALPING_ENHANCEMENT_REPORT.md): latest source review and researched comparison of VWAP, ADX, relative volume, RSI, Supertrend, Bollinger Bands, and breakout/retest approaches.
- [docs/SCALPING_IMPLEMENTATION_PLAN.md](docs/SCALPING_IMPLEMENTATION_PLAN.md): implementation status, remaining reliability work, exact candidate rules, data/cost evaluation, visual improvements, and bounded experiments.
- [research/ENHANCEMENT_EXPERIMENTS.json](research/ENHANCEMENT_EXPERIMENTS.json): archived A0 source hashes and current implementation versions; no new variant results are claimed.
- [research/BASELINE_INDEX.md](research/BASELINE_INDEX.md): one entry point for the frozen canonical BTC indicator/strategy, historical result status, validation evidence, and restore instructions.
- [research/specs/baseline.json](research/specs/baseline.json): frozen B0 rule and execution-assumption contract, recorded as implemented.
- [research/BASELINE_MANIFEST.json](research/BASELINE_MANIFEST.json): current normalized source hashes, fresh validation evidence, report hashes, and source/config mapping for every retained run.
- [research/build_baseline_manifest.mjs](research/build_baseline_manifest.mjs): reproducibly rebuilds the baseline evidence manifest without running a backtest.
- [research/specs/candidate_contract_p1.json](research/specs/candidate_contract_p1.json): versioned P1 candidate, quote, stop, target, cost gate, and execution separation rules.
- [research/CANDIDATE_CONTRACT_MANIFEST.json](research/CANDIDATE_CONTRACT_MANIFEST.json): P1 source and data hashes, B0 integrity, TakeProfit working-copy validation, and full/truncated comparison results.
- [research/reports/candidate_parity_report.md](research/reports/candidate_parity_report.md) and [candidate_event_ledger.csv](research/reports/candidate_event_ledger.csv): independent reference replay and candidate-level fields, risk blockers, planned levels, and unknown fill status.
- [research/README_CANDIDATE_P1.md](research/README_CANDIDATE_P1.md): source-of-truth map and reproduction commands for P1.
- [docs/EXECUTION_COST_AND_RISK_REQUIREMENTS.md](docs/EXECUTION_COST_AND_RISK_REQUIREMENTS.md): provisional Binance research proxy, cost-component status, research risk defaults, and user decisions still needed for GitHub issue #3.
- [research/specs/execution_cost_risk.json](research/specs/execution_cost_risk.json): versioned machine-readable venue/cost/risk assumptions with official source links and checked timestamps.
- [PROJECT_PLAN.md](PROJECT_PLAN.md): objective, original rules, validation gates, and recorded platform-driven changes.
- [indie/btc_pullback_strategy.indie](indie/btc_pullback_strategy.indie) and [indie/btc_pullback_indicator.indie](indie/btc_pullback_indicator.indie): frozen B0 source snapshots.
- [indie/btc_pullback_strategy_p1.indie](indie/btc_pullback_strategy_p1.indie) and [indie/btc_pullback_indicator_p1.indie](indie/btc_pullback_indicator_p1.indie): P1 sources generated from the shared candidate core. The indicator shows planned quote/SL/TP; it does not know exchange fills or positions.
- [research/generate_candidate_logic.mjs](research/generate_candidate_logic.mjs) and [research/candidate_reference.mjs](research/candidate_reference.mjs): shared-block drift check/generator and independent reference replay.
- [RESULTS.md](RESULTS.md): validation status, backtest parameters, outcomes, and unresolved issues.
- [results/v2/backtests.json](results/v2/backtests.json): selected run metrics and history-coverage flags; full order/fill ledgers are not retained here.
- [results/v3/backtests.json](results/v3/backtests.json): full strategy v16 backtest requests and responses for the 5m and 15m diagnostic runs.
- [results/v4/backtests.json](results/v4/backtests.json): latest-window v16 runs through 30 October plus the dashboard diagnostics visible in the user's screenshot.
- [docs/BACKTEST_DIAGNOSTIC_REPORT.md](docs/BACKTEST_DIAGNOSTIC_REPORT.md): explains why the current runs remain idle and what evidence is needed before changing the cost gate.
- [docs/V2_REVIEW_AND_PLAN.md](docs/V2_REVIEW_AND_PLAN.md): prioritized code findings, execution repairs, effectiveness research, and visual design.
- [docs/V2_LAYOUT.svg](docs/V2_LAYOUT.svg): illustrative proposed chart layout, not implemented functionality.
- [research/audit_v1.mjs](research/audit_v1.mjs): reproduces the retained-report accounting and overlapping-exit audit with `node research/audit_v1.mjs`.

## TakeProfit setup

The P1 indicator and strategy were synced to TakeProfit working copies v27 and v20 and passed compile, runtime_quick, and runtime_full validation on 5,000 series items. The working copies remain unsaved; the saved private indicator baseline is v19 and the library title cannot be renamed through the current save endpoint. No alerts or automation are configured.

The code supports 5-minute execution with a completed 15-minute EMA(20/50) trend, and 15-minute execution with a completed 1-hour EMA(20/50) trend. It resets the bias and warms up again after a timestamp gap; it requires 250 completed higher-timeframe bars. The dashboard shows the chart instrument, current model levels, estimated cost in R, and historical filter counts. Its markers and levels are chart-model outputs using an assumed bar-open fill, not guaranteed fills or exchange-position tracking.

The existing script IDs are `dd7d1e3f-a6db-4f3a-8a50-2b8f551e9db3` (indicator) and `6daa5166-bfc5-4960-8f84-e714a3b2aff2` (strategy). P1 is research-only and remains an unsaved TakeProfit working copy pending the separate platform-version checkpoint. The earlier B0 runs returned zero completed trades and insufficient-history flags. The P1 candidate replay is not a backtest: exchange fills, account fees, spread, slippage, funding, mark-price behavior, contract size, and quantity limits still need verification.
