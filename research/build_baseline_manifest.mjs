// Rebuilds the frozen BTC baseline source/report manifest from checked-in files.
// This inventories retained evidence; it does not run TakeProfit or a backtest.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outPath = path.join(root, 'research/BASELINE_MANIFEST.json');
const readJson = rel => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const fileSha = rel => sha256(fs.readFileSync(path.join(root, rel)));
const normalizedSource = rel => {
  const text = fs.readFileSync(path.join(root, rel), 'utf8').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  return sha256(Buffer.from(text, 'utf8'));
};
const reportEntry = rel => ({ path: rel, sha256_raw_file: fileSha(rel) });
const clone = value => JSON.parse(JSON.stringify(value));

const experiments = readJson('research/ENHANCEMENT_EXPERIMENTS.json');
const audit = readJson('results/v1/audit.json');
const sourceVersions = {
  v4: {
    indicator_sha256: audit.source_sha256['indie/btc_pullback_indicator.indie'],
    strategy_sha256: audit.source_sha256['indie/btc_pullback_strategy.indie'],
    evidence: 'Recorded in results/v1/audit.json and research/audit_v1.mjs; source bodies are not retained in the canonical current source paths.'
  },
  v14: {
    strategy_sha256: experiments.archived_reference.strategy.sha256,
    evidence: 'Archived reference entry in research/ENHANCEMENT_EXPERIMENTS.json.'
  }
};

const v1Files = [
  'results/v1/5m_base.json',
  'results/v1/15m_base.json',
  'results/v1/5m_sensitivity.json',
  'results/v1/15m_sensitivity.json'
];
const v1Runs = v1Files.map(rel => {
  const snapshot = readJson(rel);
  const name = path.basename(rel, '.json');
  const sensitivity = name.endsWith('_sensitivity');
  return {
    run_id: snapshot.indicator_instance_id,
    label: name,
    artifact: rel,
    source: {
      script_id: snapshot.source.script_id,
      strategy_script_version: snapshot.source.script_version,
      source_sha256: sourceVersions.v4.strategy_sha256,
      indicator_historical_sha256: sourceVersions.v4.indicator_sha256,
      mapping_status: 'version_and_historical_hash_recorded'
    },
    request: clone(snapshot.request),
    captured_at: snapshot.captured_at,
    last_bar_at: snapshot.last_bar_at,
    history_sufficient: snapshot.is_history_depth_sufficient,
    metrics: {
      total_trades: snapshot.metrics.total_trades,
      realized_pnl: snapshot.metrics.realized_pnl,
      open_pnl: snapshot.metrics.open_pnl,
      total_pnl: snapshot.metrics.total_pnl_currency,
      win_rate_percent: snapshot.metrics.win_rate_percent,
      expectancy: snapshot.metrics.expectancy,
      profit_factor: snapshot.metrics.profit_factor
    },
    evidence_status: sensitivity ? 'defective_historical_sensitivity_overlapping_exit_opened_unintended_position' : 'superseded_pre_fix_history_insufficient',
    interpretation: 'Historical diagnostic only; not admissible as current baseline performance evidence.'
  };
});

const v2 = readJson('results/v2/backtests.json');
const v2Runs = v2.runs.map(run => {
  const perRunVersion = run.strategy_script_version;
  const sourceVersion = perRunVersion ?? v2.source.initial_strategy_script_version;
  const versionIsInferred = perRunVersion == null;
  const sourceHash = sourceVersion === 14 ? sourceVersions.v14.strategy_sha256 : null;
  return {
    run_id: run.indicator_instance_id,
    label: run.name,
    artifact: 'results/v2/backtests.json',
    source: {
      script_id: v2.source.strategy_script_id,
      strategy_script_version: sourceVersion,
      version_mapping_status: versionIsInferred ? 'inferred_from_bundle_initial_version_per_run_field_omitted' : 'explicit_in_run_record',
      source_sha256: sourceHash,
      source_hash_status: sourceHash ? 'archived' : 'historical_source_body_hash_not_retained',
      platform_saved_indicator_version_context: v2.source.saved_indicator_platform_version
    },
    request: {
      ticker: v2.source.ticker,
      exchange_code: v2.source.exchange_code,
      timeframe: run.timeframe,
      requested_from: run.date_from,
      requested_to: run.date_to,
      inputs_recorded_per_run: { cost_fraction: run.cost_fraction },
      common_inputs_recorded_in_bundle: {
        initial_capital: v2.source.initial_capital,
        commission_fraction_per_execution: v2.source.commission_fraction_per_execution,
        risk_fraction: v2.source.risk_fraction,
        quantity_step: v2.source.quantity_step
      },
      inputs_not_retained_per_run: ['leverage', 'intrabar_order_filter', 'entry/fill details', 'spread', 'slippage', 'funding', 'full order/fill ledger']
    },
    captured_at: run.captured_at,
    last_bar_at: run.last_bar_at,
    history_sufficient: run.history_depth_sufficient,
    metrics: {
      total_trades: run.total_trades,
      winning_trades: run.winning_trades ?? null,
      losing_trades: run.losing_trades ?? null,
      realized_pnl: run.realized_pnl,
      open_pnl: run.open_pnl,
      total_pnl: run.total_pnl,
      win_rate_percent: run.win_rate_percent ?? null,
      expectancy: run.expectancy ?? null,
      profit_factor: run.profit_factor ?? null,
      max_equity_drawdown_percent: run.max_equity_drawdown_percent ?? null
    },
    evidence_status: run.name.includes('fee_only') ? 'superseded_cost_fraction_only_diagnostic' : `superseded_strategy_v${sourceVersion}_history_limited`,
    interpretation: 'Historical iteration only. Requested/observed date bounds differ and every bundle run is marked history-insufficient.'
  };
});

const rawFullRuns = (rel, sourceHash) => {
  const bundle = readJson(rel);
  return bundle.runs.map(run => {
    const snapshot = run.orders ?? run;
    const request = snapshot.request;
    const metrics = snapshot.metrics ?? {};
    const source = snapshot.source ?? {};
    return {
      run_id: snapshot.indicator_instance_id,
      label: run.name ?? `instance-${snapshot.indicator_instance_id}`,
      artifact: rel,
      source: {
        script_id: source.script_id,
        strategy_script_version: source.script_version,
        source_sha256: sourceHash,
        mapping_status: 'explicit_in_raw_native_snapshot'
      },
      request: clone(request),
      captured_at: snapshot.captured_at,
      last_bar_at: snapshot.last_bar_at,
      history_sufficient: snapshot.is_history_depth_sufficient,
      has_more_items_on_the_left: snapshot.has_more_items_on_the_left,
      metrics: {
        total_trades: metrics.total_trades,
        winning_trades: metrics.winning_trades,
        losing_trades: metrics.losing_trades,
        realized_pnl: metrics.realized_pnl,
        open_pnl: metrics.open_pnl,
        total_pnl: metrics.total_pnl_currency,
        win_rate_percent: metrics.win_rate_percent,
        expectancy: metrics.expectancy,
        profit_factor: metrics.profit_factor,
        max_equity_drawdown_percent: metrics.max_equity_drawdown_percent,
        total_commissions: metrics.total_commissions
      },
      orders_recorded: snapshot.orders_page?.total_count ?? null,
      trades_recorded: snapshot.trades_page?.total_count ?? null,
      evidence_status: 'superseded_b0_diagnostic_incomplete_history',
      interpretation: 'No completed trades in the retained v16 windows; not a profitability estimate.'
    };
  });
};

const v16Hash = experiments.current_code_implementation.strategy_sha256;
const v3Runs = rawFullRuns('results/v3/backtests.json', v16Hash);
const v4Runs = rawFullRuns('results/v4/backtests.json', v16Hash);

const sourceFiles = [
  {
    role: 'indicator',
    path: 'indie/btc_pullback_indicator.indie',
    script_id: 'dd7d1e3f-a6db-4f3a-8a50-2b8f551e9db3',
    working_copy_version: 24,
    platform_saved_version: 19,
    working_copy_base_version: 16,
    saved: false
  },
  {
    role: 'strategy',
    path: 'indie/btc_pullback_strategy.indie',
    script_id: '6daa5166-bfc5-4960-8f84-e714a3b2aff2',
    working_copy_version: 16,
    linked_platform_version: null,
    saved: false
  }
].map(source => ({
  ...source,
  sha256_raw_file: fileSha(source.path),
  sha256_normalized_lf_utf8_no_bom: normalizedSource(source.path),
  normalization: 'Read UTF-8, strip one leading BOM if present, convert CRLF and CR to LF, encode UTF-8 without BOM, then SHA-256.'
}));

const resultPaths = [
  ...v1Files,
  'results/v1/audit.json',
  'results/v2/backtests.json',
  'results/v3/backtests.json',
  'results/v4/backtests.json'
];
const resultArtifacts = resultPaths.map(rel => reportEntry(rel));
const historicalRunCount = v1Runs.length + v2Runs.length + v3Runs.length + v4Runs.length;

const manifest = {
  schema_version: 1,
  baseline_id: 'BTC-PERP-B0-2026-10-30-v16-v24',
  generated_on: '2026-10-30',
  generator: 'research/build_baseline_manifest.mjs',
  scope: 'Source and evidence inventory for the frozen local BTC baseline; generation does not run an Indie script or a backtest.',
  repository: {
    branch_at_freeze: 'feature/btc-perp-pullback-diagnostics',
    canonical_source_snapshot_commit: '8b54db1c10b91bc4e067d3842e6c27a8ec9facdb',
    legacy_project_files: ['ScalpFlow_Pro.indie', 'ScalpFlow_Pro_Strategy.indie', 'phase1-backup/', 'visual-redesign-backup/'],
    canonical_project_directory: 'indie/'
  },
  current_sources: sourceFiles,
  current_validation: [
    {
      role: 'strategy',
      script_id: '6daa5166-bfc5-4960-8f84-e714a3b2aff2',
      working_copy_version: 16,
      mode: 'runtime_quick',
      valid: true,
      bars: 5000,
      calculation_time_ms: 2677.0,
      request_id: '2951fe5d2fdc4b1eb657bc419b73efdc',
      validated_on: '2026-10-30',
      limitation: 'Compatibility/runtime sample only; not a full-history, parity, execution, or profitability test.'
    },
    {
      role: 'indicator',
      script_id: 'dd7d1e3f-a6db-4f3a-8a50-2b8f551e9db3',
      working_copy_version: 24,
      mode: 'runtime_quick',
      valid: true,
      bars: 5000,
      calculation_time_ms: 4114.5,
      request_id: '0ee48c34c64640e699bed8d9a35ac9eb',
      validated_on: '2026-10-30',
      limitation: 'Compatibility/runtime sample only; indicator remains unsaved against platform base v16 while saved platform is v19.'
    }
  ],
  platform_state: {
    indicator_saved_platform_uid: 'b0WWgU3721kqgpvBweE24',
    indicator_saved_platform_version: 19,
    indicator_working_copy_version: 24,
    indicator_working_copy_base_version: 16,
    indicator_working_copy_saved: false,
    strategy_working_copy_version: 16,
    strategy_linked_platform_copy: false,
    note: 'Local research artifacts are complete and restorable; platform copy reconciliation is tracked separately in GitHub issue #12.'
  },
  archived_source_versions: [
    {
      script_version: 4,
      script_id: '6daa5166-bfc5-4960-8f84-e714a3b2aff2',
      strategy_sha256: sourceVersions.v4.strategy_sha256,
      indicator_sha256: sourceVersions.v4.indicator_sha256,
      evidence: sourceVersions.v4.evidence
    },
    {
      script_version: 7,
      script_id: '6daa5166-bfc5-4960-8f84-e714a3b2aff2',
      source_sha256: null,
      evidence: 'Version ID is retained in the v2 bundle top-level metadata; original source body/hash was not captured.'
    },
    {
      script_version_range: '8-13',
      script_id: '6daa5166-bfc5-4960-8f84-e714a3b2aff2',
      source_sha256: null,
      evidence: 'Per-run versions are retained in v2 for these iterations; original source bodies/hashes were not captured.'
    },
    {
      script_version: 14,
      script_id: '6daa5166-bfc5-4960-8f84-e714a3b2aff2',
      strategy_sha256: sourceVersions.v14.strategy_sha256,
      evidence: sourceVersions.v14.evidence
    },
    {
      script_version: 16,
      script_id: '6daa5166-bfc5-4960-8f84-e714a3b2aff2',
      strategy_sha256: v16Hash,
      evidence: 'Current canonical strategy source hash; raw requests in v3/v4 identify script ID and version 16.'
    },
    {
      indicator_working_copy_version: 24,
      script_id: 'dd7d1e3f-a6db-4f3a-8a50-2b8f551e9db3',
      indicator_sha256: experiments.current_code_implementation.indicator_sha256,
      evidence: 'Current canonical indicator source hash and TakeProfit working-copy version.'
    }
  ],
  retained_result_artifacts: resultArtifacts,
  retained_run_count: historicalRunCount,
  runs: [...v1Runs, ...v2Runs, ...v3Runs, ...v4Runs],
  derived_audits: [
    {
      artifact: 'results/v1/audit.json',
      source: 'research/audit_v1.mjs',
      source_sha256: fileSha('research/audit_v1.mjs'),
      kind: 'accounting_and_overlapping_exit_audit',
      associated_run_ids: v1Runs.map(run => run.run_id),
      not_a_backtest: true
    }
  ],
  research_plan: {
    configuration_budget: clone(experiments.budget),
    registered_stage_a: clone(experiments.stage_a),
    historical_runs_are_disclosed_separately: true,
    prior_run_record_count: historicalRunCount,
    prior_run_count_is_not_unique_configuration_count: true,
    future_new_configuration_cap: experiments.budget.max_unique_new_configurations
  },
  evidence_limitations: [
    'All retained native strategy histories are incomplete; the latest v16 runs have zero completed trades.',
    'v1 sensitivity snapshots show audited same-direction overlapping exits that opened unintended positions and are marked defective.',
    'The v2 bundle omits exact per-run versions for its first four records; the manifest maps them to the bundle initial version 7 and marks that mapping as inferred.',
    'Historical source bodies/hashes are not retained for strategy versions 7-13; version IDs and the bundle/run records are retained.',
    'The 15 bp cost fraction is a candidate gate/sizing assumption, not a fully realized round-trip P&L debit. Historical spread, slippage, and funding are unavailable.',
    'The current platform indicator working copy v24 is unsaved against an older base than the latest saved private version v19.',
    'No retained report establishes a profitable win rate, expectancy, or profit factor for the current baseline.'
  ],
  report_links: [
    'docs/PROJECT_LEVEL_UP_ASSESSMENT.md',
    'docs/CURRENT_ASSESSMENT.md',
    'docs/SCALPING_IMPLEMENTATION_PLAN.md',
    'docs/BACKTEST_DIAGNOSTIC_REPORT.md',
    'RESULTS.md'
  ]
};

fs.writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
  output: path.relative(root, outPath),
  retained_run_count: manifest.retained_run_count,
  current_sources: sourceFiles.map(({ path: rel, sha256_raw_file, sha256_normalized_lf_utf8_no_bom }) => ({ path: rel, sha256_raw_file, sha256_normalized_lf_utf8_no_bom })),
  result_artifact_count: resultArtifacts.length,
  future_new_configuration_cap: manifest.research_plan.future_new_configuration_cap
}, null, 2));
