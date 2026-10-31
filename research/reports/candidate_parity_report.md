# P1 Candidate Contract Parity Report

Generated: 2026-10-31T03:10:27.017Z

Rule version: `BTC-PERP-PULLBACK-P1`. The P1 first-touch contract supersedes the B0 rolling [2]–[4] discovery rule for new experiments; the frozen B0 baseline was not edited.

## Reference method

Separate JavaScript engine; not emitted from or imported by the Indie generator/template.
SMA seed at length samples followed by alpha=2/(length+1), matching the documented Indie Ema source algorithm.
True range followed by Wilder RMA(14), initialized by the first 14-value SMA, matching the documented Indie Atr -> RMA algorithm.
Execution bars grouped by UTC bucket; complete contiguous groups only; EMA20/EMA50 recursively updated from the first completed HTF close; slope uses three completed HTF bars.
Completed bars processed once in timestamp order; first eligible range intersection arms; eligibility checks touch bias and directional EMA50 closes only within the current recovery episode.
Mask the exact disputed execution candles and omit disputed higher-timeframe buckets from the independently audited #4 stream; stale last-valid HTF bias is retained until the next clean HTF close reseeds and re-warms the series.
No exchange order book, actual fills, fee tier, spread/slippage tape, or funding cash flows are included in this candidate parity report.

## Historical replay

| Exec / HTF | Audited eligible / source bars | Setups | Candidates | Long | Short | Risk blocker counts | Full vs truncated |
|---|---|---:|---:|---:|---:|---|---|
| 5m / 15m | 207967 eligible / 210240 source | 13007 | 5262 | 2741 | 2521 | {"NONE":117,"COST > 0.2R":4483,"STOP > 2.5 ATR":662} | 139 overlapping candidates; 0 ID/level differences |
| 15m / 60m | 67064 eligible / 70080 source | 3984 | 1553 | 820 | 733 | {"COST > 0.2R":1159,"NONE":174,"STOP > 2.5 ATR":220} | 109 overlapping candidates; 0 ID/level differences |

## Fixtures

- legacy touch window: PASS
- bias at touch: PASS
- recovery ordering: PASS
- invalidating trigger wick: PASS
- six bar expiry: PASS
- long short symmetry: PASS
- execution quote separation: PASS

## Fill and profitability boundary

The strategy limit quote is recorded separately from the immutable planned entry, stop, and target. Actual fill prices remain unknown; no fill or profitability claim is made. Fees, spread, slippage, funding, venue filters, and platform cancel/fill races require separate execution validation.

Reproduce with `node research/candidate_reference.mjs`; it runs the fixtures and full-versus-truncated checks and writes the JSON report and CSV event ledger.
