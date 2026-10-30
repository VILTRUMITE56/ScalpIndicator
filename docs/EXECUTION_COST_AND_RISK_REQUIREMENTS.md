# BTC perpetual venue, cost and risk record

Record version 1.0.2, reviewed 30 October 2026. This defines a provisional research setup and records the user's reported trade size, stop, target and exit preference. It does not confirm an execution venue, account fee rate, full account risk policy, or profitable strategy.

The machine-readable record is [`research/specs/execution_cost_risk.json`](../research/specs/execution_cost_risk.json). GitHub checkpoint: [issue #3](https://github.com/VILTRUMITE56/ScalpIndicator/issues/3).

The user confirmed Binance only as the research proxy and directed that personal account fee rates remain unknown. The user reports $5-$10 margin per trade, a usual $0.50-$1 stop amount and a $5-$10 target amount, and prefers to hold until the stop or target without a time exit. Leverage and whether the P&L amounts include costs remain unknown. Account-equity risk limits are also still pending.

## Research proxy and user-selected venue

Use Binance USDⓈ-M BTCUSDT perpetual as a **research proxy only**, matching the current TakeProfit Binance BTC perpetual instrument. The user has not selected Binance or confirmed the exact execution venue. The linear USDT-quoted/margined contract identity and current contract filters must be checked from the venue's current exchange-info response before venue-specific sizing or deployment. Binance's exchange-info API exposes contract type/assets and symbol filters such as tick size, lot step and minimum notional. [Official exchange-info documentation](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data#exchange-information)

## Order classification and commissions

Binance classifies a fill that immediately matches existing book liquidity as taker; a fill from an order that rested and added liquidity is maker. A `LIMIT` label alone does not establish maker status. [Binance fee definitions](https://www.binance.com/en/support/faq/detail/360033544231)

The current strategy posts its entry limit 2 bp beyond the next-bar reference. For research, assume taker fees for marketable entries and protective exits until actual per-fill records prove otherwise. The project backtest's 5 bp commission per execution is an unverified placeholder, not the user's rate. Binance's published 2 bp maker/5 bp taker values are examples for fee calculations, while its fee table and signed `/fapi/v1/commissionRate` endpoint provide the account-specific rate. Those examples are not being treated as a current universal fee schedule. [USDⓈ-M fee table](https://www.binance.com/en/fee/futureFee), [account commission endpoint](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/account#user-commission-rate)

No API key or secret is needed for this checkpoint. If the user shares fee rates, share only the two numerical rates and any discount status.

## Cost assumptions

| Round-trip case | Current meaning | Evidence status |
| ---: | --- | --- |
| 10 bp | Low/fee-only sensitivity; matches the backtest placeholder of 5 bp each side | Hypothetical; excludes measured spread, slippage and funding |
| 15 bp | Existing B0 eligibility/sizing gate | Hypothetical; it is not fully deducted in native P&L |
| 20 bp | Adverse sensitivity | Hypothetical; not a measured venue cost |

Keep funding separate from these non-funding execution-cost scenarios. For a native TakeProfit ledger that already charges commission, add only missing spread/slippage; for a gross external ledger, deduct the complete chosen execution scenario once. Add actual signed funding cash flows once in either ledger. Do not reduce a cost case to generate more trades.

The components remain distinct:

- **Commission:** actual account maker/taker rates are unknown until read from the user's fee page or account-specific endpoint.
- **Spread:** unmeasured. Capture bid/ask around each signal and order; a current order-book snapshot cannot stand in for historical spread.
- **Adverse slippage:** unmeasured. Reconcile fills to the executable quote at submission and account for latency and partial fills. The strategy's 2 bp limit offset is a price bound, not measured slippage.
- **Funding:** unmeasured in retained runs. Use funding timestamps/rates and associated mark prices from the public USDⓈ-M history endpoint, charging or crediting only positions open at settlement. Binance says settlement frequency can vary, so do not hard-code a fixed interval. [Funding history API](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data#get-funding-rate-history), [funding guidance](https://www.binance.com/en/support/faq/detail/360033525031)

## User-reported size, stop, target and holding preference

The user's $5-$10 amount is **posted margin**, not full BTC position notional. Position notional is therefore unknown until leverage and margin mode are known; for a simple linear position it is approximately `margin * leverage`. Fees are calculated on executed notional, not just posted margin, and Binance's own fee explanation states `commission = notional value * fee rate`. [Binance Futures fee explanation](https://www.binance.com/en/support/faq/detail/98488a516eb84e3eb34605683dffd554)

Assuming the reported stop and target are gross per-trade P&L amounts, they imply a nominal reward-to-risk range from 5:1 ($5 target / $1 stop) to 20:1 ($10 / $0.50). The corresponding theoretical break-even win-rate bounds are 16.67% for the $1/$5 pairing and 4.76% for the $0.50/$10 pairing, before fees, spread, slippage, funding, partial fills or skipped exits. If the amounts are paired differently, the break-even rate changes. These are arithmetic thresholds, not a win-rate forecast or evidence of profitability. When costs are expressed as a fixed dollar amount `C`, simplified break-even is `(stop + C) / (target + stop)`; here `C` cannot be estimated until notional, account fee rate and execution costs are known.

Relative to posted margin, the reported stop is 5%-20% and the reported target is 50%-200%, taking the independent endpoints of the two ranges. Those are P&L-to-margin comparisons, **not** BTC price-move requirements. At leverage `L`, a $5-$10 margin corresponds roughly to $5L-$10L notional; the underlying price move needed for a fixed dollar P&L depends on that notional. Leverage also increases liquidation sensitivity, while a stop can fill beyond its trigger during fast markets. Do not infer a safe leverage or position size from these ranges alone.

The current B0 baseline uses a fixed 1.5R target. With a $0.50-$1.00 gross stop, 1.5R implies a $0.75-$1.50 gross target. The user's $5-$10 gross target would instead be 5R-20R across the reported ranges. That is a different exit model and should be evaluated as a separate, costed experiment; do not widen B0 targets or change sizing solely to match these dollar goals. The retained v16 backtests have zero completed trades and insufficient history, so the project has no evidence yet that either target model is profitable.

The user prefers TP/SL-only exits with no finite holding-time cap. That matches the current absence of a timer, but positions may remain open longer than a 5m-15m scalp and may incur funding or remain exposed to market gaps. Record actual hold duration and funding cash flows. Any time-based exit should be a separately tested option, not silently substituted for the user's stated preference.

## Provisional research risk and holding time

The strategy's existing simulation defaults are $10,000 starting capital, 0.25% risk per trade ($25 initial risk at that notional), and a 1x leverage backtest. The project plan proposes a 4R daily loss lock and 8% peak-to-trough drawdown gate; neither is implemented as an account-equity control. These are provisional research settings, not the user's confirmed account size or acceptable loss limits.

The user has chosen no time-based exit, rather than a finite maximum scalp duration. The strategy has no timed exit, and execution timeframes do not determine holding time. Keep 5m execution / 15m completed bias and 15m execution / 1h completed bias as separate profiles; record actual trade durations once a valid costed ledger exists. Do not add a time exit until a reducing-close behavior is verified and the alternative is separately evaluated.

## Decisions still needed from the user

- Provide leverage/margin mode and confirm whether stop/target amounts are gross or net of costs.
- Provide account equity and acceptable daily loss and maximum drawdown limits; posted margin does not establish account-level risk.

The actual execution venue and account-level maker/taker fee remain unconfirmed. The user chose Binance for research and asked to leave account fee rates unknown; that is recorded, and the fee remains a deployment blocker.

Local data, cost and parity research can continue using the provisional proxy. Venue-specific size/rounding, account economics and any deployment decision stay blocked until their inputs are confirmed and measured.
