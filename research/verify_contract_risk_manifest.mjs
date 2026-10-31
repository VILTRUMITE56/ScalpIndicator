// Verify hashes and completeness of the issue #8 evidence bundle.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(root, 'research/CONTRACT_RISK_MANIFEST.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const report = JSON.parse(fs.readFileSync(path.join(root, 'research/reports/contract_risk_report.json'), 'utf8'));
const contract = JSON.parse(fs.readFileSync(path.join(root, 'research/specs/contract_risk_controls_p1.json'), 'utf8'));
const snapshot = JSON.parse(fs.readFileSync(path.join(root, 'research/data/binance_btcusdt_contract_snapshot.json'), 'utf8'));

assert.equal(manifest.policy_id, contract.policy_id, 'manifest policy matches contract');
assert.ok(manifest.verification.all_fixtures_pass, 'manifest records passing deterministic fixtures');
assert.equal(manifest.verification.fixture_count, report.fixture_count, 'fixture count matches report');
assert.equal(report.all_fixtures_pass, true, 'report records passing fixtures');
assert.equal(contract.live_contract_snapshot.status, 'FRESH_OFFICIAL_METADATA_RESEARCH_PROXY', 'fresh research-proxy filter observation remains explicit');
assert.ok(Math.abs(contract.live_contract_snapshot.capture_to_reference_delta_seconds) <= contract.live_contract_snapshot.freshness_threshold_seconds, 'capture and reference server time meet the freshness gate');
assert.equal(contract.live_contract_snapshot.contract_type, 'PERPETUAL', 'captured product is a perpetual contract');
assert.equal(contract.live_contract_snapshot.limit_quantity_step, contract.live_contract_snapshot.market_quantity_step, 'native common quantity-step default aligns with the last observed limit and market grids');
assert.equal(snapshot.status, 'FRESH_OFFICIAL_METADATA', 'snapshot payload records fresh capture status');
assert.equal(snapshot.status === 'FRESH_OFFICIAL_METADATA', contract.live_contract_snapshot.status === 'FRESH_OFFICIAL_METADATA_RESEARCH_PROXY', 'capture and contract specification freshness states agree');
assert.equal(snapshot.captured_at_utc, contract.live_contract_snapshot.captured_at_utc, 'snapshot and contract capture timestamps agree');
assert.equal(snapshot.raw_response_sha256_utf8, contract.live_contract_snapshot.response_sha256_utf8, 'full-response digest matches the synchronized contract specification');
assert.equal(snapshot.capture_to_reference_delta_seconds, contract.live_contract_snapshot.capture_to_reference_delta_seconds, 'freshness delta matches the synchronized contract specification');
assert.equal(snapshot.filters.price_filter.tickSize, '0.10', 'captured price tick is preserved as an exact decimal string');
assert.equal(snapshot.filters.limit_lot_size.stepSize, snapshot.filters.market_lot_size.stepSize, 'captured entry and protective exit grids align');
assert.equal(snapshot.filters.min_notional_or_notional.notional, '50', 'captured minimum notional is preserved');
assert.equal(snapshot.filters.all_symbol_filters.length > 0, true, 'all symbol filters are retained in the evidence snapshot');
assert.equal(snapshot.filters.percent_price.multiplierUp, '1.0300', 'dynamic percent-price filter is retained in the evidence snapshot');
assert.equal(report.native_platform_validation.status, 'PASS_COMPILE_AND_RUNTIME_QUICK_ON_EPHEMERAL_COPY', 'native source validation is documented without claiming order performance');
assert.equal(report.native_platform_backtest_summary.status, 'DIAGNOSTIC_ONLY_INSUFFICIENT_HISTORY_NOT_PROFITABILITY_EVIDENCE', 'bounded backtest limitations are recorded');
assert.equal(report.native_platform_backtest_summary.profiles['5m_execution_15m_bias'].trades, 0, '5m no-trade result remains explicit');
assert.equal(report.native_platform_backtest_summary.profiles['15m_execution_1h_bias'].trades, 1, '15m single-trade result remains explicit');
assert.equal(report.native_platform_backtest_summary.profiles['15m_execution_1h_bias'].history_sufficient, false, 'insufficient backtest history remains explicit');
assert.equal(report.native_platform_validation.source_sha256, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'indie/btc_pullback_strategy_p1.indie'), 'utf8').replace(/\r\n/g, '\n'), 'utf8').digest('hex'), 'validated native source hash matches the report');
assert.equal(contract.user_account_locks.daily_loss_limit_quote, null, 'unset daily limit is not inferred');
assert.equal(contract.user_account_locks.maximum_drawdown_fraction, null, 'unset drawdown is not inferred');
assert.equal(contract.user_account_locks.personal_locks_enabled, false, 'personal locks remain disabled by user choice');
assert.ok(contract.user_account_locks.status.startsWith('DISABLED_BY_USER_REQUEST'), 'user lock decision is explicit');
assert.equal(manifest.unresolved_inputs.personal_locks_enabled, false, 'disabled personal locks are recorded as a deliberate policy, not missing configuration');

const seen = new Set();
for (const artifact of manifest.artifacts) {
  assert.ok(!path.isAbsolute(artifact.path), 'artifact path must be relative: ' + artifact.path);
  const resolved = path.resolve(root, artifact.path);
  assert.ok(resolved.startsWith(root + path.sep), 'artifact path must remain within repository: ' + artifact.path);
  assert.ok(!seen.has(artifact.path), 'artifact path is duplicated: ' + artifact.path);
  seen.add(artifact.path);
  const normalized = fs.readFileSync(resolved, 'utf8').replace(/\r\n/g, '\n');
  const actual = crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
  assert.equal(actual, artifact.sha256, 'artifact hash matches: ' + artifact.path);
}

const fixtureLines = fs.readFileSync(path.join(root, 'research/reports/contract_risk_fixtures.csv'), 'utf8').trim().split(/\r?\n/);
assert.equal(fixtureLines.length - 1, report.fixture_count, 'CSV fixture rows match report fixture count');
assert.ok(manifest.artifacts.some(item => item.path === 'research/reports/contract_risk_fixtures.csv'), 'fixture CSV is included');
assert.ok(manifest.artifacts.some(item => item.path === 'research/reports/contract_risk_report.md'), 'human-readable report is included');
assert.ok(manifest.artifacts.some(item => item.path === 'research/reports/p1_native_risk_backtest_summary.json'), 'diagnostic native backtest evidence is included');
assert.ok(manifest.artifacts.some(item => item.path === 'research/data/binance_btcusdt_contract_snapshot.json'), 'official filter snapshot is included');
assert.ok(manifest.artifacts.some(item => item.path === 'indie/btc_pullback_strategy_p1.indie'), 'validated native strategy source is included');
assert.equal(manifest.acceptance.issue_8_close, 'BLOCKED_DYNAMIC_PERCENT_PRICE_ACTUAL_FILL_COST_AND_EXECUTION_VENUE_RECONCILIATION', 'manifest does not imply issue completion');

console.log(JSON.stringify({ manifest: 'research/CONTRACT_RISK_MANIFEST.json', verified_artifacts: seen.size, fixtures: report.fixture_count, all_hashes_match: true, issue_8_close: manifest.acceptance.issue_8_close }, null, 2));
