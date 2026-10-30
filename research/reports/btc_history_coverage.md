# BTCUSDT USD-M history and resampling audit

Generated: 2026-10-30T13:45:03.583Z

- Contract: BTCUSDT USDⓈ-M perpetual contract; research proxy only
- Window: 2024-10-01T00:00:00.000Z to 2026-10-01T00:00:00.000Z (end exclusive)
- Complete trade 1m archive months: 24/24
- Trade 1m rows: 1,051,200 / 1,051,200 expected; missing grid bars: 0
- Archive states: {"verified":168}
- Overall acceptance audit: **PASS**

## Resampling checks

- 5m: 210,240 complete buckets independently checked; 0 internal resampling mismatches; native common=210,240, native mismatched=3, missing native=0, extra native=0.
- 15m: 70,080 complete buckets independently checked; 0 internal resampling mismatches; native common=70,080, native mismatched=3, missing native=0, extra native=0.
- 1h: 17,520 complete buckets independently checked; 0 internal resampling mismatches; native common=17,520, native mismatched=4, missing native=0, extra native=0.

## Profile warmup and excluded hours

- 5m_exec_15m_htf: 207,967 eligible bars; 0.00 hours lost to missing/incomplete execution bars; 0.25 hours removed for disputed execution bars; warmup excludes 62.50 initial hours plus 126.67 hours after gaps/source-conflict resets (56 execution bars and 250 HTF bars required); 3 disputed HTF bars excluded; first eligible 2024-10-03T14:30:00.000Z.
- 15m_exec_1h_htf: 67,064 eligible bars; 0.00 hours lost to missing/incomplete execution bars; 0.75 hours removed for disputed execution bars; warmup excludes 250.00 initial hours plus 503.25 hours after gaps/source-conflict resets (56 execution bars and 250 HTF bars required); 4 disputed HTF bars excluded; first eligible 2024-10-11T10:00:00.000Z.

Native/reference source disagreements: 5m=3, 15m=3, 1h=4 bars across the full window. They are listed with exact values and verified daily archive SHA-256s, excluded from scored bars, and trigger the baseline warmup reset. Scored common-date comparisons have zero remaining mismatches.
Mark/index monthly archives each omit 1440 / 1440 1m bars. The gaps were checked against SHA-256-verified official daily archives; 1440 mark rows and 1440 index rows were added to separate derived streams. No gaps remain in those materialized streams.
Trade volume units: BTC base volume and USDT quote volume; mark/index volume-like columns remain uninterpreted. Funding: 2,190 actual rows retained.

## Funding and price separation

- Funding rows retained: 2,190 actual event rows; timestamps preserved as received.
- Trade, mark and index price sources are written to separate 1m files. Mark/index volume-like columns are retained as published and are not interpreted as trade volume.
- Binance 1m rows with zero trades are counted separately. For a resampled bucket with trades, OHLC uses only trade-bearing minutes; for an entirely inactive but fully observed bucket, the official zero-trade OHLC is retained.
- Missing source minutes and incomplete resampled buckets are never forward-filled or fabricated.

## Reproduction

Run `node research/btc_history_pipeline.mjs --self-test` for the built-in synthetic validation, then `node research/btc_history_pipeline.mjs` to verify/download the default 2024-10 through 2026-09 source archives, generate local derived CSVs, and refresh this report and manifest. Raw archives and derived CSVs are excluded from git; their source URLs and SHA-256 checksums are retained in the manifest.

Detailed machine-readable results: research/reports/btc_history_coverage.json.
Pipeline source SHA-256: d7b0937fe29d00e3904843155d45761bcd7466601e6dbfcc0810c5d061a1d543.
Archive run manifest: research/data/btcusdt_2024-10_2026-09/manifest.json.

This report establishes data provenance and historical feature warmup only; it makes no profitability claim.
