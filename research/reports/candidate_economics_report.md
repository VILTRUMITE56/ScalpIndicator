# BTC P1 pre-cost candidate and cost/ATR feasibility report

Generated: 2026-10-31T03:10:33.116Z

Research event stream: `BTC-PERP-PULLBACK-P1`; frozen B0 source remains unchanged. Window: 2024-10-01T00:00:00.000Z through 2026-10-01T00:00:00.000Z (UTC).

## Scope and decision

REVISE before feature selection: under the declared planned-quote assumption, the current 15 bp eligible subset has non-positive cumulative net R after costs. Keep all cost and stop gates unchanged; inspect execution/exit assumptions and require an untouched, fill-reconciled follow-up before any promotion.

This is an independent shadow study, not an exchange backtest. Each signal is evaluated separately at its planned next-execution-bar open. The study assumes that quote filled only to measure barrier order and cost sensitivity. Actual order/fill counts remain unavailable, outcomes are not portfolio results, and the inspected history is not an untouched holdout.

Keep the 15 bp cost assumption, 0.20R cost cap, 2.5 ATR stop cap and 1.5R target frozen. The data do not justify loosening a gate or selecting a new configuration. The 10/15/20 bp values are predeclared sensitivities from the execution-cost record; this study consumes no new signal configurations.
Cost interpretation: Public regular-tier taker commission reference: 5 bp entry + 5 bp exit; excludes spread, slippage and funding. 10 bp commission reference + 5 bp assumed non-fee execution drag; hypothetical non-funding total-cost sensitivity. 10 bp commission reference + 10 bp assumed non-fee execution drag; hypothetical non-funding total-cost stress sensitivity. [Binance public USD-M fee table](https://www.binance.com/en/fee/futureFee), checked 2026-10-30. The user's account rate and historical spread/slippage remain unknown.

## Candidate funnel

| Profile | Scored bars | Directional setups | Triggers | 15 bp gate disposition | 10 bp pass | 15 bp pass | 20 bp pass |
|---|---:|---:|---:|---|---:|---:|---:|
| 5m | 207967 | 13007 | 5262 | {"NONE":117,"COST > 0.2R":4483,"STOP > 2.5 ATR":662} | 482 (9.16%) | 117 (2.22%) | 27 (0.51%) |
| 15m | 67064 | 3984 | 1553 | {"COST > 0.2R":1159,"NONE":174,"STOP > 2.5 ATR":220} | 473 (30.46%) | 174 (11.20%) | 72 (4.64%) |

All profiles: 6815 triggers, 16991 armed touches and 275031 model-scored bars. The funnel CSV records profile, side, UTC month and ATR-tertile counts for each stage; cost-gated shadow-order candidates and assumed quote-path counts are separate fields. Observed orders are `NOT_OBSERVED`; observed fills are `UNKNOWN`.

## Cost/ATR feasibility frontier

| Round-trip sensitivity | Required ATR/price at 2.5 ATR stop | Combined gate pass | Share of all triggers | Candidate cost/R p50 |
|---:|---:|---:|---:|---:|
| 10 bp | 0.200% | 955/6815 | 14.01% | 0.354 |
| 15 bp | 0.300% | 291/6815 | 4.27% | 0.531 |
| 20 bp | 0.400% | 99/6815 | 1.45% | 0.708 |

The pass counts require both planned stop distance <= 2.5 x touch ATR and scenario cost/R <= 0.20. A candidate can fail both; blocker columns in the frontier CSV are therefore not mutually exclusive. The gate-off performance rows are diagnostics for understanding rejected candidates and are not an executable strategy.

## Risk geometry and cost burden

| Profile | Stop % p50 / p90 | Touch ATR/price % p50 / p90 | Trigger ATR/price % p50 / p90 | 15 bp cost/R p50 / p90 |
|---|---:|---:|---:|---:|
| 5m | 0.245 / 0.558 | 0.150 / 0.309 | 0.150 / 0.304 | 0.611 / 1.385 |
| 15m | 0.454 / 1.019 | 0.279 / 0.519 | 0.284 / 0.526 | 0.330 / 0.706 |

## Conditional shadow outcomes

| Profile / side | Case | Gate candidates | Target | Stop | Gap stop | Ambiguous bound | Open at end | Net R/trade | Net R/day | MFE p50/p90 | MAE p50/p90 | Hold p50/p90 (min) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 5m / LONG | 10 bp | 182 | 83 | 99 | 0 | 0 | 0 | -0.024 | -0.007 | 1.20/1.76 | 1.01/1.18 | 68.5/189.4 |
| 5m / LONG | 15 bp | 26 | 11 | 15 | 0 | 0 | 0 | -0.113 | -0.004 | 1.02/1.60 | 1.01/1.14 | 86.5/289.5 |
| 5m / LONG | 20 bp | 4 | 3 | 1 | 0 | 0 | 0 | 0.699 | 0.004 | 1.57/1.59 | 0.46/0.93 | 46.0/220.8 |
| 5m / SHORT | 10 bp | 300 | 122 | 178 | 0 | 0 | 0 | -0.135 | -0.062 | 1.06/1.73 | 1.02/1.21 | 46.0/187.4 |
| 5m / SHORT | 15 bp | 91 | 33 | 58 | 0 | 0 | 0 | -0.260 | -0.036 | 0.80/1.64 | 1.02/1.20 | 51.5/230.5 |
| 5m / SHORT | 20 bp | 23 | 6 | 17 | 0 | 0 | 0 | -0.518 | -0.018 | 0.69/1.59 | 1.04/1.16 | 63.5/180.5 |
| 15m / LONG | 10 bp | 241 | 99 | 142 | 0 | 0 | 0 | -0.123 | -0.063 | 1.03/1.67 | 1.02/1.18 | 141.5/602.5 |
| 15m / LONG | 15 bp | 71 | 29 | 42 | 0 | 0 | 0 | -0.139 | -0.021 | 0.76/1.65 | 1.02/1.17 | 188.5/790.5 |
| 15m / LONG | 20 bp | 24 | 11 | 13 | 0 | 0 | 0 | -0.023 | -0.001 | 1.18/1.70 | 1.02/1.16 | 325.5/1050.6 |
| 15m / SHORT | 10 bp | 232 | 86 | 146 | 0 | 0 | 0 | -0.210 | -0.112 | 0.79/1.67 | 1.03/1.18 | 105.0/433.3 |
| 15m / SHORT | 15 bp | 103 | 42 | 61 | 0 | 0 | 0 | -0.127 | -0.030 | 0.96/1.69 | 1.02/1.16 | 107.5/435.5 |
| 15m / SHORT | 20 bp | 48 | 23 | 25 | 0 | 0 | 0 | 0.046 | 0.005 | 1.36/1.71 | 1.00/1.11 | 124.5/451.3 |

Net R charges the full named round-trip sensitivity once using average entry/exit notional. The 10 bp row is a public-rate commission reference, not an all-in cost; 15/20 bp assume additional execution drag without historical spread/slippage measurements. All cases exclude funding and liquidation and do not model actual execution behavior. Ambiguous 1m candles remain labeled ambiguous; net-R aggregates use the separately reported conservative stop-first bound. Censored positions have mark-to-market values in the event ledger but are excluded from closed-trade averages.

## Measurement definitions and provenance

- Bar = P1 reference bar after feature/HTF warmup, tagged by completed HTF direction or neutral. Eligible hours sum bar intervals by side; UTC months and profile-specific ATR/close tertiles are retained.
- Setup = an eligible first-touch state armed by P1. Every armed setup has one terminal reason or an explicit data-end-open disposition. Trigger = immutable P1 candidate event.
- Shadow order candidate = trigger satisfying both existing stop and cost/R gates. The assumed quote-path count evaluates barriers at the planned quote only; it is not an observed fill. Actual order counts are `NOT_OBSERVED`; actual fill counts are `UNKNOWN`, never zero.
- Volatility bucket cuts use all model-scored bars per profile and stay fixed across the months. Each stage is attributed to its event time and stage-specific ATR: bar-close ATR for eligible bars, touch ATR for setups, and trigger ATR for triggers/orders.
- Trade-price 1m OHLC is the primary barrier path; mark-price 1m is a separate trigger-price sensitivity. If one 1m candle touches both barriers, retain ambiguity and report the stop-first bound. Intra-minute execution order is unknown.
- Candidate IDs match the #4-audited P1 event ledger: 6815/6815; blocker recalculation mismatches: 0; B0 source hashes unchanged: true.
- Model-scored bars equal the #4 coverage counts by profile; the event engine masks all documented execution conflicts and reseeds after disputed HTF buckets.
- Barrier search validation: PASS, 128 trade 1m candidates and 128 mark 1m candidates matched a direct linear scan.
- No funding is applied: it is a separate signed cashflow and the user target/funding treatment is unresolved. Binance's public regular-user fee table shows 2 bp maker / 5 bp taker per side for USD-M Futures at the checked date; this is only a reference, not the user's rate. Historical spread, slippage, venue filters and observed fills are unavailable.

## Reproduce

```powershell
node research/candidate_reference.mjs
node research/candidate_economics_shadow.mjs
node research/build_candidate_economics_manifest.mjs
```

Source/data hashes and output hashes are recorded in `CANDIDATE_ECONOMICS_MANIFEST.json`. Candidate contract: `BTC-PERP-PULLBACK-P1`; baseline ID: `BTC-PERP-B0-2026-10-30-v16-v24`.
