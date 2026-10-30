# BTC perpetual venue, cost and risk record

Record version 1.0.1, reviewed 30 October 2026. This defines a provisional research setup and makes the remaining user decisions visible. It does not confirm an execution venue, account fee rate, personal risk limit, or profitable strategy.

The machine-readable record is [`research/specs/execution_cost_risk.json`](../research/specs/execution_cost_risk.json). GitHub checkpoint: [issue #3](https://github.com/VILTRUMITE56/ScalpIndicator/issues/3).

The user confirmed Binance only as the research proxy and directed that personal account fee rates remain unknown. The user plans to supply personal risk limits and maximum holding time; those values are pending.

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

## Provisional research risk and holding time

The strategy's existing simulation defaults are $10,000 starting capital, 0.25% risk per trade ($25 initial risk at that notional), and a 1x leverage backtest. The project plan proposes a 4R daily loss lock and 8% peak-to-trough drawdown gate; neither is implemented as an account-equity control. These are provisional research settings, not the user's confirmed account size or acceptable loss limits.

The user has not stated a desired maximum scalp duration. The strategy has no timed exit, and execution timeframes do not determine holding time. Keep 5m execution / 15m completed bias and 15m execution / 1h completed bias as separate profiles; record trade durations once a valid costed ledger exists. Do not add a time exit until a reducing-close behavior is verified.

## Decisions still needed from the user

- Provide personal account size, acceptable per-trade risk, daily loss and maximum drawdown limits, replacing the research-only defaults.
- Specify the intended maximum holding duration for a scalp.

The actual execution venue and account-level maker/taker fee remain unconfirmed. The user chose Binance for research and asked to leave account fee rates unknown; that is recorded, and the fee remains a deployment blocker.

Local data, cost and parity research can continue using the provisional proxy. Venue-specific size/rounding, account economics and any deployment decision stay blocked until their inputs are confirmed and measured.
