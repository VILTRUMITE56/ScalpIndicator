# BTC perpetual scalping: current assessment and upgrade roadmap

Assessment date: 30 October 2026. Scope: the BTC Pullback project in indie/, strategy working copy v16 and indicator working copy v24. ScalpFlow Pro is a separate legacy source in this repository. This document supplements the earlier implementation plan and changes the immediate priority to economic feasibility before optional filters.

## 1. Decision: is the project promising?

The project is worth a bounded research effort because its rules are explicit, it has a companion strategy, and it already records important reasons for rejecting setups. It has a useful engineering foundation. There is currently no demonstrated profitable edge, reliable win-rate estimate, or evidence that another indicator will improve it.

The strongest adverse evidence is inactivity under the current cost/risk policy. The latest strategy runs have no completed trades, and the displayed chart rejects every trigger candidate. The appropriate next investment is a reproducible economic and correctness assessment with a stop/pivot decision, rather than an indefinite sequence of new filters.

| Area | Evidence today | Assessment |
| --- | --- | --- |
| Executability | Both current scripts previously passed TakeProfit compile and runtime_quick on 5,000 bars | Basic compatibility verified; live/reload semantics still need observation |
| Signal specification | EMA20/50 bias, completed higher timeframe, frozen touch ATR/invalidation, one-shot setup, stop/cost guards | Explainable; independent event agreement has not been demonstrated |
| Trade economics | Default cost policy implies at least 0.75% stop and 1.125% gross target | A major constraint for frequent 5m scalping |
| Performance | Latest v16 runs: zero completed trades; incomplete history | Net expectancy, win rate, profit factor, and traded drawdown are undefined |
| Chart usability | Explicit research labels and rejection counters | Useful diagnostic view; default view is crowded and lacks durable event IDs |
| Deployment | v24 unsaved against base platform v16; latest saved version v19 | Source reconciliation remains outstanding |

The mission is a BTC perpetual indicator with understandable LONG/SHORT candidates, proposed entry, SL and TP, backed by positive net expectancy after execution costs and an acceptable drawdown. A 5-minute chart describes decision frequency; it does not guarantee a five-minute holding period. Treat 5m/15m bias and 15m/1h bias as separate products during evaluation.

## 2. What the retained evidence actually says

The latest saved snapshots in [results/v4/backtests.json](../results/v4/backtests.json) request:

| Profile | Requested UTC period | Completed trades | Recorded order activity | History sufficient |
| --- | --- | ---: | --- | --- |
| 5m execution / 15m bias | 13 October 12:00 to 30 October 10:30, 2026 | 0 | None | No |
| 15m execution / 1h bias | 9 September 12:00 to 30 October 10:30, 2026 | 0 | One canceled, unfilled short limit | No |

Both runs use a 15 bp round-trip eligibility/sizing assumption and 5 bp commission per execution. The 15 bp input is not a complete realized cost charge in the backtest. Historical spread, slippage, and funding cash flows are missing.

The screenshot retained with that report shows 3,502 trend bars, 254 touch events, 101 trigger candidates, zero accepted, ten stop rejects and 91 cost rejects. Cost rejects represent 90.1% of those triggers. These counts come from the chart model; their loaded window is not proven identical to the strategy window.

Earlier v14 results contain only one winning 5m trade and two losing 15m trades. Earlier v1 sensitivity runs contain an audited overlapping-exit defect that opened unintended positions. Those artifacts are historical diagnostics, not evidence for the current strategy. Preserve them with their invalid/superseded labels.

No new performance backtest or feature experiment was run for this assessment.

## 3. The most important finding: the cost policy restricts the strategy's horizon

This follows directly from indicator lines 518, 534 and 538 and strategy lines 397 and 412.

Let P be the entry reference, D the initial stop distance, c the estimated round-trip cost fraction, and A the frozen setup ATR.

Current requirements are:

    Cost per BTC = c * P
    Cost / D <= 0.20
    D <= 2.5 * A

Together these require:

    D / P >= c / 0.20
    A / P >= c / (0.20 * 2.5)

At the default c = 0.0015, a qualifying setup needs a stop of at least 0.75% of entry and setup ATR of at least 0.30% of entry. A 1.5R target is therefore at least 1.125% away. At an illustrative BTC price of $81,000, the minimum stop is $607.50 and the minimum target move is $911.25. These are derived requirements, not forecasts.

| Hypothetical total round-trip cost | Minimum stop at the existing 0.20 cost/R cap | Necessary minimum ATR/price at the 2.5 ATR stop cap | Minimum gross 1.5R target |
| ---: | ---: | ---: | ---: |
| 10 bp | 0.50% | 0.20% | 0.75% |
| 15 bp | 0.75% | 0.30% | 1.125% |
| 20 bp | 1.00% | 0.40% | 1.50% |

Passing the ATR condition is necessary, not sufficient. Structure, invalidation, timing and other guards can still reject a setup. The restriction is consistent with the screenshot's inactivity; an eligible-hours ledger is needed to measure how often it binds across market conditions.

The 0.20R cap is an experimental policy, not a mathematical condition for profitability. With idealized 1.5R winners, 1R losers and constant cost k measured in initial R:

    Net expectancy/R = 2.5 * win_probability - 1 - k
    Break-even win rate = (1 + k) / 2.5

For k = 0.20, 0.40 and 0.60, break-even is 48%, 56% and 64%, respectively. Actual fills and variable outcomes require a trade ledger.

Recommended response:

1. Keep current rules frozen as a reference.
2. Observe all pre-cost candidates in an offline shadow ledger and charge realistic costs to their simulated outcomes.
3. Measure net expectancy, opportunity count, holding duration and cost/R across volatility buckets.
4. Consider a different cost/R policy only as a registered experiment supported by those observations. Keep the assumed dollar cost grounded in venue evidence.
5. If plausible costs consume the available move, evaluate the slower profile or a different entry family. Leverage does not improve cost/R.

Adding ADX, VWAP and volume gates before this work would reduce an already sparse opportunity set without establishing better economics.

## 4. Established approaches: what is transferable?

The reviewed evidence supports testing simple rules; it does not identify an audited, currently profitable 5m BTC perpetual recipe to copy.

Deprez and Frommel (2024) studied 75,360 technical rules and selected portfolios using a multiple-hypothesis procedure before evaluating them out of sample after costs. Their reported historical outperformance supports simple technical-rule research. Their data are Bitstamp BTC/USD trades from 2012-2022, and their framework does not allow shorting. That differs materially from current perpetual scalping. The accessible publisher abstract and sections do not justify importing a win rate, profit factor, or individual rule as our expected performance. [Research paper](https://www.sciencedirect.com/science/article/pii/S1059056024003010)

Wen and coauthors report both intraday momentum and reversal. Their abstract and described hourly timing analysis support examining market conditions, rather than assuming one trend rule works throughout the day. They do not validate our exact trigger, timeframes or perpetual execution. [Publisher record](https://www.sciencedirect.com/science/article/pii/S1062940822000833)

| Established tool/family | What it contributes | Proposed role in this project | Limitation |
| --- | --- | --- | --- |
| EMA trend/pullback | A transparent direction and recovery framework | Keep as baseline and compare against a simpler benchmark | Existing EMA conditions overlap; adding more averages may add delay |
| ADX/DMI | ADX measures trend strength; direction needs other information | Isolated B1 test: completed ADX(14,14) >= 20 | Lag and redundancy with EMA bias; 20 is an experiment value |
| Daily VWAP | Volume-weighted intraday price location | Isolated B2 test: correct side of HLC3 VWAP reset at 00:00 UTC | UTC day is a chosen crypto convention; VWAP can lag |
| Relative volume | Activity relative to prior volume | Isolated B3: trigger volume / mean of preceding 20 bars >= 1.2 | Exchange-specific volume; spikes can accompany exhaustion |
| Donchian breakout/retest | A distinct continuation entry family | B5 alternative: prior 20-bar channel, later retest, common execution model | False breaks; breakout candle must be excluded from channel |
| Supertrend | ATR-based trend and stop framework | Defer; test later as a replacement direction/exit model | Strong overlap with existing EMA/ATR logic; it is not an independent confidence vote |
| Bollinger Bands | A volatility envelope useful for squeeze or reversion research | Defer to a separate regime/entry hypothesis | Band touches can persist during trends; automatic fading can fight momentum |
| RSI/MACD confirmation stacks | Additional transforms of recent price | Defer until a specific weakness and incremental value are demonstrated | More correlated gates and trials do not imply more reliable signals |

Definitions are supported by the original platform documentation: [ADX](https://www.tradingview.com/support/solutions/43000589099-average-directional-index-adx/), [VWAP](https://www.tradingview.com/support/solutions/43000502018-volume-weighted-average-price-vwap/), [relative volume](https://www.tradingview.com/support/solutions/43000635874-how-do-we-calculate-relative-volume-and-relative-volume-at-time/), [Donchian channels](https://www.tradingview.com/support/solutions/43000502253-donchian-channels-dc/), [Supertrend](https://www.tradingview.com/support/solutions/43000634738-supertrend/), and [Bollinger Bands](https://www.tradingview.com/support/solutions/43000501840-bollinger-bands-bb/). These describe mechanics and use cases, not proof of profitability.

The entry-extension test already registered as B4 deserves early attention after feasibility: it directly asks whether the recovery trigger chases an extended move. Test B0+B4 independently before combining filters. This is an engineering hypothesis, not an established result.

## 5. Weaknesses and the required repair

| Priority | Code/evidence finding | Consequence | Required work |
| --- | --- | --- | --- |
| P0 | Cost/risk/ATR constraints described above | Many ordinary-volatility setups cannot pass | Measure the feasible opportunity set and net economics first |
| P0 | Indicator prices risk from bar open; strategy prices from open +/- 2 bp | Chart and strategy can disagree on stop distance, cost eligibility and target | One immutable planned-entry/risk contract in both; actual fills recorded separately |
| P0 | Chart assumes entry; strategy submits a bounded limit and waits for acknowledgment/fill | Signal count and trade count are different | Separate candidate, qualified setup, submission, fill, expiry and model outcome |
| P0 | Closed-candle stop-first chart outcomes versus attached native orders | Same candle can produce different outcomes | Shared ambiguity policy, lower-interval replay, explicit unresolved cases |
| P0 | Incomplete native history and earlier inconsistent requested/reported bounds | No trustworthy strategy selection | Audited data coverage and strictly bounded scored periods |
| P0 | Repeated signal-state code in two source files; no independent parity ledger | Fixes can drift or duplicate a conceptual error | Shared generated signal core plus independent reference and deterministic fixtures |
| P1 | Touch discovery searches completed indices 2-4; written contract describes the first eligible touch | Boundary/bias-change behavior may differ from the intended contract | Test first-touch selection, bias at touch, recovery order and six-bar expiry; resolve before changing parameters |
| P1 | Gap resets require another 250 HTF candles | A gap can remove 62.5 hours of 5m eligibility or 250 hours of 15m eligibility | Count warmup/gap hours; audit true gaps and UTC resampling; never invent missing prices |
| P1 | Estimated 15 bp cost is used for eligibility/sizing, while native P&L charges configured commission | Displayed net reward is not a fully realized net backtest | Separate entry/exit fee, spread, adverse slippage and actual funding in a ledger |
| P1 | User-defined quantity step and unrounded price levels | Venue rejects or inconsistent live risk are possible | Snapshot actual tick/lot/min-notional/multiplier filters; round and recompute risk |
| P1 | No verified maximum holding policy or native daily/equity locks | Timeframe may not match intended scalp duration; risk controls incomplete | Measure duration first; introduce safe reducing exits and ledger-based locks as separate changes |
| P1 | Retained screenshot counters lack a proven common run/window with strategy events | Rejection percentages can be misinterpreted | Same timestamps, eligibility denominator, side and stage for both outputs |
| P2 | Large research table and chart-index setup identities | Harder manual decisions and reload comparisons | Compact display and immutable UTC-based candidate IDs |
| P2 | Two project families and stale TakeProfit source linkage | Easy to edit or publish the wrong script | Mark indie/ as canonical BTC project; retain legacy sources explicitly; reconcile platform source by diff |

A marketable limit is not automatically a maker execution. Account-specific fees and actual matching behavior determine costs. [Binance futures fee explanation](https://www.binance.com/en/support/faq/detail/98488a516eb84e3eb34605683dffd554)

TakeProfit's order processing and intrabar controls must be validated against its documented mechanics. A bar-open quote used for a decision must not be silently treated as an observed order fill. [TakeProfit strategy mechanics](https://takeprofit.com/docs/indie/Strategies/Strategy-mechanics)

The stale platform-copy conflict is a deployment gate. It should not stop local data, reference-engine and economic research from progressing on a frozen source snapshot.

## 6. Delivery plan and go/no-go gates

| Stage | Concrete deliverables | Exit condition |
| --- | --- | --- |
| 0. Freeze scope and evidence | Canonical BTC source manifest, normalized source hashes, rule version, project index, archived native reports and trial register | Every source/result maps to an exact version; known-defective results clearly excluded |
| 1. Establish data and economics | Verified perpetual 1m candles, funding, contract filters, cost assumptions; resampled 5m/15m/1h; eligible-hour and pre-gate candidate ledger | No unexplained gaps/bounds; feasible opportunity count and cost/R distribution established |
| 2. Make signals and execution comparable | Shared planned-risk calculation, durable candidate IDs, independent reference, deterministic lifecycle/fill tests | Zero unexplained signal/level differences under the same rule contract; execution differences explicit |
| 3. Measure frozen B0 | Full trade/cash/equity ledger, cost stress, holding-time and long/short/regime analysis | Baseline either supports a bounded improvement study or receives a documented revise/pivot decision |
| 4. Run isolated comparisons | Existing B1-B5 hypotheses, prioritized B4, B1, B2, B3; B5 as an alternative family | Improvement survives unseen chronological periods with adequate activity and cost sensitivity |
| 5. Improve display and paper reconcile | Compact/research modes, bounded levels, persistent reason, stable event outputs, paper log | Closed/reloaded signals agree and paper fills/costs reconcile with research assumptions |

Stage 1 should use 18-24 complete months where obtainable, including at least 250 complete HTF candles before each scored segment. Binance is the provisional research venue because the retained tests used it; the user's execution exchange remains undecided. Exchange selection and account fee tier must be resolved before venue-specific deployment.

Binance's public archive includes USD-M futures candles and trade fields with checksum companions. Obtain data through the futures namespace, verify actual units, and retain checksums because archives can be revised. Historical candles do not reconstruct bid/ask spread or queue priority. [Official public-data repository](https://github.com/binance/binance-public-data)

Stage 2 fixtures must cover UTC bucket transitions, full versus truncated history, missing/duplicate candles, repeated realtime updates, long/short symmetry, first touch/recovery/expiry, invalidating trigger wick, gap through stop, both TP and SL within a candle, partial fill, fill during cancellation, bracket/timed-exit overlap, tick/quantity constraints, and final-window open exposure. Failed cases block feature selection.

Stage 3 must report net R/trade and per eligible day, profit factor, equity drawdown including open positions, sample size, fill rate, holding duration, adverse/favorable excursion, costs/R, and results by side, volatility and calendar period. Investigate concentration in a small number of extreme days.

Use one base fee model supported by the intended account. Stress the measured spread/slippage component at 1.5x and 2x; keep fees realistic and funding event-specific. Treat hypothetical 10/15/20 bp totals as scenarios, never as measured costs or parameters selected because they win.

## 7. Research budget, promotion rules and stop conditions

Retain the existing registry's maximum 22 new configurations unless a revised proposal explicitly accounts for additional trials. Previously tried versions still count in the research history. If diagnostic observations are used to select a new threshold or gate, log that selection and configuration.

Start from B0 on both profiles, with optional gates off. Compare B4, B1, B2 and B3 independently against the same profile's B0; do not stack them initially. B5 changes the entry family and must remain separately identified. Combine at most two independently useful additions only after their development evidence passes. Exit/target changes follow entry selection and remain separate trials.

Freeze chronological development, validation and final evaluation dates before scoring. September/October 2026 data already inspected are development material. If no genuinely unseen historical period can be preserved, use a prospective period after locking code and settings. Purge overlapping trades at boundaries and use earlier data only for warmup.

Many trials can produce attractive historical results by chance. Keep all trials, use time-block uncertainty estimates and preserve an untouched final evaluation. [Bailey et al., The Probability of Backtest Overfitting](https://www.davidhbailey.com/dhbpapers/backtest-prob.pdf)

Provisional screening gates inherited from the project are:

- Positive out-of-sample net expectancy, with uncertainty reported and a positive lower bound when the sample supports estimation.
- Profit factor at least 1.25 as an engineering buffer, rather than a claim that 1.25 establishes significance.
- Drawdown within the user's eventual budget; 8% at 0.25% intended risk remains a provisional research setting.
- Positive net expectancy under the stated adverse-cost stress.
- Seek approximately 300 out-of-sample completed trades with multiple market conditions; fewer trades require an inconclusive verdict or extended observation. Report each profile and side separately; pooled results cannot establish an edge for a sparse or failing subgroup.
- The selected change improves the declared objective versus B0 on comparable dates and exposure; a higher win rate alone does not pass.
- Then at least eight calendar weeks and 100 completed reconciled paper trades, extending until both duration and sample requirements are met.

Stop/pivot if plausible execution costs consume the movement even before realistic latency/fill uncertainty, the apparent edge disappears on unseen periods, results depend on one narrow parameter setting or one exceptional period, parity cannot be reconciled, or adequate coverage cannot be obtained. A slower timeframe, another entry family, or rejecting the hypothesis are legitimate outcomes. Do not rescue a failed test by silently increasing leverage, widening stops, discarding losses or reusing the holdout.

## 8. Product improvements after the foundation is sound

The compact view should show instrument/profile, completed-data readiness, bias, current persistent state, proposed entry/SL/TP, stop percent, gross/net target R and assumed cost. Keep the large diagnostic funnel in an optional research view with counts, percentages, eligible hours and last-decision UTC time.

Use distinct event labels: SETUP, QUALIFIED, ORDER SUBMITTED where observable, ASSUMED ENTRY, OBSERVED FILL only with real fill data, MODEL TP/SL and AMBIGUOUS. Plot bounded levels for the current event and retain its outcome candle. Use stable IDs formed from venue, contract, timeframe, side, touch timestamp, trigger timestamp and rule version.

Keep optional indicator overlays subtle. Add a feature only when it has a declared purpose and supported out-of-sample value. Do not show an uncalibrated confidence percentage. The displayed break-even win rate is a payoff calculation, not an accuracy estimate.

## Immediate recommended implementation batch

1. **Complete:** freeze the canonical source/rule snapshot and index all retained reports in [the baseline index](../research/BASELINE_INDEX.md), [B0 specification](../research/specs/baseline.json), and [source/run manifest](../research/BASELINE_MANIFEST.json). The manifest identifies 22 historical run records, including defective and incomplete evidence.
2. Build the data coverage and pre-cost candidate ledger, including the feasibility table above, independent of the blocked platform save.
3. Reconcile the planned entry and risk levels between indicator and strategy; validate lifecycle and order transitions.
4. Produce a usable, fully costed B0 report before implementing optional gates.
5. Make the first continue/revise/pivot decision from that report, then execute the bounded B4/B1/B2/B3/B5 comparisons if justified.

This batch is designed to answer the project's most useful question: whether the current pullback idea has enough executable movement and repeatable edge to merit further development.

## Assessment snapshot

- Branch at start: feature/btc-perp-pullback-diagnostics, commit fc3c440.
- Indicator SHA-256: 7a6bb98817cc7be4c643b09516a7a14e56e668bdd48764b3d8512378aaa3fb58.
- Strategy SHA-256: 473cc77bee0f8e83b177fe394ece4ea928fb821ef18203910b00a83d197b8e7c.
- TakeProfit listing rechecked: indicator v24 unsaved/outdated, linked base 16/latest saved 19; strategy v16 unlinked working copy.
- Only assessment and planning documents were changed for this request. Trading code, thresholds, scripts, orders and alerts were not changed.

