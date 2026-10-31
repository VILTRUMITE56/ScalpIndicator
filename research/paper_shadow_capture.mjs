import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const researchDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(researchDir, '..');
const TOLERANCE = 1e-9;

function usage() {
  return [
    'Usage:',
    '  node research/paper_shadow_capture.mjs validate --manifest <run.json>',
    '  node research/paper_shadow_capture.mjs append --manifest <run.json> --event <event.json>',
    '  node research/paper_shadow_capture.mjs reconcile --manifest <run.json>',
  ].join('\n');
}

function option(args, key) {
  const equals = args.find(value => value.startsWith(`${key}=`));
  if (equals) return equals.slice(key.length + 1);
  const index = args.indexOf(key);
  return index >= 0 ? args[index + 1] : null;
}

function parseArgs(argv) {
  const command = argv[0];
  if (!['validate', 'append', 'reconcile'].includes(command)) throw new Error(usage());
  const manifestArg = option(argv.slice(1), '--manifest');
  if (!manifestArg) throw new Error(`--manifest is required\n${usage()}`);
  const manifestPath = path.resolve(process.cwd(), manifestArg);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  return { command, manifestPath, manifest, eventArg: option(argv.slice(1), '--event') };
}

function normalizeSource(text) {
  return text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function currentSourceHash(relativePath) {
  const fullPath = path.resolve(repoRoot, relativePath);
  if (!fullPath.startsWith(`${repoRoot}${path.sep}`)) throw new Error(`source path escapes repository: ${relativePath}`);
  return sha256(normalizeSource(fs.readFileSync(fullPath, 'utf8')));
}

function sourceVariants(manifest) {
  const lock = manifest.source_lock;
  return {
    P1: {
      execution_policy_version: lock.p1_execution_policy_version,
      signal_source_sha256_lf_utf8: lock.indicator_sha256_lf_utf8,
      strategy_source_sha256_lf_utf8: lock.p1_strategy_sha256_lf_utf8,
      strategy_path: lock.p1_strategy_path,
    },
    P2: {
      execution_policy_version: lock.p2_execution_policy_version,
      signal_source_sha256_lf_utf8: lock.indicator_sha256_lf_utf8,
      strategy_source_sha256_lf_utf8: lock.p2_strategy_sha256_lf_utf8,
      strategy_path: lock.p2_strategy_path,
    },
  };
}

function sourceChecks(manifest) {
  const lock = manifest.source_lock ?? {};
  const checks = [];
  const rows = [
    ['indicator', lock.indicator_path, lock.indicator_sha256_lf_utf8],
    ['P1 strategy', lock.p1_strategy_path, lock.p1_strategy_sha256_lf_utf8],
    ['P2 strategy', lock.p2_strategy_path, lock.p2_strategy_sha256_lf_utf8],
  ];
  for (const [role, relativePath, expected] of rows) {
    try {
      const actual = currentSourceHash(relativePath);
      checks.push({ role, path: relativePath, expected_sha256: expected, current_sha256: actual, matches: actual === expected });
    } catch (error) {
      checks.push({ role, path: relativePath ?? null, expected_sha256: expected ?? null, current_sha256: null, matches: false, error: error.message });
    }
  }
  return checks;
}

function manifestBlockers(manifest, checks) {
  const blockers = [];
  if (manifest.schema_version !== 1) blockers.push('schema_version must be 1');
  if (!/^[A-Za-z0-9._-]{3,100}$/.test(manifest.run_id ?? '')) blockers.push('run_id must be a unique 3-100 character identifier');
  if (manifest.environment !== 'PAPER_SHADOW_ONLY') blockers.push('environment must remain PAPER_SHADOW_ONLY');
  if (manifest.policy?.live_order_routing_allowed !== false) blockers.push('live_order_routing_allowed must be false');
  if (!manifest.instrument?.venue_code || !manifest.instrument?.ticker) blockers.push('instrument venue_code and ticker are required');
  if (!Array.isArray(manifest.instrument?.signal_profiles) || manifest.instrument.signal_profiles.length === 0) blockers.push('at least one signal profile is required');
  const requiredConfirmations = [
    'chart_or_export_uses_locked_local_source',
    'intended_venue_and_market_confirmed',
    'fee_schedule_and_rebates_confirmed',
    'current_contract_filters_captured',
    'funding_source_and_accounting_confirmed',
  ];
  for (const key of requiredConfirmations) if (manifest.confirmations?.[key] !== true) blockers.push(`confirmation required: ${key}`);
  const costs = manifest.cost_evidence ?? {};
  if (!Number.isFinite(costs.maker_fee_rate_fraction) || costs.maker_fee_rate_fraction < 0) blockers.push('cost_evidence.maker_fee_rate_fraction is required');
  if (!Number.isFinite(costs.taker_fee_rate_fraction) || costs.taker_fee_rate_fraction < 0) blockers.push('cost_evidence.taker_fee_rate_fraction is required');
  if (typeof costs.fee_source !== 'string' || !costs.fee_source) blockers.push('cost_evidence.fee_source is required');
  if (typeof costs.funding_source !== 'string' || !costs.funding_source) blockers.push('cost_evidence.funding_source is required');
  if (typeof costs.funding_method !== 'string' || !costs.funding_method) blockers.push('cost_evidence.funding_method is required');
  if (!validUtcTimestamp(costs.captured_at_utc)) blockers.push('cost_evidence.captured_at_utc must be an ISO-8601 UTC timestamp');
  if (manifest.status !== 'READY') blockers.push('status must be READY after all confirmations are recorded');
  for (const check of checks) if (!check.matches) blockers.push(`local source lock does not match current ${check.role} source`);
  for (const [variant, config] of Object.entries(sourceVariants(manifest))) {
    if (!/^[a-f0-9]{64}$/.test(config.signal_source_sha256_lf_utf8 ?? '')) blockers.push(`${variant} signal source hash is invalid`);
    if (!/^[a-f0-9]{64}$/.test(config.strategy_source_sha256_lf_utf8 ?? '')) blockers.push(`${variant} strategy source hash is invalid`);
  }
  return blockers;
}

function confinedRunPath(manifestPath, relativePath) {
  if (typeof relativePath !== 'string' || relativePath.length === 0 || path.isAbsolute(relativePath)) throw new Error('run paths must be non-empty and relative to the manifest');
  const base = path.dirname(manifestPath);
  const resolved = path.resolve(base, relativePath);
  if (!resolved.startsWith(`${base}${path.sep}`)) throw new Error(`run path escapes manifest directory: ${relativePath}`);
  return resolved;
}

function validUtcTimestamp(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(value) && Number.isFinite(Date.parse(value));
}

function positiveNumber(value) {
  return Number.isFinite(value) && value > 0;
}

function validateEvent(event, manifest) {
  const errors = [];
  if (!event || typeof event !== 'object' || Array.isArray(event)) return ['event must be a JSON object'];
  if (event.schema_version !== 1) errors.push('event schema_version must be 1');
  if (event.run_id !== manifest.run_id) errors.push('event run_id does not match manifest');
  if (!Number.isSafeInteger(event.sequence) || event.sequence < 1) errors.push('sequence must be a positive safe integer');
  if (typeof event.event_id !== 'string' || !/^[A-Za-z0-9._:-]{3,160}$/.test(event.event_id)) errors.push('event_id must be a unique 3-160 character identifier');
  if (typeof event.candidate_id !== 'string' || event.candidate_id.length < 5) errors.push('candidate_id is required');
  const variants = sourceVariants(manifest);
  const variant = variants[event.variant_id];
  if (!variant) errors.push('variant_id must be P1 or P2');
  if (!validUtcTimestamp(event.recorded_at_utc)) errors.push('recorded_at_utc must be an ISO-8601 UTC timestamp ending in Z');
  if (variant && event.execution_policy_version !== variant.execution_policy_version) errors.push('event execution_policy_version does not match the locked variant');
  if (variant && event.signal_source_sha256_lf_utf8 !== variant.signal_source_sha256_lf_utf8) errors.push('event signal source hash does not match the locked variant');
  if (variant && event.strategy_source_sha256_lf_utf8 !== variant.strategy_source_sha256_lf_utf8) errors.push('event strategy source hash does not match the locked variant');
  if (!['CANDIDATE', 'QUOTE', 'ORDER', 'FILL', 'FUNDING', 'CLOSE'].includes(event.event_type)) errors.push('unsupported event_type');
  if (!event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) return [...errors, 'payload must be a JSON object'];
  const p = event.payload;
  if (event.event_type === 'CANDIDATE') {
    if (!['LONG', 'SHORT'].includes(p.side)) errors.push('CANDIDATE payload.side must be LONG or SHORT');
    if (![5, 15].includes(p.profile_minutes)) errors.push('CANDIDATE payload.profile_minutes must be 5 or 15');
    if (!Number.isFinite(p.candidate_event_code)) errors.push('CANDIDATE candidate_event_code must be numeric');
    if (!Number.isFinite(p.execution_reason_code)) errors.push('CANDIDATE execution_reason_code must be numeric');
    if (!Number.isSafeInteger(p.trigger_utc_s) || p.trigger_utc_s <= 0) errors.push('CANDIDATE trigger_utc_s must be a positive UTC Unix second');
  } else if (event.event_type === 'QUOTE') {
    for (const key of ['bid', 'ask', 'mark_price', 'tick_size', 'quantity_step', 'minimum_quantity', 'market_maximum_quantity', 'minimum_notional_quote', 'percent_price_multiplier_up', 'percent_price_multiplier_down']) if (!positiveNumber(p[key])) errors.push(`QUOTE ${key} must be positive`);
    if (positiveNumber(p.bid) && positiveNumber(p.ask) && p.ask < p.bid) errors.push('QUOTE ask cannot be below bid');
    if (!validUtcTimestamp(p.quote_at_utc)) errors.push('QUOTE quote_at_utc must be an ISO-8601 UTC timestamp');
    if (typeof p.source !== 'string' || !p.source) errors.push('QUOTE source is required');
  } else if (event.event_type === 'ORDER') {
    if (!['PAPER_PLANNED', 'ACKNOWLEDGED', 'REJECTED', 'CANCEL_REQUESTED', 'CANCELED', 'EXPIRED'].includes(p.action)) errors.push('ORDER action is invalid');
    if (typeof p.order_ref !== 'string' || !p.order_ref) errors.push('ORDER order_ref is required');
    if (!positiveNumber(p.quantity)) errors.push('ORDER quantity must be positive');
    if (p.limit_price !== undefined && !positiveNumber(p.limit_price)) errors.push('ORDER limit_price must be positive when supplied');
    if (p.action === 'PAPER_PLANNED') {
      for (const key of ['limit_price', 'stop_price', 'target_price']) if (!positiveNumber(p[key])) errors.push(`PAPER_PLANNED ${key} must be positive`);
    }
    if (p.action === 'REJECTED' && (typeof p.reason !== 'string' || !p.reason)) errors.push('REJECTED order requires a reason');
  } else if (event.event_type === 'FILL') {
    if (typeof p.order_ref !== 'string' || !p.order_ref) errors.push('FILL order_ref is required');
    if (!['ENTRY', 'EXIT'].includes(p.leg)) errors.push('FILL leg must be ENTRY or EXIT');
    if (!positiveNumber(p.quantity) || !positiveNumber(p.price)) errors.push('FILL quantity and price must be positive');
    if (!Number.isFinite(p.fee_quote)) errors.push('FILL fee_quote must be numeric; use 0 when unavailable and flag the run');
    if (!['OBSERVED', 'CONFIRMED_RATE', 'UNKNOWN'].includes(p.fee_basis)) errors.push('FILL fee_basis must be OBSERVED, CONFIRMED_RATE, or UNKNOWN');
    if (!['QUOTE_SIMULATION', 'TESTNET_FILL'].includes(p.evidence_type)) errors.push('FILL evidence_type must be QUOTE_SIMULATION or TESTNET_FILL');
    if (p.evidence_type === 'QUOTE_SIMULATION' && (typeof p.fill_rule !== 'string' || !p.fill_rule)) errors.push('QUOTE_SIMULATION fill_rule is required');
  } else if (event.event_type === 'FUNDING') {
    if (!Number.isFinite(p.amount_quote)) errors.push('FUNDING amount_quote must be numeric and signed');
  } else if (event.event_type === 'CLOSE') {
    if (typeof p.exit_reason !== 'string' || !p.exit_reason) errors.push('CLOSE exit_reason is required');
    if (typeof p.fee_funding_complete !== 'boolean') errors.push('CLOSE fee_funding_complete must confirm all fees and applicable funding are recorded');
  }
  return errors;
}

function readJsonLines(filePath) {
  if (!fs.existsSync(filePath)) return { events: [], parseErrors: [] };
  const source = fs.readFileSync(filePath, 'utf8');
  const events = [];
  const parseErrors = [];
  for (const [index, line] of source.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try { events.push(JSON.parse(line)); }
    catch (error) { parseErrors.push({ line: index + 1, error: error.message }); }
  }
  return { events, parseErrors };
}

function candidateKey(event) {
  return `${event.variant_id}\u001f${event.candidate_id}`;
}

function newTrade(event) {
  return {
    variant_id: event.variant_id,
    candidate_id: event.candidate_id,
    side: event.payload.side,
    profile_minutes: event.payload.profile_minutes,
    trigger_utc_s: event.payload.trigger_utc_s,
    candidate_event_code: event.payload.candidate_event_code,
    execution_reason_code: event.payload.execution_reason_code,
    first_recorded_at_utc: event.recorded_at_utc,
    last_recorded_at_utc: event.recorded_at_utc,
    order_refs: new Map(),
    entry_qty: 0,
    position_qty: 0,
    position_cost_quote: 0,
    gross_pnl_quote: 0,
    fees_quote: 0,
    funding_quote: 0,
    evidence_types: new Set(),
    fee_bases: new Set(),
    cost_evidence_complete: true,
    quote_count: 0,
    order_count: 0,
    close_event: null,
  };
}

function disposition(trade) {
  if (trade.close_event && trade.position_qty <= TOLERANCE) return 'CLOSED';
  if (trade.execution_reason_code !== 2) return trade.execution_reason_code === 0 ? 'UNKNOWN_DECISION' : 'BLOCKED_BEFORE_ORDER';
  if (trade.order_refs.size === 0) return 'MISSING_ORDER_RECORD';
  if (trade.position_qty > TOLERANCE) return 'OPEN_POSITION';
  if (trade.entry_qty > TOLERANCE) return 'CLOSED_EVENT_MISSING';
  const terminal = [...trade.order_refs.values()].every(order => ['REJECTED', 'CANCELED', 'EXPIRED'].includes(order.state));
  return terminal ? 'NO_FILL_TERMINAL' : 'ORDER_PENDING';
}

function reconcileTrades(events, manifest) {
  const issues = [];
  const trades = new Map();
  const eventIds = new Set();
  let previousSequence = 0;
  let previousTime = -Infinity;

  for (const event of events) {
    for (const error of validateEvent(event, manifest)) issues.push({ severity: 'ERROR', event_id: event.event_id ?? null, message: error });
    if (!event || typeof event !== 'object' || Array.isArray(event)) continue;
    if (event.sequence !== previousSequence + 1) issues.push({ severity: 'ERROR', event_id: event.event_id ?? null, message: `sequence gap: expected ${previousSequence + 1}, received ${event.sequence}` });
    previousSequence = Number.isSafeInteger(event.sequence) ? event.sequence : previousSequence;
    const eventTime = Date.parse(event.recorded_at_utc ?? '');
    if (Number.isFinite(eventTime) && eventTime < previousTime) issues.push({ severity: 'ERROR', event_id: event.event_id ?? null, message: 'recorded_at_utc moved backwards in the append-only log' });
    if (Number.isFinite(eventTime)) previousTime = eventTime;
    if (eventIds.has(event.event_id)) issues.push({ severity: 'ERROR', event_id: event.event_id, message: 'duplicate event_id' });
    eventIds.add(event.event_id);

    const key = candidateKey(event);
    let trade = trades.get(key);
    if (event.event_type === 'CANDIDATE') {
      if (trade) {
        issues.push({ severity: 'ERROR', event_id: event.event_id, message: 'duplicate CANDIDATE record for variant/candidate_id' });
        continue;
      }
      trade = newTrade(event);
      trades.set(key, trade);
      continue;
    }
    if (!trade) {
      issues.push({ severity: 'ERROR', event_id: event.event_id ?? null, message: 'event has no preceding CANDIDATE record for variant/candidate_id' });
      continue;
    }
    trade.last_recorded_at_utc = event.recorded_at_utc;
    const p = event.payload ?? {};
    if (event.event_type === 'QUOTE') trade.quote_count++;
    if (event.event_type === 'ORDER') {
      trade.order_count++;
      if (p.action === 'PAPER_PLANNED' && trade.quote_count === 0) issues.push({ severity: 'ERROR', event_id: event.event_id, message: 'PAPER_PLANNED order has no preceding quote/filter snapshot' });
      if (p.action === 'PAPER_PLANNED' && positiveNumber(p.limit_price) && positiveNumber(p.stop_price) && positiveNumber(p.target_price)) {
        if (trade.side === 'LONG' && !(p.stop_price < p.limit_price && p.limit_price < p.target_price)) issues.push({ severity: 'ERROR', event_id: event.event_id, message: 'PAPER_PLANNED long levels must satisfy stop < limit < target' });
        if (trade.side === 'SHORT' && !(p.target_price < p.limit_price && p.limit_price < p.stop_price)) issues.push({ severity: 'ERROR', event_id: event.event_id, message: 'PAPER_PLANNED short levels must satisfy target < limit < stop' });
      }
      if (trade.order_refs.has(p.order_ref) && p.action === 'PAPER_PLANNED') issues.push({ severity: 'ERROR', event_id: event.event_id, message: 'order_ref was planned more than once' });
      const old = trade.order_refs.get(p.order_ref);
      if (['ACKNOWLEDGED', 'REJECTED', 'CANCEL_REQUESTED', 'CANCELED', 'EXPIRED'].includes(p.action) && !old) issues.push({ severity: 'ERROR', event_id: event.event_id, message: `order action ${p.action} has no preceding PAPER_PLANNED event` });
      if (p.action === 'PAPER_PLANNED') trade.order_refs.set(p.order_ref, { state: p.action, last_event_id: event.event_id });
      else if (old) trade.order_refs.set(p.order_ref, { ...old, state: p.action, last_event_id: event.event_id });
    }
    if (event.event_type === 'FILL') {
      const order = trade.order_refs.get(p.order_ref);
      if (!order) issues.push({ severity: 'ERROR', event_id: event.event_id, message: 'FILL references an order with no prior PAPER_PLANNED event' });
      else if (['REJECTED', 'CANCELED', 'EXPIRED'].includes(order.state)) issues.push({ severity: 'WARNING', event_id: event.event_id, message: `fill recorded after terminal order state ${order.state}; review cancel/fill race` });
      if (!['ENTRY', 'EXIT'].includes(p.leg) || !positiveNumber(p.quantity) || !positiveNumber(p.price) || !Number.isFinite(p.fee_quote)) continue;
      trade.evidence_types.add(p.evidence_type);
      trade.fee_bases.add(p.fee_basis);
      trade.fees_quote += p.fee_quote;
      if (p.fee_basis === 'UNKNOWN') {
        trade.cost_evidence_complete = false;
        issues.push({ severity: 'WARNING', event_id: event.event_id, message: 'fill fee is unknown; net P&L is incomplete' });
      }
      if (p.leg === 'ENTRY') {
        trade.entry_qty += p.quantity;
        trade.position_qty += p.quantity;
        trade.position_cost_quote += p.quantity * p.price;
      } else {
        const openQuantity = trade.position_qty;
        if (p.quantity > openQuantity + TOLERANCE) {
          issues.push({ severity: 'ERROR', event_id: event.event_id, message: `exit quantity ${p.quantity} exceeds open quantity ${openQuantity}` });
          continue;
        }
        if (openQuantity <= TOLERANCE) {
          issues.push({ severity: 'ERROR', event_id: event.event_id, message: 'exit fill recorded while flat' });
          continue;
        }
        const averageEntry = trade.position_cost_quote / openQuantity;
        const direction = trade.side === 'LONG' ? 1 : -1;
        trade.gross_pnl_quote += direction * (p.price - averageEntry) * p.quantity;
        trade.position_qty = Math.max(0, openQuantity - p.quantity);
        trade.position_cost_quote = Math.max(0, trade.position_cost_quote - averageEntry * p.quantity);
      }
    }
    if (event.event_type === 'FUNDING') {
      if (trade.position_qty <= TOLERANCE) issues.push({ severity: 'ERROR', event_id: event.event_id, message: 'funding record exists while the simulated position is flat' });
      else if (Number.isFinite(p.amount_quote)) trade.funding_quote += p.amount_quote;
    }
    if (event.event_type === 'CLOSE') {
      if (trade.close_event) issues.push({ severity: 'ERROR', event_id: event.event_id, message: 'duplicate CLOSE event' });
      else if (trade.entry_qty <= TOLERANCE) issues.push({ severity: 'ERROR', event_id: event.event_id, message: 'CLOSE event has no entry fill' });
      else if (trade.position_qty > TOLERANCE) issues.push({ severity: 'ERROR', event_id: event.event_id, message: `CLOSE left ${trade.position_qty} position quantity open` });
      else {
        if (p.fee_funding_complete !== true) {
          trade.cost_evidence_complete = false;
          issues.push({ severity: 'WARNING', event_id: event.event_id, message: 'CLOSE is missing complete fee/funding evidence' });
        }
        trade.close_event = { recorded_at_utc: event.recorded_at_utc, exit_reason: p.exit_reason, fee_funding_complete: p.fee_funding_complete };
      }
    }
  }

  const rows = [...trades.values()].map(trade => ({
    variant_id: trade.variant_id,
    candidate_id: trade.candidate_id,
    side: trade.side,
    profile_minutes: trade.profile_minutes,
    trigger_utc_s: trade.trigger_utc_s,
    candidate_event_code: trade.candidate_event_code,
    execution_reason_code: trade.execution_reason_code,
    quote_observations: trade.quote_count,
    order_records: trade.order_count,
    entry_quantity: trade.entry_qty,
    open_quantity: trade.position_qty,
    closed: trade.close_event !== null && trade.position_qty <= TOLERANCE,
    disposition: disposition(trade),
    close_time_utc: trade.close_event?.recorded_at_utc ?? null,
    exit_reason: trade.close_event?.exit_reason ?? null,
    gross_pnl_quote: trade.gross_pnl_quote,
    fees_quote: trade.fees_quote,
    funding_quote: trade.funding_quote,
    net_pnl_quote: trade.gross_pnl_quote - trade.fees_quote + trade.funding_quote,
    evidence_type: trade.evidence_types.size === 1 ? [...trade.evidence_types][0] : (trade.evidence_types.size > 1 ? 'MIXED' : null),
    fee_basis: trade.fee_bases.size === 1 ? [...trade.fee_bases][0] : (trade.fee_bases.size > 1 ? 'MIXED' : null),
    cost_evidence_complete: trade.cost_evidence_complete && trade.close_event?.fee_funding_complete === true,
  }));
  return { trades: rows, issues };
}

function metrics(rows) {
  const wins = rows.filter(row => row.net_pnl_quote > 0);
  const losses = rows.filter(row => row.net_pnl_quote < 0);
  const grossWins = wins.reduce((sum, row) => sum + row.net_pnl_quote, 0);
  const grossLosses = Math.abs(losses.reduce((sum, row) => sum + row.net_pnl_quote, 0));
  return {
    closed_trades: rows.length,
    wins: wins.length,
    losses: losses.length,
    win_rate_pct: rows.length ? wins.length / rows.length * 100 : null,
    cumulative_net_pnl_quote: rows.reduce((sum, row) => sum + row.net_pnl_quote, 0),
    mean_net_pnl_per_trade_quote: rows.length ? rows.reduce((sum, row) => sum + row.net_pnl_quote, 0) / rows.length : null,
    net_profit_factor: grossLosses > 0 ? grossWins / grossLosses : null,
  };
}

function buildReport(events, manifest, parsedErrors, ledger) {
  const variants = [...new Set(Object.keys(sourceVariants(manifest)))];
  const groups = [];
  for (const variant of variants) {
    const candidates = ledger.trades.filter(row => row.variant_id === variant);
    const closed = candidates.filter(row => row.closed);
    const evidenceGroups = [...new Set(closed.map(row => `${row.evidence_type ?? 'UNKNOWN'}|${row.fee_basis ?? 'UNKNOWN'}|${row.cost_evidence_complete ? 'COMPLETE' : 'INCOMPLETE'}`))];
    groups.push({
      variant_id: variant,
      candidate_events: candidates.length,
      candidates_with_quote: candidates.filter(row => row.quote_observations > 0).length,
      order_records: candidates.reduce((sum, row) => sum + row.order_records, 0),
      disposition_counts: Object.fromEntries([...new Set(candidates.map(row => row.disposition))].sort().map(value => [value, candidates.filter(row => row.disposition === value).length])),
      incomplete_candidates: candidates.filter(row => ['UNKNOWN_DECISION', 'MISSING_ORDER_RECORD', 'OPEN_POSITION', 'CLOSED_EVENT_MISSING', 'ORDER_PENDING'].includes(row.disposition)).length,
      closed_trade_metrics_by_evidence: evidenceGroups.map(group => {
        const [type, fee_basis, cost_evidence] = group.split('|');
        const selected = closed.filter(row => (row.evidence_type ?? 'UNKNOWN') === type && (row.fee_basis ?? 'UNKNOWN') === fee_basis && row.cost_evidence_complete === (cost_evidence === 'COMPLETE'));
        return { evidence_type: type, fee_basis, cost_evidence, ...metrics(selected) };
      }),
    });
  }
  const checks = sourceChecks(manifest);
  return {
    schema_version: 1,
    report_id: `${manifest.run_id}-RECONCILIATION`,
    generated_at_utc: new Date().toISOString(),
    run_id: manifest.run_id,
    environment: manifest.environment,
    live_order_routing_allowed: manifest.policy?.live_order_routing_allowed === true,
    run_status: manifest.status,
    confirmations: manifest.confirmations,
    source_lock_currently_matches_local_files: checks.every(row => row.matches),
    current_source_checks: checks,
    event_count: events.length,
    jsonl_parse_errors: parsedErrors,
    quality_issues: ledger.issues,
    quality_status: parsedErrors.length || ledger.issues.length > 0 ? 'REVIEW_REQUIRED' : 'STRUCTURE_CLEAN',
    variants: groups,
    closed_trades: ledger.trades.filter(row => row.closed),
    open_or_incomplete_candidates: ledger.trades.filter(row => !row.closed),
    interpretation: 'Forward paper-shadow evidence only. Quote simulations and testnet fills are reported separately and do not establish live execution or profitability.',
  };
}

function reportMarkdown(report) {
  const lines = [
    `# Paper-shadow reconciliation: ${report.run_id}`,
    '',
    `Generated ${report.generated_at_utc}. Environment: ${report.environment}. Quality status: ${report.quality_status}.`,
    '',
    `Events: ${report.event_count}; JSONL parse errors: ${report.jsonl_parse_errors.length}; source files currently match lock: ${report.source_lock_currently_matches_local_files}.`,
    '',
    'These results are forward paper-shadow evidence. Quote simulations and testnet fills remain separate from observed live execution.',
    '',
    '| Variant | Candidate events | With quotes | Order records | Incomplete | Evidence type | Closed | Win rate | Net P&L | Net PF |',
    '| --- | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: |',
  ];
  for (const variant of report.variants) {
    if (variant.closed_trade_metrics_by_evidence.length === 0) {
      lines.push(`| ${variant.variant_id} | ${variant.candidate_events} | ${variant.candidates_with_quote} | ${variant.order_records} | ${variant.incomplete_candidates} | — | 0 | — | — | — |`);
    }
    for (const result of variant.closed_trade_metrics_by_evidence) {
      const pct = result.win_rate_pct === null ? '—' : `${result.win_rate_pct.toFixed(1)}%`;
      const pnl = result.cumulative_net_pnl_quote.toFixed(2);
      const pf = result.net_profit_factor === null ? '—' : result.net_profit_factor.toFixed(3);
      lines.push(`| ${variant.variant_id} | ${variant.candidate_events} | ${variant.candidates_with_quote} | ${variant.order_records} | ${variant.incomplete_candidates} | ${result.evidence_type}/${result.fee_basis}/${result.cost_evidence} | ${result.closed_trades} | ${pct} | ${pnl} | ${pf} |`);
    }
  }
  lines.push('', '## Source checks', '');
  for (const row of report.current_source_checks) lines.push(`- ${row.role}: ${row.matches ? 'matches' : 'DIFFERS'} (${row.path})`);
  lines.push('', '## Reconciliation issues', '');
  if (report.quality_issues.length === 0 && report.jsonl_parse_errors.length === 0) lines.push('No structural issues recorded.');
  else {
    for (const issue of report.quality_issues) lines.push(`- ${issue.severity}: ${issue.event_id ?? 'event'} — ${issue.message}`);
    for (const issue of report.jsonl_parse_errors) lines.push(`- ERROR: JSONL line ${issue.line} — ${issue.error}`);
  }
  return `${lines.join('\n')}\n`;
}

function validateCommand({ manifest, manifestPath }) {
  const checks = sourceChecks(manifest);
  const blockers = manifestBlockers(manifest, checks);
  console.log(JSON.stringify({
    run_id: manifest.run_id,
    status: manifest.status,
    capture_ready: blockers.length === 0,
    blockers,
    source_checks: checks,
  }, null, 2));
  return blockers.length ? 2 : 0;
}

function appendCommand({ manifest, manifestPath, eventArg }) {
  if (!eventArg) throw new Error('--event is required for append');
  const blockers = manifestBlockers(manifest, sourceChecks(manifest));
  if (blockers.length) throw new Error(`run is not ready for capture:\n- ${blockers.join('\n- ')}`);
  const event = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), eventArg), 'utf8'));
  const errors = validateEvent(event, manifest);
  if (errors.length) throw new Error(`invalid event:\n- ${errors.join('\n- ')}`);
  const eventsPath = confinedRunPath(manifestPath, manifest.events_path);
  const current = readJsonLines(eventsPath);
  if (current.parseErrors?.length) throw new Error('existing event log has invalid JSON; reconcile/fix it before appending');
  const lastSequence = current.events.length ? current.events[current.events.length - 1].sequence : 0;
  if (event.sequence !== lastSequence + 1) throw new Error(`sequence must be ${lastSequence + 1}`);
  if (current.events.some(row => row.event_id === event.event_id)) throw new Error('event_id already exists');
  if (current.events.length && Date.parse(event.recorded_at_utc) < Date.parse(current.events[current.events.length - 1].recorded_at_utc)) throw new Error('recorded_at_utc cannot move backwards');
  fs.mkdirSync(path.dirname(eventsPath), { recursive: true });
  fs.appendFileSync(eventsPath, `${JSON.stringify(event)}\n`, 'utf8');
  console.log(JSON.stringify({ appended: true, event_id: event.event_id, sequence: event.sequence, events_path: path.relative(path.dirname(manifestPath), eventsPath) }, null, 2));
  return 0;
}

function reconcileCommand({ manifest, manifestPath }) {
  const eventsPath = confinedRunPath(manifestPath, manifest.events_path);
  const read = readJsonLines(eventsPath);
  const events = read.events ?? [];
  const parseErrors = read.parseErrors ?? [];
  const ledger = reconcileTrades(events, manifest);
  const report = buildReport(events, manifest, parseErrors, ledger);
  const reportPath = confinedRunPath(manifestPath, manifest.report_path);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.writeFileSync(reportPath.replace(/\.json$/i, '.md'), reportMarkdown(report), 'utf8');
    console.log(JSON.stringify({
    report_json: path.relative(path.dirname(manifestPath), reportPath),
    report_markdown: path.relative(path.dirname(manifestPath), reportPath.replace(/\.json$/i, '.md')),
    events: report.event_count,
    quality_status: report.quality_status,
    variants: report.variants.map(row => ({ variant_id: row.variant_id, candidate_events: row.candidate_events, dispositions: row.disposition_counts, closed_trades: row.closed_trade_metrics_by_evidence.reduce((sum, item) => sum + item.closed_trades, 0) })),
  }, null, 2));
  return report.quality_status === 'REVIEW_REQUIRED' ? 2 : 0;
}

try {
  const args = parseArgs(process.argv.slice(2));
  let exitCode = 0;
  if (args.command === 'validate') exitCode = validateCommand(args);
  else if (args.command === 'append') exitCode = appendCommand(args);
  else exitCode = reconcileCommand(args);
  process.exitCode = exitCode;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
