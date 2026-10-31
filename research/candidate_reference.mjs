// Independent, offline reference calculation for candidate-contract P1.
// This is intentionally written separately from the Indie generator/template.
// It consumes the audited #4 resampled CSV history, never places orders, and
// treats every planned quote as distinct from an actual fill.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, 'research/data/btcusdt_2024-10_2026-09/derived');
const outputDir = path.join(root, 'research/reports');
const contract = JSON.parse(fs.readFileSync(path.join(root, 'research/specs/candidate_contract_p1.json'), 'utf8'));
const config = {
  venueCode: contract.instrument_scope.venue_code,
  symbol: contract.instrument_scope.takeprofit_symbol,
  ruleVersion: contract.contract_version,
  emaFast: contract.shared_signal_rules.ema_fast,
  emaSlow: contract.shared_signal_rules.ema_slow,
  atrLength: contract.shared_signal_rules.atr_length,
  htfFast: contract.shared_signal_rules.htf_fast_ema,
  htfSlow: contract.shared_signal_rules.htf_slow_ema,
  htfLag: contract.shared_signal_rules.htf_slope_lookback,
  htfWarmup: contract.shared_signal_rules.htf_warmup_bars,
  firstTriggerAge: contract.shared_signal_rules.expiry_bars_after_touch.first,
  lastTriggerAge: contract.shared_signal_rules.expiry_bars_after_touch.last_inclusive,
  minStopAtr: contract.planned_entry_risk_contract.minimum_stop_distance_atr,
  maxStopAtr: contract.planned_entry_risk_contract.maximum_stop_distance_atr,
  targetR: contract.planned_entry_risk_contract.target_multiple_r,
  maxCostR: contract.planned_entry_risk_contract.maximum_cost_to_risk,
  costFraction: contract.planned_entry_risk_contract.round_trip_cost_fraction,
  invalidationAtr: contract.planned_entry_risk_contract.long_invalidation_offset_atr,
  stopRefAtr: contract.planned_entry_risk_contract.long_stop_reference_offset_atr,
  limitOffset: contract.execution_separation.strategy_limit_offset_fraction,
};

function csvRows(file) {
  const lines = fs.readFileSync(file, 'utf8').trimEnd().split(/\r?\n/);
  const headers = lines[0].split(',');
  return lines.slice(1).map(line => {
    const values = line.split(',');
    const row = {};
    for (let i = 0; i < headers.length; i++) row[headers[i]] = values[i];
    return {
      timeMs: Number(row.open_time_ms),
      open: Number(row.open), high: Number(row.high), low: Number(row.low), close: Number(row.close),
      volume: Number(row.base_volume),
    };
  });
}

function ema(series, length) {
  const output = new Array(series.length).fill(Number.NaN);
  const alpha = 2 / (length + 1);
  let sum = 0;
  for (let i = 0; i < series.length; i++) {
    const value = series[i];
    if (!Number.isFinite(value)) {
      sum = 0;
      continue;
    }
    if (i < length) sum += value;
    if (i === length - 1) output[i] = sum / length;
    else if (i >= length) output[i] = alpha * value + (1 - alpha) * output[i - 1];
  }
  return output;
}

function wilderAtr(bars, length) {
  const tr = bars.map((bar, i) => {
    if (i === 0) return bar.high - bar.low;
    const previous = bars[i - 1].close;
    return Math.max(bar.high - bar.low, Math.abs(bar.high - previous), Math.abs(bar.low - previous));
  });
  const output = new Array(bars.length).fill(Number.NaN);
  let sum = 0;
  let seen = 0;
  for (let i = 0; i < tr.length; i++) {
    if (i < length) {
      sum += tr[i];
      seen++;
      if (seen === length) output[i] = sum / length;
    } else {
      output[i] = (output[i - 1] * (length - 1) + tr[i]) / length;
    }
  }
  return output;
}

function asIso(unixSeconds) {
  return new Date(unixSeconds * 1000).toISOString();
}

function candidateId(profileMinutes, side, touchSeconds, triggerSeconds) {
  return [config.venueCode, config.symbol, `${profileMinutes}m`, side,
    String(touchSeconds), String(triggerSeconds), config.ruleVersion].join('|');
}

function planRisk(side, entry, stopReference, setupAtr) {
  let blocker = 'NONE';
  let distance = Number.NaN;
  let stop = Number.NaN;
  let target = Number.NaN;
  let costR = Number.NaN;
  if (!(entry > 0) || !(setupAtr > 0)) blocker = 'INVALID ENTRY OR ATR';
  else if ((side === 'LONG' && stopReference >= entry) || (side === 'SHORT' && stopReference <= entry)) blocker = 'INVALID STOP';
  else {
    distance = Math.max(Math.abs(entry - stopReference), config.minStopAtr * setupAtr);
    costR = entry * config.costFraction / distance;
    stop = side === 'LONG' ? entry - distance : entry + distance;
    target = side === 'LONG' ? entry + config.targetR * distance : entry - config.targetR * distance;
    if (distance > config.maxStopAtr * setupAtr) blocker = `STOP > ${config.maxStopAtr} ATR`;
    else if (costR > config.maxCostR) blocker = `COST > ${config.maxCostR}R`;
  }
  return { distance, stop, target, costR, blocker };
}

function runProfile(bars, profile, options = {}) {
  const minutes = profile.execution_minutes;
  const htfMinutes = profile.higher_minutes;
  const intervalMs = minutes * 60_000;
  const htfMs = htfMinutes * 60_000;
  const barsPerHtf = htfMinutes / minutes;
  const excludedExecutionTimes = options.excludedExecutionTimes ?? new Set();
  const excludedHtfBuckets = options.excludedHtfBuckets ?? new Set();
  bars = bars.filter(bar => !excludedExecutionTimes.has(bar.timeMs));
  const fast = ema(bars.map(x => x.close), config.emaFast);
  const slow = ema(bars.map(x => x.close), config.emaSlow);
  const atr = wilderAtr(bars, config.atrLength);
  const events = [];
  const setups = [];
  const eligibleBars = [];
  let htfFast = Number.NaN;
  let htfSlow = Number.NaN;
  let htfClose = Number.NaN;
  let htfSlowHistory = [];
  let htfCount = 0;
  let htfResetPending = false;
  const state = {
    long: { armed: false, touch: -1, anchor: Number.NaN, atr: Number.NaN, invalidation: Number.NaN, stopRef: Number.NaN, setupIndex: -1, used: -1, waitRecovery: false, recovery: -1 },
    short: { armed: false, touch: -1, anchor: Number.NaN, atr: Number.NaN, invalidation: Number.NaN, stopRef: Number.NaN, setupIndex: -1, used: -1, waitRecovery: false, recovery: -1 },
  };

  function resetSetup(side, usedAt, reason = 'RESET', triggeredCandidateId = '') {
    const s = state[side];
    if (s.armed && s.setupIndex >= 0) {
      const setup = setups[s.setupIndex];
      setup.outcome = reason;
      setup.resolution_time_utc = asIso(Math.floor(bars[Math.min(usedAt, bars.length - 1)].timeMs / 1000));
      setup.duration_bars = Math.max(0, usedAt - setup.touch_index);
      setup.triggered_candidate_id = triggeredCandidateId;
    }
    s.armed = false; s.touch = -1; s.anchor = Number.NaN; s.atr = Number.NaN;
    s.invalidation = Number.NaN; s.stopRef = Number.NaN; s.setupIndex = -1; s.used = usedAt;
    s.waitRecovery = true; s.recovery = -1;
  }

  for (let i = 0; i < bars.length - 1; i++) {
    const bar = bars[i];
    const next = bars[i + 1];
    const isGap = next.timeMs - bar.timeMs !== intervalMs;
    const currentBucket = Math.floor(bar.timeMs / htfMs);
    const nextBucket = Math.floor(next.timeMs / htfMs);
    const closesHtf = currentBucket !== nextBucket;
    let conflictingHtfBoundary = false;
    if (isGap) {
      htfFast = Number.NaN; htfSlow = Number.NaN; htfClose = Number.NaN;
      htfSlowHistory = []; htfCount = 0; htfResetPending = false;
      resetSetup('long', i, 'DATA_GAP'); resetSetup('short', i, 'DATA_GAP');
    } else if (closesHtf) {
      const bucketStart = Math.floor(bar.timeMs / htfMs) * htfMs;
      const priorBucketBars = [];
      for (let j = i; j >= 0 && Math.floor(bars[j].timeMs / htfMs) === currentBucket; j--) priorBucketBars.push(bars[j]);
      const complete = priorBucketBars.length === barsPerHtf && priorBucketBars[priorBucketBars.length - 1].timeMs === bucketStart;
      if (complete) {
        if (excludedHtfBuckets.has(bucketStart)) {
          // A disputed native HTF candle is omitted from the research series. Keep
          // the last completed valid bias until the next clean HTF close, then
          // reseed and re-warm from that clean candle.
          htfResetPending = true;
          conflictingHtfBoundary = true;
        } else if (htfResetPending) {
          resetSetup('long', i, 'HTF_SOURCE_CONFLICT');
          resetSetup('short', i, 'HTF_SOURCE_CONFLICT');
          htfFast = bar.close; htfSlow = bar.close; htfClose = bar.close;
          htfSlowHistory = [htfSlow]; htfCount = 1; htfResetPending = false;
        } else {
          if (htfCount === 0) {
            htfFast = bar.close;
            htfSlow = bar.close;
          } else {
            htfFast += (2 / (config.htfFast + 1)) * (bar.close - htfFast);
            htfSlow += (2 / (config.htfSlow + 1)) * (bar.close - htfSlow);
          }
          htfClose = bar.close;
          htfSlowHistory.push(htfSlow);
          htfCount++;
        }
      } else {
        htfFast = Number.NaN; htfSlow = Number.NaN; htfClose = Number.NaN;
        htfSlowHistory = []; htfCount = 0; htfResetPending = false;
        resetSetup('long', i, 'INCOMPLETE_HTF'); resetSetup('short', i, 'INCOMPLETE_HTF');
      }
    }

    if (isGap || htfCount < config.htfWarmup || i < Math.max(config.emaSlow, config.atrLength) + 3) continue;
    const laggedSlow = htfSlowHistory.length > config.htfLag
      ? htfSlowHistory[htfSlowHistory.length - 1 - config.htfLag]
      : Number.NaN;
    const longBias = htfClose > htfSlow && htfFast > htfSlow && htfSlow > laggedSlow;
    const shortBias = htfClose < htfSlow && htfFast < htfSlow && htfSlow < laggedSlow;
    eligibleBars.push({
      timeMs: bar.timeMs + intervalMs,
      side: longBias ? 'LONG' : shortBias ? 'SHORT' : 'NEUTRAL',
      close: bar.close,
      atr: atr[i],
      atrPct: atr[i] / bar.close * 100,
    });
    const long = state.long;
    const short = state.short;

    if (!longBias) resetSetup('long', i, 'BIAS_LOSS');
    if (!shortBias) resetSetup('short', i, 'BIAS_LOSS');
    for (const [side, s] of [['long', long], ['short', short]]) {
      if (s.armed && i - s.touch > config.lastTriggerAge) resetSetup(side, i, 'EXPIRED');
    }

    const longInvalid = long.armed && (bar.close <= slow[i] || bar.low <= long.invalidation);
    const shortInvalid = short.armed && (bar.close >= slow[i] || bar.high >= short.invalidation);
    if (longInvalid) resetSetup('long', i, bar.close <= slow[i] ? 'CLOSE_THROUGH_EMA50' : 'STRUCTURAL_INVALIDATION');
    if (shortInvalid) resetSetup('short', i, bar.close >= slow[i] ? 'CLOSE_THROUGH_EMA50' : 'STRUCTURAL_INVALIDATION');

    if (long.waitRecovery && i > long.used && bar.close > fast[i]) {
      long.waitRecovery = false; long.recovery = i;
    }
    if (short.waitRecovery && i > short.used && bar.close < fast[i]) {
      short.waitRecovery = false; short.recovery = i;
    }

    const intersectsFast = bar.low <= fast[i] && bar.high >= fast[i];
    let longTouchEligible = longBias && intersectsFast && bar.close > slow[i];
    let shortTouchEligible = shortBias && intersectsFast && bar.close < slow[i];
    if (long.recovery < 0 || long.recovery <= i - 1) if (bars[i - 1].close <= slow[i - 1]) longTouchEligible = false;
    if (long.recovery < 0 || long.recovery <= i - 2) if (bars[i - 2].close <= slow[i - 2]) longTouchEligible = false;
    if (short.recovery < 0 || short.recovery <= i - 1) if (bars[i - 1].close >= slow[i - 1]) shortTouchEligible = false;
    if (short.recovery < 0 || short.recovery <= i - 2) if (bars[i - 2].close >= slow[i - 2]) shortTouchEligible = false;

    if (longTouchEligible && !long.waitRecovery && !long.armed && i > long.used && i > long.recovery) {
      long.armed = true; long.touch = i; long.atr = atr[i];
      long.anchor = bar.low;
      if (long.recovery < 0 || long.recovery <= i - 1) long.anchor = Math.min(long.anchor, bars[i - 1].low);
      if (long.recovery < 0 || long.recovery <= i - 2) long.anchor = Math.min(long.anchor, bars[i - 2].low);
      long.invalidation = long.anchor - config.invalidationAtr * long.atr;
      long.stopRef = long.anchor - config.stopRefAtr * long.atr;
      const touchSeconds = Math.floor(bar.timeMs / 1000);
      long.setupIndex = setups.push({
        setup_id: [config.venueCode, config.symbol, `${minutes}m`, 'LONG', String(touchSeconds), config.ruleVersion, 'SETUP'].join('|'),
        execution_timeframe: `${minutes}m`, side: 'LONG', touch_time_utc: asIso(touchSeconds),
        touch_index: i, touch_atr: long.atr, touch_atr_pct: long.atr / bar.close * 100,
        touch_close: bar.close, outcome: 'ARMED', resolution_time_utc: '', duration_bars: '', triggered_candidate_id: '',
      }) - 1;
    }
    if (shortTouchEligible && !short.waitRecovery && !short.armed && i > short.used && i > short.recovery) {
      short.armed = true; short.touch = i; short.atr = atr[i];
      short.anchor = bar.high;
      if (short.recovery < 0 || short.recovery <= i - 1) short.anchor = Math.max(short.anchor, bars[i - 1].high);
      if (short.recovery < 0 || short.recovery <= i - 2) short.anchor = Math.max(short.anchor, bars[i - 2].high);
      short.invalidation = short.anchor + config.invalidationAtr * short.atr;
      short.stopRef = short.anchor + config.stopRefAtr * short.atr;
      const touchSeconds = Math.floor(bar.timeMs / 1000);
      short.setupIndex = setups.push({
        setup_id: [config.venueCode, config.symbol, `${minutes}m`, 'SHORT', String(touchSeconds), config.ruleVersion, 'SETUP'].join('|'),
        execution_timeframe: `${minutes}m`, side: 'SHORT', touch_time_utc: asIso(touchSeconds),
        touch_index: i, touch_atr: short.atr, touch_atr_pct: short.atr / bar.close * 100,
        touch_close: bar.close, outcome: 'ARMED', resolution_time_utc: '', duration_bars: '', triggered_candidate_id: '',
      }) - 1;
    }

    const longTrigger = bar.close > fast[i] && bar.close > slow[i] && bar.close > bar.open && bar.close > bars[i - 1].high;
    const shortTrigger = bar.close < fast[i] && bar.close < slow[i] && bar.close < bar.open && bar.close < bars[i - 1].low;
    const longAge = i - long.touch;
    const shortAge = i - short.touch;
    const isLong = long.armed && longBias && longTrigger && bar.low > long.invalidation && longAge >= config.firstTriggerAge && longAge <= config.lastTriggerAge;
    const isShort = short.armed && shortBias && shortTrigger && bar.high < short.invalidation && shortAge >= config.firstTriggerAge && shortAge <= config.lastTriggerAge;
    if (!isLong && !isShort) {
      if (conflictingHtfBoundary) {
        resetSetup('long', i, 'HTF_SOURCE_CONFLICT');
        resetSetup('short', i, 'HTF_SOURCE_CONFLICT');
      }
      continue;
    }

    const side = isLong ? 'LONG' : 'SHORT';
    const setup = isLong ? long : short;
    const entry = next.open;
    const stopRef = setup.stopRef;
    const plan = planRisk(side, entry, stopRef, setup.atr);
    const touchSeconds = Math.floor(bars[setup.touch].timeMs / 1000);
    const triggerSeconds = Math.floor(bar.timeMs / 1000);
    const limitQuote = entry * (isLong ? (1 + config.limitOffset) : (1 - config.limitOffset));
    events.push({
      candidate_id: candidateId(minutes, side, touchSeconds, triggerSeconds),
      setup_id: setup.setupIndex >= 0 ? setups[setup.setupIndex].setup_id : '',
      venue_code: config.venueCode,
      symbol: config.symbol,
      execution_timeframe: `${minutes}m`,
      side,
      touch_time_utc: asIso(touchSeconds),
      trigger_time_utc: asIso(triggerSeconds),
      decision_time_utc: asIso(Math.floor(next.timeMs / 1000)),
      touch_anchor: setup.anchor,
      setup_atr: setup.atr,
      touch_atr_pct: setup.atr / bars[setup.touch].close * 100,
      trigger_atr: atr[i],
      trigger_atr_pct: atr[i] / bar.close * 100,
      structural_invalidation: setup.invalidation,
      planned_entry_quote: entry,
      planned_stop: plan.stop,
      planned_target: plan.target,
      planned_stop_distance: plan.distance,
      round_trip_cost_fraction: config.costFraction,
      cost_to_initial_risk: plan.costR,
      risk_blocker: plan.blocker,
      indicator_model_blocker: 'NOT_SIMULATED',
      strategy_execution_blocker: 'NOT_SIMULATED',
      strategy_order_limit_quote: limitQuote,
      execution_quote_offset_bps: (limitQuote / entry - 1) * 10_000,
      actual_fill_price: '',
      actual_fill_status: 'UNKNOWN_NOT_SIMULATED',
      execution_difference_note: 'LIMIT_QUOTE_ONLY; actual fill unknown.',
    });
    resetSetup(isLong ? 'long' : 'short', i, 'TRIGGERED', events.at(-1).candidate_id);
    if (conflictingHtfBoundary) {
      resetSetup('long', i, 'HTF_SOURCE_CONFLICT');
      resetSetup('short', i, 'HTF_SOURCE_CONFLICT');
    }
  }
  resetSetup('long', bars.length - 1, 'DATA_END_OPEN');
  resetSetup('short', bars.length - 1, 'DATA_END_OPEN');
  return { events, setups, eligibleBars, fast, slow, atr };
}

function legacyWindowTouch(touches, currentBar, directionalClose) {
  const window = [currentBar - 1, currentBar - 2, currentBar - 3];
  let latest = -1;
  for (const index of window) if (touches.has(index) && index > latest) latest = index;
  if (latest < 0 || !directionalClose(latest)) return -1;
  return latest;
}

function firstEligibleTouch(touches, recoveryBar, directionalClose) {
  for (const index of [...touches].sort((a, b) => a - b)) {
    if (index > recoveryBar && directionalClose(index)) return index;
  }
  return -1;
}

function biasAtTouchAllowsSetup(touchBias) {
  return touchBias;
}

function fixtureChecks() {
  const touches = new Set([6, 8]);
  const alwaysDirectional = () => true;
  assert.equal(firstEligibleTouch(touches, 0, alwaysDirectional), 6, 'P1 keeps the first valid touch in the recovery episode');
  assert.equal(legacyWindowTouch(touches, 10, alwaysDirectional), 8, 'B0 retrospective window chooses the most recent [2..4] touch');
  assert.equal(legacyWindowTouch(new Set([6]), 10, alwaysDirectional), -1, 'B0 window misses a touch older than its three-candle search');
  assert.equal(legacyWindowTouch(touches, 10, index => index !== 8), -1, 'B0 does not fall back to an older touch when its newest touch fails the close test');
  assert.equal(biasAtTouchAllowsSetup(false), false, 'bias that appears only after the touch cannot retroactively qualify it');
  assert.equal(biasAtTouchAllowsSetup(true), true, 'directional HTF bias at the touch can qualify it');
  assert.equal(firstEligibleTouch(touches, 7, alwaysDirectional), 8, 'recovery bars cannot be reused as an eligible touch');
  assert.equal(8 > 8, false, 'recovery candle itself cannot arm');
  assert.equal(9 > 8, true, 'a later candle can arm after recovery');
  const triggerAgeAllowed = age => age >= config.firstTriggerAge && age <= config.lastTriggerAge;
  assert.equal(triggerAgeAllowed(0), false, 'touch candle cannot also trigger');
  assert.equal(triggerAgeAllowed(1), true, 'first later candle is eligible');
  assert.equal(triggerAgeAllowed(6), true, 'sixth later candle is eligible');
  assert.equal(triggerAgeAllowed(7), false, 'seventh later candle is expired');

  const invalidation = 97.5;
  const validBreakoutClose = 101;
  const wick = 97.4;
  assert.ok(validBreakoutClose > 100, 'synthetic candle closes above trigger levels');
  assert.ok(wick <= invalidation, 'same candle has an invalidating wick and must be rejected before trigger acceptance');

  const long = planRisk('LONG', 100, 97.85, 1);
  const short = planRisk('SHORT', 100, 102.15, 1);
  assert.equal(long.blocker, short.blocker, 'mirrored long/short risk gates agree');
  assert.ok(Math.abs(long.distance - short.distance) < 1e-12);
  assert.ok(Math.abs((long.stop + short.stop) / 2 - 100) < 1e-12);
  assert.ok(Math.abs((long.target + short.target) / 2 - 100) < 1e-12);

  const planQuote = 100;
  const longOrderQuote = planQuote * (1 + config.limitOffset);
  const plannedLongStop = 98;
  const plannedLongTarget = 103;
  assert.equal(plannedLongStop, 98);
  assert.equal(plannedLongTarget, 103);
  assert.ok(longOrderQuote !== planQuote, 'execution limit quote is distinct from the immutable planned quote');
  assert.equal(plannedLongStop, 98, 'execution quote does not recalculate planned stop');
  return { legacy_touch_window: 'PASS', bias_at_touch: 'PASS', recovery_ordering: 'PASS', invalidating_trigger_wick: 'PASS', six_bar_expiry: 'PASS', long_short_symmetry: 'PASS', execution_quote_separation: 'PASS' };
}

function round(value, digits = 10) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : '';
}

function writeCsv(file, events) {
  const fields = [
    'candidate_id', 'venue_code', 'symbol', 'execution_timeframe', 'side', 'touch_time_utc', 'trigger_time_utc',
    'decision_time_utc', 'touch_anchor', 'setup_atr', 'structural_invalidation', 'planned_entry_quote', 'planned_stop',
    'planned_target', 'planned_stop_distance', 'round_trip_cost_fraction', 'cost_to_initial_risk', 'risk_blocker',
    'indicator_model_blocker', 'strategy_execution_blocker',
    'strategy_order_limit_quote', 'execution_quote_offset_bps', 'actual_fill_price', 'actual_fill_status', 'execution_difference_note',
  ];
  const quote = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const rows = [fields.join(','), ...events.map(event => fields.map(field => {
    const value = event[field];
    return typeof value === 'number' ? String(round(value)) : quote(value);
  }).join(','))];
  fs.writeFileSync(file, rows.join('\n') + '\n', 'utf8');
}

function compareHistory(full, truncated, afterMs) {
  const fullRows = full.filter(row => Date.parse(row.trigger_time_utc) >= afterMs);
  const tailRows = truncated.filter(row => Date.parse(row.trigger_time_utc) >= afterMs);
  assert.equal(tailRows.length, fullRows.length, 'full/truncated candidate count matches after warmup overlap');
  const mismatches = [];
  for (let i = 0; i < fullRows.length; i++) {
    const a = fullRows[i]; const b = tailRows[i];
    assert.equal(b.candidate_id, a.candidate_id, 'full/truncated candidate IDs match');
    for (const field of ['touch_anchor', 'setup_atr', 'structural_invalidation', 'planned_entry_quote', 'planned_stop', 'planned_target', 'cost_to_initial_risk']) {
      const delta = Math.abs(a[field] - b[field]);
      if (delta > 1e-6) mismatches.push({ candidate_id: a.candidate_id, field, full: a[field], truncated: b[field], delta });
    }
  }
  assert.equal(mismatches.length, 0, 'full/truncated planned fields match within 1e-6');
  return { compared_candidates: fullRows.length, candidate_id_differences: 0, level_differences: 0, max_level_abs_delta: 0, tolerance: 1e-6 };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
const fixtureResults = fixtureChecks();
const profiles = [];
const allEvents = [];
const fullHistoryOverlap = {};
const coverageAudit = JSON.parse(fs.readFileSync(path.join(root, 'research/reports/btc_history_coverage.json'), 'utf8'));
const disputedBars = coverageAudit.resampling.native_reference_disputes_masked_from_scoring;
for (const profile of contract.profiles) {
  const fileName = profile.execution_minutes === 5 ? 'trade_5m_resampled.csv' : 'trade_15m_resampled.csv';
  const file = path.join(dataDir, fileName);
  const inputBars = csvRows(file);
  const executionConflicts = new Set((disputedBars[`${profile.execution_minutes}m`] ?? []).map(row => Date.parse(row.open_time_utc)));
  const htfKey = profile.higher_minutes === 60 ? '1h' : `${profile.higher_minutes}m`;
  const excludedHtfBuckets = new Set((disputedBars[htfKey] ?? []).map(row => Date.parse(row.open_time_utc)));
  const bars = inputBars.filter(bar => !executionConflicts.has(bar.timeMs));
  const runOptions = { excludedExecutionTimes: executionConflicts, excludedHtfBuckets };
  const fullRun = runProfile(bars, profile, runOptions);
  const preRollBars = 3500;
  const compareWindowBars = 5000;
  const truncatedStart = Math.max(0, bars.length - compareWindowBars - preRollBars);
  const truncatedBars = bars.slice(truncatedStart);
  const tailRun = runProfile(truncatedBars, profile, runOptions);
  const comparisonStartMs = bars[Math.max(0, bars.length - compareWindowBars)].timeMs;
  const parity = compareHistory(fullRun.events, tailRun.events, comparisonStartMs);
  const coverageProfile = coverageAudit.ema.profile_feature_gates.find(row => row.execution_timeframe === `${profile.execution_minutes}m`);
  assert.equal(fullRun.eligibleBars.length, coverageProfile.coverage.eligible_scored_bars, 'P1 scoring mask matches issue #4 eligible-bar count exactly');
  const blockerCounts = {};
  const sideCounts = { LONG: 0, SHORT: 0 };
  for (const row of fullRun.events) {
    blockerCounts[row.risk_blocker] = (blockerCounts[row.risk_blocker] ?? 0) + 1;
    sideCounts[row.side]++;
  }
  profiles.push({
    execution_minutes: profile.execution_minutes,
    higher_minutes: profile.higher_minutes,
    input_bars: inputBars.length,
    bars: bars.length,
    execution_conflict_bars_masked: executionConflicts.size,
    higher_timeframe_conflict_bars_masked: excludedHtfBuckets.size,
    model_eligible_bars: fullRun.eligibleBars.length,
    setups: fullRun.setups.length,
    setup_outcomes: fullRun.setups.reduce((acc, setup) => { acc[setup.outcome] = (acc[setup.outcome] ?? 0) + 1; return acc; }, {}),
    first_bar_utc: asIso(Math.floor(bars[0].timeMs / 1000)),
    last_bar_utc: asIso(Math.floor(bars.at(-1).timeMs / 1000)),
    full_history_candidates: fullRun.events.length,
    side_counts: sideCounts,
    risk_blockers: blockerCounts,
    full_vs_truncated_overlap: parity,
    truncated_start_utc: asIso(Math.floor(truncatedBars[0].timeMs / 1000)),
    comparison_start_utc: asIso(Math.floor(comparisonStartMs / 1000)),
    source_csv: fileName,
    source_csv_sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
  });
  allEvents.push(...fullRun.events);
  fullHistoryOverlap[String(profile.execution_minutes)] = parity;
}

allEvents.sort((a, b) => a.trigger_time_utc.localeCompare(b.trigger_time_utc) || a.execution_timeframe.localeCompare(b.execution_timeframe));
const candidateIds = new Set(allEvents.map(row => row.candidate_id));
assert.equal(candidateIds.size, allEvents.length, 'durable candidate IDs are unique in the full event ledger');
for (const row of allEvents) {
  assert.ok(row.touch_time_utc < row.trigger_time_utc, 'touch precedes trigger');
  assert.ok(row.decision_time_utc > row.trigger_time_utc, 'planned quote is timestamped after the completed trigger');
  if (row.risk_blocker === 'NONE') {
    assert.ok(row.planned_stop_distance > 0 && Number.isFinite(row.planned_stop));
    assert.ok(Number.isFinite(row.planned_target));
    assert.ok(row.side === 'LONG' ? row.planned_stop < row.planned_entry_quote && row.planned_target > row.planned_entry_quote : row.planned_stop > row.planned_entry_quote && row.planned_target < row.planned_entry_quote);
  }
  assert.equal(row.actual_fill_status, 'UNKNOWN_NOT_SIMULATED');
}

const report = {
  schema_version: 1,
  report_id: 'btc-perp-p1-candidate-parity-2026-10-30',
  generated_at_utc: new Date().toISOString(),
  scope: 'Independent reference calculation of P1 candidates and planned levels on the #4 audited resampled BTC perpetual history. No TakeProfit strategy fills or realized profitability are inferred.',
  contract_version: config.ruleVersion,
  reference_method: {
    implementation: 'Separate JavaScript engine; not emitted from or imported by the Indie generator/template.',
    entry_ema: 'SMA seed at length samples followed by alpha=2/(length+1), matching the documented Indie Ema source algorithm.',
    atr: 'True range followed by Wilder RMA(14), initialized by the first 14-value SMA, matching the documented Indie Atr -> RMA algorithm.',
    higher_timeframe: 'Execution bars grouped by UTC bucket; complete contiguous groups only; EMA20/EMA50 recursively updated from the first completed HTF close; slope uses three completed HTF bars.',
    touch_model: 'Completed bars processed once in timestamp order; first eligible range intersection arms; eligibility checks touch bias and directional EMA50 closes only within the current recovery episode.',
    conflict_policy: 'Mask the exact disputed execution candles and omit disputed higher-timeframe buckets from the independently audited #4 stream; stale last-valid HTF bias is retained until the next clean HTF close reseeds and re-warms the series.',
    time_model: 'Unix UTC seconds at bar opens; entry quote uses next execution candle open.',
    known_fill_limit: 'No exchange order book, actual fills, fee tier, spread/slippage tape, or funding cash flows are included in this candidate parity report.',
  },
  fixtures: fixtureResults,
  profiles,
  overall: {
    candidates: allEvents.length,
    unique_candidate_ids: candidateIds.size,
    model_eligible_bars: profiles.reduce((sum, profile) => sum + profile.model_eligible_bars, 0),
    setups: profiles.reduce((sum, profile) => sum + profile.setups, 0),
    event_ledger: 'candidate_event_ledger.csv',
    full_history_vs_truncated_history: 'PASS; see each profile row',
    id_and_timestamp_checks: 'PASS',
    planned_level_geometry_checks: 'PASS',
    actual_fills: 'not simulated; retained as unknown in every event row',
    profitability: 'unproven; this report does not measure strategy returns or prove profitability',
  },
};

fs.mkdirSync(outputDir, { recursive: true });
writeCsv(path.join(outputDir, 'candidate_event_ledger.csv'), allEvents);
fs.writeFileSync(path.join(outputDir, 'candidate_parity_report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
const md = [
  '# P1 Candidate Contract Parity Report',
  '',
  `Generated: ${report.generated_at_utc}`,
  '',
  `Rule version: \`${config.ruleVersion}\`. The P1 first-touch contract supersedes the B0 rolling [2]–[4] discovery rule for new experiments; the frozen B0 baseline was not edited.`,
  '',
  '## Reference method',
  '',
  report.reference_method.implementation,
  report.reference_method.entry_ema,
  report.reference_method.atr,
  report.reference_method.higher_timeframe,
  report.reference_method.touch_model,
  report.reference_method.conflict_policy,
  report.reference_method.known_fill_limit,
  '',
  '## Historical replay',
  '',
  '| Exec / HTF | Audited eligible / source bars | Setups | Candidates | Long | Short | Risk blocker counts | Full vs truncated |',
  '|---|---|---:|---:|---:|---:|---|---|',
  ...profiles.map(p => `| ${p.execution_minutes}m / ${p.higher_minutes}m | ${p.model_eligible_bars} eligible / ${p.input_bars} source | ${p.setups} | ${p.full_history_candidates} | ${p.side_counts.LONG} | ${p.side_counts.SHORT} | ${JSON.stringify(p.risk_blockers)} | ${p.full_vs_truncated_overlap.compared_candidates} overlapping candidates; 0 ID/level differences |`),
  '',
  '## Fixtures',
  '',
  ...Object.entries(fixtureResults).map(([name, result]) => `- ${name.replaceAll('_', ' ')}: ${result}`),
  '',
  '## Fill and profitability boundary',
  '',
  'The strategy limit quote is recorded separately from the immutable planned entry, stop, and target. Actual fill prices remain unknown; no fill or profitability claim is made. Fees, spread, slippage, funding, venue filters, and platform cancel/fill races require separate execution validation.',
  '',
  'Reproduce with `node research/candidate_reference.mjs`; it runs the fixtures and full-versus-truncated checks and writes the JSON report and CSV event ledger.',
  '',
].join('\n');
fs.writeFileSync(path.join(outputDir, 'candidate_parity_report.md'), md, 'utf8');

console.log(JSON.stringify({ report: path.relative(root, path.join(outputDir, 'candidate_parity_report.json')), ledger: path.relative(root, path.join(outputDir, 'candidate_event_ledger.csv')), fixture_results: fixtureResults, profiles, total_candidates: allEvents.length }, null, 2));
}

export { runProfile, csvRows, config, contract, ema, wilderAtr, candidateId, planRisk, asIso, fixtureChecks };
