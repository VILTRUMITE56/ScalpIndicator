// Verify the stored #7 source, input and output hashes plus key report invariants.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');
const normalizedDigest = file => crypto.createHash('sha256')
  .update(fs.readFileSync(path.join(root, file), 'utf8').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n'), 'utf8')
  .digest('hex');
const recordedDigest = record => {
  if (record.hash_method === 'raw bytes') return digest(record.path);
  if (record.hash_method === 'UTF-8 BOM stripped; CRLF/CR normalized to LF') return normalizedDigest(record.path);
  throw new Error(`Unknown or missing hash method for ${record.path}: ${record.hash_method}`);
};
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'research/CANDIDATE_ECONOMICS_MANIFEST.json'), 'utf8'));
const report = JSON.parse(fs.readFileSync(path.join(root, 'research/reports/candidate_economics_report.json'), 'utf8'));
const baseline = JSON.parse(fs.readFileSync(path.join(root, 'research/BASELINE_MANIFEST.json'), 'utf8'));

for (const file of manifest.input_hashes) assert.equal(recordedDigest(file), file.sha256, `input hash: ${file.path}`);
for (const file of manifest.artifacts) assert.equal(recordedDigest(file), file.sha256, `artifact hash: ${file.path}`);
assert.equal(normalizedDigest(manifest.experiment_spec), manifest.experiment_spec_sha256, 'experiment spec hash');

const liveB0 = ['indie/btc_pullback_indicator.indie', 'indie/btc_pullback_strategy.indie'].map(normalizedDigest);
const frozenB0 = baseline.current_sources.map(row => row.sha256_normalized_lf_utf8_no_bom);
assert.equal(liveB0.length, frozenB0.length);
assert.ok(frozenB0.every((hash, index) => hash === liveB0[index]), 'frozen B0 source hashes remain unchanged');
assert.equal(report.frozen_b0.hashes_unchanged, true);
assert.equal(report.candidate_parity.mismatched_risk_blockers, 0);
assert.equal(report.candidate_parity.candidate_id_matches, report.overall.triggers);
assert.equal(report.overall.observed_order_count, 'NOT_OBSERVED');
assert.equal(report.overall.observed_fill_count, 'UNKNOWN');
assert.equal(report.barrier_index_validation.trade_1m.status, 'PASS');
assert.equal(report.barrier_index_validation.mark_1m.status, 'PASS');
assert.equal(report.cost_frontier_overall.find(row => row.bps === 10)?.combined_pass, 955);
assert.equal(report.cost_frontier_overall.find(row => row.bps === 15)?.combined_pass, 291);
assert.equal(report.cost_frontier_overall.find(row => row.bps === 20)?.combined_pass, 99);
assert.equal(manifest.sample_counts.triggers, report.overall.triggers);
assert.equal(manifest.sample_counts.risk_pass_15bp, report.overall.risk_pass_15bp);
assert.equal(manifest.validation.profitability_claim, false);

console.log(JSON.stringify({
  manifest: 'research/CANDIDATE_ECONOMICS_MANIFEST.json',
  input_hashes_verified: manifest.input_hashes.length,
  artifact_hashes_verified: manifest.artifacts.length,
  frozen_b0_unchanged: true,
  candidate_count: report.overall.triggers,
  cost_frontier_pass_counts: report.cost_frontier_overall.map(row => ({ bps: row.bps, pass: row.combined_pass })),
  observed_orders: report.overall.observed_order_count,
  observed_fills: report.overall.observed_fill_count,
}, null, 2));
