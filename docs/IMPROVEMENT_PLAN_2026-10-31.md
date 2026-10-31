# Indicator assessment and improvement plan

Assessed 31 October 2026, Asia/Manila. Repository: `main`, starting commit `aec9e43`. The report's original findings and plan are followed by implementation updates documenting cost, execution diagnostics, and portfolio/target feasibility changes.

## Implementation update, 31 October 2026

The first economic and observability fixes are now implemented in the local P1 strategy. Its 15 bp cost/R signal gate and 15 bp execution-risk reserve use the same frozen round-trip scenario. The strategy no longer adds another 10 bp of assumed commission to its size denominator. This is a sizing reserve, while TakeProfit separately books simulator commission in cash P&L; funding and non-fee execution costs remain assumed or unavailable.

Each triggered candidate now emits three hidden numeric series: candidate event, execution reason, and trigger time in UTC seconds. The reason distinguishes candidate risk gates, open/pending/cooldown states, invalid rounded levels, minimum size/notional, risk budget, and a strategy submission request. A request output does not claim exchange acceptance or a fill.

P1's 1.5R target, research risk cap, stop limits, 15 bp scenario, and signal conditions remain unchanged as a baseline. For a separately versioned P2 feasibility test, the recorded greater-than-$5 objective is now interpreted as strictly more than $5 net after the modeled 15 bp round-trip cost, excluding funding. The P2 target was calculated from post-rounded quantity and price; its replay loses and it is not promoted. Funding and actual execution costs remain outside the modeled target.

The exact local P1 indicator and strategy passed TakeProfit compile and `runtime_quick` checks on disposable 5,000-bar copies before the B4 change. The updated 887-line indicator also compiles on TakeProfit working copy v29; its runtime quick was not run. The separate P2 strategy source passed both checks on 5,000 bars. Working copy v29 exactly matches local, but saving it was rejected because it is based on saved v16 while v19 is latest; no new saved platform version exists. A two-year native P2 backtest request was rejected by the connected plan's 5,060-bar limit (210,240 bars requested). A bounded P2 probe completed with zero trades and an insufficient-history flag; its reported last-bar timestamp falls outside the requested date range, so it is not a valid performance sample. The separate offline portfolio replay on inspected history is negative under modeled fills.

The 31 October source reconciliation confirms the TakeProfit v29 indicator draft matches local P1 but remains unsaved due to its stale base; the v21 strategy draft still differs from local, and active chart/alert binding remains unknown. The new [paper-shadow capture workflow](../research/paper_shadow/README.md) locks local source hashes and refuses capture until source, venue, fees, filters, and funding are confirmed. P1 remains the reference; the P2 net-dollar target is a negative feasibility experiment and is not an active recommendation.

### Local indicator update: B4 anti-chase gate

The local P1 indicator now has an off-by-default B4 option that rejects an otherwise eligible trigger only when its completed close is more than 1.0 trigger-bar ATR(14) from EMA20 in the signal direction. It also reports the signed extension in ATR and emits a distinct reason code and research-panel rejection count. The threshold was pre-registered in the experiment plan; this code change is an implementation of that hypothesis, not evidence that it improves net expectancy. The P1/P2 strategies remain unchanged, so enabling B4 in the indicator creates a candidate-parity difference. Keep it off for the baseline and do not use enabled signals for execution until the strategy is updated and the exact local sources are validated together.

The refreshed source and event definitions are in [`research/templates/strategy_candidate_adapter.indie.in`](../research/templates/strategy_candidate_adapter.indie.in), [`indie/btc_pullback_strategy_p1.indie`](../indie/btc_pullback_strategy_p1.indie), [`research/specs/candidate_contract_p1.json`](../research/specs/candidate_contract_p1.json), and [`CANDIDATE_EVENT_OUTPUTS_P1.md`](CANDIDATE_EVENT_OUTPUTS_P1.md).

The new [P1 conditional portfolio replay](../research/reports/p1_portfolio_shadow_report.md) applies one-position overlap, cooldown, 15 bp cost/ATR gates, rounded contract sizing, minimum notional, and the $1 modeled-loss cap. It produces 76/117 conditional entries on 5m and 92/174 on 15m. At 15 bp the modeled P&L is -$11.33 (PF 0.700) and -$17.29 (PF 0.640), respectively; both profiles are negative at 10, 15, and 20 bp. This assumes every eligible limit fills fully, uses a $10,000 research balance per independent profile, excludes funding and dynamic PERCENT_PRICE rejects, and uses an inspected period rather than a holdout. Actual orders and fills remain unknown. See the [portfolio manifest](../research/P1_PORTFOLIO_SHADOW_MANIFEST.json).

The [separate P2 net-target feasibility run](../research/reports/p2_net5_target_feasibility_report.md) implements the recorded >$5 objective as >$5 net after the modeled 15 bp cost. It hit target 14 times and stopped out 127 times; combined net P&L was -$34.30 with a 9.9% win rate. 5m was nearly flat while 15m was materially negative. Its local strategy source compiles and passes quick runtime validation, but a full-period TakeProfit backtest is blocked by the connected plan bar limit. The bounded platform probe produced no trades, insufficient history, and a requested-period/last-bar timestamp mismatch. P2 is not promoted; see its [policy](../research/specs/p2_net_target_policy.json), [platform validation record](../research/reports/p2_strategy_platform_validation.json), and [manifest](../research/P2_NET_TARGET_MANIFEST.json).

**Recommendation: retain P1 as the research baseline and do not promote P2. Current evidence does not establish a profitable scalping strategy.** The one-position P1 replay loses at every cost case. The P2 target that aims for more than $5 net also loses, mostly through stop-outs, and substantially extends holds. Do not add filters or raise the target again on the same inspected period.

The current source map and hashes are in the [source reconciliation report](../research/SOURCE_RECONCILIATION_2026-10-31.md). Resolve which exact source is attached to the chart, confirm the intended venue and current fee/filter/funding inputs, then collect forward paper-shadow events with the [capture tool](../research/paper_shadow/README.md). Do not start collection while the run manifest remains `DRAFT`.

## 1. What is already good, and what the results actually say

The repository contains two different projects. Root-level `ScalpFlow_Pro*.indie` is the older EMA/RSI/ADX/volume confluence system. The README identifies `indie/btc_pullback_*` as the canonical BTC perpetual research project: frozen B0 sources and an experimental P1 revision. Continue from P1; keep the older family as an explicitly labeled archive rather than mixing its scores and results into P1.

P1 has useful engineering foundations: completed-candle decisions, completed higher-timeframe bias, a recovery/touch/trigger state machine, frozen structural invalidation, stable event IDs, a generated shared candidate block, an independent JavaScript reference engine, and explicit separation of planned quotes from fills. Data-gap resets, order-state fixtures, contract rounding fixtures, and conditional cost studies already exist. Rebuilding these is unnecessary.

The strongest retained economic evidence is:

| Evidence | 5m execution / 15m bias | 15m execution / 1h bias | Interpretation |
| --- | ---: | ---: | --- |
| B0 modeled closed trades, 24 months | 103 | 136 | Assumed fills; separate profile simulations |
| B0 net profit factor, base 15 bp | 0.782 | 0.751 | Below 1 means modeled gross losses exceed modeled gross profits after costs |
| B0 mean net initial R/trade | -0.147R | -0.179R | Negative under the declared model |
| B0 open-equity maximum drawdown | 3.77% | 5.29% | Based on the 10,000-USDT research account, not the user's personal account |
| B0 median holding time | 52 minutes | 162.5 minutes | The current rules often behave more like intraday trades than quick scalps |
| P1 raw candidate triggers | 5,262 | 1,553 | Candidate counts, not trades |
| P1 passes at 15 bp and existing stop cap | 117 (2.22%) | 174 (11.20%) | Before actual fills and portfolio constraints |

Sources: [B0 costed report](../research/reports/b0_costed_baseline_report.md), [P1 economics report](../research/reports/candidate_economics_report.md), and [P1 conditional portfolio replay](../research/reports/p1_portfolio_shadow_report.md). The scoring interval is October 2024 through September 2026. It has already been inspected and cannot be reused as an untouched final test. B0 uncertainty intervals cross zero, so the results do not prove the strategy must always lose, but they provide no basis for claiming a positive edge. Candidate-independent P1 outcomes are negative at 15 bp. The separate portfolio replay includes one-position overlap, cooldown, rounded sizing and a $1 modeled stop-risk cap; it remains conditional on hypothetical fills and its 5m and 15m profiles also lose at 10/15/20 bp.

The latest retained native risk-adapter diagnostic has zero 5m trades and one losing 15m simulated trade, both with insufficient-history flags. Earlier zero-trade reports are therefore not the complete current story. One simulated loss is still insufficient to estimate profitability. [Native diagnostic](../research/reports/p1_native_risk_backtest_summary.json)

## 2. Highest-priority findings

### F1. Local, working-copy, and saved-platform versions differ

Fresh TakeProfit MCP reads during this assessment found:

| Script | Local P1 source | Connected working copy | Saved-platform status |
| --- | --- | --- | --- |
| Indicator | 887 lines, includes compact/research views, B4 option, and numeric event outputs | v29, 887 lines; exact local match | Unsaved; compile passed; based on platform v16 while latest saved is v19; save rejected as stale |
| Strategy | 545 lines, includes $1 modeled-loss cap and contract-grid adapter | v21, 507 lines; different source | Unsaved and not linked to a saved private strategy |

The remote strategy lacks the local `maximum_loss_quote` cap and newer minimum/maximum contract controls. A chart or backtest using that working copy does not test the latest local risk adapter. The remote indicator lacks the latest event-output and compact-view additions. Do not infer which source is attached to a live chart from the working-copy listing alone.

**Deliverable:** one version table mapping local source hash, working-copy ID/version, saved UID/version, and chart instance. Preserve the existing saved v19 and unsaved work, compare changes, and prepare the current research release under an unambiguous identity. Validate the exact source selected for publication and then check chart parameters and symbol. Do not overwrite the newer saved version blindly.

### F2. Cost assumptions differed between qualification and sizing — code fix complete; measured costs remain open

The historical local strategy adapter computed:

```text
execution_cost_per_btc = order_limit_quote * (cost_fraction + 0.001)
```

**Status:** the former 25 bp sizing reserve is corrected locally to 15 bp, matching the unchanged 15 bp signal gate. The cost contract now documents simulator commission cashflows separately from the hypothetical round-trip reserve. Candidate counts and independent-event outcomes remain unchanged; no new profitability edge is claimed.

At defaults, sizing therefore reserves **25 bp**, while qualification uses **15 bp**. The native simulator separately deducts its configured 5 bp commission per side; its reported P&L does not debit the complete spread/slippage reserve. This is a confirmed semantic mismatch, not proof of a double debit to realized P&L. If 15 bp is intended to be the total, sizing reserves commission twice; if it is intended as non-fee drag, the qualification and report labels are inconsistent.

**Completed:** versioned cost semantics are recorded in `specs/candidate_contract_p1.json` and `specs/execution_cost_risk.json`; the local order-risk reserve now matches the signal gate, and simulator commission cashflows remain distinct from the hypothetical execution reserve.

**Status:** the conditional P1 portfolio replay is now generated under documented assumed-fill rules. Remaining acceptance is to reconcile hand-calculated long/short examples against observed venue/account costs when those are available; the inspected replay does not establish realized fee or fill parity.

### F3. The recorded profit objective conflicts with the programmed target

The project records $5-$10 isolated margin, 20x-50x leverage, an intended maximum loss of $1 including fees/slippage, and a target above $5. Following the user's direction, the P2 feasibility policy interprets that objective as more than $5 net after the hypothetical 15 bp round-trip cost, excluding funding. Account rates, execution venue, actual funding, and personal daily/drawdown limits remain unconfigured.

B0 and P1 use a **1.5R gross target**. With at most $1 all-in risk, their gross planned reward is less than $1.50 when costs are positive. They cannot meet a planned target above $5 with that geometry.

For illustration only, suppose round-trip cost is 15 bp of entry notional, excluding funding, and the desired target is **net** $5:

| Position notional | Assumed cost | Maximum price-stop distance within $1 | Price move needed for net profit above $5 | Minimum gross reward/risk required, approximately |
| --- | ---: | ---: | ---: | ---: |
| $100 | $0.15 | 0.85% | >5.15% | >6.06R |
| $250 | $0.375 | 0.25% | >2.15% | >8.60R |
| $500 | $0.75 | 0.05% | >1.15% | >23R |

Calculations use `loss = N * stop_fraction + N * c`, `net_target = N * target_fraction - N * c`, and `gross_R > (5 + N*c)/(1 - N*c)`. They approximate equal entry/exit notionals and exclude funding, adverse gaps, and liquidation. They are feasibility examples, not suggested trades or guaranteed loss limits.

The existing gate also imposes `c / stop_fraction <= 0.20`. At 15 bp, the price stop must be at least **0.75%**. Combining that with a $1 all-in budget yields roughly **$111 maximum notional** before rounding and other costs. The $250/$500 examples fail that current gate despite having a nominal $1 stop budget. Minimum quantity can make even the smaller position infeasible.

**Completed as a feasibility study:** P2 solves a tick-rounded target from position quantity so modeled net profit exceeds $5 at 15 bp. The replay produced 14 target hits and 127 stops across 141 conditional entries, with a 9.9% win rate and -$34.30 combined net P&L at 15 bp. P2 also increases the upper-median holding estimate to 211 minutes. It is not promoted because both profiles lose, the 15m result is materially negative, and fills/costs are hypothetical. No leverage or active P1 defaults were changed. See the [P2 policy](../research/specs/p2_net_target_policy.json), [feasibility report](../research/reports/p2_net5_target_feasibility_report.md), and [manifest](../research/P2_NET_TARGET_MANIFEST.json).

### F4. The signal lacks enough movement relative to costs

With stop distance capped at 2.5 ATR and cost capped at 0.20R, a necessary condition is:

```text
ATR / entry_price >= cost_fraction / (2.5 * 0.20)
```

That means at least 0.20%, 0.30%, or 0.40% ATR/price for the 10/15/20 bp scenarios respectively. Actual stops below 2.5 ATR require more volatility. Only **291 of 6,815** P1 candidates pass at 15 bp. Median touch ATR/price is approximately 0.15% on 5m and 0.279% on 15m. [Feasibility report](../research/reports/candidate_economics_report.md)

The 15m profile remains only a better **economic feasibility starting point**, not a demonstrated better performer: its B0 net expectancy is more negative. At the candidate gate rate, 100 eligible events would take roughly 60 weeks on 15m or 89 weeks on 5m before portfolio restrictions. The P1 one-position model retains 92 15m and 76 5m entries in two years; the P2 >$5 net-target model retains 75 and 66, with a lower win rate and longer holds. Reaching 100 assumed fills would take roughly 113-137 weeks under P1 and 139-158 weeks under P2 if historical rates continued. These are retrospective averages, not forecasts or guarantees. An eight-week paper test cannot provide a large sample.

**Deliverable:** a funnel after every step: ready bars, setups, triggers, cost pass, rounded-size pass, available-position pass, submitted orders, fills, and completed exits. The portfolio shadow report now counts candidate gates, rounded-size rejects, position/cooldown blockers, conditional submissions, and assumed exits; observed orders and fills remain unknown.

### F5. Engineering tests do not establish venue execution parity

The risk verifier confirms 24 stored fixtures, but real account fills, account fees, and observed slippage remain absent. The native adapter does not enforce the dynamic Binance mark-price-based `PERCENT_PRICE` filter. Its minimum-size/notional failures also fall through without a complete persistent rejection record. An indicator can consequently show a valid planned setup while the strategy cannot place its rounded order.

TakeProfit documents a next-price-update delay for actions and models position-level brackets in its emulator according to Bybit-style behavior. A Binance data series does not turn that emulator into a Binance matching engine. [Strategy mechanics](https://takeprofit.com/docs/indie/Strategies/Strategy-mechanics), [orders documentation](https://takeprofit.com/docs/indie/Strategies/Orders).

**Deliverable:** retain common candidate events, then report execution-specific blockers separately. Reconcile closed/reloaded native events against the independent engine over identical timestamps and warmup. Reconcile fills and protective exposure only against the chosen execution venue's records. Treat quote, order acceptance, partial fill, and completed trade as different states.

Historical best-bid/ask coverage for the B0 interval is not established; the project's documented public archive checks found missing files. Start prospective quote/latency capture for a new study when an execution feed is selected. Future quotes cannot repair historical fills retroactively. [Execution boundary and quote-coverage evidence](TAKEPROFIT_BINANCE_EXECUTION_BOUNDARY.md)

## 3. Which strategy ideas are worth researching?

Research supports testing simple, interpretable families, but does not identify a verified profitable BTC scalping strategy to copy. Academic time-series momentum evidence concerns much longer horizons and cannot validate a five-minute EMA setup. [Moskowitz, Ooi and Pedersen, Time Series Momentum](https://www.aqr.com/Insights/Research/Journal-Article/Time-Series-Momentum).

The following ranking is my assessment of fit and implementation cost, not measured performance. All thresholds below are experimental starting rules retained from the existing registry.

| Priority | Hypothesis | Exact initial comparison | Why it may help / main failure mode |
| --- | --- | --- | --- |
| 1 | B4: avoid extended entries | Add only `side * (trigger_close - EMA20) / trigger_ATR <= 1.0` to the chosen reference | May avoid chasing an already expanded candle; can remove the strongest continuation trades |
| 2 | B1: trend strength | Add only completed execution-timeframe ADX(14,14) >= 20 | May exclude sideways EMA crossings; ADX lags and may reject early trends |
| 3 | B2: session VWAP alignment | Add only trigger close above daily HLC3 VWAP for longs, below for shorts; 00:00 UTC anchor, at least six completed session bars | Adds volume-weighted context; crypto has no universal session open and the filter may duplicate EMA bias |
| 4 | B5: Donchian breakout/retest alternative | Completed close breaks the preceding 20-bar channel; freeze level and breakout ATR; evaluate a later retest within three bars with 0.1 breakout-ATR tolerance | Different entry hypothesis that may capture expansion; vulnerable to false breaks and worse execution around fast moves |
| 5 | B3: participation filter | Add only trigger volume / mean(previous 20 completed volumes) >= 1.2; exclude trigger from denominator | May identify participation; high volume can instead mean exhaustion and greater impact |

ADX measures trend strength rather than direction; the existing higher-timeframe bias supplies direction. The threshold of 20 is a hypothesis, not a probability of winning. [Fidelity DMI/ADX guide](https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/DMI).

VWAP is a cumulative volume-weighted average and can lag. A UTC daily anchor is our reproducible convention, not evidence that it is the best crypto session. [TradingView VWAP documentation](https://www.tradingview.com/support/solutions/43000502018-volume-weighted-average-price-vwap/).

Donchian channels define prior-range boundaries; their documented breakout use supports the family choice, not the profitability of a three-bar retest or a particular target. Before B5 implementation, freeze its exact long/short touch, close confirmation, invalidation, stop, gap, and expiry rules. No pivots may be used before their confirming bars. [TradingView Donchian documentation](https://www.tradingview.com/support/solutions/43000502253-donchian-channels-dc/).

TakeProfit MCP confirms a built-in ADX with `adx_len` and `di_len`. Marketplace searches also returned “Triangle & Wedge Breakout Pro” and “Breakout Finder (BF)”, but the returned descriptions and parameter metadata provide no independently verified net-performance evidence. They are feature references, not recommended replacements.

Defer RSI/Stochastic/MACD stacking, Supertrend replacement, automatic regime switching, and order-flow/CVD features. The legacy ScalpFlow already combines correlated momentum inputs; its 0-100 confluence score is not a calibrated probability. Mean-reversion/Bollinger systems are a separate hypothesis with different failure modes and should not be blended into this trend strategy without an independent evaluation. Order-flow work first needs suitable historical trades/quotes and latency evidence.

## 4. Ordered implementation work

| Work package | Concrete output | Completion gate |
| --- | --- | --- |
| A: reconcile identity and objectives | Current-source/platform map; archived older versions; explicit cost and payoff contracts | Same named version means the same source; target and risk arithmetic is internally consistent |
| B: repair economics and observability | Shared cost components, post-rounding risk/target calculations, all execution rejection codes, executable-size funnel | Golden long/short examples agree; every candidate has a recorded disposition |
| C: establish comparable P1 evaluation | Portfolio replay with one position, pending-order/cooldown rules, partial/unfilled scenarios, costs, funding, open equity; native event comparison | P1 has its own full costed report; candidate versus execution differences explained |
| D: bounded strategy comparisons | Registered B4/B1/B2/B5/B3 comparisons against an unchanged reference, with all failed trials retained | A candidate survives chronological validation and cost stress with sufficient activity |
| E: prospective paper reconciliation | Fixed source/settings, quote/latency observations, observed paper fills where available, event and execution logs | Signal persistence, costs, fills, and outcome accounting reconcile; enough time and trades for inference |

A and B can proceed using synthetic assumptions without waiting for account credentials. During C, missing historical quotes must produce conditional scenario results rather than fabricated fill certainty. D remains conditional on the revised hypothesis and a coherent C report; no feature trial was run as part of this assessment.

Keep frozen B0 unchanged. P1 changes the entry state machine, so future improvements must be compared to an explicitly frozen P1 reference as well as reporting B0 for context. Do not reuse B0 results as P1 results. Amend the existing experiment registry before trials so B1-B5 retain their meaning but name their exact P1 parent, payoff policy, and costs.

Retain the existing **22-configuration ceiling**, with an explicit proposed allocation: 12 initial configurations (reference plus five isolated variants, on each of two profiles), up to two combinations, up to four conditional payoff alternatives, and four robustness variants. The payoff slots must be rewritten to match the chosen objective; do not run the stale 1.2R/2R options by default. Additional targets, filters, timeframes, or discretionary selections count as trials and require revising the disclosed budget before testing. Retain the 22 older run records separately as prior research history.

## 5. Validation and promotion rules

Use chronological development and validation folds with fixed parameters for each subsequent fold; never random train/test shuffles. Earlier history may supply warmup only. Purge training outcomes that overlap the validation start and record how preexisting positions are treated. Already inspected 2024-2026 periods are development material even when subdivided into folds. Reserve a genuinely unexamined period or a prospective period beginning after code/settings are locked for the final decision.

Select the primary objective before testing: mean net R per eligible day, subject to net expectancy per completed trade, executable activity, and the chosen risk constraints. Report profit factor, daily open-equity drawdown, holding times, costs/R, fill rate, long/short results, and monthly/regime breakdowns. Use paired calendar-day comparisons against the reference, including no-trade days, with block-bootstrap uncertainty. Show the effect of removing the largest winning days without choosing the variant on that diagnostic alone.

Suggested engineering promotion gates, not guarantees or statistical laws:

- Positive net expectancy in the untouched evaluation, with a positive lower confidence bound when a meaningful interval can be estimated. Otherwise classify the edge as inconclusive.
- Net profit factor at least 1.25 as a provisional buffer, with sufficient observations and without concentration in a few exceptional days.
- Positive expectancy when the non-fee execution component is stressed at 1.5x and 2x; charge fees and event-specific funding separately. Hypothetical stresses remain labeled hypothetical until measured.
- Target approximately 300 out-of-sample completed trades across different conditions. A fixed count cannot establish independence or significance; sparse profiles need longer observation.
- At least eight calendar weeks and 100 reconciled completed paper trades, extending until both are met. Never force more trades to meet the quota.
- Drawdown must be reported against a clearly identified research sizing policy. Personal daily/drawdown locks stay disabled as recorded; the old 8% research threshold is not a user-approved account limit.
- Zero unexplained closed-bar/reload candidate differences; no duplicate entry, accidental reversal, or unprotected residual exposure in the modeled lifecycle.

Parameter search itself can manufacture apparently attractive results. Preserve every tested configuration and a final evaluation that has not influenced selection. [Bailey et al., The Probability of Backtest Overfitting](https://www.davidhbailey.com/dhbpapers/backtest-prob.pdf).

Stop or pivot if the required payoff cannot be reached often enough, costs consume the movement, the observed edge disappears on fresh data, or sample collection is impractical. A slower intraday strategy is a legitimate alternative, but it must be named and tested as such; it is not automatically a better scalper.

## 6. User-facing improvements

The compact/research views and numeric candidate outputs are already implemented locally. Finish version reconciliation and reload validation before rebuilding the panel. Add cost composition, expected net target, rounded quantity, modeled all-in loss, rule version, and a persistent no-trade reason. Display “candidate qualified” separately from “order eligible” and “observed fill”. An indicator without account/order access cannot certify live size or protective coverage.

Retain long and short outcomes separately. If a quality score is retained, label it heuristic until its relationship to forward outcomes is calibrated on unseen data; do not display an invented win probability. A valid setup that is too expensive or too small to execute should be an informative rejection, not a buy/sell recommendation.

## 7. Verification completed for this assessment

- Inspected canonical B0/P1 sources, shared templates, legacy ScalpFlow logic, cost/risk contracts, retained economic reports, and execution-boundary documentation.
- Used the connected TakeProfit MCP to list and read both P1 working copies, compare their source with local files, inspect official execution documentation, and discover built-in/marketplace candidates.
- `node research/generate_candidate_logic.mjs --check`: passed; local indicator and strategy match their generator templates.
- The P1 shadow study was regenerated after the cost-contract wording was made explicit. It still finds 6,815 candidate events and 291 pass the unchanged 15 bp/stop gates; it consumes no new signal variants and retains assumed fills.
- `node research/verify_candidate_economics_manifest.mjs`: passed; 9 input hashes and 22 artifact hashes verified, 6,815 candidates, 291 passes at 15 bp.
- `node research/verify_contract_risk_manifest.mjs`: passed; 13 artifact hashes verified and 24 stored passing fixtures checked. This verifies the retained evidence bundle; it is not a fresh exchange execution test.
- `node research/p1_portfolio_shadow.mjs` and its manifest verifier: passed; 6,815 candidate events were dispositioned, 291 passed the existing signal gates, and 168 passed the assumed single-position rounded-size policy. At 15 bp, the conditional 5m and 15m reports show net P&L of -$11.33 / -$17.29 with PF 0.700 / 0.640. Actual orders and fills remain unknown; funding and dynamic PERCENT_PRICE rejection are not modeled.
- `node research/p1_portfolio_shadow.mjs --net-target-quote=5.01` and its P2 manifest verifier: passed; every rounded target models more than $5 net at 15 bp, but the conditional portfolio loses -$34.30 across 141 trades (14 targets, 127 stops, 9.9% win rate). P2 is a feasibility result, not a promoted strategy or observed performance.
- Independently checked the B0 report manifest's 19 input/artifact hashes: all match.
- No new native platform backtest or feature optimization was run. Retained native coverage limitations and current source drift make a fresh short-window run insufficient to answer profitability.

The cost contract, source-version provenance, per-candidate execution reason outputs, and conditional P1 portfolio replay are now recorded. The target objective is fixed for the P2 feasibility study, but actual costs and fills are unknown. The next evidence gate is reconciling local/platform identity and evaluating the unchanged P1 reference prospectively. Do not promote the P2 target or choose additional filters from the already-inspected period.
