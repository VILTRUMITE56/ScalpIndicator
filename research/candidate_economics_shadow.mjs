// Event-level, offline economics diagnostic for the unified P1 BTC candidate contract.
// This never submits orders and never treats a planned quote as an observed fill.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { runProfile, csvRows, contract, fixtureChecks } from './candidate_reference.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const derivedDir = path.join(root, 'research/data/btcusdt_2024-10_2026-09/derived');
const reportDir = path.join(root, 'research/reports');
const spec = JSON.parse(fs.readFileSync(path.join(root, 'research/specs/candidate_economics_p1.json'), 'utf8'));
const coverage = JSON.parse(fs.readFileSync(path.join(root, 'research/reports/btc_history_coverage.json'), 'utf8'));
assert.equal(spec.cost_sensitivities.round_trip_basis_points.length, spec.cost_sensitivities.fractions.length, 'each cost sensitivity has one declared fraction');
const costCases = spec.cost_sensitivities.round_trip_basis_points.map((bps, index) => {
  const fraction = spec.cost_sensitivities.fractions[index];
  assert.equal(fraction, bps / 10_000, `declared ${bps} bp fraction matches its basis-point value`);
  return { bps, fraction };
});

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function normalizedSha256(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function parseCsvLine(line) {
  const values = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') { value += '"'; i++; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) {
      values.push(value); value = '';
    } else value += char;
  }
  values.push(value);
  return values;
}

function readCsv(file) {
  const lines = fs.readFileSync(file, 'utf8').trimEnd().split(/\r?\n/);
  const header = parseCsvLine(lines[0]);
  return lines.slice(1).map(line => Object.fromEntries(parseCsvLine(line).map((v, i) => [header[i], v])));
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'number' ? (Number.isFinite(value) ? String(Number(value.toPrecision(12))) : '') : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function writeCsv(file, rows) {
  if (rows.length === 0) throw new Error(`Refusing to write empty CSV: ${file}`);
  const fields = Object.keys(rows[0]);
  fs.writeFileSync(file, [fields.join(','), ...rows.map(row => fields.map(field => csvEscape(row[field])).join(','))].join('\n') + '\n', 'utf8');
}

function quantile(sorted, q) {
  if (sorted.length === 0) return null;
  const index = (sorted.length - 1) * q;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function summarize(values) {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (finite.length === 0) return { count: 0, p10: null, p50: null, p90: null, mean: null };
  return {
    count: finite.length,
    p10: quantile(finite, 0.1),
    p50: quantile(finite, 0.5),
    p90: quantile(finite, 0.9),
    mean: finite.reduce((sum, value) => sum + value, 0) / finite.length,
  };
}

function monthOf(iso) { return iso.slice(0, 7); }
function dayOf(iso) { return iso.slice(0, 10); }
function iso(ms) { return new Date(ms).toISOString(); }

function lowerBound(bars, timeMs) {
  let left = 0; let right = bars.length;
  while (left < right) {
    const middle = (left + right) >>> 1;
    if (bars[middle].timeMs < timeMs) left = middle + 1;
    else right = middle;
  }
  return left;
}

class BarrierIndex {
  constructor(bars) {
    this.count = bars.length;
    this.size = 1;
    while (this.size < bars.length) this.size <<= 1;
    this.minLow = new Float64Array(this.size * 2);
    this.maxHigh = new Float64Array(this.size * 2);
    this.minLow.fill(Number.POSITIVE_INFINITY);
    this.maxHigh.fill(Number.NEGATIVE_INFINITY);
    for (let i = 0; i < bars.length; i++) {
      this.minLow[this.size + i] = bars[i].low;
      this.maxHigh[this.size + i] = bars[i].high;
    }
    for (let i = this.size - 1; i > 0; i--) {
      this.minLow[i] = Math.min(this.minLow[i * 2], this.minLow[i * 2 + 1]);
      this.maxHigh[i] = Math.max(this.maxHigh[i * 2], this.maxHigh[i * 2 + 1]);
    }
  }

  firstCrossing(start, lowThreshold, highThreshold) {
    const visit = (node, left, right) => {
      if (right <= start || left >= this.count) return -1;
      if (this.minLow[node] > lowThreshold && this.maxHigh[node] < highThreshold) return -1;
      if (right - left === 1) return left < this.count ? left : -1;
      const middle = (left + right) >>> 1;
      const earlier = visit(node * 2, left, middle);
      return earlier >= 0 ? earlier : visit(node * 2 + 1, middle, right);
    };
    return visit(1, 0, this.size);
  }

  range(start, endExclusive) {
    let left = start + this.size;
    let right = endExclusive + this.size;
    let minimum = Number.POSITIVE_INFINITY;
    let maximum = Number.NEGATIVE_INFINITY;
    while (left < right) {
      if (left & 1) { minimum = Math.min(minimum, this.minLow[left]); maximum = Math.max(maximum, this.maxHigh[left]); left++; }
      if (right & 1) { right--; minimum = Math.min(minimum, this.minLow[right]); maximum = Math.max(maximum, this.maxHigh[right]); }
      left >>= 1; right >>= 1;
    }
    return { minimum, maximum };
  }
}

function validateBarrierIndex(bars, index, events, label) {
  const sampleCount = Math.min(128, events.length);
  const stride = Math.max(1, Math.floor(events.length / sampleCount));
  const samples = events.filter((_, i) => i % stride === 0).slice(0, sampleCount);
  for (const event of samples) {
    const start = lowerBound(bars, Date.parse(event.decision_time_utc));
    const stop = Number(event.planned_stop);
    const target = Number(event.planned_target);
    const lowThreshold = event.side === 'LONG' ? stop : target;
    const highThreshold = event.side === 'LONG' ? target : stop;
    let linearFirstCrossing = -1;
    for (let i = start; i < bars.length; i++) {
      if (bars[i].low <= lowThreshold || bars[i].high >= highThreshold) {
        linearFirstCrossing = i;
        break;
      }
    }
    assert.equal(index.firstCrossing(start, lowThreshold, highThreshold), linearFirstCrossing, `${label} barrier index matches linear scan for ${event.candidate_id}`);
  }
  return { status: 'PASS', method: 'segment-tree result compared with linear OHLC scan', sample_count: samples.length };
}

function simulatePath(event, bars, index) {
  const entry = Number(event.planned_entry_quote);
  const stop = Number(event.planned_stop);
  const target = Number(event.planned_target);
  const distance = Number(event.planned_stop_distance);
  const side = event.side;
  if (![entry, stop, target, distance].every(Number.isFinite) || !(entry > 0) || !(distance > 0)) {
    return { outcome: 'UNMODELED_INVALID_PLAN', exit_price: null, gross_R_bound: null, mark_to_market_R: null, mfe_R_ohlc_bound: null, mae_R_ohlc_bound: null, holding_minutes_min: null, holding_minutes_max: null, entry_open_delta: null, hit_time_utc: '' };
  }
  const decisionMs = Date.parse(event.decision_time_utc);
  const start = lowerBound(bars, decisionMs);
  if (start >= bars.length || bars[start].timeMs !== decisionMs) {
    return { outcome: 'UNMODELED_NO_ALIGNED_1M_BAR', exit_price: null, gross_R_bound: null, mark_to_market_R: null, mfe_R_ohlc_bound: null, mae_R_ohlc_bound: null, holding_minutes_min: null, holding_minutes_max: null, entry_open_delta: null, hit_time_utc: '' };
  }
  const direction = side === 'LONG' ? 1 : -1;
  const lowThreshold = side === 'LONG' ? stop : target;
  const highThreshold = side === 'LONG' ? target : stop;
  const hit = index.firstCrossing(start, lowThreshold, highThreshold);
  const end = hit >= 0 ? hit : bars.length - 1;
  const eventBar = hit >= 0 ? bars[hit] : null;
  let outcome = 'CENSORED_AT_DATA_END';
  let exitPrice = null;
  let hitTime = '';
  let rangeEndExclusive = end + 1;
  let gapAtOpen = false;
  if (eventBar) {
    const gapStop = side === 'LONG' ? eventBar.open < stop : eventBar.open > stop;
    const gapTarget = side === 'LONG' ? eventBar.open > target : eventBar.open < target;
    const stopTouched = side === 'LONG' ? eventBar.low <= stop : eventBar.high >= stop;
    const targetTouched = side === 'LONG' ? eventBar.high >= target : eventBar.low <= target;
    if (gapStop) { outcome = 'GAP_STOP'; exitPrice = eventBar.open; gapAtOpen = true; }
    else if (gapTarget) { outcome = 'TARGET_GAP_PRICE_IMPROVEMENT'; exitPrice = eventBar.open; gapAtOpen = true; }
    else if (stopTouched && targetTouched) { outcome = 'AMBIGUOUS_STOP_FIRST_BOUND'; exitPrice = stop; }
    else if (targetTouched) { outcome = 'TARGET'; exitPrice = target; }
    else if (stopTouched) { outcome = 'STOP'; exitPrice = stop; }
    else throw new Error(`Barrier index returned a non-crossing bar for ${event.candidate_id}`);
    hitTime = iso(eventBar.timeMs);
    if (gapAtOpen) rangeEndExclusive = hit;
  }

  let minimum; let maximum;
  if (rangeEndExclusive > start) {
    ({ minimum, maximum } = index.range(start, rangeEndExclusive));
  } else {
    minimum = Number.POSITIVE_INFINITY;
    maximum = Number.NEGATIVE_INFINITY;
  }
  if (gapAtOpen) {
    minimum = Math.min(minimum, eventBar.open);
    maximum = Math.max(maximum, eventBar.open);
  }
  if (!Number.isFinite(minimum)) minimum = entry;
  if (!Number.isFinite(maximum)) maximum = entry;
  const mfe = side === 'LONG' ? Math.max(0, maximum - entry) / distance : Math.max(0, entry - minimum) / distance;
  const mae = side === 'LONG' ? Math.max(0, entry - minimum) / distance : Math.max(0, maximum - entry) / distance;
  const finalClose = bars[end].close;
  const grossR = exitPrice === null ? null : direction * (exitPrice - entry) / distance;
  const mtmR = direction * (finalClose - entry) / distance;
  const firstMinuteOpenDelta = bars[start].open - entry;
  const lowerHold = Math.max(0, (bars[end].timeMs - decisionMs) / 60_000);
  const upperHold = hit >= 0 ? lowerHold + 1 : lowerHold + 1;
  return {
    outcome,
    exit_price: exitPrice,
    gross_R_bound: grossR,
    mark_to_market_R: exitPrice === null ? mtmR : null,
    mfe_R_ohlc_bound: mfe,
    mae_R_ohlc_bound: mae,
    holding_minutes_min: lowerHold,
    holding_minutes_max: upperHold,
    entry_open_delta: firstMinuteOpenDelta,
    hit_time_utc: hitTime,
  };
}

function ensureGroup(map, profile, side, month, bucket) {
  const key = [profile, side, month, bucket].join('|');
  if (!map.has(key)) {
    const scenarios = Object.fromEntries(costCases.map(({ bps }) => [bps, {
      stopPass: 0, costPass: 0, combinedPass: 0, assumedQuotePaths: 0,
      outcomeCounts: {}, gateOffNetR: [], gateOnNetR: [], costRValues: [],
    }]));
    map.set(key, {
      profile, side, utc_month: month, volatility_bucket: bucket,
      eligible_bars: 0, eligible_hours: 0, eligibleDays: new Set(), setup_count: 0,
      setup_triggered: 0, setup_expired: 0, setup_invalidated: 0, setup_bias_reset: 0, setup_context_reset: 0, setup_data_end_open: 0,
      trigger_count: 0, scenarios,
    });
  }
  return map.get(key);
}

function bucketFor(value, thresholds) {
  if (value <= thresholds.p33) return 'LOW';
  if (value <= thresholds.p67) return 'MID';
  return 'HIGH';
}

function currentRiskPasses(event, fraction) {
  const entry = Number(event.planned_entry_quote);
  const distance = Number(event.planned_stop_distance);
  const atr = Number(event.setup_atr);
  const stopAtr = distance / atr;
  const costR = fraction * entry / distance;
  return { stopAtr, costR, stopPass: stopAtr <= 2.5 + 1e-12, costPass: costR <= 0.2 + 1e-12 };
}

function compileGroupRows(groups, profileMinutes) {
  return [...groups.values()].sort((a, b) => a.profile.localeCompare(b.profile) || a.utc_month.localeCompare(b.utc_month) || a.side.localeCompare(b.side) || a.volatility_bucket.localeCompare(b.volatility_bucket)).map(group => {
    const row = {
      profile: group.profile, side: group.side, utc_month: group.utc_month,
      volatility_bucket: group.volatility_bucket, eligible_bars: group.eligible_bars,
      eligible_hours: group.eligible_hours, eligible_days: group.eligibleDays.size,
      setup_count: group.setup_count, setup_triggered: group.setup_triggered,
      setup_expired: group.setup_expired, setup_invalidated: group.setup_invalidated,
      setup_bias_reset: group.setup_bias_reset, setup_context_reset: group.setup_context_reset, setup_data_end_open: group.setup_data_end_open,
      trigger_count: group.trigger_count,
    };
    for (const { bps } of costCases) {
      const m = group.scenarios[bps];
      const closedGateOff = m.gateOffNetR;
      const closedGateOn = m.gateOnNetR;
      row[`stop_gate_pass_${bps}bp`] = m.stopPass;
      row[`cost_r_gate_pass_${bps}bp`] = m.costPass;
      row[`combined_gate_pass_${bps}bp`] = m.combinedPass;
      row[`shadow_order_candidates_${bps}bp`] = m.combinedPass;
      row[`assumed_quote_path_count_${bps}bp`] = m.assumedQuotePaths;
      row[`gate_off_net_R_sum_${bps}bp`] = closedGateOff.reduce((sum, x) => sum + x, 0);
      row[`gate_off_closed_n_${bps}bp`] = closedGateOff.length;
      row[`gate_off_net_R_per_closed_${bps}bp`] = closedGateOff.length ? row[`gate_off_net_R_sum_${bps}bp`] / closedGateOff.length : null;
      row[`gate_on_net_R_sum_${bps}bp`] = closedGateOn.reduce((sum, x) => sum + x, 0);
      row[`gate_on_closed_n_${bps}bp`] = closedGateOn.length;
      row[`gate_on_net_R_per_closed_${bps}bp`] = closedGateOn.length ? row[`gate_on_net_R_sum_${bps}bp`] / closedGateOn.length : null;
      row[`gate_on_net_R_per_eligible_day_${bps}bp`] = group.eligibleDays.size ? row[`gate_on_net_R_sum_${bps}bp`] / group.eligibleDays.size : null;
      row[`actual_order_count_${bps}bp`] = 'NOT_OBSERVED';
      row[`actual_fill_count_${bps}bp`] = 'UNKNOWN';
    }
    row.eligible_hours = Number(row.eligible_hours.toFixed(6));
    return row;
  });
}

function buildMarkdown(report) {
  const lines = [
    '# BTC P1 pre-cost candidate and cost/ATR feasibility report', '',
    `Generated: ${report.generated_at_utc}`, '',
    `Research event stream: \`${report.candidate_contract}\`; frozen B0 source remains unchanged. Window: ${report.window.start_utc} through ${report.window.end_utc_exclusive} (UTC).`, '',
    '## Scope and decision', '',
    report.decision, '',
    'This is an independent shadow study, not an exchange backtest. Each signal is evaluated separately at its planned next-execution-bar open. The study assumes that quote filled only to measure barrier order and cost sensitivity. Actual order/fill counts remain unavailable, outcomes are not portfolio results, and the inspected history is not an untouched holdout.', '',
    'Keep the 15 bp cost assumption, 0.20R cost cap, 2.5 ATR stop cap and 1.5R target frozen. The data do not justify loosening a gate or selecting a new configuration. The 10/15/20 bp values are predeclared sensitivities from the execution-cost record; this study consumes no new signal configurations.',
    `Cost interpretation: ${report.costs.scenario_labels['10']} ${report.costs.scenario_labels['15']} ${report.costs.scenario_labels['20']} [Binance public USD-M fee table](${report.costs.public_fee_reference.url}), checked ${report.costs.public_fee_reference.checked_utc_date}. The user's account rate and historical spread/slippage remain unknown.`, '',
    '## Candidate funnel', '',
    '| Profile | Scored bars | Directional setups | Triggers | 15 bp gate disposition | 10 bp pass | 15 bp pass | 20 bp pass |',
    '|---|---:|---:|---:|---|---:|---:|---:|',
    ...report.profiles.map(p => `| ${p.profile} | ${p.model_scored_bars} | ${p.setups} | ${p.triggers} | ${JSON.stringify(p.baseline_blockers)} | ${p.cost_frontier['10'].combined_pass} (${p.cost_frontier['10'].pass_pct.toFixed(2)}%) | ${p.cost_frontier['15'].combined_pass} (${p.cost_frontier['15'].pass_pct.toFixed(2)}%) | ${p.cost_frontier['20'].combined_pass} (${p.cost_frontier['20'].pass_pct.toFixed(2)}%) |`),
    '',
    `All profiles: ${report.overall.triggers} triggers, ${report.overall.directional_setups} armed touches and ${report.overall.eligible_scored_bars} model-scored bars. The funnel CSV records profile, side, UTC month and ATR-tertile counts for each stage; cost-gated shadow-order candidates and assumed quote-path counts are separate fields. Observed orders are \`NOT_OBSERVED\`; observed fills are \`UNKNOWN\`.`, '',
    '## Cost/ATR feasibility frontier', '',
    '| Round-trip sensitivity | Required ATR/price at 2.5 ATR stop | Combined gate pass | Share of all triggers | Candidate cost/R p50 |',
    '|---:|---:|---:|---:|---:|',
    ...report.cost_frontier_overall.map(row => `| ${row.bps} bp | ${row.required_atr_pct_at_stop_cap.toFixed(3)}% | ${row.combined_pass}/${row.triggers} | ${row.pass_pct.toFixed(2)}% | ${row.median_cost_R_at_named_case === null ? 'n/a' : row.median_cost_R_at_named_case.toFixed(3)} |`),
    '',
    'The pass counts require both planned stop distance <= 2.5 x touch ATR and scenario cost/R <= 0.20. A candidate can fail both; blocker columns in the frontier CSV are therefore not mutually exclusive. The gate-off performance rows are diagnostics for understanding rejected candidates and are not an executable strategy.', '',
    '## Risk geometry and cost burden', '',
    '| Profile | Stop % p50 / p90 | Touch ATR/price % p50 / p90 | Trigger ATR/price % p50 / p90 | 15 bp cost/R p50 / p90 |',
    '|---|---:|---:|---:|---:|',
    ...report.profiles.map(p => `| ${p.profile} | ${p.measures.stop_pct.p50.toFixed(3)} / ${p.measures.stop_pct.p90.toFixed(3)} | ${p.measures.touch_ATR_pct.p50.toFixed(3)} / ${p.measures.touch_ATR_pct.p90.toFixed(3)} | ${p.measures.trigger_ATR_pct.p50.toFixed(3)} / ${p.measures.trigger_ATR_pct.p90.toFixed(3)} | ${p.measures.cost_R_15bp.p50.toFixed(3)} / ${p.measures.cost_R_15bp.p90.toFixed(3)} |`),
    '',
    '## Conditional shadow outcomes', '',
    '| Profile / side | Case | Gate candidates | Target | Stop | Gap stop | Ambiguous bound | Open at end | Net R/trade | Net R/day | MFE p50/p90 | MAE p50/p90 | Hold p50/p90 (min) |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
    ...report.outcome_summary.map(row => `| ${row.profile} / ${row.side} | ${row.bps} bp | ${row.gate_candidates} | ${row.target} | ${row.stop} | ${row.gap_stop} | ${row.ambiguous} | ${row.censored} | ${row.net_R_per_closed_trade === null ? 'n/a' : row.net_R_per_closed_trade.toFixed(3)} | ${row.net_R_per_eligible_day === null ? 'n/a' : row.net_R_per_eligible_day.toFixed(3)} | ${row.MFE_R_OHLC_p50 === null ? 'n/a' : `${row.MFE_R_OHLC_p50.toFixed(2)}/${row.MFE_R_OHLC_p90.toFixed(2)}`} | ${row.MAE_R_OHLC_p50 === null ? 'n/a' : `${row.MAE_R_OHLC_p50.toFixed(2)}/${row.MAE_R_OHLC_p90.toFixed(2)}`} | ${row.holding_minutes_p50 === null ? 'n/a' : `${row.holding_minutes_p50.toFixed(1)}/${row.holding_minutes_p90.toFixed(1)}`} |`),
    '',
    'Net R charges the full named round-trip sensitivity once using average entry/exit notional. The 10 bp row is a public-rate commission reference, not an all-in cost; 15/20 bp assume additional execution drag without historical spread/slippage measurements. All cases exclude funding and liquidation and do not model actual execution behavior. Ambiguous 1m candles remain labeled ambiguous; net-R aggregates use the separately reported conservative stop-first bound. Censored positions have mark-to-market values in the event ledger but are excluded from closed-trade averages.', '',
    '## Measurement definitions and provenance', '',
    '- Bar = P1 reference bar after feature/HTF warmup, tagged by completed HTF direction or neutral. Eligible hours sum bar intervals by side; UTC months and profile-specific ATR/close tertiles are retained.',
    '- Setup = an eligible first-touch state armed by P1. Every armed setup has one terminal reason or an explicit data-end-open disposition. Trigger = immutable P1 candidate event.',
    '- Shadow order candidate = trigger satisfying both existing stop and cost/R gates. The assumed quote-path count evaluates barriers at the planned quote only; it is not an observed fill. Actual order counts are `NOT_OBSERVED`; actual fill counts are `UNKNOWN`, never zero.',
    '- Volatility bucket cuts use all model-scored bars per profile and stay fixed across the months. Each stage is attributed to its event time and stage-specific ATR: bar-close ATR for eligible bars, touch ATR for setups, and trigger ATR for triggers/orders.',
    '- Trade-price 1m OHLC is the primary barrier path; mark-price 1m is a separate trigger-price sensitivity. If one 1m candle touches both barriers, retain ambiguity and report the stop-first bound. Intra-minute execution order is unknown.',
    `- Candidate IDs match the #4-audited P1 event ledger: ${report.candidate_parity.candidate_id_matches}/${report.candidate_parity.existing_ledger_rows}; blocker recalculation mismatches: ${report.candidate_parity.mismatched_risk_blockers}; B0 source hashes unchanged: ${report.frozen_b0.hashes_unchanged}.`,
    `- Model-scored bars equal the #4 coverage counts by profile; the event engine masks all documented execution conflicts and reseeds after disputed HTF buckets.`,
    `- Barrier search validation: ${report.barrier_index_validation.trade_1m.status}, ${report.barrier_index_validation.trade_1m.sample_count} trade 1m candidates and ${report.barrier_index_validation.mark_1m.sample_count} mark 1m candidates matched a direct linear scan.`,
    `- No funding is applied: it is a separate signed cashflow and the user target/funding treatment is unresolved. Binance's public regular-user fee table shows 2 bp maker / 5 bp taker per side for USD-M Futures at the checked date; this is only a reference, not the user's rate. Historical spread, slippage, venue filters and observed fills are unavailable.`,
    '',
    '## Reproduce', '',
    '```powershell',
    'node research/candidate_reference.mjs',
    'node research/candidate_economics_shadow.mjs',
    'node research/build_candidate_economics_manifest.mjs',
    '```', '',
    `Source/data hashes and output hashes are recorded in \`CANDIDATE_ECONOMICS_MANIFEST.json\`. Candidate contract: \`${report.candidate_contract}\`; baseline ID: \`${report.frozen_b0.baseline_id}\`.`, '',
  ];
  return lines.join('\n');
}

const existingLedger = readCsv(path.join(reportDir, 'candidate_event_ledger.csv'));
const candidateFixtures = fixtureChecks();
const profiles = [];
const allEvents = [];
const allSetups = [];
const allEligibleBars = [];
const preRollParity = {};
const disputedBars = coverage.resampling.native_reference_disputes_masked_from_scoring;
for (const profile of contract.profiles) {
  const minutes = profile.execution_minutes;
  const timeframe = `${minutes}m`;
  const fileName = minutes === 5 ? 'trade_5m_resampled.csv' : 'trade_15m_resampled.csv';
  const bars = csvRows(path.join(derivedDir, fileName));
  const executionConflicts = new Set((disputedBars[`${minutes}m`] ?? []).map(row => Date.parse(row.open_time_utc)));
  const htfKey = profile.higher_minutes === 60 ? '1h' : `${profile.higher_minutes}m`;
  const excludedHtfBuckets = new Set((disputedBars[htfKey] ?? []).map(row => Date.parse(row.open_time_utc)));
  const run = runProfile(bars, profile, { excludedExecutionTimes: executionConflicts, excludedHtfBuckets });
  const profileEvents = run.events.map(row => ({ ...row, execution_timeframe: timeframe }));
  const profileSetups = run.setups.map(row => ({ ...row, profile: timeframe }));
  const profileBars = run.eligibleBars.map(row => ({ ...row, profile: timeframe }));
  const ids = new Set(existingLedger.filter(row => row.execution_timeframe === timeframe).map(row => row.candidate_id));
  assert.equal(ids.size, profileEvents.length, `P1 candidate count matches existing ledger for ${timeframe}`);
  for (const row of profileEvents) assert.ok(ids.has(row.candidate_id), `P1 candidate ID matches existing ledger: ${row.candidate_id}`);
  preRollParity[timeframe] = { regenerated: profileEvents.length, existing_ledger_rows: ids.size, candidate_id_matches: ids.size };
  profiles.push({ profile: timeframe, higher_minutes: profile.higher_minutes, minutes, bars, events: profileEvents, setups: profileSetups, eligibleBars: profileBars, source_file: fileName, source_sha256: sha256(path.join(derivedDir, fileName)) });
  for (const row of profileEvents) allEvents.push(row);
  for (const row of profileSetups) allSetups.push(row);
  for (const row of profileBars) allEligibleBars.push(row);
}
assert.equal(allEvents.length, existingLedger.length, 'all regenerated events match the complete existing P1 ledger');
const candidateIds = new Set(allEvents.map(row => row.candidate_id));
assert.equal(candidateIds.size, allEvents.length, 'candidate IDs are unique across both profiles');

const atrByProfile = new Map();
for (const profile of profiles) {
  const values = profile.eligibleBars.map(row => row.atrPct).filter(Number.isFinite).sort((a, b) => a - b);
  atrByProfile.set(profile.profile, { p33: quantile(values, 1 / 3), p67: quantile(values, 2 / 3), count: values.length, min: values[0], max: values.at(-1) });
}
function volatilityBucket(profile, atrPct) {
  const cuts = atrByProfile.get(profile);
  return bucketFor(atrPct, cuts);
}

const tradeBars = csvRows(path.join(derivedDir, 'trade_1m.csv'));
const markBars = csvRows(path.join(derivedDir, 'mark_1m.csv'));
for (const stream of [tradeBars, markBars]) {
  for (let i = 1; i < stream.length; i++) assert.equal(stream[i].timeMs - stream[i - 1].timeMs, 60_000, '1m replay input is strictly aligned with no gaps');
}
const tradeIndex = new BarrierIndex(tradeBars);
const markIndex = new BarrierIndex(markBars);
const barrierIndexValidation = {
  trade_1m: validateBarrierIndex(tradeBars, tradeIndex, allEvents, 'trade 1m'),
  mark_1m: validateBarrierIndex(markBars, markIndex, allEvents, 'mark 1m'),
};
const groups = new Map();
const frontierGroups = new Map();
const outcomeRows = [];
const shutdownNotes = [];

for (const bar of allEligibleBars) {
  const month = monthOf(iso(bar.timeMs));
  const day = dayOf(iso(bar.timeMs));
  const bucket = volatilityBucket(bar.profile, bar.atrPct);
  const group = ensureGroup(groups, bar.profile, bar.side, month, bucket);
  group.eligible_bars++;
  group.eligible_hours += profiles.find(p => p.profile === bar.profile).minutes / 60;
  group.eligibleDays.add(day);
}

const setupById = new Map(allSetups.map(row => [row.setup_id, row]));
for (const setup of allSetups) {
  const group = ensureGroup(groups, setup.profile, setup.side, monthOf(setup.touch_time_utc), volatilityBucket(setup.profile, setup.touch_atr_pct));
  group.setup_count++;
  const outcomeKey = setup.outcome;
  if (outcomeKey === 'TRIGGERED') group.setup_triggered++;
  else if (outcomeKey === 'EXPIRED') group.setup_expired++;
  else if (outcomeKey === 'STRUCTURAL_INVALIDATION' || outcomeKey === 'CLOSE_THROUGH_EMA50') group.setup_invalidated++;
  else if (outcomeKey === 'BIAS_LOSS') group.setup_bias_reset++;
  else if (outcomeKey === 'DATA_GAP' || outcomeKey === 'INCOMPLETE_HTF' || outcomeKey === 'HTF_SOURCE_CONFLICT') group.setup_context_reset++;
  else if (outcomeKey === 'DATA_END_OPEN') group.setup_data_end_open++;
  else shutdownNotes.push({ setup_id: setup.setup_id, unexpected_setup_outcome: outcomeKey });
}
assert.equal(shutdownNotes.length, 0, 'all armed setups have a declared terminal disposition');
assert.equal(allSetups.filter(row => row.outcome === 'TRIGGERED').length, allEvents.length, 'every candidate trigger resolves one armed setup');
for (const event of allEvents) assert.ok(setupById.has(event.setup_id), `trigger references setup: ${event.candidate_id}`);

const sourceMismatch = [];
const frontierLookup = new Map();
const shadowLedgerRows = [];

for (const event of allEvents) {
  const profile = event.execution_timeframe;
  const month = monthOf(event.trigger_time_utc);
  const bucket = volatilityBucket(profile, event.trigger_atr_pct);
  const group = ensureGroup(groups, profile, event.side, month, bucket);
  group.trigger_count++;
  const tradePath = simulatePath(event, tradeBars, tradeIndex);
  const markPath = simulatePath(event, markBars, markIndex);
  const baseline = currentRiskPasses(event, 0.0015);
  const expectedRiskBlocker = !baseline.stopPass ? 'STOP > 2.5 ATR' : !baseline.costPass ? 'COST > 0.2R' : 'NONE';
  if (event.risk_blocker !== expectedRiskBlocker) sourceMismatch.push({ candidate_id: event.candidate_id, stored: event.risk_blocker, expected: expectedRiskBlocker });
  const stopAtr = Number(event.planned_stop_distance) / Number(event.setup_atr);
  const entry = Number(event.planned_entry_quote);
  const distance = Number(event.planned_stop_distance);
  const stopPct = distance / entry * 100;
  const triggerAtrPct = Number(event.trigger_atr_pct);
  const touchAtrPct = Number(event.touch_atr_pct);
  const entryOpenDelta = tradePath.entry_open_delta;

  const ledgerRow = {
    candidate_id: event.candidate_id,
    setup_id: event.setup_id,
    profile,
    side: event.side,
    touch_time_utc: event.touch_time_utc,
    trigger_time_utc: event.trigger_time_utc,
    decision_time_utc: event.decision_time_utc,
    utc_month: month,
    volatility_bucket: bucket,
    planned_entry_quote: entry,
    planned_stop: Number(event.planned_stop),
    planned_target: Number(event.planned_target),
    stop_distance: distance,
    stop_pct: stopPct,
    stop_distance_atr: stopAtr,
    touch_atr_pct: touchAtrPct,
    trigger_atr_pct: triggerAtrPct,
    risk_blocker_15bp: event.risk_blocker,
    trade_1m_outcome: tradePath.outcome,
    trade_1m_exit_price: tradePath.exit_price,
    trade_1m_gross_R_bound: tradePath.gross_R_bound,
    trade_1m_mark_to_market_R_if_censored: tradePath.mark_to_market_R,
    trade_1m_MFE_R_OHLC_bound: tradePath.mfe_R_ohlc_bound,
    trade_1m_MAE_R_OHLC_bound: tradePath.mae_R_ohlc_bound,
    trade_1m_holding_minutes_min: tradePath.holding_minutes_min,
    trade_1m_holding_minutes_max: tradePath.holding_minutes_max,
    trade_1m_barrier_time_utc: tradePath.hit_time_utc,
    mark_1m_outcome_sensitivity: markPath.outcome,
    mark_1m_gross_R_bound_sensitivity: markPath.gross_R_bound,
    mark_1m_mark_to_market_R_if_censored: markPath.mark_to_market_R,
    first_1m_trade_open_minus_plan: entryOpenDelta,
    actual_order_observation: 'NOT_OBSERVED',
    actual_fill_status: 'UNKNOWN',
  };
  for (const { bps, fraction } of costCases) {
    const gate = currentRiskPasses(event, fraction);
    const closed = tradePath.gross_R_bound !== null;
    const roundTripQuoteCost = closed ? fraction * (entry + tradePath.exit_price) / 2 : null;
    const netR = closed ? tradePath.gross_R_bound - roundTripQuoteCost / distance : null;
    const censoredMtmNetR = !closed && tradePath.mark_to_market_R !== null
      ? tradePath.mark_to_market_R - fraction * (entry + tradeBars.at(-1).close) / 2 / distance
      : null;
    ledgerRow[`cost_R_${bps}bp_at_entry`] = fraction * entry / distance;
    ledgerRow[`stop_gate_pass_${bps}bp`] = gate.stopPass;
    ledgerRow[`cost_gate_pass_${bps}bp`] = gate.costPass;
    ledgerRow[`combined_gate_pass_${bps}bp`] = gate.stopPass && gate.costPass;
    ledgerRow[`shadow_order_candidate_${bps}bp`] = gate.stopPass && gate.costPass;
    ledgerRow[`assumed_quote_path_evaluated_${bps}bp`] = gate.stopPass && gate.costPass;
    ledgerRow[`gate_off_net_R_${bps}bp`] = netR;
    ledgerRow[`gate_on_net_R_${bps}bp`] = gate.stopPass && gate.costPass ? netR : null;
    ledgerRow[`gate_off_censored_MTM_net_R_${bps}bp`] = censoredMtmNetR;
    const scenario = group.scenarios[bps];
    scenario.stopPass += gate.stopPass ? 1 : 0;
    scenario.costPass += gate.costPass ? 1 : 0;
    scenario.costRValues.push(gate.costR);
    if (gate.stopPass && gate.costPass) {
      scenario.combinedPass++;
      scenario.assumedQuotePaths++;
    }
    const outcomeKey = tradePath.outcome;
    scenario.outcomeCounts[outcomeKey] = (scenario.outcomeCounts[outcomeKey] ?? 0) + (gate.stopPass && gate.costPass ? 1 : 0);
    if (netR !== null) scenario.gateOffNetR.push(netR);
    if (gate.stopPass && gate.costPass && netR !== null) scenario.gateOnNetR.push(netR);

    const fkey = [profile, event.side, month, bucket, bps].join('|');
    if (!frontierLookup.has(fkey)) frontierLookup.set(fkey, { profile, side: event.side, utc_month: month, volatility_bucket: bucket, bps, candidates: 0, stop_gate_pass: 0, cost_r_gate_pass: 0, combined_gate_pass: 0, costRValues: [], stopAtrValues: [], touchAtrPctValues: [] });
    const frontier = frontierLookup.get(fkey);
    frontier.candidates++;
    frontier.stop_gate_pass += gate.stopPass ? 1 : 0;
    frontier.cost_r_gate_pass += gate.costPass ? 1 : 0;
    frontier.combined_gate_pass += gate.stopPass && gate.costPass ? 1 : 0;
    frontier.costRValues.push(gate.costR);
    frontier.stopAtrValues.push(stopAtr);
    frontier.touchAtrPctValues.push(touchAtrPct);
  }
  outcomeRows.push({ ...event, tradePath, markPath, stopPct, stopAtr, touchAtrPct, triggerAtrPct, bucket, month });
  shadowLedgerRows.push(ledgerRow);
}
assert.equal(sourceMismatch.length, 0, `current 15bp risk blockers match the shared candidate contract (${sourceMismatch.length} mismatches)`);

const eligibleProfileDates = new Map();
for (const row of allEligibleBars) {
  const key = `${row.profile}|${row.side}`;
  if (!eligibleProfileDates.has(key)) eligibleProfileDates.set(key, new Set());
  eligibleProfileDates.get(key).add(dayOf(iso(row.timeMs)));
}

const outcomeSummary = [];
for (const profile of profiles) {
  for (const side of ['LONG', 'SHORT']) {
    const matching = outcomeRows.filter(row => row.execution_timeframe === profile.profile && row.side === side);
    const eligibleDays = eligibleProfileDates.get(`${profile.profile}|${side}`)?.size ?? 0;
    for (const { bps } of costCases) {
      const gated = matching.filter(row => {
        const pass = currentRiskPasses(row, bps / 10_000);
        return pass.stopPass && pass.costPass;
      });
      const outcomes = gated.map(row => row.tradePath.outcome);
      const closed = gated.filter(row => row.tradePath.gross_R_bound !== null);
      const netValues = closed.map(row => {
        const entry = Number(row.planned_entry_quote);
        const exit = row.tradePath.exit_price;
        const distance = Number(row.planned_stop_distance);
        return row.tradePath.gross_R_bound - (bps / 10_000) * (entry + exit) / 2 / distance;
      });
      const mfe = gated.map(row => row.tradePath.mfe_R_ohlc_bound).filter(Number.isFinite);
      const mae = gated.map(row => row.tradePath.mae_R_ohlc_bound).filter(Number.isFinite);
      const hold = gated.filter(row => Number.isFinite(row.tradePath.holding_minutes_min)).map(row => (row.tradePath.holding_minutes_min + row.tradePath.holding_minutes_max) / 2);
      const count = value => outcomes.filter(x => x === value).length;
      outcomeSummary.push({
        profile: profile.profile, side, bps, candidate_count: matching.length, gate_candidates: gated.length,
        target: count('TARGET') + count('TARGET_GAP_PRICE_IMPROVEMENT'), stop: count('STOP'), gap_stop: count('GAP_STOP'),
        ambiguous: count('AMBIGUOUS_STOP_FIRST_BOUND'), censored: count('CENSORED_AT_DATA_END'),
        net_R_sum: netValues.reduce((sum, x) => sum + x, 0),
        net_R_per_closed_trade: netValues.length ? netValues.reduce((sum, x) => sum + x, 0) / netValues.length : null,
        net_R_per_eligible_day: eligibleDays ? netValues.reduce((sum, x) => sum + x, 0) / eligibleDays : null,
        closed_count: closed.length, eligible_days: eligibleDays,
        MFE_R_OHLC_p50: summarize(mfe).p50, MFE_R_OHLC_p90: summarize(mfe).p90,
        MAE_R_OHLC_p50: summarize(mae).p50, MAE_R_OHLC_p90: summarize(mae).p90,
        holding_minutes_p50: summarize(hold).p50, holding_minutes_p90: summarize(hold).p90,
        actual_order_count: 'NOT_OBSERVED', actual_fill_count: 'UNKNOWN',
      });
    }
  }
}

const costFrontierOverall = [];
for (const { bps, fraction } of costCases) {
  const rows = outcomeRows;
  const perProfile = profiles.map(profile => {
    const matching = rows.filter(row => row.execution_timeframe === profile.profile);
    const stopPass = matching.filter(row => Number(row.planned_stop_distance) / Number(row.setup_atr) <= 2.5 + 1e-12).length;
    const costPass = matching.filter(row => fraction * Number(row.planned_entry_quote) / Number(row.planned_stop_distance) <= 0.2 + 1e-12).length;
    const combined = matching.filter(row => {
      const gate = currentRiskPasses(row, fraction);
      return gate.stopPass && gate.costPass;
    }).length;
    return { profile: profile.profile, triggers: matching.length, stop_gate_pass: stopPass, cost_r_gate_pass: costPass, combined_pass: combined, pass_pct: matching.length ? combined / matching.length * 100 : 0 };
  });
  const all = perProfile.reduce((acc, row) => ({ triggers: acc.triggers + row.triggers, stop_gate_pass: acc.stop_gate_pass + row.stop_gate_pass, cost_r_gate_pass: acc.cost_r_gate_pass + row.cost_r_gate_pass, combined_pass: acc.combined_pass + row.combined_pass }), { triggers: 0, stop_gate_pass: 0, cost_r_gate_pass: 0, combined_pass: 0 });
  const atrValues = rows.map(row => row.touchAtrPct);
  const costRValues = rows.map(row => fraction * Number(row.planned_entry_quote) / Number(row.planned_stop_distance));
  costFrontierOverall.push({
    bps, fraction, ...all,
    pass_pct: all.triggers ? all.combined_pass / all.triggers * 100 : 0,
    required_atr_pct_at_stop_cap: fraction / (0.2 * 2.5) * 100,
    median_candidate_touch_atr_pct: summarize(atrValues).p50,
    median_cost_R_at_named_case: summarize(costRValues).p50,
    by_profile: perProfile,
  });
}

const funnelRows = compileGroupRows(groups, profiles.map(p => p.profile));
const frontierRows = [...frontierLookup.values()].sort((a, b) => a.profile.localeCompare(b.profile) || a.utc_month.localeCompare(b.utc_month) || a.side.localeCompare(b.side) || a.volatility_bucket.localeCompare(b.volatility_bucket) || a.bps - b.bps).map(row => {
  const cr = summarize(row.costRValues); const sa = summarize(row.stopAtrValues); const ta = summarize(row.touchAtrPctValues);
  return {
    profile: row.profile, side: row.side, utc_month: row.utc_month, volatility_bucket: row.volatility_bucket,
    cost_sensitivity_bp: row.bps, candidate_count: row.candidates,
    stop_cap_pass_count: row.stop_gate_pass, cost_R_pass_count: row.cost_r_gate_pass,
    both_gate_pass_count: row.combined_gate_pass,
    both_gate_pass_pct: row.candidates ? row.combined_gate_pass / row.candidates * 100 : 0,
    cost_R_p50: cr.p50, cost_R_p90: cr.p90, stop_distance_ATR_p50: sa.p50, touch_ATR_pct_p50: ta.p50,
    actual_order_count: 'NOT_OBSERVED', actual_fill_count: 'UNKNOWN',
  };
});

const profileReports = profiles.map(profile => {
  const events = outcomeRows.filter(row => row.execution_timeframe === profile.profile);
  const setups = profile.setups;
  const blockers = {};
  for (const event of events) blockers[event.risk_blocker] = (blockers[event.risk_blocker] ?? 0) + 1;
  const cuts = atrByProfile.get(profile.profile);
  const coverageProfile = coverage.ema.profile_feature_gates.find(row => row.execution_timeframe === `${profile.minutes}m`);
  assert.equal(profile.eligibleBars.length, coverageProfile.coverage.eligible_scored_bars, `P1 scored bars match #4 coverage for ${profile.profile}`);
  const frontier = Object.fromEntries(costFrontierOverall.map(row => [String(row.bps), { ...row.by_profile.find(x => x.profile === profile.profile), required_atr_pct_at_stop_cap: row.required_atr_pct_at_stop_cap }]));
  const metricSummary = {
    stop_pct: summarize(events.map(row => row.stopPct)),
    stop_distance_ATR: summarize(events.map(row => row.stopAtr)),
    touch_ATR_pct: summarize(events.map(row => row.touchAtrPct)),
    trigger_ATR_pct: summarize(events.map(row => row.triggerAtrPct)),
    cost_R_10bp: summarize(events.map(row => 0.001 * Number(row.planned_entry_quote) / Number(row.planned_stop_distance))),
    cost_R_15bp: summarize(events.map(row => 0.0015 * Number(row.planned_entry_quote) / Number(row.planned_stop_distance))),
    cost_R_20bp: summarize(events.map(row => 0.002 * Number(row.planned_entry_quote) / Number(row.planned_stop_distance))),
  };
  const setupOutcomes = {};
  for (const setup of setups) setupOutcomes[setup.outcome] = (setupOutcomes[setup.outcome] ?? 0) + 1;
  return {
    profile: profile.profile,
    higher_minutes: profile.higher_minutes,
    source_bars: profile.bars.length,
    model_scored_bars: profile.eligibleBars.length,
    issue4_coverage_scored_bars: coverageProfile?.coverage?.eligible_scored_bars ?? null,
    scored_bar_delta_vs_issue4: coverageProfile ? profile.eligibleBars.length - coverageProfile.coverage.eligible_scored_bars : null,
    eligible_side_hours: profile.eligibleBars.reduce((sum, row) => sum + (row.side === 'NEUTRAL' ? 0 : profile.minutes / 60), 0),
    setups: setups.length,
    setup_outcomes: setupOutcomes,
    triggers: events.length,
    baseline_blockers: blockers,
    cost_frontier: frontier,
    volatility_cuts_atr_pct: { p33: cuts.p33, p67: cuts.p67, observations: cuts.count },
    measures: metricSummary,
    history: { first_bar_utc: iso(profile.bars[0].timeMs), last_bar_utc: iso(profile.bars.at(-1).timeMs) },
    source_file: profile.source_file,
    source_sha256: profile.source_sha256,
  };
});

const overallSetups = allSetups.length;
const overallEvents = outcomeRows.length;
const eligibleScoredBars = allEligibleBars.length;
const oldB0Hashes = JSON.parse(fs.readFileSync(path.join(root, 'research/BASELINE_MANIFEST.json'), 'utf8')).current_sources.map(row => row.sha256_raw_file);
const nowB0Hashes = ['indie/btc_pullback_indicator.indie', 'indie/btc_pullback_strategy.indie'].map(file => normalizedSha256(path.join(root, file)));
const frozenB0HashesUnchanged = oldB0Hashes.length === nowB0Hashes.length && oldB0Hashes.every((hash, i) => hash === nowB0Hashes[i]);
assert.ok(frozenB0HashesUnchanged, 'frozen B0 source hashes remain unchanged');

const discrepancyRows = outcomeRows.map(row => row.tradePath.entry_open_delta).filter(Number.isFinite);
const tradeMarkOutcomeChanges = outcomeRows.filter(row => row.tradePath.outcome !== row.markPath.outcome).length;
const overallFifteen = costFrontierOverall.find(row => row.bps === 15);
const riskPass15 = outcomeSummary.filter(row => row.bps === 15).reduce((sum, row) => sum + row.gate_candidates, 0);
const riskPass15Net = outcomeSummary.filter(row => row.bps === 15).reduce((sum, row) => sum + row.net_R_sum, 0);
const riskPass15Closed = outcomeSummary.filter(row => row.bps === 15).reduce((sum, row) => sum + row.closed_count, 0);
const decision = riskPass15Closed > 0 && riskPass15Net <= 0
  ? 'REVISE before feature selection: under the declared planned-quote assumption, the current 15 bp eligible subset has non-positive cumulative net R after costs. Keep all cost and stop gates unchanged; inspect execution/exit assumptions and require an untouched, fill-reconciled follow-up before any promotion.'
  : 'CONTINUE research only: the conditional shadow results do not establish profitability or observed fills. Keep current gates unchanged and require untouched, fill-reconciled validation before any promotion.';

const report = {
  schema_version: 1,
  report_id: spec.experiment_id,
  generated_at_utc: new Date().toISOString(),
  status: 'conditional_shadow_diagnostic_no_actual_orders_or_fills_no_profitability_claim',
  candidate_contract: contract.contract_version,
  frozen_b0: { baseline_id: spec.frozen_b0_reference, hashes_unchanged: frozenB0HashesUnchanged, source_hashes: nowB0Hashes },
  window: { start_utc: spec.history.start_utc_inclusive, end_utc_exclusive: spec.history.end_utc_exclusive, period_grouping: spec.history.period_grouping, untouched_holdout: false },
  definitions: spec.stage_definitions,
  outcome_model: spec.outcome_model,
  costs: spec.cost_sensitivities,
  risk_gates: spec.risk_gates,
  volatility_buckets_by_profile: Object.fromEntries(atrByProfile),
  candidate_reference_fixtures: candidateFixtures,
  barrier_index_validation: barrierIndexValidation,
  candidate_parity: { candidate_id_matches: candidateIds.size, existing_ledger_rows: existingLedger.length, mismatched_risk_blockers: sourceMismatch.length },
  profiles: profileReports,
  overall: {
    eligible_scored_bars: eligibleScoredBars,
    directional_setups: overallSetups,
    triggers: overallEvents,
    setup_to_trigger_pct: overallSetups ? overallEvents / overallSetups * 100 : 0,
    risk_pass_15bp: overallFifteen.combined_pass,
    risk_pass_share_15bp: overallFifteen.pass_pct,
    closed_15bp_gate_shadow_outcomes: riskPass15Closed,
    cumulative_net_R_15bp_gate_shadow: riskPass15Net,
    conditional_gate_candidate_count_15bp: riskPass15,
    observed_order_count: 'NOT_OBSERVED',
    observed_fill_count: 'UNKNOWN',
    assumed_quote_paths_are_model_only: true,
    gate_off_performance_is_diagnostic_only: true,
    funding_applied: false,
    portfolio_overlap_or_capital_model: false,
    configuration_budget_signal_variants_consumed: 0,
    trade_mark_outcome_disagreement_count: tradeMarkOutcomeChanges,
    first_minute_entry_open_delta: summarize(discrepancyRows),
    profitability: 'unproven; conditional path results do not establish realized expectancy or profitability',
  },
  cost_frontier_overall: costFrontierOverall.map(({ by_profile, ...row }) => row),
  outcome_summary: outcomeSummary,
  decision,
  source_files: [
    'research/candidate_reference.mjs', 'research/specs/candidate_contract_p1.json', 'research/specs/candidate_economics_p1.json',
    'research/specs/execution_cost_risk.json', 'research/reports/candidate_event_ledger.csv',
    'research/reports/btc_history_coverage.json', 'research/data/btcusdt_2024-10_2026-09/manifest.json',
    'research/data/btcusdt_2024-10_2026-09/derived/trade_1m.csv', 'research/data/btcusdt_2024-10_2026-09/derived/mark_1m.csv',
  ].map(file => ({ path: file, sha256: sha256(path.join(root, file)) })),
  artifacts: [],
};

assert.equal(report.candidate_parity.candidate_id_matches, report.candidate_parity.existing_ledger_rows);
assert.ok(overallEvents > 0 && overallSetups >= overallEvents);

writeCsv(path.join(reportDir, 'pre_cost_shadow_ledger.csv'), shadowLedgerRows);
writeCsv(path.join(reportDir, 'candidate_funnel_utc_month_volatility.csv'), funnelRows);
writeCsv(path.join(reportDir, 'cost_atr_frontier_utc_month_volatility.csv'), frontierRows);
fs.writeFileSync(path.join(reportDir, 'candidate_economics_report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
fs.writeFileSync(path.join(reportDir, 'candidate_economics_report.md'), buildMarkdown(report).trimEnd() + '\n', 'utf8');

console.log(JSON.stringify({
  report: 'research/reports/candidate_economics_report.md',
  candidates: overallEvents,
  setups: overallSetups,
  eligible_scored_bars: eligibleScoredBars,
  cost_frontier: costFrontierOverall.map(({ bps, combined_pass, triggers, pass_pct, required_atr_pct_at_stop_cap }) => ({ bps, combined_pass, triggers, pass_pct, required_atr_pct_at_stop_cap })),
  '15bp_net_R': riskPass15Net,
  decision,
}, null, 2));
