# Binance BTCUSDT perpetual filter evidence

**Checked:** 2026-10-31 UTC
**Scope:** Binance USDⓈ-M BTCUSDT perpetual as a research proxy only. The user has not selected Binance as an execution venue.

## Public facts located

| Filter or rule | Public Binance evidence | What it establishes |
| --- | --- | --- |
| Price tick | Binance announced that BTCUSDT USDⓈ-M perpetual tick size changed from `0.01` to `0.1` effective 2022-02-15. | Last located BTC-specific tick notice; it is not a live filter snapshot. |
| Minimum notional | Binance announced a change from `100` to `50 USDT` for BTCUSDT perpetuals effective 2026-04-14. | Last located public minimum-notional notice; the active symbol filter still needs live confirmation. |
| Quantity grid | Current USDⓈ-M rules define `LOT_SIZE` with `minQty`, `maxQty`, and `stepSize`. | The current BTCUSDT values were not returned in this environment. |

Sources: [BTCUSDT tick-size notice](https://www.binance.com/en/support/announcement/detail/81e6795b0bae49828cbd52479094a987), [BTCUSDT minimum-notional notice](https://www.binance.com/en-BH/support/announcement/detail/10999fd17dc045de801c0c78ab29e6fc), and [Binance filter definitions](https://developers.binance.com/en/docs/products/derivatives-trading-options/common-definition).

## Missing snapshot

The official USDⓈ-M `GET /fapi/v1/exchangeInfo?symbol=BTCUSDT` endpoint returned HTTP 451 in this environment on 2026-10-31. No current contract-status/type/assets response or BTCUSDT `PRICE_FILTER`, `LOT_SIZE`, and `MIN_NOTIONAL` filter object was captured. Binance's documentation says `exchangeInfo` is the source for current symbol filters; the historical public notices cannot replace that snapshot.

Do not treat the historical `0.1` tick notice or `50 USDT` minimum-notional notice as a complete current exchange filter record. Keep current price/quantity rounding and executable order eligibility unverified. The research fixtures remain synthetic, and actual fills, account fees, spread and slippage are still absent. GitHub issue #8 stays open until the current filters can be obtained and native grid/fill behavior is reconciled.
