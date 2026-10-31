# BTC perpetual candidate contract P1

Implementation update (31 October 2026): execution rules are versioned as `BTC-PERP-EXEC-1` alongside the unchanged `BTC-PERP-PULLBACK-P1` signal identity. The local strategy reserves the configured round-trip scenario once during sizing and exposes hidden execution candidate event/reason/timestamp outputs. Exact local P1 sources passed ephemeral TakeProfit compile and `runtime_quick` validation on 5,000 bars before the B4 indicator change. TakeProfit working copy v29 now matches the updated local indicator and compiled, but remains unsaved because it is based on v16 while v19 is latest; strategy working copy v21 still differs from local files. See [the current improvement plan](../docs/IMPROVEMENT_PLAN_2026-10-31.md). The simulation's short history and modeled fills still provide no profitability claim.

P1 is the shared signal and planned-risk contract used by the research indicator and native strategy. It is an experimental revision of B0, not evidence of profitability or a live trading configuration.

## Source of truth

- Frozen B0 source: `indie/btc_pullback_indicator.indie` and `indie/btc_pullback_strategy.indie`. Their hashes remain in `BASELINE_MANIFEST.json`.
- P1 working sources: `indie/btc_pullback_indicator_p1.indie` and `indie/btc_pullback_strategy_p1.indie`.
- Machine-readable rules and entry/stop/target contract: `specs/candidate_contract_p1.json`.
- The generator reads the shared Indie template and writes the same candidate/state/risk block into both P1 scripts. The two order/visual adapters remain role-specific.
- The independent reference engine is `candidate_reference.mjs`; it does not import or generate from the Indie code.

## Contract summary

The first eligible completed EMA20 range touch after recovery arms a setup. It must have directional HTF bias at touch and the touch candle plus up to two older candles in the recovery episode must close on the directional side of EMA50. P1 processes each touch once as it completes; it does not search retrospectively through B0's `[2]`–`[4]` indices. Trigger age is 1–6 execution bars after touch, inclusive. A trigger candle that wicks through structural invalidation is rejected.

The planned entry quote is the next execution bar open after the completed trigger candle. The stop and target are computed from this same quote and the touch-anchored stop reference. They are model levels, not observed fills. The strategy order limit is offset by 2 bp from the quote; actual fill, spread, slippage, fees, and funding remain execution data and do not change the immutable planned levels.

Candidate IDs include the TakeProfit venue code and symbol, execution timeframe, side, touch and trigger UTC open times, and rule version.

The P1 indicator defaults to a compact chart panel and can show the detailed research panel through the `Research diagnostics` setting. It exposes hidden numeric event outputs for candidate decisions, planned quote/SL/TP and modeled outcomes. State labels intentionally distinguish a qualified plan from the OHLC model's assumed entry and exit; no order or observed fill is reported. See [the event-output guide](../docs/CANDIDATE_EVENT_OUTPUTS_P1.md) for stable plot IDs, code meanings, timestamp fields and remaining platform reload checks.

## Reproduce and verify

Requires Node.js 20 or newer, plus the local #4 audited/resampled data under `research/data/btcusdt_2024-10_2026-09/`.

```powershell
node research/generate_candidate_logic.mjs --check
node research/candidate_reference.mjs
```

Regenerate source blocks with:

```powershell
node research/generate_candidate_logic.mjs --write
```

The reference command runs fixtures for B0's retrospective search, touch-time bias, recovery ordering, trigger-wick invalidation, six-bar expiry, long/short symmetry and planned-quote versus order-limit separation. It replays both execution profiles and compares the final 5,000 execution bars against runs initialized with 3,500 bars of pre-roll. It writes `reports/candidate_parity_report.{md,json}` and `reports/candidate_event_ledger.csv`.

The run manifest `CANDIDATE_CONTRACT_MANIFEST.json` records source/data hashes, frozen B0 integrity, TakeProfit working-copy versions and validation results. TakeProfit runtime validation does not export event-level series, so event-level figures in the CSV are from the independent reference engine; the scripts' shared generated block is checked byte-for-byte.

## Interpretation

The report describes candidate parity and risk blockers only. The current cost gate rejects many candidates, and the retained history has no observed TakeProfit fills for this P1 run. Do not infer expectancy, win rate, or profitability from candidate counts. Venue filters, account fee tier, order-book spread, slippage, funding, and the cancel/fill race still need execution evidence.

## Pre-cost economics checkpoint (#7)

`candidate_reference.mjs` applies the exact issue #4 execution-conflict mask and disputed HTF-bar reseeding policy before replay. Its scored-bar counts now match issue #4 coverage for both profiles. The frozen B0 sources remain byte-for-byte unchanged; the economics study uses the P1 contract as a separately versioned shadow event stream.

Run the complete diagnostic with:

```powershell
node candidate_reference.mjs
node candidate_economics_shadow.mjs
node build_candidate_economics_manifest.mjs
node verify_candidate_economics_manifest.mjs
```

The first command regenerates the audited P1 candidate ledger. The second reports eligible bars, armed setups, triggers, gate-eligible shadow orders and assumed quote paths by profile, side, UTC month and profile-specific ATR tertile. It replays every P1 candidate on trade 1m OHLC and records a separate mark 1m sensitivity. The third freezes source, data and output hashes. The fourth verifies those hashes plus key report and frozen-baseline invariants.

The cost cases are the already-declared 10/15/20 bp sensitivities; no signal configuration is selected or consumed. The 10 bp case references two standard regular-tier taker commissions on Binance's public fee table; it excludes spread and slippage and is not the user's account rate. The 15/20 bp cases add assumed 5/10 bp non-fee execution drag, which is not measured from historical quotes. A conditional quote fill is assumed only to evaluate barriers, and actual order/fill counts stay unknown. The full inspected history is not an untouched holdout; net R is not a portfolio backtest; funding, realized fees/spread/slippage, liquidation and exchange execution are absent. See `reports/candidate_economics_report.md`, `pre_cost_shadow_ledger.csv`, `candidate_funnel_utc_month_volatility.csv`, `cost_atr_frontier_utc_month_volatility.csv`, and `CANDIDATE_ECONOMICS_MANIFEST.json`.

## Order lifecycle checkpoint (#6)

Run `node order_lifecycle_check.mjs` to execute deterministic order/position accounting fixtures and replay the 304 risk-pass candidate plans against aligned 1m trade and mark OHLC histories. This assumes a planned-quote fill solely to test barrier ordering; it cannot infer limit fills. Read `reports/order_lifecycle_report.md` and `ORDER_LIFECYCLE_MANIFEST.json` for fixture outcomes, platform validation, and emulator/live limitations. Run `node generate_candidate_logic.mjs --check` alongside it to verify the shared candidate source is still generated identically.

## Contract rounding and risk-control checkpoint (#8)

Run `node risk_controls_reference.mjs` for deterministic reference fixtures covering contract-grid rounding, all-in stop risk, supplied-fill reconciliation against a stressed stop, partial fills, fees, funding, marked equity, protective coverage and configurable loss locks. Then run `node build_contract_risk_manifest.mjs` and `node verify_contract_risk_manifest.mjs` to create and verify hashes for the report bundle. Fixture filters and costs are synthetic. A current public Binance USD-M exchangeInfo snapshot is saved in the contract and timestamped evidence; it is fresh at capture but research proxy only. See `../docs/EXCHANGE_FILTER_EVIDENCE.md`. Binance is not a confirmed execution venue, and account fees and observed fills are unconfirmed. The native P1 strategy source now rounds price levels to the chart tick, applies configurable captured Binance quantity/notional defaults, and caps modeled stop risk at the user-confirmed $1 research budget after rounding. It compiled and passed a 5,000-bar TakeProfit runtime_quick validation on an ephemeral copy. Its bounded diagnostic backtest produced zero 5m trades and one losing 15m simulator trade with insufficient history; see `reports/p1_native_risk_backtest_summary.json`. Personal daily/drawdown locks remain intentionally disabled by user choice. See `reports/contract_risk_report.md`, `specs/contract_risk_controls_p1.json` and `CONTRACT_RISK_MANIFEST.json`. This checkpoint does not establish profitability.

## Portfolio shadow checkpoint

Run `node p1_portfolio_shadow.mjs` to replay the unchanged P1 candidate stream with a one-position limit, the existing cooldown, rounded tick/quantity sizing, minimum notional, the modeled $1 stop-risk cap, and 10/15/20 bp cost scenarios. It assumes a full fill at each eligible rounded limit and resolves barrier paths on trade 1m OHLC with stop-first handling for same-minute ambiguity. It excludes funding, unobserved limit-fill behavior, partial fills, queue/rejections, and the dynamic mark-price `PERCENT_PRICE` filter. The full 2024-10 through 2026-09 period is inspected development history, not a holdout.

Run `node build_p1_portfolio_shadow_manifest.mjs` and `node verify_p1_portfolio_shadow_manifest.mjs` to hash and verify the report, ledgers, source, contracts, and data inputs. Read `reports/p1_portfolio_shadow_report.md`, `P1_PORTFOLIO_SHADOW_MANIFEST.json`, and the event/trade/daily/monthly CSV ledgers. The 15 bp model yields 76 conditional 5m entries (net -$11.33, PF 0.700) and 92 conditional 15m entries (net -$17.29, PF 0.640); hypothetical fills are not observed orders or trades, and profitability remains unproven.

## P2 net-dollar target feasibility (not promoted)

Run `node p1_portfolio_shadow.mjs --net-target-quote=5.01` to test the recorded target objective as more than $5 net at the modeled 15 bp round-trip cost. The target is calculated from post-rounded size and rounded outward to the $0.10 tick. P1 signals, cost/R gate, stop, $1 modeled stop-loss cap, and single-position policy stay fixed.

The replay produced 66 conditional 5m trades (9 targets, net -$1.56, PF 0.967) and 75 conditional 15m trades (5 targets, net -$32.74, PF 0.433). Combined, 14 of 141 trades hit target and 127 hit stop; the 15 bp net result is -$34.30, with 9.9% wins. The 10 and 20 bp cases are also negative. P2 is not promoted. This uses assumed full fills, excludes funding, and replays inspected history; it does not promise $5 net from actual trades.

The separate [P2 strategy source](../indie/btc_pullback_strategy_p2.indie) passed TakeProfit compile and `runtime_quick` on 5,000 bars from an ephemeral, unsaved working copy. The two-year native 5m backtest request was rejected by the connected plan's 5,060-bar limit (210,240 requested). A bounded probe returned zero trades, insufficient history, and a reported last-bar timestamp outside the requested range; treat it as an execution probe, not a performance sample. See the [platform validation record](reports/p2_strategy_platform_validation.json).

The P1 indicator includes the registered B4 entry-extension hypothesis as an off-by-default, indicator-only setting. Enabling it rejects a trigger whose completed close is more than 1.0 trigger-bar ATR from EMA20 in the signal direction. This feature has not been performance-tested or mirrored in P1/P2 strategy code; keep it disabled for baseline collection and do not use the enabled output for execution until parity is restored.

P2 also exposes hidden `execution_candidate_target_quote`, which is a rounded theoretical target after quantity calculation; it can be present even when a later minimum-notional or risk check rejects the order. Reason code `30` means the rounded target cannot meet the configured minimum net target under the cost model. Neither output is evidence of an accepted order or realized profit; see `specs/p2_net_target_policy.json` for the contract.

Run `node build_p2_net_target_manifest.mjs` and `node verify_p2_net_target_manifest.mjs` to hash and verify this feasibility evidence. See `specs/p2_net_target_policy.json`, `reports/p2_net5_target_feasibility_report.md`, `P2_NET_TARGET_MANIFEST.json`, and the P2 ledgers.
