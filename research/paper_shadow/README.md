# Forward paper-shadow capture

This workflow records prospective candidate and execution observations for the locked P1/P2 pair. It does not send orders, connect to an exchange, or pull TakeProfit plots automatically. The account had no existing alerts or recent alert-log items at the source check; export or enter events from the chosen chart/data source, then append them locally. The report separates quote-simulated outcomes from testnet fills; neither is a real-money performance claim.

## Before collection

1. Copy `run_manifest.template.json` to a new run folder and assign a unique `run_id`.
2. Decide which source the chart/export will use. Confirm its signal and strategy hashes against the source lock. The current TakeProfit drafts mismatch the local files; see [`../SOURCE_RECONCILIATION_2026-10-31.md`](../SOURCE_RECONCILIATION_2026-10-31.md).
3. Confirm the execution venue, fee tier/rebates, funding source, and current tick, quantity, market-quantity, notional, and mark-price percentage filters. Update the instrument metadata and confirmations.
4. Set `status` to `READY` only after those confirmations are true. Capture refuses drafts or incomplete locks. `live_order_routing_allowed` must remain false.

The `cost_evidence` block must contain the venue's actual maker/taker rates, fee source, funding source/method, and capture time before collection. Keep those rates distinct from P2's hypothetical 15 bp scenario.

The default Binance code is a repository research proxy, not an assumption that Binance is the intended venue. Its USD-M rules include price bands based on mark price plus tick/quantity/notional constraints; capture the live values for the selected contract rather than relying on a stale snapshot. [Official filter reference](https://developers.binance.com/docs/derivatives/usds-margined-futures/common-definition).

## Append one immutable observation

Create one JSON file for each state transition and run:

```powershell
node research/paper_shadow_capture.mjs append --manifest path\to\run.json --event path\to\event.json
```

The tool assigns no trading decision. Each event must include:

```json
{
  "schema_version": 1,
  "run_id": "your-run-id",
  "sequence": 1,
  "event_id": "unique-observation-id",
  "candidate_id": "venue|ticker|profile|LONG_OR_SHORT|touch_utc_s|trigger_utc_s|BTC-PERP-PULLBACK-P1",
  "variant_id": "P1",
  "execution_policy_version": "BTC-PERP-EXEC-1",
  "event_type": "CANDIDATE",
  "recorded_at_utc": "2026-11-01T00:00:00Z",
  "signal_source_sha256_lf_utf8": "5b26a8fae30c73ffaeec8201387d5fdbac999211f771db047bd8071a68fb66b7",
  "strategy_source_sha256_lf_utf8": "ad87c6b7bd6a12d999913087995333b7e26af6049aa5952c1621e4a2f2019d54",
  "payload": {
    "side": "LONG",
    "profile_minutes": 5,
    "candidate_event_code": 1,
    "execution_reason_code": 2,
    "trigger_utc_s": 1793491200
  }
}
```

Allowed `event_type` values are `CANDIDATE`, `QUOTE`, `ORDER`, `FILL`, `FUNDING`, and `CLOSE`. `QUOTE` records bid/ask/mark and a timestamped filter snapshot. A `PAPER_PLANNED` order must follow a quote and include quantity, limit, stop, and target; its long/short level geometry is checked. Other order events record accepted/rejected/canceled state. Each partial `FILL` is a separate row with leg (`ENTRY`/`EXIT`), quantity, price, fee, and evidence type. `FUNDING` records the signed quote amount. `CLOSE` marks a fully closed position and gives its exit reason. Full field rules are enforced by the capture tool.

Each `QUOTE` must include current tick size, quantity step and limits, minimum notional, and mark-price band multipliers. Every `FILL` requires a fee basis (`OBSERVED`, `CONFIRMED_RATE`, or `UNKNOWN`); `CLOSE` must confirm that applicable fees and funding are complete. Unknown cost evidence remains labeled incomplete in the report and blocks a clean quality status. The run manifest also requires the confirmed fee schedule and funding method, kept distinct from P2's hypothetical 15 bp scenario.

The log is append-only. If a recorded event is wrong, preserve the old run and start a replacement run with `supersedes_run_id` pointing to it; do not edit or silently delete observations.

## Reconcile

```powershell
node research/paper_shadow_capture.mjs reconcile --manifest path\to\run.json
```

The reconciler checks source locks, event order, duplicate IDs, order/fill references, partial quantities, open residual positions, and required cost/funding evidence. It calculates closed-trade P&L from entry/exit fills, fees, and signed funding, then groups results by variant and fill evidence. Candidate events without a closed position remain in the funnel and do not count as closed trades.

Do not tune parameters during collection. The evaluation gates in the manifest mirror the improvement plan; they are engineering gates, not guarantees that eight weeks or a fixed sample proves an edge. Testnet is useful for supported order-path checks, but Binance documents that endpoint coverage is product-specific; its simulated fills should remain separate from quote-based paper results. [USD-M Futures testnet endpoints](https://developers.binance.com/docs/derivatives/usds-margined-futures/general-info).
