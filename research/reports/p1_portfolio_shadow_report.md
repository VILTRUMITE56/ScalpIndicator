# P1 conditional portfolio replay

Generated 2026-10-31T06:18:48.232Z. This is a conditional historical scenario, not observed execution or evidence of profitability.

## Portfolio model

- Starting research cash: $10,000 per profile; one position at a time; no pyramiding.
- The unchanged 15 bp cost/R and 2.5 ATR candidate gates are applied before portfolio constraints.
- Target policy preserves the frozen 1.5R P1 reference.
- Orders passing post-rounding quantity, notional, geometry, and $1 modeled stop-risk checks are assumed to fill fully at the rounded 2 bp limit on the decision bar.
- Stop and target are rounded to the captured $0.10 proxy tick. Trade 1m bars determine exits; same-minute stop/target ambiguity is stop-first.
- The round-trip cost scenario is charged once to each modeled P&L result. Funding, spread observations, actual account fees, queue, partial fills, and rejections are unavailable.
- Static tick, quantity, and notional filters are modeled; the dynamic mark-price-based PERCENT_PRICE filter is not modeled.
- Daily drawdown is based on UTC daily close marked equity; it is not intraday maximum drawdown. The 2024-10 through 2026-09 history is inspected development material, not a holdout.

## Results by profile and cost scenario

| Profile | Triggers | 15 bp gate passes | Conditional entries | Closed | Cost | Net P&L | Net PF | Mean net P&L/trade | Max daily close drawdown |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 5m | 5262 | 117 | 76 | 76 | 10 bp | -8.29 | 0.769 | -0.109 | 0.09% |
| 5m | 5262 | 117 | 76 | 76 | 15 bp | -11.33 | 0.700 | -0.149 | 0.12% |
| 5m | 5262 | 117 | 76 | 76 | 20 bp | -14.37 | 0.637 | -0.189 | 0.15% |
| 15m | 1553 | 174 | 92 | 92 | 10 bp | -13.70 | 0.700 | -0.149 | 0.14% |
| 15m | 1553 | 174 | 92 | 92 | 15 bp | -17.29 | 0.640 | -0.188 | 0.18% |
| 15m | 1553 | 174 | 92 | 92 | 20 bp | -20.88 | 0.585 | -0.227 | 0.21% |

## Execution funnel

### 5m

- 5262 candidate events; 117 pass the frozen 15 bp signal gates; 76 receive a hypothetical full fill.
- ASSUMED_FULL_FILL: 76
- COST_TO_R_GATE: 4483
- MINIMUM_QUANTITY: 30
- POSITION_OPEN: 11
- STOP_ATR_GATE: 662

### 15m

- 1553 candidate events; 174 pass the frozen 15 bp signal gates; 92 receive a hypothetical full fill.
- ASSUMED_FULL_FILL: 92
- COOLDOWN: 2
- COST_TO_R_GATE: 1159
- MINIMUM_QUANTITY: 73
- POSITION_OPEN: 7
- STOP_ATR_GATE: 220

## Interpretation

These results impose single-position overlap and cooldown constraints that the candidate-independent shadow study omits. They still assume every eligible limit order fills in full at its modeled limit and use inspected history. They cannot establish realized edge. Treat the 10/15/20 bp results as cost sensitivities, and treat the daily marked drawdown as an end-of-day measure only.

Outputs: `p1_portfolio_event_ledger.csv`, `p1_portfolio_trade_ledger.csv`, `p1_portfolio_daily_equity.csv`, `p1_portfolio_monthly_summary.csv`, and the machine-readable JSON report.

Reproduce with `node research/p1_portfolio_shadow.mjs`.
