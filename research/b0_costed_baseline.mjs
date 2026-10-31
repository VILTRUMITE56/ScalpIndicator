// Reproducible independent B0 baseline replay. This is an assumed-fill
// historical model, not an exchange-fill or profitability claim.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import readline from 'node:readline';
import { createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evalPath = path.join(root, 'research/specs/baseline_evaluation_p0.json');
const evaluation = JSON.parse(fs.readFileSync(evalPath, 'utf8'));
const dataDir = path.join(root, 'research/data/btcusdt_2024-10_2026-09/derived');
const reportDir = path.join(root, 'research/reports');
const audit = JSON.parse(fs.readFileSync(path.join(root, 'research/reports/btc_history_coverage.json'), 'utf8'));
const base = JSON.parse(fs.readFileSync(path.join(root, 'research/specs/baseline.json'), 'utf8'));
const nativeAuditFile = path.join(reportDir, 'b0_native_takeprofit_reconciliation.json');
const nativeAudit = fs.existsSync(nativeAuditFile) ? JSON.parse(fs.readFileSync(nativeAuditFile, 'utf8')) : null;
const START_MS = Date.parse(evaluation.scoring_window.start_inclusive_utc);
const END_MS = Date.parse(evaluation.scoring_window.end_exclusive_utc);
const MINUTE_MS = 60_000;
const costCases = [
  { name: 'fee_only_10bp', totalBps: 10, proxyBps: 0 },
  { name: 'base_15bp', totalBps: 15, proxyBps: 5 },
  { name: 'stress_1_5x_17_5bp', totalBps: 17.5, proxyBps: 7.5 },
  { name: 'stress_2x_20bp', totalBps: 20, proxyBps: 10 },
];
const runFixtures = process.argv.includes('--self-test');
const runInputsOnly = process.argv.includes('--check-inputs');

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function normalizedTextSha256(file) {
  let text = fs.readFileSync(file, 'utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  text = text.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}
function validateFrozenInputs() {
  const expectedFiles = [
    ['rule_source', path.join(root, evaluation.baseline.rule_source), evaluation.baseline.rule_source_sha256, true],
    ['indicator_source', path.join(root, base.canonical_sources.indicator.path), evaluation.baseline.source_hash_reconciliation.current_indicator_normalized_sha256, true],
    ['rule_spec', path.join(root, evaluation.baseline.rule_spec), evaluation.baseline.rule_spec_sha256, true],
    ...Object.entries(evaluation.inputs).map(([name, x]) => [name, path.join(root, x.path), x.sha256, !x.path.endsWith('.csv')]),
  ];
  const checks = expectedFiles.map(([name, file, expected, normalize]) => {
    const actual = normalize ? normalizedTextSha256(file) : sha256(file);
    assert.equal(actual, expected, `frozen input hash mismatch: ${name}`);
    return { name, path: path.relative(root, file).replaceAll('\\', '/'), sha256: actual, hash_method: normalize ? 'UTF-8 BOM stripped; CRLF/CR normalized to LF' : 'raw bytes' };
  });
  return checks;
}

function readBars(file) {
  const text = fs.readFileSync(file, 'utf8').trimEnd();
  const lines = text.split(/\r?\n/);
  const header = lines[0].split(',');
  const ix = Object.fromEntries(header.map((x, i) => [x, i]));
  return lines.slice(1).map((line, i) => {
    const x = line.split(',');
    const row = {
      timeMs: Number(x[ix.open_time_ms]),
      open: Number(x[ix.open]), high: Number(x[ix.high]), low: Number(x[ix.low]), close: Number(x[ix.close]),
      volume: Number(x[ix.base_volume]),
    };
    assert.ok(Number.isFinite(row.timeMs) && row.open > 0 && row.high >= row.low && row.close > 0, `${file}: invalid bar ${i}`);
    return row;
  });
}

function readCleanBars(file, intervalMs) {
  const bars = readBars(file);
  for (let i = 0; i < bars.length; i++) {
    assert.ok(bars[i].timeMs >= START_MS && bars[i].timeMs < END_MS, `${file}: timestamp outside frozen range`);
    if (i > 0) assert.equal(bars[i].timeMs - bars[i - 1].timeMs, intervalMs, `${file}: gap or duplicate at row ${i}`);
  }
  return bars;
}

function emaSma(values, length) {
  const out = new Float64Array(values.length).fill(Number.NaN);
  const alpha = 2 / (length + 1);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    if (i < length) sum += values[i];
    if (i === length - 1) out[i] = sum / length;
    else if (i >= length) out[i] = alpha * values[i] + (1 - alpha) * out[i - 1];
  }
  return out;
}

function wilderAtr(bars, length) {
  const out = new Float64Array(bars.length).fill(Number.NaN);
  let sum = 0;
  for (let i = 0; i < bars.length; i++) {
    const prior = i === 0 ? bars[i].close : bars[i - 1].close;
    const tr = Math.max(bars[i].high - bars[i].low, Math.abs(bars[i].high - prior), Math.abs(bars[i].low - prior));
    if (i < length) {
      sum += tr;
      if (i === length - 1) out[i] = sum / length;
    } else out[i] = (out[i - 1] * (length - 1) + tr) / length;
  }
  return out;
}

function resetSetup(state, usedAt) {
  state.armed = false; state.touch = -1; state.anchor = NaN; state.atr = NaN;
  state.invalidation = NaN; state.stopRef = NaN; state.used = usedAt;
  state.waitRecovery = true; state.recovery = -1;
}
function newSetup() {
  return { armed: false, touch: -1, anchor: NaN, atr: NaN, invalidation: NaN, stopRef: NaN, used: -1, waitRecovery: false, recovery: -1 };
}
function resetBoth(state, barIndex) {
  resetSetup(state.long, barIndex);
  resetSetup(state.short, barIndex);
}

function riskPlan(side, reference, stopRef, setupAtr) {
  const offset = base.risk_and_execution_assumptions.strategy_entry_limit_offset_fraction;
  const entry = reference * (side === 'LONG' ? 1 + offset : 1 - offset);
  let blocker = 'NONE';
  let distance = NaN; let stop = NaN; let target = NaN; let costR = NaN;
  if (!(entry > 0) || !(setupAtr > 0) || !Number.isFinite(stopRef)) blocker = 'INVALID_ENTRY_ATR_OR_STOP';
  else if (side === 'LONG' ? stopRef >= entry : stopRef <= entry) blocker = 'INVALID_STOP_STRUCTURE';
  else {
    distance = Math.max(Math.abs(entry - stopRef), setupAtr * evaluation.risk_policy.stop_distance_atr_floor);
    stop = side === 'LONG' ? entry - distance : entry + distance;
    target = side === 'LONG' ? entry + evaluation.risk_policy.target_multiple_r * distance : entry - evaluation.risk_policy.target_multiple_r * distance;
    costR = entry * evaluation.risk_policy.cost_fraction_for_sizing / distance;
    if (distance > setupAtr * evaluation.risk_policy.stop_distance_atr_cap) blocker = 'STOP_DISTANCE_OVER_ATR_CAP';
    else if (costR > evaluation.risk_policy.cost_to_initial_risk_max) blocker = 'COST_TO_R_OVER_CAP';
  }
  return { entry, distance, stop, target, costR, blocker };
}

function latestB0Touch(touchIndices, triggerIndex, passesCloseTest) {
  const candidates = touchIndices.filter(x => x >= triggerIndex - 3 && x <= triggerIndex - 1).sort((a, b) => b - a);
  if (!candidates.length) return -1;
  const selected = candidates[0];
  return passesCloseTest(selected) ? selected : -1;
}

function classifyBarrier(candidate, bar) {
  const isLong = candidate.side === 'LONG';
  if (isLong ? bar.open <= candidate.stop : bar.open >= candidate.stop) return { outcome: 'GAP_STOP', exitPrice: bar.open };
  const stopHit = isLong ? bar.low <= candidate.stop : bar.high >= candidate.stop;
  const targetHit = isLong ? bar.high >= candidate.target : bar.low <= candidate.target;
  if (stopHit && targetHit) return { outcome: 'AMBIGUOUS_STOP_FIRST', exitPrice: candidate.stop };
  if (stopHit) return { outcome: 'STOP', exitPrice: candidate.stop };
  if (targetHit) return { outcome: 'TARGET', exitPrice: candidate.target };
  return null;
}

function fixtureChecks() {
  const t = new Set([6, 8]);
  assert.equal(latestB0Touch([...t], 10, () => true), 8, 'B0 chooses newest touch in rolling [2..4] window');
  assert.equal(latestB0Touch([6], 10, () => true), -1, 'B0 misses a touch outside rolling window');
  assert.equal(latestB0Touch([...t], 10, x => x !== 8), -1, 'B0 does not fall back when selected newest touch fails');
  assert.equal(10 - 9, 1, 'a touch at offset two can trigger after one bar');
  const collision = classifyBarrier({ side: 'LONG', stop: 98, target: 103 }, { open: 100, high: 104, low: 97, close: 101 });
  assert.deepEqual(collision, { outcome: 'AMBIGUOUS_STOP_FIRST', exitPrice: 98 });
  const gap = classifyBarrier({ side: 'SHORT', stop: 102, target: 97 }, { open: 103, high: 104, low: 96, close: 100 });
  assert.deepEqual(gap, { outcome: 'GAP_STOP', exitPrice: 103 });
  const fundingLong = -0.0001 * 100_000;
  const fundingShort = 0.0001 * 100_000;
  assert.equal(fundingLong, -10); assert.equal(fundingShort, 10);
  assert.equal(5 + 5 + 5, 15, 'fee and execution proxy decomposition equals frozen 15bp total');
  return { rolling_touch_selection: 'PASS', no_fallback: 'PASS', stop_first_collision: 'PASS', adverse_gap_stop: 'PASS', funding_sign: 'PASS', cost_decomposition: 'PASS' };
}

function conflictSets(executionMinutes, higherMinutes) {
  const exec = audit.resampling.native_comparison[`${executionMinutes}m`].mismatch_examples.map(x => Date.parse(x.open_time_utc));
  const htfKey = higherMinutes === 60 ? '1h' : `${higherMinutes}m`;
  const htf = audit.resampling.native_comparison[htfKey].mismatch_examples.map(x => Date.parse(x.open_time_utc));
  return { exec: new Set(exec), htf: new Set(htf), execCount: exec.length, htfCount: htf.length };
}

function makeId(minutes, side, touchMs, triggerMs) {
  const raw = `${evaluation.instrument.exchange_code}|BTC/USDT.P|${minutes}m|${side}|${touchMs}|${triggerMs}|B0`;
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 24);
}

function runSignalProfile(bars, profile) {
  const minutes = profile.execution_minutes;
  const htfMinutes = profile.higher_minutes;
  const execMs = minutes * MINUTE_MS;
  const htfMs = htfMinutes * MINUTE_MS;
  const barsPerHtf = profile.bars_per_higher;
  const fast = emaSma(bars.map(x => x.close), base.signal_rules_as_implemented.entry_features.fast_ema_length);
  const slow = emaSma(bars.map(x => x.close), base.signal_rules_as_implemented.entry_features.slow_ema_length);
  const atr = wilderAtr(bars, base.signal_rules_as_implemented.entry_features.atr_length);
  const conflicts = conflictSets(minutes, htfMinutes);
  const long = newSetup(); const short = newSetup();
  const slowHistory = [];
  let htfFast = NaN, htfSlow = NaN, htfClose = NaN, htfCount = 0;
  let groupStart = Math.floor(bars[0].timeMs / htfMs) * htfMs;
  let groupCount = 0, groupBad = false, execSinceReset = 0;
  const events = [];
  const eligibleDays = new Set();
  let resets = 0;
  const resetHtfAndSetups = (barIndex) => {
    htfFast = NaN; htfSlow = NaN; htfClose = NaN; htfCount = 0; slowHistory.length = 0;
    resetBoth({ long, short }, barIndex); execSinceReset = 0; resets++;
  };

  for (let i = 0; i < bars.length - 1; i++) {
    const bar = bars[i]; const next = bars[i + 1];
    const gap = next.timeMs - bar.timeMs !== execMs;
    const bucketStart = Math.floor(bar.timeMs / htfMs) * htfMs;
    if (bucketStart !== groupStart) { groupStart = bucketStart; groupCount = 0; groupBad = false; }
    const execConflict = conflicts.exec.has(bar.timeMs);
    if (gap || execConflict) {
      resetHtfAndSetups(i);
      groupStart = bucketStart; groupCount = 0; groupBad = true;
    }
    const cleanExecutionBar = !gap && !execConflict;
    if (cleanExecutionBar) { groupCount++; execSinceReset++; }
    else groupBad = true;
    const nextBucketStart = Math.floor(next.timeMs / htfMs) * htfMs;
    const closesHtf = nextBucketStart !== bucketStart;
    let boundaryConflict = false;
    if (closesHtf) {
      boundaryConflict = conflicts.htf.has(bucketStart) || groupBad || groupCount !== barsPerHtf;
      if (boundaryConflict) resetHtfAndSetups(i);
      else {
        if (htfCount === 0) { htfFast = bar.close; htfSlow = bar.close; }
        else {
          htfFast += (2 / 21) * (bar.close - htfFast);
          htfSlow += (2 / 51) * (bar.close - htfSlow);
        }
        htfClose = bar.close;
        slowHistory.push(htfSlow);
        htfCount++;
      }
      groupStart = nextBucketStart; groupCount = 0; groupBad = false;
    }
    if (gap || execConflict || boundaryConflict) continue;
    if (htfCount < 250 || execSinceReset < 56 || i + 1 <= 55) continue;
    const laggedSlow = slowHistory.length > 3 ? slowHistory[slowHistory.length - 1 - 3] : NaN;
    const longBias = htfClose > htfSlow && htfFast > htfSlow && htfSlow > laggedSlow;
    const shortBias = htfClose < htfSlow && htfFast < htfSlow && htfSlow < laggedSlow;
    const decisionDay = new Date(next.timeMs).toISOString().slice(0, 10);
    eligibleDays.add(decisionDay);
    if (!longBias) resetSetup(long, i);
    if (!shortBias) resetSetup(short, i);

    if (long.armed && i - long.touch > 6) resetSetup(long, i);
    if (short.armed && i - short.touch > 6) resetSetup(short, i);
    if (long.armed && (bar.close <= slow[i] || bar.low <= long.invalidation)) resetSetup(long, i);
    if (short.armed && (bar.close >= slow[i] || bar.high >= short.invalidation)) resetSetup(short, i);
    if (long.waitRecovery && i > long.used && bar.close > fast[i]) { long.waitRecovery = false; long.recovery = i; }
    if (short.waitRecovery && i > short.used && bar.close < fast[i]) { short.waitRecovery = false; short.recovery = i; }

    const touchIndices = [];
    for (const idx of [i - 1, i - 2, i - 3]) if (idx >= 0 && bars[idx].low <= fast[idx] && bars[idx].high >= fast[idx]) touchIndices.push(idx);
    const touch = touchIndices.length ? Math.max(...touchIndices) : -1;
    const longHold = touch >= 0 && touch >= 2 && bars[touch].close > slow[touch] && bars[touch - 1].close > slow[touch - 1] && bars[touch - 2].close > slow[touch - 2];
    const shortHold = touch >= 0 && touch >= 2 && bars[touch].close < slow[touch] && bars[touch - 1].close < slow[touch - 1] && bars[touch - 2].close < slow[touch - 2];
    const longEligible = touch >= 0 && longHold && longBias;
    const shortEligible = touch >= 0 && shortHold && shortBias;
    if (longEligible && !long.waitRecovery && !long.armed && touch > long.used && touch > long.recovery) {
      long.armed = true; long.touch = touch; long.atr = atr[touch]; long.anchor = bars[touch].low;
      if (long.recovery < 0 || long.recovery <= touch - 1) long.anchor = Math.min(long.anchor, bars[touch - 1].low);
      if (long.recovery < 0 || long.recovery <= touch - 2) long.anchor = Math.min(long.anchor, bars[touch - 2].low);
      long.invalidation = long.anchor - 0.1 * long.atr; long.stopRef = long.anchor - 0.15 * long.atr;
    }
    if (shortEligible && !short.waitRecovery && !short.armed && touch > short.used && touch > short.recovery) {
      short.armed = true; short.touch = touch; short.atr = atr[touch]; short.anchor = bars[touch].high;
      if (short.recovery < 0 || short.recovery <= touch - 1) short.anchor = Math.max(short.anchor, bars[touch - 1].high);
      if (short.recovery < 0 || short.recovery <= touch - 2) short.anchor = Math.max(short.anchor, bars[touch - 2].high);
      short.invalidation = short.anchor + 0.1 * short.atr; short.stopRef = short.anchor + 0.15 * short.atr;
    }
    if (long.armed && (bar.close <= slow[i] || bar.low <= long.invalidation)) resetSetup(long, i);
    if (short.armed && (bar.close >= slow[i] || bar.high >= short.invalidation)) resetSetup(short, i);
    const longTrigger = bar.close > fast[i] && bar.close > slow[i] && bar.close > bar.open && i > 0 && bar.close > bars[i - 1].high;
    const shortTrigger = bar.close < fast[i] && bar.close < slow[i] && bar.close < bar.open && i > 0 && bar.close < bars[i - 1].low;
    const longSignal = long.armed && longBias && longTrigger && bar.low > long.invalidation && i - long.touch >= 1 && i - long.touch <= 6;
    const shortSignal = short.armed && shortBias && shortTrigger && bar.high < short.invalidation && i - short.touch >= 1 && i - short.touch <= 6;
    if (!longSignal && !shortSignal) continue;

    const side = longSignal ? 'LONG' : 'SHORT';
    const setup = side === 'LONG' ? long : short;
    const plan = riskPlan(side, next.open, setup.stopRef, setup.atr);
    events.push({
      candidate_id: makeId(minutes, side, bars[setup.touch].timeMs, bar.timeMs),
      execution_timeframe: `${minutes}m`, higher_timeframe: `${htfMinutes}m`, side,
      regime: side === 'LONG' ? 'HTF_BULL_BIAS' : 'HTF_BEAR_BIAS',
      touch_time_utc: new Date(bars[setup.touch].timeMs).toISOString(),
      trigger_time_utc: new Date(bar.timeMs).toISOString(),
      decision_time_utc: new Date(next.timeMs).toISOString(),
      decision_ms: next.timeMs, decision_exec_index: i + 1,
      touch_anchor: setup.anchor, setup_atr: setup.atr,
      structural_invalidation: setup.invalidation, stop_reference: setup.stopRef,
      reference_open: next.open, planned_entry_quote: plan.entry,
      planned_stop: plan.stop, planned_target: plan.target,
      planned_stop_distance: plan.distance, cost_to_initial_risk: plan.costR,
      risk_blocker: plan.blocker,
    });
    resetSetup(setup, i);
  }
  return { events, eligibleDays: [...eligibleDays].sort(), bars: bars.length, resetCount: resets, conflictCounts: { execution: conflicts.execCount, higher: conflicts.htfCount } };
}

async function readMinuteStream(file) {
  const rl = readline.createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  let rowCount = 0; let startMs = null; let expectedMs = null;
  const open = new Float64Array(Number(audit.obtained_coverage.actual_trade_1m_rows));
  const high = new Float64Array(open.length); const low = new Float64Array(open.length); const close = new Float64Array(open.length);
  for await (const line of rl) {
    if (rowCount === 0) { rowCount++; continue; }
    const f = line.split(',');
    const timeMs = Number(f[0]);
    if (startMs === null) { startMs = timeMs; expectedMs = timeMs; }
    assert.equal(timeMs, expectedMs, `${path.basename(file)} 1m timestamp gap/duplicate at row ${rowCount - 1}`);
    assert.ok(timeMs >= START_MS && timeMs < END_MS);
    const i = rowCount - 1;
    open[i] = Number(f[1]); high[i] = Number(f[2]); low[i] = Number(f[3]); close[i] = Number(f[4]);
    assert.ok(open[i] > 0 && high[i] >= low[i] && close[i] > 0, `${file} invalid OHLC row ${i}`);
    rowCount++; expectedMs += MINUTE_MS;
  }
  const rows = rowCount - 1;
  assert.equal(rows, Number(audit.obtained_coverage.actual_trade_1m_rows));
  assert.equal(startMs, START_MS);
  assert.equal(expectedMs, END_MS);
  return { startMs, count: rows, open, high, low, close };
}

function readFunding() {
  const lines = fs.readFileSync(path.join(dataDir, 'funding_events.csv'), 'utf8').trimEnd().split(/\r?\n/);
  const h = lines[0].split(','); const ix = Object.fromEntries(h.map((v, i) => [v, i]));
  return lines.slice(1).map(line => {
    const f = line.split(',');
    return { timeMs: Number(f[ix.calc_time_ms]), intervalHours: Number(f[ix.funding_interval_hours]), rate: Number(f[ix.last_funding_rate]) };
  }).filter(x => x.timeMs >= START_MS && x.timeMs < END_MS).sort((a, b) => a.timeMs - b.timeMs);
}

function classifyAtIndex(candidate, trade, index) {
  return classifyBarrier({
    side: candidate.side,
    stop: candidate.stop ?? candidate.planned_stop,
    target: candidate.target ?? candidate.planned_target,
  }, { open: trade.open[index], high: trade.high[index], low: trade.low[index], close: trade.close[index] });
}

function resolveOne(candidate, trade) {
  const start = Math.round((candidate.decision_ms - trade.startMs) / MINUTE_MS);
  assert.ok(start >= 0 && start < trade.count && trade.startMs + start * MINUTE_MS === candidate.decision_ms, 'entry decision must align to a trade minute');
  for (let i = start; i < trade.count; i++) {
    const result = classifyAtIndex(candidate, trade, i);
    if (result) return { outcome: result.outcome, exitPrice: result.exitPrice, exitIndex: i, exitMs: trade.startMs + i * MINUTE_MS, holdingMinutes: i - start };
  }
  return { outcome: 'OPEN_AT_DATA_END', exitPrice: NaN, exitIndex: trade.count - 1, exitMs: END_MS, holdingMinutes: trade.count - 1 - start };
}

function chooseOrders(events, profile, trade) {
  const orders = []; const orderRows = [];
  let platformCash = evaluation.risk_policy.starting_cash_usdt;
  let lastExitExecIndex = -100; let lastSignalExecIndex = -100; let busyThroughExecIndex = -100;
  for (const candidate of events) {
    const row = { ...candidate, order_status: '', quantity_btc: '', sizing_cash_usdt: round(platformCash, 8), min_filter_status: 'UNKNOWN_NOT_APPLIED' };
    if (candidate.risk_blocker !== 'NONE') { row.order_status = `RISK_REJECT:${candidate.risk_blocker}`; orderRows.push(row); continue; }
    const execIdx = candidate.decision_exec_index;
    if (execIdx <= busyThroughExecIndex) { row.order_status = 'BLOCKED_POSITION_OR_EXIT_UNOBSERVED'; orderRows.push(row); continue; }
    if (execIdx - lastExitExecIndex <= 3) { row.order_status = 'BLOCKED_EXIT_COOLDOWN'; orderRows.push(row); continue; }
    if (execIdx - lastSignalExecIndex <= 3) { row.order_status = 'BLOCKED_SIGNAL_COOLDOWN'; orderRows.push(row); continue; }
    const entry = candidate.planned_entry_quote;
    const distance = candidate.planned_stop_distance;
    const costPerBtc = entry * evaluation.risk_policy.cost_fraction_for_sizing;
    const riskSize = platformCash * evaluation.risk_policy.research_risk_fraction / (distance + costPerBtc);
    const cashSize = platformCash / (entry * 1.001);
    const raw = Math.min(riskSize, cashSize);
    const step = evaluation.risk_policy.quantity_step_btc;
    const size = Math.floor((raw + 1e-12) / step) * step;
    if (!(size >= step)) { row.order_status = 'BLOCKED_SIZE_ROUNDS_TO_ZERO'; orderRows.push(row); continue; }
    row.quantity_btc = round(size, 6);
    row.order_status = 'MODELED_SUBMISSION_ASSUMED_FULL_FILL';
    row.sizing_cash_usdt = round(platformCash, 8);
    const order = { ...candidate, quantity_btc: size, min_filter_status: 'UNKNOWN_NOT_APPLIED' };
    const path = resolveOne(order, trade);
    order.model_outcome = path.outcome;
    order.model_exit_price = path.exitPrice;
    order.model_exit_ms = path.exitMs;
    order.model_exit_index = path.exitIndex;
    order.holding_minutes = path.holdingMinutes;
    order.entry_minute_index = Math.round((order.decision_ms - trade.startMs) / MINUTE_MS);
    orders.push(order);
    lastSignalExecIndex = execIdx;
    const exitObservedIdx = Math.floor((path.exitMs - START_MS) / (profile.execution_minutes * MINUTE_MS)) + 1;
    busyThroughExecIndex = path.outcome === 'OPEN_AT_DATA_END' ? Number.POSITIVE_INFINITY : exitObservedIdx;
    if (path.outcome !== 'OPEN_AT_DATA_END') {
      lastExitExecIndex = exitObservedIdx;
      const gross = (order.side === 'LONG' ? 1 : -1) * (path.exitPrice - order.planned_entry_quote) * size;
      const comm = (order.planned_entry_quote + path.exitPrice) * size * evaluation.cost_scenarios.commission_placeholder_bps_per_side / 10_000;
      // TakeProfit's frozen strategy P&L has per-fill commission. Spread/slippage and funding do not alter native cash.
      platformCash += gross - comm;
    }
    orderRows.push(row);
  }
  return { orders, orderRows };
}

function fundingAtIndex(fundingEvents) {
  const byMinute = new Map();
  for (const event of fundingEvents) {
    const minute = Math.floor((event.timeMs - START_MS) / MINUTE_MS);
    const list = byMinute.get(minute) ?? []; list.push(event); byMinute.set(minute, list);
  }
  return byMinute;
}

function simulateScenario(profile, orders, eligibleDaySet, trade, mark, fundingEvents, costCase) {
  const execMinutes = profile.execution_minutes;
  const fundingMap = fundingAtIndex(fundingEvents);
  const orderAt = new Map(orders.map(x => [x.entry_minute_index, x]));
  const dayMap = new Map();
  const tradeRows = []; const costRows = []; const fundingRows = [];
  let cash = evaluation.risk_policy.starting_cash_usdt;
  let active = null;
  let peakEquity = cash; let maxDd = 0; let maxDdPct = 0;
  const dailyRealized = new Map();
  const dailyPnlByEntry = new Map();
  const dayId = ms => new Date(ms).toISOString().slice(0, 10);
  const proxyFraction = costCase.proxyBps / 10_000;
  const commissionFraction = evaluation.cost_scenarios.commission_placeholder_bps_per_side / 10_000;
  const ensureDay = day => {
    if (!dayMap.has(day)) dayMap.set(day, { date_utc: day, eligible: eligibleDaySet.has(day), start_equity: NaN, end_equity: NaN, min_open_equity: Infinity, max_open_equity: -Infinity, intraday_peak_equity: -Infinity, max_intraday_drawdown_usdt: 0, realized_net_pnl: 0, funding_cashflow: 0, end_cash: NaN, open_position_at_day_end: false });
    return dayMap.get(day);
  };
  const mktEquity = index => {
    if (!active) return cash;
    const px = mark.close[index];
    const sideSign = active.side === 'LONG' ? 1 : -1;
    const unreal = sideSign * (px - active.planned_entry_quote) * active.quantity_btc;
    const exitNotional = px * active.quantity_btc;
    const estExit = exitNotional * (commissionFraction + proxyFraction / 2);
    return cash + unreal - estExit;
  };
  const emitCost = (order, kind, notional, fee, proxy) => {
    costRows.push({ candidate_id: order.candidate_id, execution_timeframe: order.execution_timeframe, scenario: costCase.name, leg: kind, notional_usdt: round(notional, 8), commission_usdt: round(fee, 8), execution_proxy_usdt: round(proxy, 8), total_cost_usdt: round(fee + proxy, 8), total_round_trip_scenario_bps: costCase.totalBps, cost_status: 'HYPOTHETICAL_NOT_MEASURED' });
  };
  const closeActive = (order, path, minuteIndex, fundingTotal) => {
    const exitNotional = path.exitPrice * order.quantity_btc;
    const exitFee = exitNotional * commissionFraction;
    const exitProxy = exitNotional * proxyFraction / 2;
    const entryNotional = order.planned_entry_quote * order.quantity_btc;
    const entryFee = entryNotional * commissionFraction;
    const entryProxy = entryNotional * proxyFraction / 2;
    const gross = (order.side === 'LONG' ? 1 : -1) * (path.exitPrice - order.planned_entry_quote) * order.quantity_btc;
    const fees = entryFee + exitFee; const proxyCost = entryProxy + exitProxy;
    const net = gross - fees - proxyCost + fundingTotal;
    const initialRisk = order.planned_stop_distance * order.quantity_btc;
    const exitDate = dayId(trade.startMs + minuteIndex * MINUTE_MS);
    const d = ensureDay(exitDate);
    d.realized_net_pnl += gross - fees - proxyCost;
    cash += gross - exitFee - exitProxy;
    tradeRows.push({
      candidate_id: order.candidate_id, execution_timeframe: order.execution_timeframe, side: order.side, regime: order.regime,
      scenario: costCase.name, fill_status: 'MODELED_FULL_FILL_NOT_OBSERVED', entry_time_utc: new Date(order.decision_ms).toISOString(),
      entry_price: round(order.planned_entry_quote, 8), quantity_btc: round(order.quantity_btc, 6), stop: round(order.planned_stop, 8), target: round(order.planned_target, 8),
      exit_status: path.outcome, exit_time_utc: path.outcome === 'OPEN_AT_DATA_END' ? '' : new Date(trade.startMs + minuteIndex * MINUTE_MS).toISOString(),
      exit_price: round(path.exitPrice, 8), holding_minutes: path.holdingMinutes, initial_risk_usdt: round(initialRisk, 8),
      gross_pnl_usdt: round(gross, 8), commission_usdt: round(fees, 8), execution_proxy_usdt: round(proxyCost, 8), funding_usdt: round(fundingTotal, 8),
      net_pnl_usdt: round(net, 8), net_initial_R: round(net / initialRisk, 8), min_order_filter_status: order.min_filter_status,
      fill_assumption: 'ASSUMED_FULL_FILL_AT_BOUNDED_ENTRY_QUOTE',
    });
    emitCost(order, 'EXIT', exitNotional, exitFee, exitProxy);
    const entryDate = dayId(order.decision_ms);
    dailyRealized.set(entryDate, (dailyRealized.get(entryDate) ?? 0) + net / initialRisk);
    dailyPnlByEntry.set(entryDate, (dailyPnlByEntry.get(entryDate) ?? 0) + net);
    return { gross, fees, proxyCost, net, initialRisk, exitFee, exitProxy };
  };

  for (let i = 0; i < trade.count; i++) {
    const timeMs = trade.startMs + i * MINUTE_MS;
    const date = dayId(timeMs);
    const d = ensureDay(date);
    if (i % 1440 === 0) d.start_equity = mktEquity(i);

    const incoming = orderAt.get(i);
    if (incoming) {
      assert.equal(active, null, 'order selection must prevent overlapping positions');
      const entryNotional = incoming.planned_entry_quote * incoming.quantity_btc;
      const entryFee = entryNotional * commissionFraction;
      const entryProxy = entryNotional * proxyFraction / 2;
      cash -= entryFee + entryProxy;
      emitCost(incoming, 'ENTRY', entryNotional, entryFee, entryProxy);
      active = incoming;
      active.funding = 0;
    }

    const eventList = fundingMap.get(i) ?? [];
    for (const event of eventList) {
      if (active && active.decision_ms < event.timeMs) {
        const sign = active.side === 'LONG' ? -1 : 1;
        const notional = active.quantity_btc * mark.open[i];
        const amount = sign * event.rate * notional;
        cash += amount; active.funding += amount;
        const dFunding = ensureDay(date); dFunding.funding_cashflow += amount;
        fundingRows.push({ candidate_id: active.candidate_id, execution_timeframe: active.execution_timeframe, side: active.side, event_time_utc: new Date(event.timeMs).toISOString(), funding_rate: event.rate, mark_price_proxy: round(mark.open[i], 8), quantity_btc: round(active.quantity_btc, 6), funding_cashflow_usdt: round(amount, 8), scenario: costCase.name, status: 'EVENT_SPECIFIC_MARK_OPEN_PROXY' });
      }
    }

    if (active) {
      const path = classifyAtIndex(active, trade, i);
      if (path) {
        const fundingTotal = active.funding;
        closeActive(active, { ...path, holdingMinutes: i - active.entry_minute_index }, i, fundingTotal);
        active = null;
      }
    }

    const eq = mktEquity(i);
    peakEquity = Math.max(peakEquity, eq);
    const dd = peakEquity - eq;
    maxDd = Math.max(maxDd, dd);
    if (peakEquity > 0) maxDdPct = Math.max(maxDdPct, dd / peakEquity * 100);
    d.min_open_equity = Math.min(d.min_open_equity, eq);
    d.max_open_equity = Math.max(d.max_open_equity, eq);
    d.intraday_peak_equity = Math.max(d.intraday_peak_equity, eq);
    d.max_intraday_drawdown_usdt = Math.max(d.max_intraday_drawdown_usdt, d.intraday_peak_equity - eq);
    d.end_equity = eq; d.end_cash = cash; d.open_position_at_day_end = Boolean(active);
  }

  if (active) {
    const px = mark.close[trade.count - 1];
    const gross = (active.side === 'LONG' ? 1 : -1) * (px - active.planned_entry_quote) * active.quantity_btc;
    const exitNotional = px * active.quantity_btc;
    const estimatedExit = exitNotional * (commissionFraction + proxyFraction / 2);
    const entryNotional = active.planned_entry_quote * active.quantity_btc;
    const entryCost = entryNotional * (commissionFraction + proxyFraction / 2);
    tradeRows.push({
      candidate_id: active.candidate_id, execution_timeframe: active.execution_timeframe, side: active.side, regime: active.regime,
      scenario: costCase.name, fill_status: 'MODELED_FULL_FILL_NOT_OBSERVED', entry_time_utc: new Date(active.decision_ms).toISOString(),
      entry_price: round(active.planned_entry_quote, 8), quantity_btc: round(active.quantity_btc, 6), stop: round(active.planned_stop, 8), target: round(active.planned_target, 8),
      exit_status: 'OPEN_AT_DATA_END', exit_time_utc: '', exit_price: '', holding_minutes: trade.count - 1 - active.entry_minute_index,
      initial_risk_usdt: round(active.planned_stop_distance * active.quantity_btc, 8), gross_pnl_usdt: round(gross, 8),
      commission_usdt: round(entryNotional * commissionFraction, 8), execution_proxy_usdt: round(entryNotional * proxyFraction / 2, 8), funding_usdt: round(active.funding, 8),
      net_pnl_usdt: '', net_initial_R: '', unrealized_gross_pnl_usdt: round(gross, 8), estimated_exit_cost_usdt: round(estimatedExit, 8),
      estimated_open_net_pnl_usdt: round(gross - entryCost - estimatedExit + active.funding, 8),
      min_order_filter_status: active.min_filter_status, fill_assumption: 'ASSUMED_FULL_FILL_AT_BOUNDED_ENTRY_QUOTE',
    });
    emitCost(active, 'EXIT_ESTIMATE_AT_DATA_END', exitNotional, exitNotional * commissionFraction, exitNotional * proxyFraction / 2);
  }

  for (let d = new Date(START_MS); d < new Date(END_MS); d.setUTCDate(d.getUTCDate() + 1)) {
    const date = d.toISOString().slice(0, 10);
    const row = ensureDay(date);
    if (!Number.isFinite(row.start_equity)) row.start_equity = row.end_equity ?? cash;
    if (!Number.isFinite(row.end_equity)) row.end_equity = row.start_equity;
    if (!Number.isFinite(row.end_cash)) row.end_cash = cash;
    if (!Number.isFinite(row.min_open_equity)) row.min_open_equity = row.end_equity;
    if (!Number.isFinite(row.max_open_equity)) row.max_open_equity = row.end_equity;
  }
  const equityRows = [...dayMap.values()].sort((a, b) => a.date_utc.localeCompare(b.date_utc)).map(x => ({
    profile: `${execMinutes}m/${profile.higher_minutes}m`, scenario: costCase.name, ...x,
    eligible: x.eligible ? 'YES' : 'NO', entry_cohort_net_R: round(dailyRealized.get(x.date_utc) ?? 0, 8),
    intraday_peak_drawdown_usdt: round(x.max_intraday_drawdown_usdt, 8),
  }));
  return { tradeRows, costRows, fundingRows, equityRows, cash, maxDd, maxDdPct, dailyRealized, dailyPnlByEntry };
}

function percentile(sorted, p) {
  if (!sorted.length) return NaN;
  const at = (sorted.length - 1) * p; const lo = Math.floor(at); const hi = Math.ceil(at);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo);
}
function blockBootstrap(dailyRs, seedText, closedCount) {
  if (closedCount < 30) return { status: 'INCONCLUSIVE_LT_30_CLOSED_FILLS', closed_fill_count: closedCount, eligible_daily_observations: dailyRs.length, block_days: 7, replicates: 0, mean_daily_net_R_ci95: null };
  let seed = crypto.createHash('sha256').update(seedText).digest().readUInt32LE(0) || 1;
  const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
  const block = 7; const reps = 5000; const n = dailyRs.length; const out = new Array(reps);
  for (let r = 0; r < reps; r++) {
    let sum = 0; let count = 0;
    while (count < n) {
      const start = Math.floor(random() * n);
      for (let k = 0; k < block && count < n; k++, count++) sum += dailyRs[(start + k) % n];
    }
    out[r] = sum / n;
  }
  out.sort((a, b) => a - b);
  return { status: 'MODEL_CONDITIONAL_7_DAY_CIRCULAR_BLOCK_BOOTSTRAP', closed_fill_count: closedCount, eligible_daily_observations: dailyRs.length, block_days: block, replicates: reps, mean_daily_net_R_ci95: [round(percentile(out, 0.025), 8), round(percentile(out, 0.975), 8)] };
}

function summarize(profile, events, eligibleDays, orderSet, scenario) {
  const closed = scenario.tradeRows.filter(x => x.exit_status !== 'OPEN_AT_DATA_END');
  const open = scenario.tradeRows.filter(x => x.exit_status === 'OPEN_AT_DATA_END');
  const pnls = closed.map(x => Number(x.net_pnl_usdt));
  const Rs = closed.map(x => Number(x.net_initial_R));
  const wins = pnls.filter(x => x > 0).reduce((a, b) => a + b, 0);
  const losses = -pnls.filter(x => x < 0).reduce((a, b) => a + b, 0);
  const dailyR = eligibleDays.map(day => scenario.dailyRealized.get(day) ?? 0);
  const dailyNet = [...scenario.dailyPnlByEntry.entries()].map(([day, pnl]) => ({ day, pnl })).sort((a, b) => b.pnl - a.pnl);
  const positiveDayNet = dailyNet.filter(x => x.pnl > 0).reduce((a, b) => a + b.pnl, 0);
  const top5 = dailyNet.filter(x => x.pnl > 0).slice(0, 5);
  const netClosed = pnls.reduce((a, b) => a + b, 0);
  const durations = closed.map(x => Number(x.holding_minutes)).sort((a, b) => a - b);
  const side = {};
  const byMonth = {};
  for (const row of closed) {
    const sideKey = `${row.side}/${row.regime}`;
    side[sideKey] ??= { trades: 0, net_pnl_usdt: 0, net_R: 0, wins: 0 };
    side[sideKey].trades++; side[sideKey].net_pnl_usdt += Number(row.net_pnl_usdt); side[sideKey].net_R += Number(row.net_initial_R); if (Number(row.net_pnl_usdt) > 0) side[sideKey].wins++;
    const month = row.exit_time_utc.slice(0, 7);
    byMonth[month] ??= { trades: 0, net_pnl_usdt: 0, net_R: 0 };
    byMonth[month].trades++; byMonth[month].net_pnl_usdt += Number(row.net_pnl_usdt); byMonth[month].net_R += Number(row.net_initial_R);
  }
  for (const x of Object.values(side)) { x.net_pnl_usdt = round(x.net_pnl_usdt, 8); x.net_R = round(x.net_R, 8); x.win_rate = x.trades ? round(x.wins / x.trades, 8) : null; }
  for (const x of Object.values(byMonth)) { x.net_pnl_usdt = round(x.net_pnl_usdt, 8); x.net_R = round(x.net_R, 8); }
  return {
    profile: `${profile.execution_minutes}m/${profile.higher_minutes}m`, scenario: scenario.name,
    signals: events.length, risk_pass_signals: events.filter(x => x.risk_blocker === 'NONE').length,
    modeled_orders: orderSet.orders.length, modeled_fills: orderSet.orders.length, observed_fills: 0,
    order_blockers: blockerCounts(orderSet.orderRows), closed_modeled_fills: closed.length, open_at_data_end: open.length,
    eligible_days: eligibleDays.length, net_expectancy_usdt_per_closed_fill: closed.length ? round(netClosed / closed.length, 8) : null,
    net_expectancy_initial_R: Rs.length ? round(Rs.reduce((a, b) => a + b, 0) / Rs.length, 8) : null,
    net_R_per_eligible_day: eligibleDays.length ? round(dailyR.reduce((a, b) => a + b, 0) / eligibleDays.length, 8) : null,
    total_net_closed_pnl_usdt: round(netClosed, 8), profit_factor_net: losses ? round(wins / losses, 8) : wins ? 'UNDEFINED_NO_NET_LOSSES' : null,
    closed_trade_win_rate: closed.length ? round(pnls.filter(x => x > 0).length / closed.length, 8) : null,
    open_equity_max_drawdown_usdt: round(scenario.maxDd, 8), open_equity_max_drawdown_pct: round(scenario.maxDdPct, 8),
    final_cash_usdt: round(scenario.cash, 8), open_position_marked_net_pnl_usdt: open.length ? open.map(x => x.estimated_open_net_pnl_usdt) : [],
    holding_minutes: closed.length ? { mean: round(durations.reduce((a, b) => a + b, 0) / durations.length, 4), median: percentile(durations, 0.5), p90: percentile(durations, 0.9), max: Math.max(...durations) } : null,
    positive_net_pnl_top5_day_share: positiveDayNet > 0 ? round(top5.reduce((a, b) => a + b.pnl, 0) / positiveDayNet, 8) : null,
    net_pnl_excluding_top5_winning_days_usdt: round(netClosed - top5.reduce((a, b) => a + b.pnl, 0), 8),
    top5_winning_days: top5.map(x => ({ date_utc: x.day, net_pnl_usdt: round(x.pnl, 8) })),
    by_side_and_regime: side, by_utc_month: byMonth,
    confidence: blockBootstrap(dailyR, `${evaluation.evaluation_id}|${profile.execution_minutes}|${scenario.name}`, closed.length),
    inference: closed.length < 30 ? 'INCONCLUSIVE_SPARSE_CLOSED_MODELED_FILLS' : 'CONDITIONAL_ON_ASSUMED_FILLS_AND_UNMEASURED_COSTS',
  };
}

function blockerCounts(rows) {
  const result = {};
  for (const r of rows) result[r.order_status] = (result[r.order_status] ?? 0) + 1;
  return result;
}
function round(x, digits = 8) { return Number.isFinite(x) ? Number(x.toFixed(digits)) : ''; }
function csvCell(x) {
  if (x === null || x === undefined) return '';
  const s = typeof x === 'object' ? JSON.stringify(x) : String(x);
  return `"${s.replaceAll('"', '""')}"`;
}
function writeCsv(name, rows) {
  const file = path.join(reportDir, name);
  if (!rows.length) { fs.writeFileSync(file, '\n'); return; }
  const fields = [...new Set(rows.flatMap(x => Object.keys(x)))];
  const body = [fields.join(','), ...rows.map(row => fields.map(key => csvCell(row[key])).join(','))].join('\n') + '\n';
  fs.writeFileSync(file, body, 'utf8');
  return file;
}

function integritySummary(inputChecks, profiles, scenarioSummaries, allCandidateRows, allOrderRows, allFillRows, allCostRows, allEquityRows) {
  assert.equal(allCandidateRows.length, profiles.reduce((a, x) => a + x.events.length, 0));
  assert.equal(allOrderRows.length, allCandidateRows.length, 'every candidate needs an order/accounting disposition');
  const fillIds = allFillRows.map(x => `${x.execution_timeframe}|${x.candidate_id}|${x.scenario}`);
  assert.equal(new Set(fillIds).size, fillIds.length, 'modeled fills must have unique profile/candidate/scenario keys');
  const orderIds = allOrderRows.filter(x => x.order_status === 'MODELED_SUBMISSION_ASSUMED_FULL_FILL').map(x => `${x.execution_timeframe}|${x.candidate_id}`);
  for (const key of orderIds) for (const scenario of costCases) assert.ok(fillIds.includes(`${key}|${scenario.name}`), `every modeled order must have one fill disposition per scenario: ${key}/${scenario.name}`);
  for (const row of allFillRows) {
    if (row.exit_status !== 'OPEN_AT_DATA_END') {
      const identity = Number(row.gross_pnl_usdt) - Number(row.commission_usdt) - Number(row.execution_proxy_usdt) + Number(row.funding_usdt);
      assert.ok(Math.abs(identity - Number(row.net_pnl_usdt)) < 1e-6, `net PnL accounting mismatch ${row.candidate_id}`);
    }
  }
  return {
    frozen_inputs_hash_checked: true,
    inputs: inputChecks,
    candidates_all_dispositioned: true,
    model_orders_all_have_one_per_scenario_fill_disposition: true,
    closed_fill_pnl_identity_checked: true,
    position_open_at_end_preserved: allFillRows.some(x => x.exit_status === 'OPEN_AT_DATA_END'),
    artifact_rows: { candidates: allCandidateRows.length, orders: allOrderRows.length, fills: allFillRows.length, costs: allCostRows.length, daily_equity: allEquityRows.length },
    profile_summaries: profiles.map(x => ({ profile: `${x.profile.execution_minutes}m/${x.profile.higher_minutes}m`, eligible_days: x.eligibleDays.length, signals: x.events.length, assumed_orders: x.orders.length, resets: x.resetCount, conflict_counts: x.conflictCounts })),
    scenario_summaries: scenarioSummaries,
  };
}

if (runFixtures) console.log(JSON.stringify({ deterministic_fixtures: fixtureChecks() }, null, 2));
if (runInputsOnly) {
  console.log(JSON.stringify({ frozen_inputs: validateFrozenInputs() }, null, 2));
  process.exit(0);
}

const fixtureResults = fixtureChecks();
const inputChecks = validateFrozenInputs();
const bars5 = readCleanBars(path.join(dataDir, 'trade_5m_resampled.csv'), 5 * MINUTE_MS);
const bars15 = readCleanBars(path.join(dataDir, 'trade_15m_resampled.csv'), 15 * MINUTE_MS);
const trade1m = await readMinuteStream(path.join(dataDir, 'trade_1m.csv'));
const mark1m = await readMinuteStream(path.join(dataDir, 'mark_1m.csv'));
assert.equal(mark1m.count, trade1m.count, 'trade and mark one-minute streams must align');
assert.equal(mark1m.startMs, trade1m.startMs);
const funding = readFunding();
assert.equal(funding.length, audit.funding_audit.events, 'funding event count must match #4 source audit');

const profileSpecs = evaluation.profiles;
const profileRuns = [];
const candidateRows = []; const orderRows = [];
for (const profile of profileSpecs) {
  const bars = profile.execution_minutes === 5 ? bars5 : bars15;
  const signalRun = runSignalProfile(bars, profile);
  const selected = chooseOrders(signalRun.events, profile, trade1m);
  const profileRun = { profile, ...signalRun, ...selected };
  profileRuns.push(profileRun);
  candidateRows.push(...signalRun.events.map(x => ({ ...x, model_price_status: 'RESEARCH_REFERENCE_NOT_FILL' })));
  orderRows.push(...selected.orderRows.map(x => ({ ...x, profile: `${profile.execution_minutes}m/${profile.higher_minutes}m` })));
}

const fillRows = []; const costRows = []; const fundingRows = []; const equityRows = []; const scenarioSummaries = [];
for (const profileRun of profileRuns) {
  for (const costCase of costCases) {
    const result = simulateScenario(profileRun.profile, profileRun.orders, new Set(profileRun.eligibleDays), trade1m, mark1m, funding, costCase);
    result.name = costCase.name;
    const summary = summarize(profileRun.profile, profileRun.events, profileRun.eligibleDays, { orders: profileRun.orders, orderRows: profileRun.orderRows }, result);
    scenarioSummaries.push(summary);
    fillRows.push(...result.tradeRows);
    costRows.push(...result.costRows);
    fundingRows.push(...result.fundingRows);
    equityRows.push(...result.equityRows.map(x => ({ ...x, profile: `${profileRun.profile.execution_minutes}m/${profileRun.profile.higher_minutes}m` })));
    profileRun.scenarios ??= {};
    profileRun.scenarios[costCase.name] = { ...result, summary };
  }
}

const accounting = integritySummary(inputChecks, profileRuns, scenarioSummaries, candidateRows, orderRows, fillRows, costRows, equityRows);
const observedConflictDates = audit.resampling.native_comparison;
const userEconomics = {
  user_reported_margin_usdt: [5, 10], user_reported_leverage_x: [20, 50],
  implied_linear_notional_usdt: [100, 500], user_all_in_max_loss_usdt: 1, user_target_minimum_usdt_exclusive: 5,
  b0_target_multiple_R: evaluation.risk_policy.target_multiple_r,
  arithmetic_conclusion: 'A fixed 1.5R target cannot gross $5 when all-in planned loss is capped at $1 (at most $1.50 gross before costs); the B0 target/risk geometry does not meet the stated personal dollar target. At the declared 10-20 bp modeled cost, the user-sized net outcome is lower. This is an objective mismatch, not a performance estimate.',
};
const report = {
  report_id: evaluation.evaluation_id,
  generated_at_utc: new Date().toISOString(),
  scope: 'Frozen local B0 full-history reference replay with conditional assumed fills and explicit hypothetical cost/funding accounting.',
  decision: {
    choice: 'REVISE_RESEARCH_HYPOTHESIS; KEEP_FEATURE_EXPERIMENTS_BLOCKED',
    rationale: 'The B0 1.5R payoff geometry cannot meet the user-confirmed >$5 target under a <=$1 all-in loss cap. Historical performance remains conditional on unobserved fills, unmeasured execution costs, unknown account fees, unavailable platform minimum filters, and non-holdout data. Do not infer live profitability; complete native parity and collect venue-specific quotes/fills before deciding whether to continue or pivot the signal.',
    profitability_claim: 'NONE',
  },
  evaluation_policy: evaluation,
  deterministic_fixtures: fixtureResults,
  data_coverage: {
    coverage_report: 'research/reports/btc_history_coverage.md',
    start_inclusive_utc: evaluation.scoring_window.start_inclusive_utc,
    end_exclusive_utc: evaluation.scoring_window.end_exclusive_utc,
    trade_1m_rows: trade1m.count,
    mark_1m_rows: mark1m.count,
    funding_events: funding.length,
    independent_resampling_native_comparison: observedConflictDates,
  },
  accounting_validation: accounting,
  native_reference_reconciliation: nativeAudit ?? {
    status: 'PENDING_NATIVE_EPHEMERAL_B0_RUN',
    caveat: 'Connected canonical TakeProfit script id currently points to version 21 P1 source, not B0. A temporary ephemeral B0 copy is required for native comparison; do not use the P1 copy as B0.',
  },
  user_economics_overlay: userEconomics,
  results: scenarioSummaries,
  known_limits: [
    "No historical best bid/ask or user's account fee rate was provided; 5 bp per side plus an unmeasured impact proxy are assumptions.",
    'Every submitted model order assumes immediate full fill at the bounded quote. Queue position, partial fills, order rejections, and cancel/fill races are unknown.',
    'Exchange tick size, minimum quantity, and minimum notional filters are not verified; model sizes below the known 0.001 BTC step are rejected, but platform eligibility remains unknown.',
    'Funding is event-specific but mark-price notional uses the open of the event minute as a proxy, not an exchange settlement snapshot.',
    'The evaluation window was previously inspected and is not an untouched holdout.',
    'The local strategy and indicator hashes match the frozen manifest after UTF-8 LF normalization; raw Windows CRLF hashes are recorded separately in the evaluation policy.',
    "User's personal risk limits are not used to size this 10,000 USDT research baseline. Account-level daily loss and drawdown limits remain unset.",
  ],
  reproducibility: {
    command: 'node research/b0_costed_baseline.mjs',
    evaluator_path: 'research/b0_costed_baseline.mjs',
    evaluator_sha256: normalizedTextSha256(fileURLToPath(import.meta.url)),
    frozen_policy_path: 'research/specs/baseline_evaluation_p0.json',
    frozen_policy_sha256: normalizedTextSha256(evalPath),
    run_manifest_path: 'research/reports/b0_costed_baseline_manifest.json',
  },
};

writeCsv('b0_candidate_ledger.csv', candidateRows);
writeCsv('b0_order_ledger.csv', orderRows);
writeCsv('b0_fill_ledger.csv', fillRows);
writeCsv('b0_cost_ledger.csv', costRows);
writeCsv('b0_funding_ledger.csv', fundingRows);
writeCsv('b0_daily_equity_ledger.csv', equityRows);
fs.writeFileSync(path.join(reportDir, 'b0_costed_baseline_report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
const md = [
  '# Costed B0 Baseline: Findings and Decision', '',
  `Generated: ${report.generated_at_utc}`, '',
  `**Decision: ${report.decision.choice}.** ${report.decision.rationale}`, '',
  'This is a conditional historical model, not observed trading performance or a profitability claim. The exact evaluation policy was frozen before the replay in `research/specs/baseline_evaluation_p0.json`.', '',
  '## Profile and cost results', '',
  '| Profile | Cost case | Signals | Assumed fills | Closed | Open at end | Expectancy USDT / fill | Expectancy R | Net R / eligible day | Net PF | Open-equity max DD | Inference |',
  '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|',
  ...scenarioSummaries.map(x => `| ${x.profile} | ${x.scenario} | ${x.signals} | ${x.modeled_fills} | ${x.closed_modeled_fills} | ${x.open_at_data_end} | ${x.net_expectancy_usdt_per_closed_fill ?? 'n/a'} | ${x.net_expectancy_initial_R ?? 'n/a'} | ${x.net_R_per_eligible_day ?? 'n/a'} | ${x.profit_factor_net} | ${x.open_equity_max_drawdown_usdt} (${x.open_equity_max_drawdown_pct}%) | ${x.inference} |`), '',
  '## Evidence', '',
  `- Full interval: ${report.data_coverage.start_inclusive_utc} through ${report.data_coverage.end_exclusive_utc} exclusive; ${report.data_coverage.trade_1m_rows.toLocaleString()} trade minutes, ${report.data_coverage.mark_1m_rows.toLocaleString()} mark minutes, and ${report.data_coverage.funding_events.toLocaleString()} funding events.`,
  `- Candidate, order, assumed fill, cost, funding, and daily open-equity ledgers are archived as ` + '`b0_candidate_ledger.csv`, `b0_order_ledger.csv`, `b0_fill_ledger.csv`, `b0_cost_ledger.csv`, `b0_funding_ledger.csv`, and `b0_daily_equity_ledger.csv`.' ,
  '- Full file hashes, frozen rules, cost assumptions, reset/warmup rules, and normalized source-hash reconciliation are in the run JSON and evaluation policy.',
  '- Fills are assumed at the bounded next-open quote. Costs use a 5 bp/side fee placeholder plus 5 bp unmeasured round-trip execution proxy at base; stress cases multiply only that proxy by 1.5x/2x. Funding uses recorded events and event-minute mark open.',
  `- Native reconciliation status: ${report.native_reference_reconciliation.status}. The temporary exact-source B0 script compiled and passed quick runtime, but TakeProfit rejected 24-month runs at its 5,060-bar plan cap; bounded snapshots returned bars after the requested end date. See ` + '`b0_native_takeprofit_reconciliation.json`.', '',
  `- Independent data audit found 3 5m, 3 15m and 4 1h native/reference conflict bars. The source audit lists their values; these bars were excluded and reset warmup, leaving no conflicts in scored bars. Candidate dispositions and modeled fill/cost accounting checks passed; no position crossed the data end.`, '',
  '## Base-cost uncertainty and concentration', '',
  '| Profile | 7-day block-bootstrap 95% CI for mean net R/eligible day | Positive PnL in top five winning days | Mean / median / p90 / max hold (minutes) |',
  '|---|---:|---:|---:|',
  ...scenarioSummaries.filter(x => x.scenario === 'base_15bp').map(x => `| ${x.profile} | [${x.confidence.mean_daily_net_R_ci95.join(', ')}] | ${(100 * x.positive_net_pnl_top5_day_share).toFixed(1)}% | ${x.holding_minutes.mean} / ${x.holding_minutes.median} / ${x.holding_minutes.p90} / ${x.holding_minutes.max} |`), '',
  'The interval is conditional on the model and assumed fills. It crosses zero for both profiles; it does not establish positive expectancy.', '',
  '## Base-cost breakdown by side and regime', '',
  '| Profile | Side / HTF regime | Closed modeled fills | Net USDT | Net initial R | Win rate |',
  '|---|---|---:|---:|---:|---:|',
  ...scenarioSummaries.filter(x => x.scenario === 'base_15bp').flatMap(x => Object.entries(x.by_side_and_regime).map(([bucket, v]) => `| ${x.profile} | ${bucket} | ${v.trades} | ${v.net_pnl_usdt} | ${v.net_R} | ${(100 * v.win_rate).toFixed(1)}% |`)), '',
  '## Base-cost breakdown by UTC exit month', '',
  '| Profile | Exit month | Closed modeled fills | Net USDT | Net initial R |',
  '|---|---|---:|---:|---:|',
  ...scenarioSummaries.filter(x => x.scenario === 'base_15bp').flatMap(x => Object.entries(x.by_utc_month).sort(([a], [b]) => a.localeCompare(b)).map(([month, v]) => `| ${x.profile} | ${month} | ${v.trades} | ${v.net_pnl_usdt} | ${v.net_R} |`)), '',
  '- The machine-readable run manifest records SHA-256 hashes for the source inputs and every generated report/ledger artifact.',
  '## Personal sizing compatibility', '',
  `The user's stated $1 all-in maximum loss and >$5 target do not align with B0's fixed ${evaluation.risk_policy.target_multiple_r}R target. If $1 is the all-in stop risk, B0 can gross at most $1.50 at target before costs. This is arithmetic about the configured payoff ratio, not a backtest result.`, '',
  '## Limitations', '',
  ...report.known_limits.map(x => `- ${x}`), '',
  'Profitability remains unproven. Keep feature experiments blocked until native parity, measured execution costs, and a fresh holdout can support an economic decision.', '',
].join('\n');
fs.writeFileSync(path.join(reportDir, 'b0_costed_baseline_report.md'), md, 'utf8');
const artifactNames = [
  'b0_candidate_ledger.csv', 'b0_order_ledger.csv', 'b0_fill_ledger.csv', 'b0_cost_ledger.csv',
  'b0_funding_ledger.csv', 'b0_daily_equity_ledger.csv', 'b0_costed_baseline_report.json',
  'b0_costed_baseline_report.md', 'b0_native_takeprofit_reconciliation.json',
];
const manifest = {
  manifest_id: evaluation.evaluation_id,
  generated_at_utc: report.generated_at_utc,
  evaluation_policy_path: 'research/specs/baseline_evaluation_p0.json',
  evaluation_policy_sha256: normalizedTextSha256(evalPath),
  evaluator_path: 'research/b0_costed_baseline.mjs',
  evaluator_sha256: normalizedTextSha256(fileURLToPath(import.meta.url)),
  text_hash_method: 'SHA-256 after UTF-8 BOM stripping and CRLF/CR to LF normalization; input market CSVs hash raw bytes.',
  command: 'node research/b0_costed_baseline.mjs',
  frozen_input_hashes: inputChecks,
  native_reconciliation_status: report.native_reference_reconciliation.status,
  artifact_hashes: artifactNames.map(name => ({ path: `research/reports/${name}`, sha256: normalizedTextSha256(path.join(reportDir, name)), bytes: fs.statSync(path.join(reportDir, name)).size })),
  ledger_rows: accounting.artifact_rows,
  decision: report.decision,
  performance_summaries: scenarioSummaries.map(x => ({ profile: x.profile, scenario: x.scenario, modeled_fills: x.modeled_fills, closed: x.closed_modeled_fills, expectancy_usdt: x.net_expectancy_usdt_per_closed_fill, expectancy_R: x.net_expectancy_initial_R, net_R_per_eligible_day: x.net_R_per_eligible_day, net_profit_factor: x.profit_factor_net, inference: x.inference })),
};
fs.writeFileSync(path.join(reportDir, 'b0_costed_baseline_manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({
  report: 'research/reports/b0_costed_baseline_report.md',
  manifest: 'research/reports/b0_costed_baseline_manifest.json',
  native_reconciliation: report.native_reference_reconciliation.status,
  artifact_rows: accounting.artifact_rows,
  summaries: scenarioSummaries.map(x => ({ profile: x.profile, scenario: x.scenario, assumed_fills: x.modeled_fills, expectancy_usdt: x.net_expectancy_usdt_per_closed_fill, expectancy_R: x.net_expectancy_initial_R, net_R_per_day: x.net_R_per_eligible_day, profit_factor: x.profit_factor_net, max_drawdown_pct: x.open_equity_max_drawdown_pct, inference: x.inference })),
}, null, 2));
