// Build the source/data/output provenance manifest for the #7 shadow economics study.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');
const normalizedDigest = file => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file), 'utf8').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n'), 'utf8').digest('hex');
const outputFile = 'research/CANDIDATE_ECONOMICS_MANIFEST.json';
const report = JSON.parse(fs.readFileSync(path.join(root, 'research/reports/candidate_economics_report.json'), 'utf8'));
const candidateManifest = JSON.parse(fs.readFileSync(path.join(root, 'research/CANDIDATE_CONTRACT_MANIFEST.json'), 'utf8'));
const baselineManifest = JSON.parse(fs.readFileSync(path.join(root, 'research/BASELINE_MANIFEST.json'), 'utf8'));
const specPath = 'research/specs/candidate_economics_p1.json';
const files = [
  'research/candidate_reference.mjs',
  'research/candidate_economics_shadow.mjs',
  'research/build_candidate_economics_manifest.mjs',
  'research/verify_candidate_economics_manifest.mjs',
  specPath,
  'research/specs/candidate_contract_p1.json',
  'research/specs/execution_cost_risk.json',
  'research/CANDIDATE_CONTRACT_MANIFEST.json',
  'research/BASELINE_MANIFEST.json',
  'research/reports/candidate_event_ledger.csv',
  'research/reports/candidate_parity_report.json',
  'research/reports/btc_history_coverage.json',
  'research/data/btcusdt_2024-10_2026-09/manifest.json',
  'research/data/btcusdt_2024-10_2026-09/derived/trade_5m_resampled.csv',
  'research/data/btcusdt_2024-10_2026-09/derived/trade_15m_resampled.csv',
  'research/data/btcusdt_2024-10_2026-09/derived/trade_1m.csv',
  'research/data/btcusdt_2024-10_2026-09/derived/mark_1m.csv',
  'research/reports/pre_cost_shadow_ledger.csv',
  'research/reports/candidate_funnel_utc_month_volatility.csv',
  'research/reports/cost_atr_frontier_utc_month_volatility.csv',
  'research/reports/candidate_economics_report.json',
  'research/reports/candidate_economics_report.md',
];
const artifacts = files.map(file => ({ path: file, sha256: digest(file) }));
const b0Hashes = baselineManifest.current_sources.map(row => row.sha256_normalized_lf_utf8_no_bom);
const liveB0Hashes = ['indie/btc_pullback_indicator.indie', 'indie/btc_pullback_strategy.indie'].map(normalizedDigest);
assert.ok(b0Hashes.every((hash, index) => hash === liveB0Hashes[index]), 'Frozen B0 source hashes must remain unchanged.');
assert.equal(report.frozen_b0.hashes_unchanged, true);
assert.equal(report.candidate_parity.candidate_id_matches, report.overall.triggers);

const manifest = {
  schema_version: 1,
  manifest_id: 'btc-perp-p1-precost-feasibility-2026-10-30',
  generated_at_utc: new Date().toISOString(),
  status: report.status,
  experiment_spec: specPath,
  experiment_spec_sha256: digest(specPath),
  candidate_contract: report.candidate_contract,
  parent_frozen_baseline: report.frozen_b0.baseline_id,
  frozen_b0_sources_unchanged: true,
  candidate_contract_manifest_id: candidateManifest.manifest_id,
  window: report.window,
  input_hashes: report.source_files,
  sample_counts: {
    eligible_scored_bars: report.overall.eligible_scored_bars,
    setups: report.overall.directional_setups,
    triggers: report.overall.triggers,
    risk_pass_15bp: report.overall.risk_pass_15bp,
    observed_orders: report.overall.observed_order_count,
    observed_fills: report.overall.observed_fill_count,
  },
  cost_cases_bps: [10, 15, 20],
  new_signal_configurations_consumed: 0,
  validation: {
    candidate_ids_match_existing_p1_ledger: report.candidate_parity.candidate_id_matches === report.candidate_parity.existing_ledger_rows,
    baseline_risk_blockers_match_recalculation: report.candidate_parity.mismatched_risk_blockers === 0,
    b0_frozen_source_hashes_match: true,
    observed_orders_and_fills_available: false,
    profitability_claim: false,
  },
  limitation: 'Assumed planned-quote fills, minute OHLC barrier paths and hypothetical execution-cost sensitivities are not realized fills or proof of profitability. Funding, liquidation, measured spread/slippage, account fees and the actual execution venue remain unresolved.',
  artifacts,
};
fs.writeFileSync(path.join(root, outputFile), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ manifest: outputFile, artifact_count: artifacts.length, source_matches: manifest.validation.candidate_ids_match_existing_p1_ledger && manifest.validation.baseline_risk_blockers_match_recalculation && manifest.validation.b0_frozen_source_hashes_match }, null, 2));
