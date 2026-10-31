import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'research/P1_PORTFOLIO_SHADOW_MANIFEST.json'), 'utf8'));
const report = JSON.parse(fs.readFileSync(path.join(root, 'research/reports/p1_portfolio_shadow_report.json'), 'utf8'));

function hashFile(relative) {
  const bytes = fs.readFileSync(path.join(root, relative));
  if (relative.toLowerCase().endsWith('.csv')) return crypto.createHash('sha256').update(bytes).digest('hex');
  const normalized = bytes.toString('utf8').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
}

const verify = rows => rows.map(row => {
  const actual = hashFile(row.path);
  assert.equal(actual, row.sha256, `hash mismatch: ${row.path}`);
  return row.path;
});
const verifiedInputs = verify(manifest.source_inputs);
const verifiedArtifacts = verify(manifest.artifacts);
assert.equal(report.data.candidate_rows, 6815, 'candidate event count changed; review before accepting this checkpoint');
assert.equal(report.profiles.reduce((sum, profile) => sum + profile.signal_gate_passes_15bp, 0), 291, '15 bp gate count must match the frozen candidate study');
assert.equal(report.profiles.reduce((sum, profile) => sum + profile.closed_trades, 0), 168, 'conditional entry/closed trade counts disagree');
assert.ok(report.profiles.every(profile => profile.closed_trades === profile.portfolio_conditional_entries), 'all conditional fills must have a closed outcome in this history');
assert.ok(report.profiles.every(profile => profile.scenarios.find(scenario => scenario.cost_scenario_bps === 15).cumulative_net_pnl_quote < 0), 'expected current 15 bp model losses for both profiles');
assert.ok(report.profiles.every(profile => profile.scenarios.every(scenario => scenario.net_profit_factor < 1)), 'retained model must remain below unit PF at every cost case');
assert.equal(report.result_semantics.actual_orders, 'NOT_OBSERVED');
assert.equal(report.result_semantics.actual_fills, 'UNKNOWN');
assert.equal(report.result_semantics.profitability.includes('unproven'), true);

for (const artifact of [
  'research/reports/p1_portfolio_event_ledger.csv',
  'research/reports/p1_portfolio_trade_ledger.csv',
  'research/reports/p1_portfolio_daily_equity.csv',
  'research/reports/p1_portfolio_monthly_summary.csv',
]) {
  const lines = fs.readFileSync(path.join(root, artifact), 'utf8').trimEnd().split(/\r?\n/);
  assert.ok(lines.length > 1, `empty replay output: ${artifact}`);
}

console.log(JSON.stringify({
  manifest: 'research/P1_PORTFOLIO_SHADOW_MANIFEST.json',
  verified_inputs: verifiedInputs.length,
  verified_artifacts: verifiedArtifacts.length,
  candidate_events: report.data.candidate_rows,
  gate_passes_15bp: 291,
  conditional_closed_trades: 168,
  both_profiles_negative_at_15bp: true,
  actual_orders: report.result_semantics.actual_orders,
  actual_fills: report.result_semantics.actual_fills,
}, null, 2));
