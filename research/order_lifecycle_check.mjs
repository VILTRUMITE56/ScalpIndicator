// Deterministic order-lifecycle safety fixtures plus lower-interval barrier-path sensitivity.
// This is an explicit research emulator, not a representation of actual exchange fills.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import readline from 'node:readline';
import { createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const spec = JSON.parse(fs.readFileSync(path.join(root, 'research/specs/order_lifecycle_p1.json'), 'utf8'));
const reportDir = path.join(root, 'research/reports');
const activeStatuses = new Set(spec.order_statuses.active);
const terminalStatuses = new Set(spec.order_statuses.terminal);
const eps = 1e-10;

function freshState() {
  return {
    update: 0,
    resolvedThisUpdate: false,
    seenCandidateIds: [],
    candidate: null,
    order: null,
    position: 0,
    positionSide: null,
    bracket: { active: false, side: null, stop: null, target: null, protectedQty: 0 },
    lastExitBar: null,
    events: [],
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sameNumber(a, b) {
  return Math.abs(a - b) <= eps;
}

function assertInvariant(state) {
  assert.ok(Number.isFinite(state.position), 'position must remain finite');
  if (Math.abs(state.position) <= eps) {
    assert.equal(state.positionSide, null, 'flat state cannot retain a side');
    assert.equal(state.bracket.active, false, 'flat state cannot retain an active bracket');
    assert.equal(state.bracket.protectedQty, 0, 'flat state cannot retain protected quantity');
  } else {
    assert.equal(state.bracket.active, true, 'every modeled open exposure must be protected');
    assert.equal(state.bracket.side, state.position > 0 ? 'LONG' : 'SHORT');
    assert.ok(sameNumber(state.bracket.protectedQty, Math.abs(state.position)), 'protection must equal open exposure');
  }
  if (state.order) {
    const order = state.order;
    assert.ok(activeStatuses.has(order.status) || terminalStatuses.has(order.status), `unknown modeled status ${order.status}`);
    assert.ok(order.size > 0 && order.filledQty >= 0 && order.filledQty <= order.size + eps);
    if (order.status === 'PARTIALLY_FILLED') {
      assert.ok(order.filledQty > 0 && order.filledQty < order.size, 'partial state must have a remainder');
    }
    if (order.status === 'FILLED') assert.ok(sameNumber(order.filledQty, order.size));
    if (order.status === 'PARTIALLY_FILLED_CLOSED') assert.ok(order.filledQty > 0 && order.filledQty < order.size);
    if (order.status === 'CANCELED' || order.status === 'REJECTED') assert.equal(order.filledQty, 0);
    if (Math.abs(state.position) > eps) assert.equal(order.side, state.position > 0 ? 'LONG' : 'SHORT');
  }
}

class LifecycleModel {
  constructor(snapshot = null) {
    this.state = snapshot ? clone(snapshot) : freshState();
    assertInvariant(this.state);
  }

  record(type, bar, detail = {}) {
    const order = this.state.order;
    this.state.events.push({
      sequence: this.state.events.length + 1,
      update: this.state.update,
      bar,
      event: type,
      candidate_id: detail.candidateId ?? this.state.candidate?.id ?? order?.candidateId ?? '',
      order_id: order?.id ?? '',
      status: order?.status ?? 'NONE',
      side: order?.side ?? this.state.positionSide ?? '',
      requested_qty: order?.size ?? 0,
      filled_qty: order?.filledQty ?? 0,
      remaining_qty: order ? Math.max(0, order.size - order.filledQty) : 0,
      position_qty: this.state.position,
      protected_qty: this.state.bracket.protectedQty,
      stop: this.state.bracket.stop ?? '',
      target: this.state.bracket.target ?? '',
      detail: detail.message ?? '',
    });
  }

  check() {
    assertInvariant(this.state);
  }

  nextUpdate(bar) {
    this.state.update++;
    this.state.resolvedThisUpdate = false;
    if (this.state.order && terminalStatuses.has(this.state.order.status)) this.state.order = null;
    this.record('NEXT_UPDATE', bar);
    this.check();
  }

  candidate(id, bar, payload = {}) {
    if (this.state.seenCandidateIds.includes(id)) {
      this.record('DUPLICATE_CANDIDATE_IGNORED', bar, { candidateId: id, message: 'idempotent repeated update/reload' });
      this.check();
      return false;
    }
    this.state.seenCandidateIds.push(id);
    this.record('CANDIDATE', bar, { candidateId: id });
    if (this.state.resolvedThisUpdate || Math.abs(this.state.position) > eps || (this.state.order && activeStatuses.has(this.state.order.status))) {
      this.record('CANDIDATE_BLOCKED', bar, { candidateId: id, message: 'position, active order, or same-update resolution' });
      this.check();
      return false;
    }
    this.state.candidate = {
      id,
      side: payload.side ?? 'LONG',
      size: payload.size ?? 1,
      stop: payload.stop ?? 98,
      target: payload.target ?? 103,
    };
    this.record('SETUP_QUALIFIED', bar, { candidateId: id });
    this.check();
    return true;
  }

  submit(orderId, bar) {
    assert.ok(this.state.candidate, 'submission requires a qualified candidate');
    assert.ok(!this.state.resolvedThisUpdate, 'cannot submit in an update that resolved an order/position');
    assert.ok(Math.abs(this.state.position) <= eps, 'cannot submit while exposure is open');
    assert.ok(!this.state.order || terminalStatuses.has(this.state.order.status), 'cannot submit while parent order is active');
    const candidate = this.state.candidate;
    this.state.order = {
      id: orderId,
      candidateId: candidate.id,
      side: candidate.side,
      size: candidate.size,
      filledQty: 0,
      status: 'CREATED',
      cancelRequested: false,
      expired: false,
      stop: candidate.stop,
      target: candidate.target,
    };
    this.state.candidate = null;
    this.record('SUBMISSION', bar, { message: 'parent entry created; no fill assumed' });
    this.check();
  }

  acknowledge(bar, rejected = false) {
    assert.ok(this.state.order?.status === 'CREATED' || this.state.order?.status === 'PLACED');
    if (rejected) {
      assert.equal(this.state.order.filledQty, 0, 'this fixture models rejection before any fill');
      this.state.order.status = 'REJECTED';
      this.state.resolvedThisUpdate = true;
      this.record('REJECTION', bar, { message: 'zero fill and zero exposure' });
    } else {
      this.state.order.status = 'PLACED';
      this.record('ACKNOWLEDGMENT', bar, { message: 'parent accepted; fill remains asynchronous' });
    }
    this.check();
  }

  fill(quantity, bar, price) {
    const order = this.state.order;
    assert.ok(order && activeStatuses.has(order.status), 'fill requires an active parent order');
    assert.ok(quantity > 0 && quantity <= order.size - order.filledQty + eps, 'fill cannot exceed remaining parent size');
    const direction = order.side === 'LONG' ? 1 : -1;
    if (Math.abs(this.state.position) > eps) assert.ok(this.state.position * direction > 0, 'entry fill cannot reverse an existing position');
    order.filledQty += quantity;
    this.state.position += direction * quantity;
    this.state.positionSide = order.side;
    this.state.bracket = {
      active: true,
      side: order.side,
      stop: order.stop,
      target: order.target,
      protectedQty: Math.abs(this.state.position),
    };
    const full = sameNumber(order.filledQty, order.size);
    order.status = full ? 'FILLED' : 'PARTIALLY_FILLED';
    this.record(full ? 'FULL_FILL' : 'PARTIAL_FILL', bar, { message: `hypothetical fill at ${price}` });
    this.check();
  }

  requestCancel(bar, reason) {
    const order = this.state.order;
    assert.ok(order && activeStatuses.has(order.status), 'cancel request requires an active parent');
    if (order.cancelRequested) {
      this.record('DUPLICATE_CANCEL_IGNORED', bar, { message: reason });
      this.check();
      return;
    }
    order.cancelRequested = true;
    this.record('CANCELLATION_REQUEST', bar, { message: reason });
    this.check();
  }

  expire(bar) {
    assert.ok(this.state.order && activeStatuses.has(this.state.order.status));
    this.state.order.expired = true;
    this.record('EXPIRY', bar, { message: 'entry lifetime elapsed; expiry is a cancel request, not an acknowledgment' });
    this.requestCancel(bar, 'expired parent entry');
  }

  acknowledgeCancel(bar) {
    const order = this.state.order;
    assert.ok(order && activeStatuses.has(order.status) && order.cancelRequested, 'cancel acknowledgment must follow a request');
    order.status = order.filledQty > 0 ? 'PARTIALLY_FILLED_CLOSED' : 'CANCELED';
    this.state.resolvedThisUpdate = true;
    this.record('CANCELLATION_ACKNOWLEDGMENT', bar, { message: 'unfilled remainder is closed; any filled exposure remains bracket-protected' });
    this.check();
  }

  exit(reason, quantity, price, bar) {
    assert.ok(this.state.bracket.active && Math.abs(this.state.position) > eps, 'protective exit requires open protected exposure');
    const absPosition = Math.abs(this.state.position);
    const qty = quantity ?? absPosition;
    assert.ok(qty > 0 && qty <= absPosition + eps, 'protective exit may reduce but never exceed open exposure');
    const prior = this.state.position;
    const signedReduction = prior > 0 ? -qty : qty;
    const next = prior + signedReduction;
    assert.ok(Math.abs(next) <= absPosition + eps, 'exit may not increase or reverse exposure');
    if (prior > 0) assert.ok(next >= -eps, 'long protective exit may not create a short');
    else assert.ok(next <= eps, 'short protective exit may not create a long');
    this.state.position = Math.abs(next) <= eps ? 0 : next;
    this.state.bracket.protectedQty = Math.abs(this.state.position);
    this.state.bracket.active = Math.abs(this.state.position) > eps;
    if (!this.state.bracket.active) {
      this.state.positionSide = null;
      this.state.bracket.side = null;
      this.state.bracket.stop = null;
      this.state.bracket.target = null;
      this.state.lastExitBar = bar;
    }
    this.state.resolvedThisUpdate = true;
    this.record(reason, bar, { message: `reducing exit at ${price}; qty=${qty}` });
    const order = this.state.order;
    if (order && order.status === 'PARTIALLY_FILLED' && !order.cancelRequested) {
      this.requestCancel(bar, 'protective bracket reduced exposure; cancel parent remainder');
    }
    this.check();
  }
}

function resolveMinute(model, side, stop, target, minute, bar) {
  const gapStop = side === 'LONG' ? minute.open <= stop : minute.open >= stop;
  if (gapStop) {
    model.exit('GAP_THROUGH_STOP_EXIT', undefined, minute.open, bar);
    return { outcome: 'GAP_STOP', fill: minute.open, ambiguous: false };
  }
  const stopHit = side === 'LONG' ? minute.low <= stop : minute.high >= stop;
  const targetHit = side === 'LONG' ? minute.high >= target : minute.low <= target;
  if (stopHit && targetHit) {
    model.exit('AMBIGUOUS_BARRIER_EXIT', undefined, stop, bar);
    return { outcome: 'AMBIGUOUS', fill: stop, ambiguous: true, conservative_bound: 'STOP_FIRST' };
  }
  if (stopHit) {
    model.exit('STOP_EXIT', undefined, stop, bar);
    return { outcome: 'STOP', fill: stop, ambiguous: false };
  }
  if (targetHit) {
    model.exit('TAKE_PROFIT_EXIT', undefined, target, bar);
    return { outcome: 'TARGET', fill: target, ambiguous: false };
  }
  return { outcome: 'OPEN', fill: null, ambiguous: false };
}

const fixtureEvents = [];
const fixtureSummaries = [];
function finishFixture(name, model, facts = {}) {
  model.check();
  for (const event of model.state.events) fixtureEvents.push({ scenario: name, ...event });
  fixtureSummaries.push({ scenario: name, final_position: model.state.position, final_status: model.state.order?.status ?? 'NONE', event_count: model.state.events.length, ...facts });
  return model;
}

function runFixtures() {
  {
    const a = new LifecycleModel();
    assert.equal(a.candidate('C-RELOAD', 1, { side: 'LONG', size: 1, stop: 98, target: 103 }), true);
    a.candidate('C-RELOAD', 1, { side: 'LONG', size: 1, stop: 98, target: 103 });
    a.submit('O-RELOAD', 1);
    a.acknowledge(1);
    const checkpoint = clone(a.state);
    const uninterrupted = new LifecycleModel(checkpoint);
    const reloaded = new LifecycleModel(checkpoint);
    for (const model of [uninterrupted, reloaded]) {
      model.nextUpdate(2);
      model.candidate('C-RELOAD', 2, { side: 'LONG', size: 1, stop: 98, target: 103 });
      model.fill(1, 2, 100);
      model.exit('TAKE_PROFIT_EXIT', undefined, 103, 2);
    }
    assert.deepEqual(reloaded.state, uninterrupted.state, 'reload suffix must be event-identical');
    const submitted = reloaded.state.events.filter(x => x.event === 'SUBMISSION').length;
    assert.equal(submitted, 1, 'repeated/reloaded candidate must not resubmit');
    finishFixture('repeated_updates_and_reload', reloaded, { submission_count: submitted, reload_suffix_equal: true });
  }
  {
    const m = new LifecycleModel();
    m.candidate('C-DELAY', 3, { side: 'LONG', size: 1, stop: 98, target: 103 });
    m.submit('O-DELAY', 3);
    m.nextUpdate(3);
    m.nextUpdate(3);
    m.acknowledge(3);
    m.nextUpdate(4);
    m.fill(1, 4, 100);
    assert.equal(m.state.position, 1);
    finishFixture('delayed_ack_and_fill', m, { delayed_updates_before_ack: 2, exposure_after_fill: 1 });
  }
  {
    const m = new LifecycleModel();
    m.candidate('C-PARTIAL-CANCEL', 10, { side: 'LONG', size: 1, stop: 98, target: 103 });
    m.submit('O-PARTIAL-CANCEL', 10);
    m.acknowledge(10);
    m.fill(0.4, 11, 100);
    assert.equal(m.state.bracket.protectedQty, 0.4);
    m.expire(12);
    m.fill(0.2, 12, 100.1);
    assert.ok(sameNumber(m.state.position, 0.6), 'late fill before cancel ack must be accounted');
    assert.ok(sameNumber(m.state.bracket.protectedQty, 0.6), 'bracket must track partial and late fills');
    m.acknowledgeCancel(13);
    assert.equal(m.state.order.status, 'PARTIALLY_FILLED_CLOSED');
    assert.ok(sameNumber(m.state.position, 0.6), 'cancel ack closes only the unfilled remainder');
    assert.equal(m.candidate('C-BLOCKED-OPEN', 13), false, 'open exposure blocks another entry');
    m.exit('STOP_EXIT', undefined, 98, 14);
    assert.equal(m.state.position, 0);
    assert.equal(m.candidate('C-SAME-UPDATE', 14), false, 'exit update blocks immediate re-entry');
    m.nextUpdate(15);
    assert.equal(m.candidate('C-AFTER-EXIT', 15), true);
    finishFixture('partial_fill_cancel_race_and_protected_exit', m, { final_status: 'NEXT_CANDIDATE_QUALIFIED', max_exposure: 0.6 });
  }
  {
    const m = new LifecycleModel();
    m.candidate('C-REJECT', 20, { side: 'SHORT', size: 1, stop: 102, target: 95 });
    m.submit('O-REJECT', 20);
    m.acknowledge(20, true);
    assert.equal(m.state.position, 0);
    assert.equal(m.state.bracket.active, false);
    finishFixture('rejection', m, { exposure_after_rejection: 0, bracket_after_rejection: false });
  }
  {
    const m = new LifecycleModel();
    m.candidate('C-SAME-BAR', 30, { side: 'LONG', size: 1, stop: 98, target: 103 });
    m.submit('O-SAME-BAR', 30);
    m.acknowledge(30);
    m.fill(1, 30, 100);
    const outcome = resolveMinute(m, 'LONG', 98, 103, { open: 100, high: 103.2, low: 99.5, close: 103 }, 30);
    assert.equal(outcome.outcome, 'TARGET');
    assert.equal(m.state.position, 0);
    assert.equal(m.state.lastExitBar, 30);
    finishFixture('same_bar_entry_and_take_profit', m, { outcome: outcome.outcome, entry_bar: 30, exit_bar: 30 });
  }
  {
    const m = new LifecycleModel();
    m.candidate('C-EXPIRE', 40, { side: 'SHORT', size: 1, stop: 102, target: 95 });
    m.submit('O-EXPIRE', 40);
    m.acknowledge(40);
    m.expire(41);
    assert.equal(m.state.order.status, 'PLACED', 'expiry is only a cancel request');
    m.acknowledgeCancel(42);
    assert.equal(m.state.order.status, 'CANCELED');
    assert.equal(m.state.position, 0);
    finishFixture('unfilled_expiry_and_cancel_ack', m, { final_status: 'CANCELED', exposure: 0 });
  }
  for (const [name, bars, expected] of [
    ['target_first', [{ open: 100, high: 103.2, low: 99.2, close: 102 }, { open: 102, high: 102.5, low: 97.8, close: 98 }], 'TARGET'],
    ['stop_first', [{ open: 100, high: 101, low: 97.8, close: 98 }, { open: 98, high: 103.2, low: 97.5, close: 103 }], 'STOP'],
    ['same_minute_ambiguous', [{ open: 100, high: 103.2, low: 97.8, close: 101 }], 'AMBIGUOUS'],
  ]) {
    const m = new LifecycleModel();
    m.candidate(`C-${name}`, 50, { side: 'LONG', size: 1, stop: 98, target: 103 });
    m.submit(`O-${name}`, 50);
    m.acknowledge(50);
    m.fill(1, 50, 100);
    let outcome = { outcome: 'OPEN' };
    for (let i = 0; i < bars.length && outcome.outcome === 'OPEN'; i++) outcome = resolveMinute(m, 'LONG', 98, 103, bars[i], 51 + i);
    assert.equal(outcome.outcome, expected);
    if (expected === 'AMBIGUOUS') assert.equal(outcome.conservative_bound, 'STOP_FIRST');
    finishFixture(`lower_interval_${name}`, m, { outcome: outcome.outcome, ambiguity_retained: outcome.ambiguous ?? false, conservative_bound: outcome.conservative_bound ?? '' });
  }
  {
    const m = new LifecycleModel();
    m.candidate('C-GAP', 60, { side: 'LONG', size: 1, stop: 98, target: 103 });
    m.submit('O-GAP', 60);
    m.acknowledge(60);
    m.fill(1, 60, 100);
    const outcome = resolveMinute(m, 'LONG', 98, 103, { open: 95, high: 96, low: 94, close: 95.5 }, 61);
    assert.equal(outcome.outcome, 'GAP_STOP');
    assert.equal(outcome.fill, 95, 'gap model uses the adverse open, not the stop price');
    finishFixture('gap_through_stop', m, { outcome: outcome.outcome, hypothetical_fill: outcome.fill, stop_price: 98 });
  }
  {
    const m = new LifecycleModel();
    m.candidate('C-NO-REVERSE', 70, { side: 'SHORT', size: 1, stop: 102, target: 95 });
    m.submit('O-NO-REVERSE', 70);
    m.acknowledge(70);
    m.fill(1, 70, 100);
    assert.throws(() => m.exit('STOP_EXIT', 1.01, 102, 71), /may reduce but never exceed/);
    assert.equal(m.state.position, -1, 'invalid over-close cannot reverse a short');
    m.exit('STOP_EXIT', 1, 102, 71);
    assert.equal(m.state.position, 0);
    finishFixture('exit_cannot_reverse_or_increase', m, { invalid_overclose_rejected: true, final_position: 0 });
  }
  {
    const m = new LifecycleModel();
    m.candidate('C-LATE-ACK', 80, { side: 'LONG', size: 1, stop: 98, target: 103 });
    m.submit('O-LATE-ACK', 80);
    m.acknowledge(80);
    m.expire(81);
    m.acknowledgeCancel(82);
    assert.throws(() => m.fill(1, 83, 100), /fill requires an active parent order/);
    assert.equal(m.state.position, 0);
    finishFixture('post_ack_late_fill_fails_closed', m, { post_ack_fill_rejected: true, final_position: 0 });
  }
  return { fixture_count: fixtureSummaries.length, fixtureSummaries, fixtureEvents };
}

function parseCsvLine(line) {
  const fields = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') { value += '"'; i++; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) {
      fields.push(value);
      value = '';
    } else value += char;
  }
  fields.push(value);
  return fields;
}

function readCandidateRows() {
  const file = path.join(reportDir, 'candidate_event_ledger.csv');
  const lines = fs.readFileSync(file, 'utf8').trimEnd().split(/\r?\n/);
  const headers = parseCsvLine(lines[0]);
  const candidates = [];
  for (const line of lines.slice(1)) {
    const values = parseCsvLine(line);
    const row = Object.fromEntries(headers.map((key, index) => [key, values[index] ?? '']));
    if (row.risk_blocker !== 'NONE') continue;
    candidates.push({
      candidateId: row.candidate_id,
      timeframe: row.execution_timeframe,
      side: row.side,
      decisionMs: Date.parse(row.decision_time_utc),
      plannedEntry: Number(row.planned_entry_quote),
      stop: Number(row.planned_stop),
      target: Number(row.planned_target),
      assumption: 'FILLED_AT_PLANNED_QUOTE_ONLY',
    });
  }
  candidates.sort((a, b) => a.decisionMs - b.decisionMs || a.candidateId.localeCompare(b.candidateId));
  return candidates;
}

function classifyPath(candidate, bar) {
  const long = candidate.side === 'LONG';
  const stopGap = long ? bar.open <= candidate.stop : bar.open >= candidate.stop;
  if (stopGap) return { outcome: 'GAP_STOP', fill: bar.open, barTime: bar.time, ambiguous: false };
  const stopHit = long ? bar.low <= candidate.stop : bar.high >= candidate.stop;
  const targetHit = long ? bar.high >= candidate.target : bar.low <= candidate.target;
  if (stopHit && targetHit) return { outcome: 'AMBIGUOUS', fill: '', barTime: bar.time, ambiguous: true, conservativeBound: 'STOP_FIRST' };
  if (stopHit) return { outcome: 'STOP', fill: candidate.stop, barTime: bar.time, ambiguous: false };
  if (targetHit) return { outcome: 'TARGET', fill: candidate.target, barTime: bar.time, ambiguous: false };
  return null;
}

async function replayHistoricalBarrierPaths(candidates) {
  const dataDir = path.join(root, 'research/data/btcusdt_2024-10_2026-09/derived');
  const tradeReader = readline.createInterface({ input: createReadStream(path.join(dataDir, 'trade_1m.csv')), crlfDelay: Infinity });
  const markReader = readline.createInterface({ input: createReadStream(path.join(dataDir, 'mark_1m.csv')), crlfDelay: Infinity });
  const tradeIterator = tradeReader[Symbol.asyncIterator]();
  const markIterator = markReader[Symbol.asyncIterator]();
  const tradeHeaderResult = await tradeIterator.next();
  const markHeaderResult = await markIterator.next();
  assert.equal(tradeHeaderResult.done, false);
  assert.equal(markHeaderResult.done, false);
  const tradeHeaders = parseCsvLine(tradeHeaderResult.value);
  const markHeaders = parseCsvLine(markHeaderResult.value);
  const tradeColumn = Object.fromEntries(tradeHeaders.map((x, i) => [x, i]));
  const markColumn = Object.fromEntries(markHeaders.map((x, i) => [x, i]));
  const outcomes = { trade_1m: [], mark_1m: [] };
  const active = { trade_1m: [], mark_1m: [] };
  let nextCandidate = 0;
  let pairedMinuteCount = 0;
  let lastTimestamp = null;

  while (true) {
    const [tradeLine, markLine] = await Promise.all([tradeIterator.next(), markIterator.next()]);
    if (tradeLine.done || markLine.done) {
      assert.equal(tradeLine.done, markLine.done, 'trade and mark 1m ranges must align');
      break;
    }
    const trade = parseCsvLine(tradeLine.value);
    const mark = parseCsvLine(markLine.value);
    const time = Number(trade[tradeColumn.open_time_ms]);
    assert.equal(Number(mark[markColumn.open_time_ms]), time, 'trade and mark minute timestamps must align');
    if (lastTimestamp !== null) assert.equal(time - lastTimestamp, 60_000, '1m replay input contains a gap or duplicate');
    lastTimestamp = time;
    pairedMinuteCount++;

    while (nextCandidate < candidates.length && candidates[nextCandidate].decisionMs < time) {
      const candidate = candidates[nextCandidate++];
      for (const source of ['trade_1m', 'mark_1m']) {
        outcomes[source].push({ ...candidate, outcome: 'NO_DECISION_MINUTE', fill: '', outcome_time_ms: '', ambiguous: false, conservative_bound: '' });
      }
    }
    while (nextCandidate < candidates.length && candidates[nextCandidate].decisionMs === time) {
      const candidate = candidates[nextCandidate++];
      for (const source of ['trade_1m', 'mark_1m']) active[source].push({ candidate, done: false });
    }

    for (const [source, fields, columns] of [
      ['trade_1m', trade, tradeColumn],
      ['mark_1m', mark, markColumn],
    ]) {
      const bar = {
        time,
        open: Number(fields[columns.open]),
        high: Number(fields[columns.high]),
        low: Number(fields[columns.low]),
        close: Number(fields[columns.close]),
      };
      const remaining = [];
      for (const item of active[source]) {
        const result = classifyPath(item.candidate, bar);
        if (result) {
          outcomes[source].push({
            ...item.candidate,
            outcome: result.outcome,
            fill: result.fill,
            outcome_time_ms: result.barTime,
            ambiguous: result.ambiguous,
            conservative_bound: result.conservativeBound ?? '',
            duration_minutes: Math.floor((result.barTime - item.candidate.decisionMs) / 60_000),
          });
        } else remaining.push(item);
      }
      active[source] = remaining;
    }
  }

  for (; nextCandidate < candidates.length; nextCandidate++) {
    const candidate = candidates[nextCandidate];
    for (const source of ['trade_1m', 'mark_1m']) {
      outcomes[source].push({ ...candidate, outcome: 'DECISION_AFTER_DATA', fill: '', outcome_time_ms: '', ambiguous: false, conservative_bound: '' });
    }
  }
  for (const source of ['trade_1m', 'mark_1m']) {
    for (const item of active[source]) {
      outcomes[source].push({ ...item.candidate, outcome: 'OPEN_AT_DATA_END', fill: '', outcome_time_ms: '', ambiguous: false, conservative_bound: '' });
    }
    const expected = candidates.length;
    assert.equal(outcomes[source].length, expected, `${source} must classify every risk-pass candidate exactly once`);
  }
  tradeReader.close();
  markReader.close();
  return { pairedMinuteCount, candidates, outcomes };
}

function summarizeOutcomes(rows) {
  const summary = {};
  for (const row of rows) summary[row.outcome] = (summary[row.outcome] ?? 0) + 1;
  return summary;
}

function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function writeCsv(file, rows, headers) {
  const text = [headers.join(','), ...rows.map(row => headers.map(key => csvEscape(row[key])).join(','))].join('\n') + '\n';
  fs.writeFileSync(file, text, 'utf8');
}

function summarizeByProfile(rows) {
  const profiles = {};
  for (const timeframe of ['5m', '15m']) {
    const subset = rows.filter(row => row.timeframe === timeframe);
    profiles[timeframe] = {
      candidates: new Set(subset.map(row => row.candidateId)).size,
      trade_1m: summarizeOutcomes(subset.filter(x => x.source === 'trade_1m')),
      mark_1m: summarizeOutcomes(subset.filter(x => x.source === 'mark_1m')),
    };
  }
  return profiles;
}

const fixtureResult = runFixtures();
const candidates = readCandidateRows();
const history = await replayHistoricalBarrierPaths(candidates);
const historicalRows = [
  ...history.outcomes.trade_1m.map(row => ({ ...row, source: 'trade_1m' })),
  ...history.outcomes.mark_1m.map(row => ({ ...row, source: 'mark_1m' })),
].sort((a, b) => a.decisionMs - b.decisionMs || a.source.localeCompare(b.source) || a.candidateId.localeCompare(b.candidateId));

const report = {
  contract_version: spec.contract_version,
  observation_model: spec.observation_model,
  fixture_count: fixtureResult.fixture_count,
  fixture_results: fixtureResult.fixtureSummaries,
  fixture_event_count: fixtureResult.fixtureEvents.length,
  historical_replay: {
    source_files: [
      'research/data/btcusdt_2024-10_2026-09/derived/trade_1m.csv',
      'research/data/btcusdt_2024-10_2026-09/derived/mark_1m.csv',
    ],
    paired_1m_bars: history.pairedMinuteCount,
    risk_pass_candidates: candidates.length,
    fill_assumption: 'assumed fill at the immutable planned quote; not an observed fill',
    trade_1m: summarizeOutcomes(history.outcomes.trade_1m),
    mark_1m: summarizeOutcomes(history.outcomes.mark_1m),
    by_timeframe: summarizeByProfile(historicalRows),
    boundary_rule: '1m OHLC determines ordering across minutes; if one 1m bar touches both barriers, outcome stays ambiguous and is not reported as observed stop-first.',
  },
  platform_validation: {
    strategy: {
      script_id: '6daa5166-bfc5-4960-8f84-e714a3b2aff2',
      working_copy_version: 21,
      saved: false,
      local_source_matches_working_copy: true,
      compile: 'PASS',
      runtime_quick: { result: 'PASS', series_items: 5000, orders_emitted: 0 },
      runtime_full: { result: 'PASS', series_items: 5000, orders_emitted: 0 },
    },
    indicator: {
      script_id: 'dd7d1e3f-a6db-4f3a-8a50-2b8f551e9db3',
      working_copy_version: 28,
      saved: false,
      local_source_matches_working_copy: true,
      compile: 'PASS',
      runtime_quick: { result: 'PASS', series_items: 5000, markers: 3 },
      runtime_full: { result: 'UNCONFIRMED_INFRASTRUCTURE_ERROR', error: '[wasm] Compilation is not finished yet, retry later' },
    },
  },
  platform_backtest: {
    script_id: '6daa5166-bfc5-4960-8f84-e714a3b2aff2',
    working_copy_version: 21,
    ticker: 'BTC/USDT.P',
    exchange_code: 'CXBNF8',
    timeframe: '5m',
    requested_range_utc: { from: '2026-09-14T00:00:00Z', to: '2026-09-30T23:59:59Z' },
    returned_last_bar_utc: '2026-10-27T03:45:00Z',
    plan_bar_limit: 5060,
    history_sufficient: false,
    has_more_items_on_left: true,
    has_more_items_on_right: false,
    total_trades: 0,
    recent_orders: 0,
    recent_trades: 0,
    interpretation: 'The bounded platform run emitted no orders or trades and its returned last bar fell outside the requested range. It does not validate order fill/exit transitions; fixture coverage is local and deterministic.',
  },
  limitations: [
    'Historical 1m path replay is conditional on a hypothetical fill at the planned quote and is not a trade or profitability backtest.',
    'OHLC cannot resolve event ordering inside one minute; ambiguous bars retain the ambiguity and expose a stop-first conservative bound.',
    'The TakeProfit emulator bracket model is not a Binance live-exchange execution guarantee.',
    'Fee, queue position, actual partial-fill quantity, slippage, and funding are not inferred from OHLC.',
  ],
};

fs.mkdirSync(reportDir, { recursive: true });
writeCsv(path.join(reportDir, 'order_lifecycle_fixtures.csv'), fixtureResult.fixtureEvents, [
  'scenario', 'sequence', 'update', 'bar', 'event', 'candidate_id', 'order_id', 'status', 'side', 'requested_qty', 'filled_qty', 'remaining_qty', 'position_qty', 'protected_qty', 'stop', 'target', 'detail',
]);
writeCsv(path.join(reportDir, 'order_lifecycle_barrier_paths.csv'), historicalRows, [
  'candidateId', 'timeframe', 'side', 'decisionMs', 'plannedEntry', 'stop', 'target', 'assumption', 'source', 'outcome', 'fill', 'outcome_time_ms', 'ambiguous', 'conservative_bound', 'duration_minutes',
]);
fs.writeFileSync(path.join(reportDir, 'order_lifecycle_report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');

const lines = [
  '# Order lifecycle and protective-exit validation',
  '',
  `Contract: \`${report.contract_version}\`.`,
  '',
  `- Deterministic lifecycle fixtures passed: ${report.fixture_count}.`,
  `- Fixture events recorded: ${report.fixture_event_count}.`,
  `- Aligned lower-interval trade/mark bars replayed: ${history.pairedMinuteCount.toLocaleString('en-US')} 1m bars.`,
  `- Risk-pass candidate plans path-checked: ${candidates.length} (5m and 15m).`,
  '',
  '## Deterministic fixture coverage',
  '',
  ...fixtureResult.fixtureSummaries.map(x => `- \`${x.scenario}\`: ${x.event_count} events; final position ${x.final_position}; ${Object.entries(x).filter(([k]) => !['scenario', 'event_count', 'final_position', 'final_status'].includes(k)).map(([k, v]) => `${k}=${v}`).join('; ') || 'all invariants passed'}.`),
  '',
  '## Lower-interval conditional barrier paths',
  '',
  'These paths assume a fill at each planned next-bar-open quote. They do not establish that the strategy limit order filled, and they are not realized trade results.',
  '',
  '| Data source | Candidates | Target first | Stop first | Gap stop | Ambiguous within 1m | Open at data end |',
  '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
  ...['trade_1m', 'mark_1m'].map(source => {
    const x = summarizeOutcomes(history.outcomes[source]);
    return `| ${source} | ${history.outcomes[source].length} | ${x.TARGET ?? 0} | ${x.STOP ?? 0} | ${x.GAP_STOP ?? 0} | ${x.AMBIGUOUS ?? 0} | ${x.OPEN_AT_DATA_END ?? 0} |`;
  }),
  '',
  'The trade and mark streams are evaluated separately because trigger-price choice is an execution rule. A 1m candle touching both levels remains `AMBIGUOUS`; the event ledger separately carries the conservative stop-first bound. Minute ordering cannot reveal the tick sequence within that minute.',
  '',
  '## Strategy changes and platform semantics',
  '',
  'The P1 strategy now recognizes the documented active and terminal order statuses explicitly, keeps the entry guard active through cancel acknowledgment, and requests cancellation of an unfilled parent remainder after an observed partial protective reduction or flat transition. It also stamps the exit cooldown when `PARTIALLY_FILLED_CLOSED` resolves flat in the same bar, even if no calculation observed the transient open position. Unknown order states fail closed.',
  '',
  'TakeProfit documents that strategy actions become effective on the next price update. Its backtesting emulator models TP/SL as position-level OCO brackets whose quantity follows current exposure. Live bracket handling belongs to the chosen exchange; Binance is still only the research proxy. A close/cancel sequence for timed exits has not been implemented, so timed exits remain deferred.',
  '',
  `TakeProfit working-copy checks: strategy v21 compile/runtime_quick/runtime_full passed on 5,000 series items; indicator v28 compile/runtime_quick passed on 5,000 items. Indicator runtime_full returned an infrastructure response (\`${report.platform_validation.indicator.runtime_full.error}\`) and was not retried. The fixed 5m platform backtest returned zero trades/orders, insufficient history, and a last bar outside its requested window; it is not lifecycle evidence.`,
  '',
  '## Reproduction',
  '',
  '```powershell',
  'node research/generate_candidate_logic.mjs --check',
  'node research/order_lifecycle_check.mjs',
  '```',
  '',
  'The first command checks generated indicator/strategy candidate-core parity. The second runs the deterministic lifecycle/accounting fixtures and regenerates both CSV ledgers and this report. TakeProfit compile/runtime/backtest results are recorded separately in `ORDER_LIFECYCLE_MANIFEST.json`.',
  '',
  '## Limits',
  '',
  '- No observed exchange fills are used. Planned entry quotes are not fills.',
  '- The emulator safety findings do not establish Binance attached-order behavior or live stop execution.',
  '- No profitability, win-rate, expectancy, or maximum-hold result is claimed.',
];
fs.writeFileSync(path.join(reportDir, 'order_lifecycle_report.md'), lines.join('\n') + '\n', 'utf8');

console.log(JSON.stringify({
  contract_version: report.contract_version,
  fixtures: report.fixture_count,
  fixture_events: report.fixture_event_count,
  paired_1m_bars: history.pairedMinuteCount,
  risk_pass_candidates: candidates.length,
  trade_1m: report.historical_replay.trade_1m,
  mark_1m: report.historical_replay.mark_1m,
  report: 'research/reports/order_lifecycle_report.md',
}, null, 2));
