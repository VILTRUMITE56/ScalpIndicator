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

const reportPath = 'research/reports/p2_net5_target_feasibility_report.json';
const report = JSON.parse(fs.readFileSync(path.join(root, reportPath), 'utf8'));
const inputs = [
  'research/specs/p2_net_target_policy.json',
  'research/specs/p1_portfolio_shadow.json',
  'research/specs/candidate_contract_p1.json',
  'research/specs/candidate_economics_p1.json',
  'research/specs/contract_risk_controls_p1.json',
  'research/specs/execution_cost_risk.json',
  'indie/btc_pullback_strategy_p1.indie',
  'indie/btc_pullback_strategy_p2.indie',
  'research/templates/strategy_candidate_adapter.indie.in',
  'research/p1_portfolio_shadow.mjs',
  'research/reports/candidate_economics_report.json',
  'research/reports/pre_cost_shadow_ledger.csv',
  'research/reports/p1_portfolio_shadow_report.json',
  'research/data/btcusdt_2024-10_2026-09/manifest.json',
  'research/data/btcusdt_2024-10_2026-09/derived/trade_1m.csv',
  'research/data/binance_btcusdt_contract_snapshot.json',
].map(relative => ({ path: relative, ...hashFile(relative) }));

const artifacts = [
  'research/p1_portfolio_shadow.mjs',
  'research/build_p2_net_target_manifest.mjs',
  'research/verify_p2_net_target_manifest.mjs',
  'research/README_CANDIDATE_P1.md',
  'docs/IMPROVEMENT_PLAN_2026-10-31.md',
  'research/specs/p2_net_target_policy.json',
  'indie/btc_pullback_strategy_p2.indie',
  'research/reports/p2_strategy_platform_validation.json',
  reportPath,
  'research/reports/p2_net5_target_feasibility_report.md',
  'research/reports/p2_net5_event_ledger.csv',
  'research/reports/p2_net5_trade_ledger.csv',
  'research/reports/p2_net5_daily_equity.csv',
  'research/reports/p2_net5_monthly_summary.csv',
].map(relative => ({ path: relative, ...hashFile(relative) }));

const manifest = {
  schema_version: 1,
  manifest_id: 'btc-perp-p2-net-target-feasibility-2026-10-31',
  generated_at_utc: new Date().toISOString(),
  policy_id: report.target_policy.id,
  status: 'feasibility_study_not_promoted',
  hash_convention: 'CSV inputs/artifacts use raw-byte SHA-256; text uses UTF-8 BOM stripping and CRLF/CR to LF normalization.',
  source_inputs: inputs,
  artifacts,
  result_summary: {
    candidate_count: report.data.candidate_rows,
    target_net_quote_at_15bp: report.target_policy.required_net_quote,
    profiles: report.profiles.map(profile => {
      const scenario = profile.scenarios.find(row => row.cost_scenario_bps === 15);
      return {
        profile: profile.profile,
        signal_gate_passes_15bp: profile.signal_gate_passes_15bp,
        conditional_entries: profile.portfolio_conditional_entries,
        closed_trades: scenario.closed_trades,
        win_rate_pct: scenario.win_rate_pct,
        net_pnl_15bp_quote: scenario.cumulative_net_pnl_quote,
        net_profit_factor_15bp: scenario.net_profit_factor,
        median_holding_minutes_upper: scenario.median_holding_minutes_upper,
      };
    }),
    actual_orders: report.result_semantics.actual_orders,
    actual_fills: report.result_semantics.actual_fills,
    promotion_decision: 'NOT_PROMOTED_NEGATIVE_15BP_EXPECTANCY_AND_SUBSTANTIALLY_LONGER_HOLDS',
  },
};

fs.writeFileSync(path.join(root, 'research/P2_NET_TARGET_MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({
  manifest: 'research/P2_NET_TARGET_MANIFEST.json',
  source_inputs: inputs.length,
  artifacts: artifacts.length,
  target_net_quote_at_15bp: manifest.result_summary.target_net_quote_at_15bp,
  conditional_entries: manifest.result_summary.profiles.reduce((sum, profile) => sum + profile.conditional_entries, 0),
}, null, 2));
