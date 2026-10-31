# Costed B0 Baseline: Findings and Decision

Generated: 2026-10-31T03:13:58.302Z

**Decision: REVISE_RESEARCH_HYPOTHESIS; KEEP_FEATURE_EXPERIMENTS_BLOCKED.** The B0 1.5R payoff geometry cannot meet the user-confirmed >$5 target under a <=$1 all-in loss cap. Historical performance remains conditional on unobserved fills, unmeasured execution costs, unknown account fees, unavailable platform minimum filters, and non-holdout data. Do not infer live profitability; complete native parity and collect venue-specific quotes/fills before deciding whether to continue or pivot the signal.

This is a conditional historical model, not observed trading performance or a profitability claim. The exact evaluation policy was frozen before the replay in `research/specs/baseline_evaluation_p0.json`.

## Profile and cost results

| Profile | Cost case | Signals | Assumed fills | Closed | Open at end | Expectancy USDT / fill | Expectancy R | Net R / eligible day | Net PF | Open-equity max DD | Inference |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 5m/15m | fee_only_10bp | 5068 | 103 | 103 | 0 | -1.98516635 | -0.09137598 | -0.01298169 | 0.85574187 | 332.75846849 (3.30348561%) | CONDITIONAL_ON_ASSUMED_FILLS_AND_UNMEASURED_COSTS |
| 5m/15m | base_15bp | 5068 | 103 | 103 | 0 | -3.14137235 | -0.1469077 | -0.02087103 | 0.78246172 | 378.2873903 (3.77184789%) | CONDITIONAL_ON_ASSUMED_FILLS_AND_UNMEASURED_COSTS |
| 5m/15m | stress_1_5x_17_5bp | 5068 | 103 | 103 | 0 | -3.71947536 | -0.17467356 | -0.02481569 | 0.74834776 | 406.68841565 (4.06160004%) | CONDITIONAL_ON_ASSUMED_FILLS_AND_UNMEASURED_COSTS |
| 5m/15m | stress_2x_20bp | 5068 | 103 | 103 | 0 | -4.29757836 | -0.20243942 | -0.02876036 | 0.71576656 | 453.76384674 (4.53260126%) | CONDITIONAL_ON_ASSUMED_FILLS_AND_UNMEASURED_COSTS |
| 15m/60m | fee_only_10bp | 1483 | 136 | 136 | 0 | -2.6154401 | -0.1281818 | -0.02486837 | 0.81463849 | 419.22971385 (4.17191761%) | CONDITIONAL_ON_ASSUMED_FILLS_AND_UNMEASURED_COSTS |
| 15m/60m | base_15bp | 1483 | 136 | 136 | 0 | -3.67193899 | -0.17883739 | -0.03469599 | 0.75138777 | 531.13150485 (5.29450615%) | CONDITIONAL_ON_ASSUMED_FILLS_AND_UNMEASURED_COSTS |
| 15m/60m | stress_1_5x_17_5bp | 1483 | 136 | 136 | 0 | -4.20018843 | -0.20416519 | -0.03960979 | 0.72183529 | 600.52044403 (5.98766369%) | CONDITIONAL_ON_ASSUMED_FILLS_AND_UNMEASURED_COSTS |
| 15m/60m | stress_2x_20bp | 1483 | 136 | 136 | 0 | -4.72843788 | -0.22949299 | -0.0445236 | 0.69354653 | 669.90938321 (6.68116037%) | CONDITIONAL_ON_ASSUMED_FILLS_AND_UNMEASURED_COSTS |

## Evidence

- Full interval: 2024-10-01T00:00:00Z through 2026-10-01T00:00:00Z exclusive; 1,051,200 trade minutes, 1,051,200 mark minutes, and 2,190 funding events.
- Candidate, order, assumed fill, cost, funding, and daily open-equity ledgers are archived as `b0_candidate_ledger.csv`, `b0_order_ledger.csv`, `b0_fill_ledger.csv`, `b0_cost_ledger.csv`, `b0_funding_ledger.csv`, and `b0_daily_equity_ledger.csv`.
- Full file hashes, frozen rules, cost assumptions, reset/warmup rules, and normalized source-hash reconciliation are in the run JSON and evaluation policy.
- Fills are assumed at the bounded next-open quote. Costs use a 5 bp/side fee placeholder plus 5 bp unmeasured round-trip execution proxy at base; stress cases multiply only that proxy by 1.5x/2x. Funding uses recorded events and event-minute mark open.
- Native reconciliation status: BLOCKED_FULL_HISTORY_PLATFORM_QUOTA_AND_WINDOW_MISMATCH. The temporary exact-source B0 script compiled and passed quick runtime, but TakeProfit rejected 24-month runs at its 5,060-bar plan cap; bounded snapshots returned bars after the requested end date. See `b0_native_takeprofit_reconciliation.json`.

- Independent data audit found 3 5m, 3 15m and 4 1h native/reference conflict bars. The source audit lists their values; these bars were excluded and reset warmup, leaving no conflicts in scored bars. Candidate dispositions and modeled fill/cost accounting checks passed; no position crossed the data end.

## Base-cost uncertainty and concentration

| Profile | 7-day block-bootstrap 95% CI for mean net R/eligible day | Positive PnL in top five winning days | Mean / median / p90 / max hold (minutes) |
|---|---:|---:|---:|
| 5m/15m | [-0.04711206, 0.00593875] | 39.1% | 127.7864 / 52 / 304.59999999999997 / 1057 |
| 15m/60m | [-0.07338868, 0.00449682] | 23.0% | 300.375 / 162.5 / 621 / 2668 |

The interval is conditional on the model and assumed fills. It crosses zero for both profiles; it does not establish positive expectancy.

## Base-cost breakdown by side and regime

| Profile | Side / HTF regime | Closed modeled fills | Net USDT | Net initial R | Win rate |
|---|---|---:|---:|---:|---:|
| 5m/15m | SHORT/HTF_BEAR_BIAS | 78 | -287.27979091 | -13.27872501 | 39.7% |
| 5m/15m | LONG/HTF_BULL_BIAS | 25 | -36.28156153 | -1.8527682 | 44.0% |
| 15m/60m | LONG/HTF_BULL_BIAS | 59 | -228.19411633 | -11.09559278 | 39.0% |
| 15m/60m | SHORT/HTF_BEAR_BIAS | 77 | -271.18958592 | -13.22629271 | 39.0% |

## Base-cost breakdown by UTC exit month

| Profile | Exit month | Closed modeled fills | Net USDT | Net initial R |
|---|---|---:|---:|---:|
| 5m/15m | 2024-10 | 3 | -22.05520008 | -1.03703789 |
| 5m/15m | 2024-11 | 6 | -96.44075429 | -4.54349544 |
| 5m/15m | 2024-12 | 10 | 13.36025665 | 0.66325312 |
| 5m/15m | 2025-01 | 6 | 14.53036485 | 0.55379349 |
| 5m/15m | 2025-02 | 9 | 42.6041849 | 2.13091081 |
| 5m/15m | 2025-03 | 13 | -3.53766245 | -0.08106282 |
| 5m/15m | 2025-04 | 8 | -37.39032037 | -1.79665896 |
| 5m/15m | 2025-10 | 5 | -69.07480812 | -3.31557158 |
| 5m/15m | 2025-11 | 5 | -18.20531657 | -0.94117896 |
| 5m/15m | 2025-12 | 4 | -98.29647935 | -4.71045862 |
| 5m/15m | 2026-01 | 1 | -24.48321082 | -1.16148679 |
| 5m/15m | 2026-02 | 18 | 81.94375387 | 4.1963204 |
| 5m/15m | 2026-03 | 4 | 6.77935747 | 0.2753227 |
| 5m/15m | 2026-06 | 9 | -65.10309384 | -3.057405 |
| 5m/15m | 2026-07 | 1 | -24.0151838 | -1.15105301 |
| 5m/15m | 2026-08 | 1 | -24.17724049 | -1.15568466 |
| 15m/60m | 2024-10 | 4 | 3.98708581 | 0.24742036 |
| 15m/60m | 2024-11 | 16 | -22.62330509 | -1.16915274 |
| 15m/60m | 2024-12 | 9 | -59.94976612 | -2.92073689 |
| 15m/60m | 2025-01 | 6 | 6.63948441 | 0.45011647 |
| 15m/60m | 2025-02 | 5 | -67.32052543 | -3.08766162 |
| 15m/60m | 2025-03 | 13 | 3.29937215 | 0.04094297 |
| 15m/60m | 2025-04 | 8 | -31.30383079 | -1.60445042 |
| 15m/60m | 2025-05 | 1 | 26.89475156 | 1.31158495 |
| 15m/60m | 2025-06 | 1 | -23.71601915 | -1.15305899 |
| 15m/60m | 2025-07 | 2 | -47.93324258 | -2.38690873 |
| 15m/60m | 2025-08 | 1 | 27.36369414 | 1.3513392 |
| 15m/60m | 2025-10 | 4 | -96.00551975 | -4.61496922 |
| 15m/60m | 2025-11 | 11 | -103.03436149 | -5.11027114 |
| 15m/60m | 2025-12 | 3 | -19.79447857 | -1.02049261 |
| 15m/60m | 2026-01 | 3 | -19.02614571 | -1.018862 |
| 15m/60m | 2026-02 | 15 | 115.52241153 | 5.60645216 |
| 15m/60m | 2026-03 | 13 | -158.17280492 | -7.62312982 |
| 15m/60m | 2026-04 | 3 | -20.32740781 | -0.98913807 |
| 15m/60m | 2026-05 | 1 | 28.38936536 | 1.35363602 |
| 15m/60m | 2026-06 | 11 | -1.41101494 | -0.13806976 |
| 15m/60m | 2026-08 | 6 | -40.86144486 | -1.84647561 |

- The machine-readable run manifest records SHA-256 hashes for the source inputs and every generated report/ledger artifact.
## Personal sizing compatibility

The user's stated $1 all-in maximum loss and >$5 target do not align with B0's fixed 1.5R target. If $1 is the all-in stop risk, B0 can gross at most $1.50 at target before costs. This is arithmetic about the configured payoff ratio, not a backtest result.

## Limitations

- No historical best bid/ask or user's account fee rate was provided; 5 bp per side plus an unmeasured impact proxy are assumptions.
- Every submitted model order assumes immediate full fill at the bounded quote. Queue position, partial fills, order rejections, and cancel/fill races are unknown.
- Exchange tick size, minimum quantity, and minimum notional filters are not verified; model sizes below the known 0.001 BTC step are rejected, but platform eligibility remains unknown.
- Funding is event-specific but mark-price notional uses the open of the event minute as a proxy, not an exchange settlement snapshot.
- The evaluation window was previously inspected and is not an untouched holdout.
- The local strategy and indicator hashes match the frozen manifest after UTF-8 LF normalization; raw Windows CRLF hashes are recorded separately in the evaluation policy.
- User's personal risk limits are not used to size this 10,000 USDT research baseline. Account-level daily loss and drawdown limits remain unset.

Profitability remains unproven. Keep feature experiments blocked until native parity, measured execution costs, and a fresh holdout can support an economic decision.
