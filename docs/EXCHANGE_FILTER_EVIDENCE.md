# Binance BTCUSDT perpetual filter evidence

**Checked:** 2026-10-31 04:33:14 UTC
**Scope:** Binance USD-M BTCUSDT perpetual as a research proxy only. The user has not selected Binance as an execution venue.

## Last official observation

The public Binance USD-M endpoint returned one BTCUSDT row marked `PERPETUAL`, `TRADING`, with BTC base, USDT quote, and USDT margin. Its response included these filter values:

| Filter | Last observed value |
| --- | --- |
| `PRICE_FILTER` | tick `0.10`, min `556.80`, max `4529764` |
| `LOT_SIZE` | min `0.001`, step `0.001`, max `1000` |
| `MARKET_LOT_SIZE` | min `0.001`, step `0.001`, max `120` |
| `MIN_NOTIONAL` | `50` USDT |
| `PERCENT_PRICE` | reference-price multipliers `0.9700` to `1.0300` (dynamic filter) |

Captured response: [`binance_btcusdt_contract_snapshot.json`](../research/data/binance_btcusdt_contract_snapshot.json). It includes all symbol filters and the raw response SHA-256.

## Freshness result

The exchangeInfo response was captured at `2026-10-31T04:33:14.976Z`; the subsequent `/fapi/v1/time` response was 0.295 seconds away. This is within the 300-second freshness gate. Binance's endpoint documentation explicitly says to ignore `exchangeInfo.serverTime` and use `/fapi/v1/time` when checking server time; the old value in the exchangeInfo body is therefore not a freshness signal.

This satisfies a current public metadata snapshot for the Binance research proxy at capture time. It does not confirm that Binance will be the user's execution venue, nor does it establish user-specific fees, actual fills, or execution quality. `research/capture_binance_contract_snapshot.mjs` checks capture time against the subsequent `/fapi/v1/time` response and records stale responses explicitly.

## Public references

- [Binance USD-M exchange information endpoint](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data#exchange-information)
- [Binance USD-M common definitions and filter behavior](https://developers.binance.com/en/docs/products/derivatives-trading-usds-margined-futures/common-definition)
- [BTCUSDT tick-size notice](https://www.binance.com/en/support/announcement/detail/81e6795b0bae49828cbd52479094a987)
- [BTCUSDT minimum-notional notice](https://www.binance.com/en-BH/support/announcement/detail/10999fd17dc045de801c0c78ab29e6fc)

## Remaining limitations

The local P1 research strategy now rounds its entry, stop, and target to the chart instrument's tick size, floors size to a configured common quantity step, checks entry and protective-exit quantity/notional bounds, and caps modeled stop loss after rounding. Its Binance parameter defaults use the captured values above and remain configurable. The exact source compiled and passed `runtime_quick` on a disposable TakeProfit copy over 5,000 bars; the protected linked platform copy was not modified. The dynamic `PERCENT_PRICE` filter is not applied by the native adapter, and this run emitted no orders. This does not verify order execution or profitability.

The same ephemeral strategy was backtested over 2026-10-16 through 2026-10-31: 5m produced no trades; 15m produced one simulated short that stopped out at -$0.3649 net. Both runs were marked history-insufficient, and the single 15m entry/stop shared a timestamp. The results are a diagnostic only; details are in [`p1_native_risk_backtest_summary.json`](../research/reports/p1_native_risk_backtest_summary.json).

The model has no observed user fills, account fee tier, measured spread/slippage, or funding reserve. Binance remains a research proxy, not a confirmed execution venue. A stop can exceed the modeled loss cap through gaps, liquidation, exchange failure, or fill races. Issue #8 remains open until dynamic-filter handling, platform order behavior, and actual fill/cost reconciliation are verified.
