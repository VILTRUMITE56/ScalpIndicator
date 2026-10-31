# TakeProfit simulator and Binance execution boundary

Checked: 2026-10-31  
Scope: BTCUSDT USD-M perpetual as a research proxy. This note does not select an execution venue or authorize live orders.

## Finding

The TakeProfit strategy backtest is not a Binance order emulator. TakeProfit's official strategy-order documentation says its backtesting emulator models position-level take-profit and stop-loss behavior to match Bybit, while live exchanges manage attached TP/SL according to their own rules. It also says these exits are independent stop orders after the parent fills, with an optional limit price to make them stop-limit orders. The current strategy attaches `stop_loss(stop=...)` and `take_profit(stop=...)` without a limit price.

The platform run can still validate Indie compilation and test the strategy against TakeProfit's emulator. Its fills, bracket lifecycle, and exits cannot establish Binance-native behavior or Binance execution parity. The independent Binance-data reference replay remains the relevant historical model for the proxy; its fills and costs are still assumptions.

## Dynamic Binance price filter

The captured BTCUSDT `PERCENT_PRICE` multipliers are dynamic bounds around mark price. Binance documents that the filter uses mark price, and exposes current mark price through `/fapi/v1/premiumIndex`; it also publishes historical mark-price candles through `/fapi/v1/markPriceKlines`.

The P1 strategy builds a rounded limit-entry price from its chart bars. This project has no documented mark-price input wired into that strategy and no actual exchange order/fill feed, so it cannot check the live mark and venue response at order time. Substituting chart close for mark price would be an unverified approximation. A preflight at signal time also cannot guarantee later exchange acceptance or execution of a conditional exit.

## Required treatment

- Keep the current TakeProfit strategy and indicator research-only; do not describe simulator acceptance or fills as Binance order validation.
- Keep issue #8 open until a supported execution path supplies a fresh mark reference at submission, applies current exchange filters, and reconciles venue order acknowledgments, fills, fees, funding, and protective coverage. Any market-triggered exit behavior must be verified on the actual venue.
- Keep issue #9 native/reference parity unresolved. A TakeProfit emulator run is useful as a platform diagnostic, but it is not a Binance-native execution comparison. The existing history-cap and date-window issues are independent blockers.
- If TakeProfit adds a documented mark-price series or a safe order-validation integration, test it on a disposable script and verify exact order mapping before linking it to the protected working copy.

## Evidence

- [TakeProfit strategy orders](https://takeprofit.com/docs/indie/Strategies/Orders): position-level TP/SL behavior, backtesting-emulator scope, and stop versus stop-limit syntax.
- [Binance USD-M common definitions](https://developers.binance.com/zh-CN/docs/products/derivatives-trading-usds-futures/common-definition): `PERCENT_PRICE` bounds around mark price and order-side rules.
- [Binance USD-M market-data API](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data): current mark-price endpoint and mark-price kline endpoint.
- [Captured Binance BTCUSDT proxy filters](../research/data/binance_btcusdt_contract_snapshot.json) and [risk assessment](EXCHANGE_FILTER_EVIDENCE.md).
