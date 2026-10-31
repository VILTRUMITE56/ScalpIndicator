# P2 net-dollar-target portfolio feasibility

Generated 2026-10-31T06:20:23.646Z. This is a conditional historical scenario, not observed execution or evidence of profitability.

## Portfolio model

- Starting research cash: $10,000 per profile; one position at a time; no pyramiding.
- The unchanged 15 bp cost/R and 2.5 ATR candidate gates are applied before portfolio constraints.
- Target policy solves for more than $5 net per trade at the rounded strategy-limit fill using the 15 bp round-trip scenario; it targets $5.01 before outward tick rounding. Funding is excluded.
- Separate P2 strategy source passed TakeProfit compile and runtime_quick on 5,000 bars; the ephemeral working copy was not saved.
- A matching two-year native platform backtest was not produced: the connected plan allows 5,060 bars, while the requested 5-minute window required 210,240. See `research/reports/p2_strategy_platform_validation.json`.
- The hidden target quote output is theoretical and can be present even if a later sizing or order eligibility check rejects the candidate; reason code 30 means the rounded target fails the configured net target requirement.
- Orders passing post-rounding quantity, notional, geometry, and $1 modeled stop-risk checks are assumed to fill fully at the rounded 2 bp limit on the decision bar.
- Stop and target are rounded to the captured $0.10 proxy tick. Trade 1m bars determine exits; same-minute stop/target ambiguity is stop-first.
- The round-trip cost scenario is charged once to each modeled P&L result. Funding, spread observations, actual account fees, queue, partial fills, and rejections are unavailable.
- Static tick, quantity, and notional filters are modeled; the dynamic mark-price-based PERCENT_PRICE filter is not modeled.
- Daily drawdown is based on UTC daily close marked equity; it is not intraday maximum drawdown. The 2024-10 through 2026-09 history is inspected development material, not a holdout.

## Results by profile and cost scenario

| Profile | Triggers | 15 bp gate passes | Conditional entries | Closed | Cost | Net P&L | Net PF | Mean net P&L/trade | Max daily close drawdown |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 5m | 5262 | 117 | 66 | 66 | 10 bp | 1.10 | 1.025 | 0.017 | 0.16% |
| 5m | 5262 | 117 | 66 | 66 | 15 bp | -1.56 | 0.967 | -0.024 | 0.18% |
| 5m | 5262 | 117 | 66 | 66 | 20 bp | -4.21 | 0.914 | -0.064 | 0.19% |
| 15m | 1553 | 174 | 75 | 75 | 10 bp | -29.84 | 0.458 | -0.398 | 0.36% |
| 15m | 1553 | 174 | 75 | 75 | 15 bp | -32.74 | 0.433 | -0.437 | 0.38% |
| 15m | 1553 | 174 | 75 | 75 | 20 bp | -35.65 | 0.411 | -0.475 | 0.41% |

## Execution funnel

### 5m

- 5262 candidate events; 117 pass the frozen 15 bp signal gates; 66 receive a hypothetical full fill.
- ASSUMED_FULL_FILL: 66
- COST_TO_R_GATE: 4483
- MINIMUM_QUANTITY: 26
- POSITION_OPEN: 25
- STOP_ATR_GATE: 662

### 15m

- 1553 candidate events; 174 pass the frozen 15 bp signal gates; 75 receive a hypothetical full fill.
- ASSUMED_FULL_FILL: 75
- COST_TO_R_GATE: 1159
- MINIMUM_QUANTITY: 66
- POSITION_OPEN: 33
- STOP_ATR_GATE: 220

## Interpretation

These results impose single-position overlap and cooldown constraints that the candidate-independent shadow study omits. They still assume every eligible limit order fills in full at its modeled limit and use inspected history. They cannot establish realized edge. Treat the 10/15/20 bp results as cost sensitivities, and treat the daily marked drawdown as an end-of-day measure only.

Outputs: `p2_net5_event_ledger.csv`, `p2_net5_trade_ledger.csv`, `p2_net5_daily_equity.csv`, `p2_net5_monthly_summary.csv`, and the machine-readable JSON report.

Reproduce with `node research/p1_portfolio_shadow.mjs --net-target-quote=5.01`.
