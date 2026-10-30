# BTC perpetual history pipeline

The canonical research proxy is Binance USD-M `BTCUSDT` perpetual. The current reproducible window is 24 completed UTC months: 2024-10-01 inclusive through 2026-10-01 exclusive.

## Reproduce

Requires Node.js 20 or newer; the pipeline uses only Node built-ins.

```powershell
node research/btc_history_pipeline.mjs --self-test
node research/btc_history_pipeline.mjs
```

The pipeline downloads the official monthly 1m trade, mark, index and funding archives, plus native trade 5m, 15m and 1h archives. It verifies each sibling SHA-256 checksum and records source URLs, archive metadata and revision dates. It fetches checksum-verified daily archives only to investigate a native/reference conflict or recover an official mark/index row missing from a monthly archive.

Large raw ZIPs and derived CSVs stay local under `research/data/btcusdt_2024-10_2026-09/` and are ignored by git. The compact manifest is tracked at `research/data/btcusdt_2024-10_2026-09/manifest.json`.

## Data rules

- Timestamps are Unix epoch milliseconds in UTC. Funding event times remain exactly as published.
- Trade volume is BTC base volume; quote volume is USDT. Mark and index streams stay separate and their volume-like columns are not treated as trade activity.
- Resampled bars require all exact 1m constituents. Missing minutes are never forward-filled. For a bucket with trades, OHLC uses trade-bearing minute rows; a fully inactive bucket keeps the official zero-trade OHLC rows.
- Mark/index rows missing from the monthly archive may be filled only by matching timestamps from a checksum-verified official daily archive. The source and recovered row count are recorded.
- Native/reference conflicts are retained in the audit with exact values. Conflicting timeframe bars are excluded from scoring and trigger the canonical warmup reset; no value is silently selected.
- Execution EMA reference uses an SMA seed; the custom higher-timeframe EMA uses the first completed close after a reset. Scoring readiness is 56 completed execution bars plus 250 contiguous completed HTF bars.

## Evidence

- Coverage report: [`reports/btc_history_coverage.md`](reports/btc_history_coverage.md)
- Machine-readable audit: [`reports/btc_history_coverage.json`](reports/btc_history_coverage.json)
- Reproducer: [`btc_history_pipeline.mjs`](btc_history_pipeline.mjs)

This pipeline audits historical data and warmup; it does not establish strategy profitability.
