import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hashFile = relative => {
  const bytes = fs.readFileSync(path.join(root, relative));
  if (relative.toLowerCase().endsWith('.csv')) return { sha256: crypto.createHash('sha256').update(bytes).digest('hex'), method: 'raw bytes' };
  const normalized = bytes.toString('utf8').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  return { sha256: crypto.createHash('sha256').update(normalized, 'utf8').digest('hex'), method: 'UTF-8 BOM stripped; CRLF/CR normalized to LF' };
};

const reportPath = 'research/reports/p1_portfolio_shadow_report.json';
const report = JSON.parse(fs.readFileSync(path.join(root, reportPath), 'utf8'));
const inputs = [
  'research/specs/p1_portfolio_shadow.json',
  'research/specs/p2_net_target_policy.json',
  'research/specs/candidate_contract_p1.json',
  'research/specs/candidate_economics_p1.json',
  'research/specs/contract_risk_controls_p1.json',
  'research/specs/execution_cost_risk.json',
  'indie/btc_pullback_strategy_p1.indie',
  'research/templates/strategy_candidate_adapter.indie.in',
  'research/candidate_economics_shadow.mjs',
  'research/reports/candidate_economics_report.json',
  'research/reports/candidate_event_ledger.csv',
  'research/reports/pre_cost_shadow_ledger.csv',
  'research/data/btcusdt_2024-10_2026-09/manifest.json',
  'research/data/btcusdt_2024-10_2026-09/derived/trade_1m.csv',
  'research/data/binance_btcusdt_contract_snapshot.json',
].map(relative => ({ path: relative, ...hashFile(relative) }));

const artifacts = [
  'research/p1_portfolio_shadow.mjs',
  'research/build_p1_portfolio_shadow_manifest.mjs',
  'research/verify_p1_portfolio_shadow_manifest.mjs',
  'research/README_CANDIDATE_P1.md',
  'docs/IMPROVEMENT_PLAN_2026-10-31.md',
  reportPath,
  'research/reports/p1_portfolio_shadow_report.md',
  'research/reports/p1_portfolio_event_ledger.csv',
  'research/reports/p1_portfolio_trade_ledger.csv',
  'research/reports/p1_portfolio_daily_equity.csv',
  'research/reports/p1_portfolio_monthly_summary.csv',
].map(relative => ({ path: relative, ...hashFile(relative) }));

const manifest = {
  schema_version: 1,
  manifest_id: 'btc-perp-p1-portfolio-shadow-2026-10-31',
  generated_at_utc: new Date().toISOString(),
  model_id: report.report_id,
  status: report.status,
  hash_convention: 'CSV inputs/artifacts use raw-byte SHA-256; text uses UTF-8 BOM stripping and CRLF/CR to LF normalization.',
  source_inputs: inputs,
  artifacts,
  result_summary: {
    candidate_count: report.data.candidate_rows,
    profiles: report.profiles.map(profile => ({
      profile: profile.profile,
      triggers: profile.candidate_triggers,
      gate_passes_15bp: profile.signal_gate_passes_15bp,
      conditional_entries: profile.portfolio_conditional_entries,
      closed_trades: profile.closed_trades,
      net_pnl_15bp_quote: profile.scenarios.find(scenario => scenario.cost_scenario_bps === 15).cumulative_net_pnl_quote,
      net_profit_factor_15bp: profile.scenarios.find(scenario => scenario.cost_scenario_bps === 15).net_profit_factor,
    })),
    actual_orders: report.result_semantics.actual_orders,
    actual_fills: report.result_semantics.actual_fills,
    profitability: report.result_semantics.profitability,
  },
};

fs.writeFileSync(path.join(root, 'research/P1_PORTFOLIO_SHADOW_MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({
  manifest: 'research/P1_PORTFOLIO_SHADOW_MANIFEST.json',
  source_inputs: inputs.length,
  artifacts: artifacts.length,
  candidates: manifest.result_summary.candidate_count,
  conditional_entries: manifest.result_summary.profiles.reduce((sum, profile) => sum + profile.conditional_entries, 0),
}, null, 2));
