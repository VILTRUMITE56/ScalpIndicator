# Current assessment: accuracy and profitability

Updated 30 October 2026. Strategy working copy v16 has refreshed 5m and 15m backtests; both produced zero completed trades and flag insufficient history. Strategy v16 passes compile and `runtime_quick` validation on 5,000 candles. The chart indicator working copy is now v24 (UID `dd7d1e3f-a6db-4f3a-8a50-2b8f551e9db3`) and also passes compile and `runtime_quick` on 5,000 candles. Its latest saved private platform version is v19 (UID `b0WWgU3721kqgpvBweE24`). The v24 diagnostic edit is unsaved because it is based on v16; TakeProfit blocks saving a stale copy and blocks loading v19 while the copy has unsaved changes.

## Baseline freeze checkpoint

GitHub issue [#2](https://github.com/VILTRUMITE56/ScalpIndicator/issues/2) is satisfied by the frozen B0 source/rule specification, reproducible source/run manifest, and reviewer index: [`research/specs/baseline.json`](../research/specs/baseline.json), [`research/BASELINE_MANIFEST.json`](../research/BASELINE_MANIFEST.json), and [`research/BASELINE_INDEX.md`](../research/BASELINE_INDEX.md). The manifest records current normalized source hashes and fresh runtime validation, and inventories all 22 historical backtest run records. It marks the two defective v1 sensitivity runs, incomplete historical windows, inferred version metadata in four v2 records, and missing old source bodies explicitly. The 22-configuration future research cap remains unchanged. No trading logic or performance result was changed by this freeze.

## Latest code changes

The B0 pullback lifecycle now requires actual candle intersection with EMA20, records ATR and invalidation from the touch, checks the completed trigger candle against that frozen invalidation, expires from the source candle, and requires a later EMA20 recovery before accepting a fresh touch after invalidation, expiry, trigger, bias loss, or a data gap. The structural extreme is calculated from the touch candle and up to two preceding candles, clipped to the recovery period.

The strategy sizes and places its attached stop/target using the worst entry allowed by its bounded limit price. The chart model evaluates stop/target from completed candles and labels bars touching both as ambiguous with stop-first treatment. Its status remains visible for the rest of the chart candle. These source changes address specific lifecycle and reload inconsistencies; they do not establish that the rules are profitable or that actual fills match the model.

The local strategy v16 matches its TakeProfit working copy; both pass compile and `runtime_quick`. The local indicator source matches working copy v24 and also passes both checks, but it is not published to the private script. The existing screenshot's chart panel identifies the 0.15% cost gate as the dominant blocker in its displayed 5m history. Live/reload comparison and candidate timestamp/level parity audit remain required. The [implementation plan](SCALPING_IMPLEMENTATION_PLAN.md) remains the worklist. ADX, VWAP, relative-volume, entry-extension, and breakout/retest filters have not been added to the baseline.

## Earlier reliability changes

### Realtime higher-timeframe rollback

The 5m-to-15m and 15m-to-1h EMA streams are recalculated whenever the current execution candle belongs to a new higher-timeframe bucket. Each recalculation uses the previous committed series value and the last closed execution candle, so repeated realtime updates are idempotent. The one-time boundary flag now gates only plain class diagnostics. This handles TakeProfit's mutable-series rollback behavior in source; a live chart replay and reload check is still required.

The indicator's cumulative counters explicitly carry forward the previous bar's count and add at most one event for the current bar. Event flags reset on every new execution candle, including warmup and gap candles, preventing stale counts from persisting through unavailable-data states.

### Earlier pullback lifecycle and trigger consistency

Both scripts track the source candle of the first qualifying touch and preserve its extreme for the stop anchor. A touch is consumed once; expiry, invalidation, or a trigger advances the consumed-touch watermark to the current decision bar. A new setup therefore requires a later touch, rather than reusing an already-observed touch inside the rolling lookback. Setups expire after six execution bars and clear on a bias change, data gap, a completed close beyond the slow EMA, or a breach of the stored structural extreme by 0.1 ATR. The trigger candle must close on the valid side of both entry EMAs, in the directional candle body, and beyond the prior candle's high/low.

Strategy and indicator rules now match for these conditions; independent candidate-ID parity is not yet demonstrated. The chart panel shows the armed setup's source-bar ID, age, structural invalidation price, and research/assumed-fill status. The displayed source-bar ID is chart-run relative, not a durable cross-reload identifier.

## Current strategy v16 backtest findings

Two diagnostic runs were completed on Binance `BTC/USDT.P` (`CXBNF8`) with $10,000 initial capital, 0.25% risk, 0.15% round-trip cost eligibility assumption, 0.05% commission per execution, and 1x leverage.

| Execution chart | Window | Orders | Completed trades | Total P&L | Buy-and-hold | History sufficient? |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| 5m | 10-26 Oct 2026 | 0 | 0 | $0.00 | -2.98% | No |
| 15m | 5 Sep-26 Oct 2026 | 1 canceled | 0 | $0.00 | +0.63% | No |

The 15m order was a 0.029 BTC short limit at $80,988.69902; it was canceled after 30 minutes without a fill. Both runs set `is_history_depth_sufficient=false` and `has_more_items_on_the_left=true`. There were no completed trades, so win rate, expectancy, and profit factor are undefined. The zero P&L reflects no exposure, not a measured break-even strategy. The latest-window rerun through 30 October also returned 0 trades on both charts and the same single canceled 15m order. Full snapshots are in [results/v3/backtests.json](../results/v3/backtests.json) and [results/v4/backtests.json](../results/v4/backtests.json).

The refreshed history windows were moved forward to include data through 30 October but remain capped; both are truncated. “Huge”, “large”, and “small” history selectors were denied; wider explicit requests exceeded the reported 5,060-bar allowance. The configured 0.15% cost assumption is not deducted as a complete realized round-trip cost: historical spread, slippage, and funding were unavailable. These results cannot establish accuracy or profitability.

The 5m chart screenshot provides a reason for the idle strategy model: on the displayed chart history, the diagnostic counters read 3,502 trend bars / 254 pullback events / 101 trigger candidates, followed by 0 accepted / 10 stop rejected / 91 cost rejected. Thus 90.1% of displayed trigger candidates hit the cost gate; 10/101 (9.9%) hit the aggregated stop gate. The screenshot's 1,666 completed higher-timeframe bars exceed the 250-bar warmup requirement. These chart-model counts do not substitute for exact strategy-run event counts. The local v24 panel now splits stop rejects into invalid geometry and stops over 2.5 ATR, but that edit is not saved to the private platform.

## Last retained backtest evidence (before the current lifecycle update)

The retained strategy v14 runs used Binance `BTC/USDT.P` (`CXBNF8`), $10,000 initial capital, 0.25% risk, 0.05% commission per execution, and the 0.15% round-trip cost eligibility assumption. They predate the current strategy v16 and indicator v22 sources and are retained only as historical context. The private indicator library title remains `BTC Perp Pullback Signals v1` because TakeProfit keeps the original library title.

| Execution chart | Trades | Net P&L | Win rate | Profit factor | Max equity drawdown | History sufficient? |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| 5m, 1-15 Oct 2026 | 1 | +$32.49 | 100% (1 win) | Undefined | 0.30% | No |
| 15m, 1 Sep-15 Oct 2026 | 2 | -$39.82 | 0% (0 wins) | 0.00 | 0.40% | No |

The 5m result is one short winner; one trade cannot estimate accuracy, expectancy, or profit factor. The 15m sample is negative, averaging -$19.91 per trade. The 15m ledger includes two filled losses and canceled entry attempts. Both reports set `is_history_depth_sufficient=false`; the reported final bars are 26 October for the 5m run and 19 October for the 15m run, later than the 15 October requested endpoint. These reports cannot be treated as clean, bounded performance evidence. Full snapshots and run IDs are recorded in `results/v2/backtests.json`.

The commission model is 5 bp per execution. The 15 bp `cost_fraction` is used for eligibility and sizing; it does not add spread, slippage, or funding to reported P&L. No venue fee tier or actual spread/slippage feed has been confirmed.

## Remaining risks and work

- Resolve the stale unsaved working-copy conflict, rebase diagnostic indicator v24 onto the latest saved private version 19, then publish and check the visible version, higher-timeframe count, persistent setup state, and closed-candle outcome behavior across live bucket changes and reload.
- Compare the manual higher-timeframe EMA values against independently resampled UTC candles, then reconcile candidate timestamps, direction, setup ID, entry, stop, and target between the indicator and strategy.
- The signal logic remains duplicated in two files. A common rule source or generated parity check is still needed.
- Obtain a longer, correctly bounded sample and actual venue costs. The current windows are too short, carry insufficient-history flags, and have endpoint metadata inconsistencies.
- Verify pending-entry cancellation, fills, attached bracket/OCO behavior, gap-through-stop handling, and account exposure with deterministic cases or a documented platform replay. Backtest snapshots do not prove these execution invariants.
- Daily loss and equity-drawdown entry locks remain unimplemented. The Indie reference found for `Trading` exposes available cash and position, but no confirmed day-realized-P&L or equity-series field. Do not use cash as a substitute until its behavior is proven.
- After correctness and data gates pass, run the predeclared entry/exit comparisons on chronological validation windows and preserve an untouched holdout. Require the project's paper-forward gate before any deployment decision.

## Conclusion

Strategy v16 and indicator v24 both pass compile and `runtime_quick` on 5,000 candles. The diagnostic indicator change is not saved because the working copy is based on v16 while the latest saved version is v19. Strategy v16 backtests produced no completed trades and used incomplete history, so live/reload behavior, candidate parity, and profitability remain unverified. The chart diagnostic locates the main visible restriction in the cost gate; it does not show that lowering the estimate would be profitable. Verify venue fees, spread, slippage, and funding before a declared cost sensitivity. The local v24 code splits stop-rejection causes, but the update must be rebased before it can be published. The earlier v14 trades are also too few and history-limited to support a profitability claim or live use.

## Branch and TakeProfit status (2026-10-30)

The work is now on `feature/btc-perp-pullback-diagnostics`. The BTC Pullback indicator and strategy sources, current assessment, implementation plan, audit, and retained backtest artifacts are included in the branch work. The unrelated ScalpFlow Pro source edits have been reverted. The branch starts from repository `main` (`9a19441`), which currently contains ScalpFlow Pro; the BTC Pullback project files are added on this feature branch.

The local BTC Pullback indicator matches TakeProfit working copy v24 exactly. Indicator v24 and strategy v16 pass compile and `runtime_quick` on 5,000 candles. Loading saved private indicator v19 was blocked because TakeProfit protects the unsaved v24 working copy (`dd7d1e3f-a6db-4f3a-8a50-2b8f551e9db3`) from being overwritten. Therefore no v19 rebase or platform save has happened. The v24 source is preserved in the branch; the next platform step is to clear or detach the stale working copy, then load v19 into a clean linked copy and merge by diff.
