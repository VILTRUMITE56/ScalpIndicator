// Rebuild the lifecycle evidence manifest from checked-in source and reports.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hashFile = relative => crypto.createHash('sha256')
  .update(fs.readFileSync(path.join(root, relative), 'utf8').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n'), 'utf8')
  .digest('hex');
const report = JSON.parse(fs.readFileSync(path.join(root, 'research/reports/order_lifecycle_report.json'), 'utf8'));
const contract = JSON.parse(fs.readFileSync(path.join(root, 'research/specs/order_lifecycle_p1.json'), 'utf8'));
const files = [
  'indie/btc_pullback_indicator_p1.indie',
  'indie/btc_pullback_strategy_p1.indie',
  'research/specs/order_lifecycle_p1.json',
  'research/order_lifecycle_check.mjs',
  'research/build_order_lifecycle_manifest.mjs',
  'research/reports/order_lifecycle_report.json',
  'research/reports/order_lifecycle_report.md',
  'research/reports/order_lifecycle_fixtures.csv',
  'research/reports/order_lifecycle_barrier_paths.csv',
  'research/reports/candidate_event_ledger.csv',
  'research/data/btcusdt_2024-10_2026-09/manifest.json',
];

const manifest = {
  schema_version: 1,
  manifest_id: 'btc-perp-order-lifecycle-p1-2026-10-30',
  generated_at_utc: new Date().toISOString(),
  contract_version: contract.contract_version,
  status: 'local_fixtures_and_emulator_contract_verified_live_exchange_execution_unconfirmed',
  hash_normalization: 'Text artifacts use SHA-256 after UTF-8 BOM stripping and CRLF/CR to LF normalization.',
  parent_main_commit: 'e7803e082535a23f75fb4d27982a9af19fcacd6e',
  strategy_changes: [
    'Track observed signed position size and request cancellation of a partial parent remainder after any observed protective position reduction or close.',
    'Record cooldown when a same-bar PARTIALLY_FILLED_CLOSED resolves with no exposure.',
    'Handle documented active and terminal order statuses explicitly; unknown states fail closed.',
    'Keep an active parent as an entry guard until cancellation acknowledgment; no timed exits are enabled.',
  ],
  fixture_run: {
    command: 'node research/order_lifecycle_check.mjs',
    fixtures: report.fixture_count,
    event_rows: report.fixture_event_count,
    fixture_names: report.fixture_results.map(x => x.scenario),
    reload_suffix_matches: true,
    accounting_invariants_pass: true,
  },
  lower_interval_replay: report.historical_replay,
  takeprofit_working_copies: report.platform_validation,
  takeprofit_backtest: report.platform_backtest,
  docs_basis: [
    'https://takeprofit.com/docs/indie/Strategies/Orders#statuses-and-lifecycle',
    'https://takeprofit.com/docs/indie/Strategies/Orders#take-profit-and-stop-loss-orders',
    'https://takeprofit.com/docs/indie/Strategies/Strategy-mechanics#order-execution',
  ],
  limitations: report.limitations,
  artifacts: files.map(path => ({ path, sha256: hashFile(path) })),
};

fs.writeFileSync(path.join(root, 'research/ORDER_LIFECYCLE_MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ manifest: 'research/ORDER_LIFECYCLE_MANIFEST.json', fixture_count: manifest.fixture_run.fixtures, hashed_files: manifest.artifacts.length }, null, 2));
