# Source reconciliation — 31 October 2026

The current TakeProfit P1 indicator working copy now matches the local source exactly. The separate strategy draft still differs from local P1.

| Role | Local source | Current TakeProfit copy | State |
| --- | --- | --- | --- |
| P1 indicator | 887 lines, SHA-256 `5b26a8fa…` | v29, 887 lines; linked to saved v16 while v19 is latest | Exact local match; compile passed; unsaved and stale, save rejected |
| P1 strategy | 576 lines, SHA-256 `ad87c6b7…` | v21, 507 lines; no saved platform UID | Unsaved draft; mismatch |
| P2 strategy | 596 lines, SHA-256 `568a9c1b…` | Ephemeral validation copy only | Compile and `runtime_quick` passed; not saved |

The active chart or alert binding is unknown. A script listing cannot establish what a chart is currently using. The local files are the reproducible engineering sources; do not treat the platform drafts as equivalent or active without checking the chart and alert bindings.

After the initial source check, the local indicator gained an off-by-default B4 anti-chase research gate and extension/reason outputs. The exact updated source was written to TakeProfit working copy v29 and compiled successfully. Saving was rejected because that copy is based on saved v16 while v19 is latest; the saved platform version remains unchanged. The P1/P2 strategy sources also remain unchanged; enabling B4 breaks indicator/strategy candidate parity.

The connected account currently has no alerts or recent alert-log items, so there is no existing prospective event feed to import. The capture utility accepts prepared JSON events but is not wired to TakeProfit notifications.

The [machine-readable record](SOURCE_RECONCILIATION_2026-10-31.json) has the complete local hashes and TakeProfit IDs. The paper-shadow template locks the intended local P1/P2 pair and blocks capture until source, venue, fee, and filter confirmations are set.
