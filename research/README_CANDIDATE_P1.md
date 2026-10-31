# BTC perpetual candidate contract P1

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

Run `node risk_controls_reference.mjs` for deterministic reference fixtures covering contract-grid rounding, all-in stop risk, supplied-fill reconciliation against a stressed stop, partial fills, fees, funding, marked equity, protective coverage and configurable loss locks. Then run `node build_contract_risk_manifest.mjs` and `node verify_contract_risk_manifest.mjs` to create and verify hashes for the report bundle. The filters and costs in fixtures are synthetic; the Binance execution filter snapshot, actual execution venue, account fees and observed exchange fills remain unconfirmed. TakeProfit documents `self.info.tick_size` and `price_precision`, but no BTCUSDT value was captured; its strategy API does not document quantity step/max filters. The native P1 strategy still uses a manually entered quantity step, so keep it research-only. Personal daily/drawdown locks remain intentionally disabled by user choice. See `reports/contract_risk_report.md`, `specs/contract_risk_controls_p1.json` and `CONTRACT_RISK_MANIFEST.json`. This checkpoint does not establish profitability.
