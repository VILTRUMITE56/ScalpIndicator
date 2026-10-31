// Build the reproducible #8 contract/risk evidence manifest.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hashFile = relative => {
  const normalized = fs.readFileSync(path.join(root, relative), 'utf8').replace(/\r\n/g, '\n');
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
};
const report = JSON.parse(fs.readFileSync(path.join(root, 'research/reports/contract_risk_report.json'), 'utf8'));
const contract = JSON.parse(fs.readFileSync(path.join(root, 'research/specs/contract_risk_controls_p1.json'), 'utf8'));
if (!report.all_fixtures_pass || report.fixture_count < 1) throw new Error('Risk fixtures must pass before a manifest can be built.');

const files = [
  'research/specs/contract_risk_controls_p1.json',
  'research/risk_controls_reference.mjs',
  'research/capture_binance_contract_snapshot.mjs',
  'research/build_contract_risk_manifest.mjs',
  'research/verify_contract_risk_manifest.mjs',
  'research/README_CANDIDATE_P1.md',
  'research/reports/contract_risk_report.json',
  'research/reports/contract_risk_report.md',
  'research/reports/contract_risk_fixtures.csv',
];

const manifest = {
  schema_version: 1,
  manifest_id: 'btc-perp-contract-risk-p1-2026-10-30',
  generated_at_utc: new Date().toISOString(),
  policy_id: contract.policy_id,
  parent_commit: 'ca2e55001d9c50a80878a8903ca9a79c1f7f184d',
  status: 'paper_reference_fixtures_verified_live_filters_and_fills_unconfirmed_user_locks_disabled',
  hash_normalization: 'UTF-8 text; CRLF normalized to LF before SHA-256',
  verification: {
    command: 'node research/risk_controls_reference.mjs',
    fixture_count: report.fixture_count,
    all_fixtures_pass: report.all_fixtures_pass,
    outcomes: report.fixtures.map(row => ({ fixture: row.fixture, status: row.status })),
  },
  unresolved_inputs: {
    live_binance_filters: contract.live_contract_snapshot.status,
    actual_execution_venue_confirmed: contract.research_proxy.execution_venue_confirmed,
    account_fee_rates: contract.per_trade_risk.account_fee_rate,
    measured_spread_slippage: contract.per_trade_risk.historical_spread_slippage,
    funding_reserve: contract.per_trade_risk.funding_reserve_quote,
    daily_loss_limit: contract.user_account_locks.daily_loss_limit_quote,
    max_drawdown_fraction: contract.user_account_locks.maximum_drawdown_fraction,
    personal_locks_status: contract.user_account_locks.status,
    personal_locks_enabled: contract.user_account_locks.personal_locks_enabled,
    observed_user_exchange_fills: 'not supplied',
  },
  acceptance: report.acceptance_status,
  limitations: [
    'Fixture exchange filters and cost inputs are synthetic test values and are not Binance metadata or account settings.',
    'A modeled stop-market fill is not a guaranteed loss cap through gaps, liquidation, exchange failure or fill races.',
    'No profitability statistic is produced by contract and ledger fixtures.',
  ],
  docs_basis: [
    'https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/common-definition',
    'https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usds-margined-futures/api/rest-api/market-data#exchange-information',
    'https://takeprofit.com/docs/indie/Library-reference/package-indie',
    'https://takeprofit.com/docs/indie/Library-reference/package-indie-strategies',
  ],
  artifacts: files.map(file => ({ path: file, sha256: hashFile(file) })),
};

fs.writeFileSync(path.join(root, 'research/CONTRACT_RISK_MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ manifest: 'research/CONTRACT_RISK_MANIFEST.json', fixtures: manifest.verification.fixture_count, hashed_files: manifest.artifacts.length, status: manifest.status }, null, 2));
