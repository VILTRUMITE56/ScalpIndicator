import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'research/P2_NET_TARGET_MANIFEST.json'), 'utf8'));
const report = JSON.parse(fs.readFileSync(path.join(root, 'research/reports/p2_net5_target_feasibility_report.json'), 'utf8'));
const policy = JSON.parse(fs.readFileSync(path.join(root, 'research/specs/p2_net_target_policy.json'), 'utf8'));
const platformValidation = JSON.parse(fs.readFileSync(path.join(root, 'research/reports/p2_strategy_platform_validation.json'), 'utf8'));

function hashFile(relative) {
  const bytes = fs.readFileSync(path.join(root, relative));
  if (relative.toLowerCase().endsWith('.csv')) return crypto.createHash('sha256').update(bytes).digest('hex');
  const normalized = bytes.toString('utf8').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
}

function parseCsvLine(line) {
  const values = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { value += '"'; i++; }
      else quoted = !quoted;
    } else if (ch === ',' && !quoted) { values.push(value); value = ''; }
    else value += ch;
  }
  values.push(value);
  return values;
}

const verify = rows => rows.map(row => {
  assert.equal(hashFile(row.path), row.sha256, `hash mismatch: ${row.path}`);
  return row.path;
});
const verifiedInputs = verify(manifest.source_inputs);
const verifiedArtifacts = verify(manifest.artifacts);
assert.equal(report.report_id, 'BTC-PERP-P2-NET-TARGET-5-01-SHADOW-2026-10');
assert.equal(manifest.policy_id, policy.policy_id);
assert.equal(report.target_policy.execution_policy_version, policy.execution_policy_version);
assert.equal(platformValidation.strategy_source_sha256_raw_bytes, policy.platform_validation.source_sha256_raw_bytes);
assert.equal(
  crypto.createHash('sha256').update(fs.readFileSync(path.join(root, policy.strategy_source))).digest('hex'),
  platformValidation.strategy_source_sha256_raw_bytes,
  'platform validation must match the exact local P2 source bytes',
);
assert.equal(platformValidation.compile.valid, true);
assert.equal(platformValidation.runtime_quick.valid, true);
assert.equal(platformValidation.native_backtest.status, 'NOT_RUN_PLAN_BAR_LIMIT');
assert.equal(report.native_backtest_limit.available_bars, 5060);
assert.equal(report.candidate_outputs.target_quote_plot_id, 'execution_candidate_target_quote');
assert.equal(report.candidate_outputs.reason_code_30, 'NET_TARGET_UNREACHABLE_AFTER_TICK_ROUNDING');
assert.equal(report.target_policy.required_net_quote, policy.objective.minimum_net_profit_quote_per_closed_trade);
assert.equal(report.data.candidate_rows, 6815);
assert.equal(report.profiles.reduce((sum, profile) => sum + profile.signal_gate_passes_15bp, 0), 291);
assert.equal(report.profiles.reduce((sum, profile) => sum + profile.portfolio_conditional_entries, 0), 141);
assert.ok(report.profiles.every(profile => profile.scenarios.find(scenario => scenario.cost_scenario_bps === 15).cumulative_net_pnl_quote < 0), 'both profiles must remain negative at the modeled base cost');
assert.equal(report.result_semantics.actual_orders, 'NOT_OBSERVED');
assert.equal(report.result_semantics.actual_fills, 'UNKNOWN');

const tradeFile = path.join(root, 'research/reports/p2_net5_trade_ledger.csv');
const lines = fs.readFileSync(tradeFile, 'utf8').trimEnd().split(/\r?\n/);
const headers = parseCsvLine(lines[0]);
const netTargetIndex = headers.indexOf('modeled_target_net_pnl_15bp_quote');
const riskIndex = headers.indexOf('modeled_all_in_risk_quote');
const sizeIndex = headers.indexOf('quantity_btc');
assert.ok(netTargetIndex >= 0 && riskIndex >= 0 && sizeIndex >= 0, 'P2 trade ledger target/risk/size outputs required');
const trades = lines.slice(1).map(line => {
  const cells = parseCsvLine(line);
  return { modeledTargetNet: Number(cells[netTargetIndex]), risk: Number(cells[riskIndex]), size: Number(cells[sizeIndex]) };
});
assert.equal(trades.length, 141);
assert.ok(trades.every(trade => trade.modeledTargetNet > 5), 'rounded target must model more than $5 net at 15 bp');
assert.ok(trades.every(trade => trade.risk <= 1 + 1e-9), 'all rounded trade sizes must respect the $1 all-in stop-loss cap');
assert.ok(trades.every(trade => trade.size >= 0.001 && trade.size <= 120), 'all rounded trade sizes must respect the proxy quantity bounds');

console.log(JSON.stringify({
  manifest: 'research/P2_NET_TARGET_MANIFEST.json',
  verified_inputs: verifiedInputs.length,
  verified_artifacts: verifiedArtifacts.length,
  candidates: report.data.candidate_rows,
  signal_gate_passes_15bp: 291,
  conditional_entries: trades.length,
  every_rounded_target_models_over_5_net_at_15bp: true,
  both_profiles_negative_at_15bp: true,
  actual_orders: report.result_semantics.actual_orders,
  actual_fills: report.result_semantics.actual_fills,
}, null, 2));
