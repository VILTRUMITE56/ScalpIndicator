# BTC perpetual venue, cost and risk record

Record version 1.0.6, reviewed 31 October 2026. This defines a provisional research setup and records the user's reported trade size, variable leverage range, per-trade loss cap, target and exit preference. It does not confirm an execution venue, account fee rate, full account risk policy, or profitable strategy.

The machine-readable record is [`research/specs/execution_cost_risk.json`](../research/specs/execution_cost_risk.json). GitHub checkpoint: [issue #3](https://github.com/VILTRUMITE56/ScalpIndicator/issues/3).

Issue #3 is complete as a research-profile checkpoint: the proxy, reported per-trade limits, assumptions and unknowns are recorded. Closure does not mean the execution venue, account costs or deployment risk controls are confirmed; those remain deployment blockers.

The user confirmed Binance only as the research proxy and directed that personal account fee rates remain unknown. The user reports $5-$10 margin per trade, variable 20x-50x leverage, isolated margin, a maximum intended total loss of $1 per trade including fees and slippage, a take-profit goal above $5, and a preference to hold until TP or SL without a time exit. The exact leverage is selected per trade. Funding inclusion in the $1 cap and the target's net/gross basis remain unspecified. The user explicitly chose to leave personal daily-loss and drawdown limits unset; account equity was not provided.

## Research proxy and user-selected venue

Use Binance USDⓈ-M BTCUSDT perpetual as a **research proxy only**, matching the current TakeProfit Binance BTC perpetual instrument. The user has not selected Binance or confirmed the exact execution venue. The linear USDT-quoted/margined contract identity and current contract filters must be checked from the venue's current exchange-info response before venue-specific sizing or deployment. Binance's exchange-info API exposes contract type/assets and symbol filters such as tick size, lot step and minimum notional. [Official exchange-info documentation](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data#exchange-information)

Public notices give historical BTCUSDT references (tick size changed to `0.1` in 2022; minimum notional changed to `50 USDT` in April 2026), but the current exchange-info response remains unavailable here. See the [filter evidence note](EXCHANGE_FILTER_EVIDENCE.md); do not treat those notices as a complete live filter snapshot.

## Order classification and commissions

Binance classifies a fill that immediately matches existing book liquidity as taker; a fill from an order that rested and added liquidity is maker. A `LIMIT` label alone does not establish maker status. [Binance fee definitions](https://www.binance.com/en/support/faq/detail/360033544231)

The current strategy posts its entry limit 2 bp beyond the next-bar reference. For research, assume taker fees for marketable entries and protective exits until actual per-fill records prove otherwise. The project backtest's 5 bp commission per execution is an unverified placeholder, not the user's rate. Binance's published 2 bp maker/5 bp taker values are examples for fee calculations, while its fee table and signed `/fapi/v1/commissionRate` endpoint provide the account-specific rate. Those examples are not being treated as a current universal fee schedule. [USDⓈ-M fee table](https://www.binance.com/en/fee/futureFee), [account commission endpoint](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/account#user-commission-rate)

No API key or secret is needed for this checkpoint. If the user shares fee rates, share only the two numerical rates and any discount status.

## Cost assumptions

| Round-trip case | Current meaning | Evidence status |
| ---: | --- | --- |
| 10 bp | Two assumed 5 bp commission legs | Hypothetical; excludes measured spread, slippage and funding |
| 15 bp | The same two assumed commission legs plus 5 bp non-fee execution drag | Hypothetical; not measured from the user's venue |
| 20 bp | The same two assumed commission legs plus 10 bp non-fee execution drag | Hypothetical adverse case; not a measured venue cost |

Keep funding separate from these non-funding execution-cost scenarios. For a native TakeProfit ledger that already charges commission, add only missing spread/slippage; for a gross external ledger, deduct the complete chosen execution scenario once. P1's 15 bp strategy risk sizing reserves the complete scenario once; it does not add a second pair of commission legs. The simulator still debits its own commission cashflows from P&L; the remaining 5 bp at the base case is a modeled safety reserve, not a cash debit. Add actual signed funding cash flows once in either ledger. Do not reduce a cost case to generate more trades.

The components remain distinct:

- **Commission:** actual account maker/taker rates are unknown until read from the user's fee page or account-specific endpoint.
- **Spread:** unmeasured. Capture bid/ask around each signal and order; a current order-book snapshot cannot stand in for historical spread.
- **Adverse slippage:** unmeasured. Reconcile fills to the executable quote at submission and account for latency and partial fills. The strategy's 2 bp limit offset is a price bound, not measured slippage.
- **Funding:** unmeasured in retained runs. Use funding timestamps/rates and associated mark prices from the public USDⓈ-M history endpoint, charging or crediting only positions open at settlement. Binance says settlement frequency can vary, so do not hard-code a fixed interval. [Funding history API](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data#get-funding-rate-history), [funding guidance](https://www.binance.com/en/support/faq/detail/360033525031)

## User-reported size, stop, target and holding preference

The user's $5-$10 amount is **posted margin**, not full BTC position notional. At 20x-50x leverage, a simple linear estimate is $100-$500 notional (`margin * leverage`); the actual position size must be read from the order and account settings. Fees are calculated on executed notional, not just posted margin, and Binance's own fee explanation states `commission = notional value * fee rate`. [Binance Futures fee explanation](https://www.binance.com/en/support/faq/detail/98488a516eb84e3eb34605683dffd554)

The user's latest rule is a maximum intended total loss of $1 and target greater than $5. If both amounts are measured on the same basis, that is greater than 5:1 reward-to-risk and an idealized pre-cost break-even win rate below 16.67%. The previously stated usual ranges ($0.50-$1 stop and $5-$10 target) imply 5:1 to 20:1 if treated as gross P&L. These are arithmetic thresholds, not a win-rate forecast or evidence of profitability. When costs are expressed as a fixed dollar amount `C`, simplified break-even is `(stop + C) / (target + stop)`. The cost-inclusive value cannot be calculated until actual notional, account fee rate and execution costs are known.

At the estimated $100-$500 notional, a $1 gross loss corresponds approximately to a 0.2%-1.0% adverse price move; a $5 gross gain corresponds to about 1%-5%, and a target above $5 requires more. These are linear-contract estimates before costs, not exact stop or target distances. The project's existing research commission placeholder of 5 bp per execution would cost about $0.10-$0.50 round trip on $100-$500 notional if entry and exit notionals are similar. That alone could consume 10%-50% of a $1 loss budget; it is a placeholder, not the user's actual fee, and omits spread, slippage and funding.

High leverage magnifies both exposure and liquidation sensitivity. Binance's USDⓈ-M guidance bases maintenance margin on notional tiers and says account leverage availability may be restricted; liquidation can also occur before a stop closes a position if the trigger, mark price, slippage or liquidation buffer is unfavorable. [Leverage and margin guidance](https://www.binance.com/en-AU/support/faq/detail/360033162192), [liquidation despite stop-loss guidance](https://www.binance.com/en/support/faq/detail/d82ce5274e974806a5842d1a109787b8). Binance remains only the research proxy here, so these details must be checked for whichever venue is eventually selected.

For an implementation, derive quantity from the $1 all-in loss budget, the actual structural stop distance, and estimated fees/slippage; then check that the chosen leverage and isolated margin leave liquidation safely beyond the stop. Leverage should not be used to set risk by itself. Funding inclusion in the $1 cap remains unspecified and must be shown separately if the hold crosses a funding event.

The current B0 baseline uses a fixed 1.5R target. With a $0.50-$1.00 gross stop, 1.5R implies a $0.75-$1.50 gross target. The user's $5-$10 gross target would instead be 5R-20R across the reported ranges. That is a different exit model and should be evaluated as a separate, costed experiment; do not widen B0 targets or change sizing solely to match these dollar goals. The retained v16 backtests have zero completed trades and insufficient history, so the project has no evidence yet that either target model is profitable.

The user prefers TP/SL-only exits with no finite holding-time cap. That matches the current absence of a timer, but positions may remain open longer than a 5m-15m scalp and may incur funding or remain exposed to market gaps. Record actual hold duration and funding cash flows. Any time-based exit should be a separately tested option, not silently substituted for the user's stated preference.

## Provisional research risk and holding time

The strategy's existing simulation defaults are $10,000 starting capital, 0.25% risk per trade ($25 initial risk at that notional), and a 1x leverage backtest. The project plan proposes a 4R daily loss lock and 8% peak-to-trough drawdown gate; neither is implemented as an account-equity control. These are provisional research settings, not the user's account settings. The user's $1 loss cap is confirmed as including fees and slippage, but funding treatment and relationship to account equity are unresolved. The user explicitly left daily loss and maximum drawdown unset; do not substitute the research proposals for personal limits.

The user has chosen no time-based exit, rather than a finite maximum scalp duration. The strategy has no timed exit, and execution timeframes do not determine holding time. Keep 5m execution / 15m completed bias and 15m execution / 1h completed bias as separate profiles; record actual trade durations once a valid costed ledger exists. Do not add a time exit until a reducing-close behavior is verified and the alternative is separately evaluated.

## Decisions still needed from the user

- The user selected Binance as research-only; no actual execution venue or account fee rate is selected.
- Funding inclusion in the $1 loss cap and the target's net/gross basis remain unspecified.
- Personal daily loss and drawdown limits are intentionally unset; account equity was not supplied. Do not infer account-level limits from posted margin.

The actual execution venue and account-level maker/taker fee remain unconfirmed. The user chose Binance for research and asked to leave account fee rates unknown; that is recorded, and the fee remains a deployment blocker.

Local data, cost and parity research can continue using the provisional proxy. Venue-specific size/rounding, account economics and any deployment decision stay blocked until their inputs are confirmed and measured.
