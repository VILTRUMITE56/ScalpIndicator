# ScalpFlow Pro: assessment and enhancement plan

Assessment date: 2026-10-30. Target confirmed by the user: Bitcoin perpetual futures. Planning baseline: 5-minute execution, confirmed 15-minute trend context. Exchange, exact contract (linear versus inverse), account fee tier, and acceptable drawdown remain unspecified.

## Assessment

The project is a functioning research prototype with confirmed-bar long/short setup signals, defined stops/targets, and a usable chart display. It has not demonstrated a dependable profitable edge. The earlier conversation reported a negative, limited backtest; no reproducible report or trade ledger is stored in this workspace, so its metrics cannot be independently audited here. Compilation and 5,000-candle runtime checks from the preceding task establish execution compatibility, not profitability.

This review inspected both current source files, checked the strategy's compiler-reported defaults through TakeProfit MCP, and checked current official execution and commission documentation. No trading code or platform script was changed, and no new performance backtest was run for this assessment.

### What the current system does

- Bullish setup: EMA 9 above EMA 21 above EMA 50, rising EMA 50, higher-timeframe bullish alignment, RSI at least 50, acceptable ATR/price, ADX at least 18 by default, a pullback/recovery candle, acceptable stop distance, and score at least 70. Bearish logic is mirrored.
- The default pullback trigger requires touching the fast EMA area and closing beyond the previous candle's high/low in the trend direction. Breakout entries are disabled by default.
- A confirmed setup proposes a limit entry at the signal candle's close, valid for three bars. A BUY/SELL arrow identifies the setup; it does not establish an actual fill.
- Stop distance is the wider of 1.2 ATR and a five-bar structure stop plus 0.15 ATR buffer, with a maximum of 3 ATR. Target is 1.5 times the planned stop distance.
- Strategy sizing is a fixed 0.01 quantity, initial capital is 10,000, leverage is 1, and commission is 0.0006 per execution under the percentage model.

### Findings ranked by priority

| Priority | Finding and source | Implication |
|---|---|---|
| P0 | Different higher-timeframe implementations: indicator `ConfirmedHigherTrend` and `calc_on` at lines 11-16 and 76-79; strategy manually aggregates boundary closes and seeds EMAs at lines 67-89. | Warm-up, EMA initialization, missing candles, and higher-timeframe boundary timing may differ. Matching signal names do not establish matching signals. This is a parity risk, not a proven lookahead defect. |
| P0 | Different lifecycle rules: indicator lines 255-364 suppress new setups on an exit/expiry bar; strategy lines 181-208 has no equivalent exclusion and clears its entry reference immediately after requesting cancellation. | The strategy can become eligible for a new order on a bar where the indicator prohibits a new setup. Cancellation confirmation and partial fills need explicit reconciliation. |
| P0 | Indicator manually simulates fills and exits, while the strategy uses the exchange emulator. Indicator stop/target checks and alerts run only on closed bars, with stop-first treatment when both are touched. | Backtest fills and indicator outcomes can diverge. Exit alerts can arrive at bar close after a level was touched; they are modeled events, not exchange fill confirmations. |
| P0 | Strategy commission at line 10 is 0.0006; ATR minimum is 0.0005 and target is 1.5R. No spread, slippage, or funding treatment is explicit in these files. | Some allowed trades have insufficient gross room to cover costs. A profitable-looking gross signal may have negative net expectancy. |
| P1 | Score at indicator lines 159-208 and strategy lines 116-165 combines EMA alignment, HTF trend, RSI, ADX, volume, and candle body. | Several inputs measure related trend strength. Under default hard gates, an accepted candidate already earns at least 60 points; a threshold of 70 adds only ten further points. Score and A/B grade are uncalibrated, not win probabilities. |
| P1 | Pullback conditions at indicator lines 149-150 use current-candle EMA contact and a previous-candle break. | There is no explicit multi-bar pullback sequence, maximum entry extension, or rejection of an oversized recovery candle. Strong RSI/body scores can reward an already extended move. This hypothesis requires testing. |
| P1 | Volume filtering is off, but volume can still contribute ten score points. ADX +/-DI outputs are calculated but unused. | The volume toggle disables a hard gate, not its score contribution. Settings need clearer semantics; adding DI as another gate would require evidence. |
| P1 | Pending setups expire by time only; active trades have no maximum holding time. Stops/targets remain anchored to the proposed entry even if the modeled fill improves. | A pending setup can fill after conditions deteriorate; positions can outlast the intended scalp. Fill-based reward/risk and gap-through-stop behavior need explicit rules. |
| P1 | Strategy uses fixed quantity and has no explicit contract conversion, price/size rounding, loss budget, or funding logic. | Results are not comparable across contract types or price regimes. Risk depends on stop distance, and small notional exposure can make equity drawdown appear reassuring. |
| P2 | Workspace contains two scripts and backups, but no Git repository, research ledger, regression suite, or archived results. | Reproducing an apparent improvement and detecting logic drift is currently difficult. |

### Why costs are the first economic constraint

TakeProfit documents percentage commission as a fraction: 0.001 means 0.1%. Therefore 0.0006 in this strategy means 0.06% per execution, approximately 0.12% for entry plus exit, before other costs. This is the script's assumption, not a verified fee for the user's exchange. [Official strategy parameters](https://takeprofit.com/docs/indie/Strategies/Strategy-params)

Illustration using allowed settings: if ATR/price is 0.05% and the structure stop does not widen the stop beyond 1.2 ATR, the stop is 0.06% and the 1.5R target is 0.09%. Approximate round-trip commission of 0.12% exceeds that winning price move.

For an idealized fixed 1.5R winner and 1R loser, with constant round-trip cost c measured in R, net expectancy is `p * 1.5 - (1 - p) - c`. Break-even win rate is `(1 + c) / 2.5`. With a 0.20% stop and 0.12% fees, c is about 0.60R and break-even is about 64%, before spread/slippage. Actual analysis must use realized fills, variable costs, and actual win/loss sizes.

## Implementation and research sequence

### Phase 1: establish an auditable baseline and execution contract

1. Archive source hashes, inputs, platform version, exact exchange ticker, contract specification, dates, time zone, and data coverage. Introduce version control without losing the existing backups.
2. Define event meanings: `LONG SETUP` / `SHORT SETUP` on confirmed close, proposed entry and expiry, modeled fill, cancellation/invalidation, and modeled stop/target outcome. Preserve existing alert IDs and meanings; introduce new event outputs explicitly when needed.
3. Select the exact Bitcoin perpetual venue/contract before performance testing. Obtain actual maker/taker fees, tick size, quantity step, minimum notional, contract multiplier, and funding schedule. A limit order is not automatically a maker fill.
4. Make indicator and strategy use equivalent confirmed HTF values, warm-up, signal eligibility, cooldown, and lifecycle rules. Prefer a shared supported implementation; if Indie cannot share code or strategy secondary contexts, maintain a canonical specification and automated comparison fixtures.
5. Keep setup confirmation separate from entry execution. Document the baseline limit-at-signal-close policy and its three-bar validity. Do not credit an entry before the setup is knowable.
6. Reconcile cancellations only after acknowledgment; handle partial fills and replacement eligibility explicitly. Define whether a gap beyond the planned stop invalidates the entry. Align same-bar exit/re-entry rules.
7. Validate closed-bar versus live/reloaded results at each 15-minute boundary, incomplete history, missing bars, pending expiry, improved fills, and stop/target collisions. Retain conservative treatment where candle data cannot establish order of events.

Deliverables: baseline manifest, event specification, matched signal ledger, and targeted regression fixtures. Pass condition: zero unexplained differences in confirmed setup timestamps/directions after agreed warm-up, with every execution-model difference documented.

TakeProfit's documented emulator is an OHLC approximation and order operations take effect on a later update. Confirm supported lower-timeframe execution and cost capabilities before relying on them; otherwise use a separately documented conservative research model. [Official strategy mechanics](https://takeprofit.com/docs/indie/Strategies/Strategy-mechanics)

### Phase 2: measure the baseline after realistic costs

1. Run the reconciled baseline on the chosen BTC perpetual with an immutable date range and sufficient warm-up. Aim for 6-12 months spanning rising, falling, and ranging markets if data access permits. Report the exact available period if the account cannot supply that history.
2. Record every setup, fill, unfilled expiry, invalidation, exit, fee, modeled slippage, holding duration, and net P&L in currency and R. Record feature values at signal time only. Mark intrabar excursion statistics as uncertain where candle ordering is unknown.
3. Include spread and slippage scenarios, plus funding when a position crosses the applicable funding timestamp. If native backtesting cannot model these, apply and disclose an external cost model without presenting it as an exchange execution simulation.
4. Report net expectancy/trade, profit factor, win rate, average win/loss, maximum drawdown, longest loss streak, trade count, exposure, fill rate, and holding-time distribution. Separate long/short results, market regimes, and calendar periods.
5. Use fixed notional or R-normalized results to compare signal variants. Introduce risk-based sizing later so a sizing change cannot masquerade as a signal improvement.

Deliverables: reproducible baseline report, full trade ledger, and cost sensitivity table. If the baseline fails badly after costs, investigate the trade economics before expanding the indicator stack.

### Phase 3: test a small number of signal improvements

Each proposal below is a hypothesis. Test individually against the same baseline and chronological validation data. Log all variants, including failures; do not silently search hundreds of combinations.

| Order | Experiment | Rationale and decision evidence |
|---|---|---|
| 1 | Cost eligibility gate: require target distance to exceed conservative all-in costs with a predeclared buffer; expose net reward/risk. | Removes trades that cannot reasonably pay their execution costs. Passing the gate alone does not prove positive expectancy. Compare net expectancy and retained opportunity count. |
| 2 | Explicit pullback sequence: established trend, bounded pullback into a defined EMA area, then confirmed recovery; limit distance from EMA/ATR and recovery-candle size. | Test whether fewer late entries improve net returns and adverse excursion without eliminating the useful signals. Use only information available at confirmation. |
| 3 | One regime filter at a time: normalized EMA slope/separation or a simple price-efficiency measure. | ADX alone may admit unfavorable price action. Compare against a simpler EMA/HTF baseline and reject redundant filters. Do not begin with several overlapping gates. |
| 4 | Volume/session eligibility based on the selected venue's data. | Test liquidity-related variation and actual cost sensitivity. Do not select a session simply because it happened to win in one sample. Handle missing volume explicitly. |
| 5 | Entry policy comparison: baseline close-price limit, next executable market entry, and a defined pullback limit. | Measure missed fills, adverse selection, latency, and net expectancy. Never count unfilled limit setups as profitable trades. |
| 6 | Exit alternatives: a small fixed set of target multiples, maximum holding time, and setup invalidation. | Use realized trade behavior to choose candidates. Test break-even/trailing/partial exits only as later isolated experiments because they add parameters and can reduce net edge. |

Keep breakout entries as a separate research branch after the pullback baseline. Their continuation/fill behavior should not be mixed into one aggregate score without separate evidence. Analyze long and short sides separately before considering asymmetric rules.

### Phase 4: make the score useful and add risk controls

- Evaluate existing score bands against net expectancy and realized outcomes on validation data. If higher scores do not rank outcomes better, simplify or remove the grade gate. Compare against a version without discretionary scoring.
- Retain the label 'confluence score' unless an explicit probability model is calibrated and independently validated. Never display 85/100 as an 85% win probability.
- Add configurable risk-based quantity using stop distance, contract multiplier, fees/slippage allowance, tick/quantity rounding, minimum notional, and a notional ceiling. Linear and inverse perpetuals require different P&L/quantity treatment.
- Define a maximum loss budget, loss-streak pause, and maximum holding time for research/paper trading. Choose values from the user's drawdown tolerance; do not optimize risk limits on the final test period. These controls limit exposure, not create an edge.
- Keep the clean display: one confirmed setup marker, active proposed levels, expiry/invalidation state, net cost eligibility, and an explicit waiting state. Distinguish hypothetical indicator state from actual exchange execution.

### Phase 5: validate before treating it as actionable

1. Partition data chronologically into development, validation, and untouched final test periods, then use walk-forward windows when data permits. Do not use random candle splits. Allow warm-up context, but exclude it from performance and purge overlapping trades at evaluation boundaries.
2. Evaluate the preselected candidate on the untouched period once. If it fails and the rules change, that period becomes development data; a new holdout is required.
3. Stress nearby parameters and higher costs (for example, 1.5x and 2x modeled spread/slippage). Look for stable neighborhoods, not one exceptional setting. Fees must remain grounded in the actual venue schedule.
4. Report uncertainty in net expectancy using methods that respect time clustering, such as a block bootstrap. A few favorable trades or a single regime are insufficient. If uncertainty is large, collect more independent data rather than declare success.
5. Predeclare evaluation gates before looking at final results: positive net expectancy, profit factor above 1, drawdown within an agreed budget, acceptable cost sensitivity, and no unexplained signal/execution mismatch. Any additional numerical buffer is a research criterion, not a guaranteed profitability threshold.
6. Forward paper trade through enough signals and market conditions to compare confirmation times, fills, costs, and outcomes with the research assumptions. A calendar target such as four weeks is a minimum observation window, not proof by itself.

Deliverables: frozen candidate and settings, untouched-period report, uncertainty/cost analysis, paper-trading event log, and an explicit proceed/revise/reject decision. If the evidence fails these gates, retain the indicator as a research tool rather than claim profitability.

## Recommended next increment

Implement Phase 1 first: consistent HTF and event logic, explicit setup-versus-fill semantics, and reproducible baseline records. Then measure actual venue costs and add the cost eligibility experiment. Avoid changing EMA/RSI defaults or adding more indicators until this baseline can be trusted.

The user confirmed Bitcoin perpetuals. The only market detail still needed before venue-specific testing is the exchange and exact contract; fee tier and risk tolerance are needed before cost calibration and risk sizing. No exchange connection or live trading is needed for this research plan.

## Source checkpoint

- Initial pre-implementation hashes: indicator `127291C653B65501BC77C4533917419726050D09144CE7091BBF9A14065F8293`; strategy `A39DFDFC3499429BD43BD6E0069EF40D5CFD74487246A46FCF8A07A6F94B88AF`.
- Existing backup: `visual-redesign-backup/`.
- Private indicator version from the preceding task: 2. Strategy MCP metadata checked in this assessment: working-copy version 3.
- Official HTF API reference: [Request additional instruments](https://takeprofit.com/docs/indie/Request-additional-instruments). Its indicator example does not establish strategy support; verify that capability during Phase 1.

## Implementation progress (2026-10-30)

The first execution-consistency changes are now in the local files and TakeProfit MCP working copies:

- Both scripts use the same manual 15-minute EMA aggregation and warm-up requirement. TakeProfit's Indie playbook states that timeframe-based `calc_on` in a strategy is runtime-unsupported, so this keeps the indicator and strategy on the supported calculation path.
- The strategy tracks a pending cancellation until the order reaches a terminal status, and blocks a new signal on the bar a position closes.
- Both scripts now include the same cost-eligibility gate. Defaults estimate 0.15% round-trip fees/slippage and require at least 0.5R of target room after those costs. These are provisional settings because the user's venue and fee tier are unknown; TakeProfit's fee setting is still 0.06% per execution and does not simulate the assumed slippage.

Before adding the cost gate, a `tiny` TakeProfit strategy backtest on Binance BTC/USDT perpetual, 5-minute, at 0.06% commission per execution returned: 81 trades, -0.676% total P&L, 44.44% win rate, 0.514 profit factor, and 0.754% maximum equity drawdown over 16.25 days. At 0.10% commission per execution, the same nominal window returned -1.205% P&L, 38.27% wins, and 0.290 profit factor. A Bybit 0.06% run returned -0.649% P&L, 45.68% wins, and 0.541 profit factor over 16.39 days. TakeProfit marked all runs as having insufficient history. These are short diagnostics, not a profitability conclusion or a fair cross-venue comparison.

TakeProfit validation then returned `Validation infrastructure error during compile` for both updated working copies. Its current Indie authoring guidance says not to retry a validation-service infrastructure failure. Therefore the latest changes have not passed compilation or runtime validation, and no backtest was run on them. The local edits and MCP working copies are present, but the previously saved private indicator remains platform version 2; the new working-copy indicator version has not been saved or published. Resolve this validation-service issue before relying on, saving, or testing the new cost-gated version.

The larger history windows were denied by the account's current TakeProfit plan; only `tiny` was available. Cost tuning, proper-size BTC perpetual risk handling, full-history comparison, and forward paper evaluation remain outstanding. TakeProfit currently has BTC/USDT perpetual instruments listed on Binance (`CXBNF8`) and Bybit (`CXBYBT`); neither was confirmed as the user's venue.

Current local source hashes after the unvalidated edits: indicator `EC48F617AFD8599E7C9AA351C7584CB95A9C6E56EB75B485BFE52D4D1EAED977`; strategy `FBF0B45CC0FF8EA669AA859B5CC21E8BA0C41B55A7970E0A27006BEF5B1EBB0B`.
