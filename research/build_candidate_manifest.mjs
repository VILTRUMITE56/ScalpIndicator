// Build the provenance manifest for the versioned P1 candidate contract.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const normalizedText = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
const fileHash = file => digest(normalizedText(file));
const b0Manifest = JSON.parse(fs.readFileSync(path.join(root, 'research/BASELINE_MANIFEST.json'), 'utf8'));
const report = JSON.parse(fs.readFileSync(path.join(root, 'research/reports/candidate_parity_report.json'), 'utf8'));
const contract = JSON.parse(fs.readFileSync(path.join(root, 'research/specs/candidate_contract_p1.json'), 'utf8'));
const risk = contract.planned_entry_risk_contract;
const sharedTemplate = normalizedText('research/templates/shared_candidate_core.indie.in');
const templateValues = {
  expiry_last: String(contract.shared_signal_rules.expiry_bars_after_touch.last_inclusive),
  long_invalidation_atr: String(risk.long_invalidation_offset_atr),
  long_stop_reference_atr: String(risk.long_stop_reference_offset_atr),
  short_invalidation_atr: String(risk.short_invalidation_offset_atr),
  short_stop_reference_atr: String(risk.short_stop_reference_offset_atr),
  minimum_stop_atr: String(risk.minimum_stop_distance_atr),
  target_r: String(risk.target_multiple_r),
  stop_cap_atr: String(risk.maximum_stop_distance_atr),
  cost_r_cap: String(risk.maximum_cost_to_risk),
  contract_version: contract.contract_version,
};
let renderedCore = sharedTemplate;
for (const [key, value] of Object.entries(templateValues)) renderedCore = renderedCore.replaceAll(`{{${key}}}`, value);
assert.ok(!/\{\{[^}]+\}\}/.test(renderedCore), 'All shared-core template values must be resolved');
renderedCore = renderedCore
  .replace('        # BEGIN GENERATED SHARED CANDIDATE CORE\n', '')
  .replace('\n        # END GENERATED SHARED CANDIDATE CORE', '');

const b0Integrity = b0Manifest.current_sources.map(source => {
  const actual = fileHash(source.path);
  assert.equal(actual, source.sha256_normalized_lf_utf8_no_bom, `Frozen B0 source changed: ${source.path}`);
  return { path: source.path, sha256: actual, matches_frozen_manifest: true };
});

const p1IndicatorPath = 'indie/btc_pullback_indicator_p1.indie';
const p1StrategyPath = 'indie/btc_pullback_strategy_p1.indie';
const indicator = normalizedText(p1IndicatorPath);
const strategy = normalizedText(p1StrategyPath);
const start = '        # BEGIN GENERATED SHARED CANDIDATE CORE\n';
const end = '        # END GENERATED SHARED CANDIDATE CORE';
const core = source => {
  const i = source.indexOf(start);
  const j = source.indexOf(end, i);
  assert.ok(i >= 0 && j > i, 'Generated core markers are required in each P1 Indie source');
  return source.slice(i + start.length, j);
};
const indicatorCore = core(indicator);
const strategyCore = core(strategy);
assert.equal(indicatorCore, strategyCore, 'P1 indicator and strategy shared core must be byte-identical');
assert.equal(indicatorCore.trimEnd(), renderedCore.trimEnd(), 'P1 source core must match the rendered generator template');

const dataManifestPath = 'research/data/btcusdt_2024-10_2026-09/manifest.json';
const ledgerPath = 'research/reports/candidate_event_ledger.csv';
const jsonReportPath = 'research/reports/candidate_parity_report.json';
const mdReportPath = 'research/reports/candidate_parity_report.md';
const scripts = [
  {
    role: 'indicator', path: p1IndicatorPath, script_id: 'dd7d1e3f-a6db-4f3a-8a50-2b8f551e9db3',
    takeprofit_working_copy_version: 29, working_copy_line_count: 887, platform_saved: false,
    platform_uid: 'b0WWgU3721kqgpvBweE24', latest_saved_platform_version_major: 19,
    local_platform_source_match: true, preserved_platform_source_sha256: '7507a3f87e78fc17c78b841ff5af64997f4b750c460105c652d1a72c15d11564',
    working_copy_compile: 'PASS', working_copy_runtime_quick: 'NOT_RUN_AFTER_B4_CHANGE', working_copy_runtime_full: 'NOT_RUN_AFTER_B4_CHANGE',
    working_copy_runtime_series_items: 0,
    save_status: 'BLOCKED_STALE_BASE_16_LATEST_19',
    previous_local_source_ephemeral_validation: {
      script_id: '57e57ed7-7922-4e79-a3a1-a80503bc1b42', version: 1, ephemeral: true, platform_saved: false,
      source_sha256: '99fc5092895a4cf66d966427e808fc4ee2a27f3b1e5ed7da352a9238154ea87f',
      compile: 'PASS', runtime_quick: 'PASS', runtime_series_items: 5000,
    },
    current_source_validation: {
      script_id: 'dd7d1e3f-a6db-4f3a-8a50-2b8f551e9db3', version: 29, ephemeral: false, platform_saved: false,
      compile: 'PASS', runtime_quick: 'NOT_RUN_AFTER_B4_CHANGE', runtime_series_items: 0,
    },
  },
  {
    role: 'strategy', path: p1StrategyPath, script_id: '6daa5166-bfc5-4960-8f84-e714a3b2aff2',
    takeprofit_working_copy_version: 21, working_copy_line_count: 507, platform_saved: false,
    platform_uid: null, latest_saved_platform_version_major: null,
    local_platform_source_match: false, working_copy_matches_preceding_local_snapshot: true,
    working_copy_compile: 'PASS', working_copy_runtime_quick: 'PASS', working_copy_runtime_full: 'PASS',
    working_copy_runtime_series_items: 5000,
    current_source_ephemeral_validation: {
      script_id: '92254833-5b23-4439-a9c2-8f46975debd9', version: 1, ephemeral: true, platform_saved: false,
      compile: 'PASS', runtime_quick: 'PASS', runtime_series_items: 5000,
    },
  },
].map(script => ({ ...script, sha256: fileHash(script.path) }));

const artifacts = [
  'research/README_CANDIDATE_P1.md',
  'docs/CANDIDATE_EVENT_OUTPUTS_P1.md',
  'docs/EXECUTION_COST_AND_RISK_REQUIREMENTS.md',
  'research/specs/execution_cost_risk.json',
  'research/specs/candidate_contract_p1.json',
  'research/templates/shared_candidate_core.indie.in',
  'research/templates/indicator_candidate_adapter.indie.in',
  'research/templates/strategy_candidate_adapter.indie.in',
  'research/generate_candidate_logic.mjs',
  'research/candidate_reference.mjs',
  'research/build_candidate_manifest.mjs',
  jsonReportPath,
  mdReportPath,
  ledgerPath,
  dataManifestPath,
  'research/specs/order_lifecycle_p1.json',
  'research/order_lifecycle_check.mjs',
  'research/build_order_lifecycle_manifest.mjs',
  'research/reports/order_lifecycle_report.md',
  'research/reports/order_lifecycle_report.json',
  'research/reports/order_lifecycle_fixtures.csv',
  'research/reports/order_lifecycle_barrier_paths.csv',
].map(file => ({ path: file, sha256: fileHash(file) }));

const manifest = {
  schema_version: 1,
  manifest_id: 'btc-perp-candidate-contract-p1-2026-10-31',
  generated_at_utc: new Date().toISOString(),
  contract_version: contract.contract_version,
  execution_policy_version: contract.execution_separation.execution_policy_version,
  parent_frozen_baseline: b0Manifest.baseline_id,
  status: 'candidate-parity-checkpoint-complete_execution-policy-updated_b4-indicator-only-unvalidated_profitability-unproven',
  environment: { node_version: process.version, operating_system: process.platform },
  frozen_b0_source_integrity: b0Integrity,
  p1_platform_sources: scripts,
  p1_indicator_experimental_filter: {
    id: 'B4',
    setting: 'b4_avoid_extended_entries',
    default_enabled: false,
    rule: 'Reject only when side * (completed_trigger_close - EMA20) / trigger_ATR14 > 1.0.',
    scope: 'Indicator-only; the P1 strategy remains unchanged, so leave the option off when candidate parity is required.',
    platform_validation: 'COMPILE_PASS_RUNTIME_NOT_RUN_AFTER_B4_CHANGE_UNSAVED_STALE_BASE',
    profitability_status: 'UNPROVEN_NOT_PROMOTED',
  },
  generated_shared_core: {
    sha256_lf_utf8: digest(indicatorCore.trimEnd()),
    indicator_equals_strategy: true,
    source_equals_template: true,
  },
  reference_run: {
    report: jsonReportPath,
    ledger: ledgerPath,
    independent_engine_source: 'research/candidate_reference.mjs',
    input_history_manifest: dataManifestPath,
    profiles: report.profiles.map(profile => ({
      execution_minutes: profile.execution_minutes,
      higher_minutes: profile.higher_minutes,
      bars: profile.bars,
      source_csv: profile.source_csv,
      source_csv_sha256: profile.source_csv_sha256,
      candidates: profile.full_history_candidates,
      full_vs_truncated: profile.full_vs_truncated_overlap,
    })),
    fixtures: report.fixtures,
    unique_candidate_ids: report.overall.unique_candidate_ids,
    profitability_status: 'unproven; native P1 executions/fills were not part of this candidate parity run',
  },
  event_level_native_runtime_export: 'TakeProfit compile/runtime validation does not return candidate rows or plotted series values. Candidate event rows and historical fields are from the independently written reference engine; platform parity is verified by identical shared source code and plan fields consumed by each adapter.',
  artifacts,
};

fs.writeFileSync(path.join(root, 'research/CANDIDATE_CONTRACT_MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ manifest: 'research/CANDIDATE_CONTRACT_MANIFEST.json', b0_sources_unchanged: b0Integrity.length, generated_core_sha256: manifest.generated_shared_core.sha256_lf_utf8, p1_scripts: scripts, profiles: manifest.reference_run.profiles }, null, 2));
