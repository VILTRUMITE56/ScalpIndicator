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

assert.equal(manifest.policy_id, contract.policy_id, 'manifest policy matches contract');
assert.ok(manifest.verification.all_fixtures_pass, 'manifest records passing deterministic fixtures');
assert.equal(manifest.verification.fixture_count, report.fixture_count, 'fixture count matches report');
assert.equal(report.all_fixtures_pass, true, 'report records passing fixtures');
assert.equal(contract.live_contract_snapshot.status, 'NOT_CAPTURED_HTTP_451', 'live filter absence remains explicit');
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
assert.equal(manifest.acceptance.issue_8_close, 'BLOCKED_LIVE_FILTERS_NATIVE_STRATEGY_GRID_INTEGRATION_AND_OBSERVED_FILL_COST_RECONCILIATION', 'manifest does not imply issue completion');

console.log(JSON.stringify({ manifest: 'research/CONTRACT_RISK_MANIFEST.json', verified_artifacts: seen.size, fixtures: report.fixture_count, all_hashes_match: true, issue_8_close: manifest.acceptance.issue_8_close }, null, 2));
