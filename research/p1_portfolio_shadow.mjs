// Conditional portfolio replay for the frozen P1 event stream.
// It models an immediate full fill at the rounded limit; it does not infer venue fills.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reportDir = path.join(root, 'research/reports');
const dataDir = path.join(root, 'research/data/btcusdt_2024-10_2026-09/derived');
const spec = JSON.parse(fs.readFileSync(path.join(root, 'research/specs/p1_portfolio_shadow.json'), 'utf8'));
const candidateContract = JSON.parse(fs.readFileSync(path.join(root, 'research/specs/candidate_contract_p1.json'), 'utf8'));
const riskSpec = JSON.parse(fs.readFileSync(path.join(root, 'research/specs/contract_risk_controls_p1.json'), 'utf8'));
const p2PolicySpec = JSON.parse(fs.readFileSync(path.join(root, 'research/specs/p2_net_target_policy.json'), 'utf8'));
const netTargetArgument = process.argv.find(argument => argument.startsWith('--net-target-quote='));
const requiredNetTargetQuote = netTargetArgument ? Number(netTargetArgument.split('=')[1]) : null;
if (netTargetArgument) assert.equal(requiredNetTargetQuote, p2PolicySpec.objective.minimum_net_profit_quote_per_closed_trade, 'P2 run must match its frozen target policy spec');
const isP2TargetRun = netTargetArgument !== undefined;
const targetPolicy = isP2TargetRun
  ? { id: p2PolicySpec.policy_id, execution_policy_version: p2PolicySpec.execution_policy_version, type: 'MINIMUM_NET_QUOTE', required_net_quote: requiredNetTargetQuote, basis_bps: 15, funding_included: false }
  : { id: 'BTC-PERP-P1-TARGET-1-5R', execution_policy_version: spec.execution_policy_version, type: 'FIXED_R', target_multiple: 1.5 };
const outputPrefix = isP2TargetRun ? 'p2_net5' : 'p1_portfolio';

assert.equal(spec.execution_policy_version, candidateContract.execution_separation.execution_policy_version);
assert.equal(candidateContract.execution_separation.strategy_limit_offset_fraction, spec.contract_grid_and_sizing.limit_offset_fraction);
assert.equal(candidateContract.planned_entry_risk_contract.round_trip_cost_fraction, spec.contract_grid_and_sizing.sizing_cost_fraction);

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function parseCsvLine(line) {
  const fields = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { value += '"'; i++; }
      else quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      fields.push(value); value = '';
    } else value += ch;
  }
  fields.push(value);
  return fields;
}

function readCsv(file) {
  const lines = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').trimEnd().split(/\r?\n/);
  const header = parseCsvLine(lines[0]);
  return lines.slice(1).map(line => {
    const row = parseCsvLine(line);
    return Object.fromEntries(header.map((field, i) => [field, row[i] ?? '']));
  });
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'number'
    ? (Number.isFinite(value) ? String(Number(value.toPrecision(12))) : '')
    : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function writeCsv(file, rows) {
  if (rows.length === 0) throw new Error(`Refusing to write empty CSV: ${file}`);
  const fields = Object.keys(rows[0]);
  const text = [fields.join(','), ...rows.map(row => fields.map(key => csvEscape(row[key])).join(','))].join('\n') + '\n';
  fs.writeFileSync(file, text, 'utf8');
}

function bool(value) { return value === 'true' || value === true; }
function numeric(value) { const n = Number(value); return Number.isFinite(n) ? n : NaN; }
function iso(ms) { return new Date(ms).toISOString(); }
function utcDay(ms) { return iso(ms).slice(0, 10); }
function utcMonth(ms) { return iso(ms).slice(0, 7); }

function readBars(file) {
  const rows = readCsv(file);
  return rows.map((row, i) => {
    const bar = {
      timeMs: Number(row.open_time_ms),
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
    };
    assert.ok(Number.isFinite(bar.timeMs) && bar.open > 0 && bar.high >= bar.low && bar.close > 0, `invalid minute bar ${i}`);
    if (i > 0) assert.equal(bar.timeMs - rows[i - 1]._timeMs, 60_000, `1m input gap/duplicate at row ${i}`);
    rows[i]._timeMs = bar.timeMs;
    return bar;
  });
}

function floorGrid(value, step) { return Math.round(Math.floor(value / step + 1e-9) * step * 1e10) / 1e10; }
function ceilGrid(value, step) { return Math.round(Math.ceil(value / step - 1e-9) * step * 1e10) / 1e10; }
function roundGrid(value, step, method) { return method === 'floor' ? floorGrid(value, step) : ceilGrid(value, step); }

function lowerBound(bars, timeMs) {
  let left = 0; let right = bars.length;
  while (left < right) {
    const mid = (left + right) >>> 1;
    if (bars[mid].timeMs < timeMs) left = mid + 1;
    else right = mid;
  }
  return left;
}

class BarrierIndex {
  constructor(bars) {
    this.count = bars.length;
    this.size = 1;
    while (this.size < bars.length) this.size <<= 1;
    this.minLow = new Float64Array(this.size * 2).fill(Number.POSITIVE_INFINITY);
    this.maxHigh = new Float64Array(this.size * 2).fill(Number.NEGATIVE_INFINITY);
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
      const mid = (left + right) >>> 1;
      const first = visit(node * 2, left, mid);
      return first >= 0 ? first : visit(node * 2 + 1, mid, right);
    };
    return visit(1, 0, this.size);
  }
}

function simulatePath(event, bars, index, entry, stop, target) {
  const start = lowerBound(bars, event.decisionMs);
  if (start >= bars.length || bars[start].timeMs !== event.decisionMs) {
    return { outcome: 'UNMODELED_NO_ALIGNED_1M_BAR', exitPrice: null, exitTimeMs: null, markPrice: bars.at(-1).close };
  }
  const isLong = event.side === 'LONG';
  const lowThreshold = isLong ? stop : target;
  const highThreshold = isLong ? target : stop;
  const hit = index.firstCrossing(start, lowThreshold, highThreshold);
  if (hit < 0) return { outcome: 'CENSORED_AT_DATA_END', exitPrice: null, exitTimeMs: null, markPrice: bars.at(-1).close };
  const bar = bars[hit];
  const gapStop = isLong ? bar.open < stop : bar.open > stop;
  const gapTarget = isLong ? bar.open > target : bar.open < target;
  const stopTouched = isLong ? bar.low <= stop : bar.high >= stop;
  const targetTouched = isLong ? bar.high >= target : bar.low <= target;
  if (gapStop) return { outcome: 'GAP_STOP', exitPrice: bar.open, exitTimeMs: bar.timeMs, markPrice: null };
  if (gapTarget) return { outcome: 'TARGET_GAP_PRICE_IMPROVEMENT', exitPrice: bar.open, exitTimeMs: bar.timeMs, markPrice: null };
  if (stopTouched && targetTouched) return { outcome: 'AMBIGUOUS_STOP_FIRST', exitPrice: stop, exitTimeMs: bar.timeMs, markPrice: null };
  if (stopTouched) return { outcome: 'STOP', exitPrice: stop, exitTimeMs: bar.timeMs, markPrice: null };
  if (targetTouched) return { outcome: 'TARGET', exitPrice: target, exitTimeMs: bar.timeMs, markPrice: null };
  throw new Error(`Barrier index returned a non-crossing bar for ${event.candidate_id}`);
}

function summarizeTrades(trades, bps, initialCash) {
  const pnlKey = `net_pnl_${bps}bp`;
  const closed = trades.filter(trade => trade.exit_time_utc !== null);
  const wins = closed.filter(trade => trade[pnlKey] > 0);
  const losses = closed.filter(trade => trade[pnlKey] < 0);
  const net = closed.reduce((sum, trade) => sum + trade[pnlKey], 0);
  const gross = closed.reduce((sum, trade) => sum + trade.gross_pnl_quote, 0);
  const positive = wins.reduce((sum, trade) => sum + trade[pnlKey], 0);
  const negative = losses.reduce((sum, trade) => sum + Math.abs(trade[pnlKey]), 0);
  const netR = closed.map(trade => trade[pnlKey] / trade.modeled_all_in_risk_quote);
  const holding = closed.map(trade => trade.holding_minutes_upper);
  const outcomes = Object.fromEntries([...new Set(closed.map(trade => trade.outcome))].sort().map(outcome => [outcome, closed.filter(trade => trade.outcome === outcome).length]));
  return {
    cost_scenario_bps: bps,
    closed_trades: closed.length,
    open_positions_at_data_end: trades.length - closed.length,
    win_rate_pct: closed.length ? wins.length / closed.length * 100 : null,
    mean_net_pnl_quote_per_closed_trade: closed.length ? net / closed.length : null,
    cumulative_net_pnl_quote: net,
    cumulative_gross_pnl_quote: gross,
    net_return_on_initial_cash_pct: net / initialCash * 100,
    net_profit_factor: negative > 0 ? positive / negative : (positive > 0 ? null : 0),
    net_expectancy_modeled_all_in_R: netR.length ? netR.reduce((sum, value) => sum + value, 0) / netR.length : null,
    median_holding_minutes_upper: holding.length ? holding.sort((a, b) => a - b)[Math.floor((holding.length - 1) / 2)] : null,
    outcomes,
    actual_orders: 'NOT_OBSERVED',
    actual_fills: 'UNKNOWN',
  };
}

function gridAndSize(event, strategyCash, sizing, targetPolicyOverride) {
  const side = event.side;
  const planned = numeric(event.planned_entry_quote);
  const plannedStop = numeric(event.planned_stop);
  const plannedTarget = numeric(event.planned_target);
  const rawLimit = planned * (side === 'LONG' ? 1 + sizing.limitOffsetFraction : 1 - sizing.limitOffsetFraction);
  const entry = roundGrid(rawLimit, sizing.tickSize, side === 'LONG' ? 'floor' : 'ceil');
  const stop = roundGrid(plannedStop, sizing.tickSize, side === 'LONG' ? 'ceil' : 'floor');
  let target = targetPolicyOverride.type === 'MINIMUM_NET_QUOTE'
    ? NaN
    : roundGrid(plannedTarget, sizing.tickSize, side === 'LONG' ? 'ceil' : 'floor');
  const entryStopGeometryOk = entry > 0 && stop > 0 && (side === 'LONG' ? stop < entry : stop > entry);
  if (!entryStopGeometryOk) return { disposition: 'INVALID_ROUNDED_LEVELS', entry, stop, target };
  if (entry < sizing.minPrice || entry > sizing.maxPrice || stop < sizing.minPrice || stop > sizing.maxPrice) {
    return { disposition: 'PRICE_FILTER', entry, stop, target };
  }

  const budget = Math.min(strategyCash * sizing.riskFraction, sizing.maxLossQuote);
  const stopDistance = Math.abs(entry - stop);
  const modeledCostPerUnit = entry * sizing.sizingCostFraction;
  const riskSize = budget / (stopDistance + modeledCostPerUnit);
  const cashSize = strategyCash / (entry * (1 + sizing.cashReserveFraction));
  const rawSize = Math.min(riskSize, cashSize, sizing.maxQuantity);
  const size = floorGrid(rawSize, sizing.quantityStep);
  if (!(rawSize > 0)) return { disposition: 'NON_POSITIVE_SIZE', entry, stop, target, budget, size };
  const modeledAllInLoss = size * (stopDistance + modeledCostPerUnit);
  if (size < sizing.minQuantity) return { disposition: 'MINIMUM_QUANTITY', entry, stop, target, budget, size, modeledAllInLoss };

  let modeledTargetNet15bp = null;
  if (targetPolicyOverride.type === 'MINIMUM_NET_QUOTE') {
    const c = targetPolicyOverride.basis_bps / 10_000;
    if (side === 'LONG') {
      target = ceilGrid((targetPolicyOverride.required_net_quote / size + entry * (1 + c / 2)) / (1 - c / 2), sizing.tickSize);
    } else {
      target = floorGrid((entry * (1 - c / 2) - targetPolicyOverride.required_net_quote / size) / (1 + c / 2), sizing.tickSize);
    }
    const direction = side === 'LONG' ? 1 : -1;
    modeledTargetNet15bp = size * direction * (target - entry) - c * size * (entry + target) / 2;
    if (!(target > 0) || !(modeledTargetNet15bp > 5)) return { disposition: 'NET_TARGET_INFEASIBLE', entry, stop, target, budget, size, modeledAllInLoss, modeledTargetNet15bp };
  } else {
    const direction = side === 'LONG' ? 1 : -1;
    modeledTargetNet15bp = size * direction * (target - entry) - sizing.sizingCostFraction * size * (entry + target) / 2;
  }

  const directionalTargetOk = target > 0 && (side === 'LONG' ? target > entry : target < entry);
  if (!directionalTargetOk) return { disposition: 'INVALID_ROUNDED_LEVELS', entry, stop, target, budget, size, modeledAllInLoss };
  if (target < sizing.minPrice || target > sizing.maxPrice) return { disposition: 'PRICE_FILTER', entry, stop, target, budget, size, modeledAllInLoss };
  const protectiveNotional = size * Math.min(entry, stop, target);
  if (protectiveNotional < sizing.minimumNotional) return { disposition: 'MINIMUM_PROTECTIVE_NOTIONAL', entry, stop, target, budget, size, modeledAllInLoss, protectiveNotional };
  if (size > sizing.maxQuantity + 1e-12) return { disposition: 'MAXIMUM_QUANTITY', entry, stop, target, budget, size, modeledAllInLoss };
  if (modeledAllInLoss > budget + 1e-9) return { disposition: 'ALL_IN_RISK_OVER_BUDGET', entry, stop, target, budget, size, modeledAllInLoss };
  return { disposition: 'ELIGIBLE', entry, stop, target, budget, size, modeledAllInLoss, protectiveNotional, modeledTargetNet15bp };
}

const initialCash = spec.portfolio_policy.initial_research_cash_quote;
const costScenarios = spec.cost_scenarios.round_trip_basis_points;
const sizing = {
  tickSize: spec.contract_grid_and_sizing.tick_size,
  quantityStep: spec.contract_grid_and_sizing.quantity_step,
  minQuantity: spec.contract_grid_and_sizing.minimum_quantity,
  maxQuantity: spec.contract_grid_and_sizing.maximum_market_quantity,
  minimumNotional: spec.contract_grid_and_sizing.minimum_entry_and_protective_notional_quote,
  minPrice: riskSpec.live_contract_snapshot.price_min,
  maxPrice: riskSpec.live_contract_snapshot.price_max,
  limitOffsetFraction: spec.contract_grid_and_sizing.limit_offset_fraction,
  riskFraction: spec.contract_grid_and_sizing.risk_fraction,
  maxLossQuote: spec.contract_grid_and_sizing.maximum_modeled_loss_quote,
  sizingCostFraction: spec.contract_grid_and_sizing.sizing_cost_fraction,
  cashReserveFraction: spec.contract_grid_and_sizing.cash_reserve_fraction,
};

const candidates = readCsv(path.join(reportDir, 'pre_cost_shadow_ledger.csv')).map(row => ({
  ...row,
  decisionMs: Date.parse(row.decision_time_utc),
}));
assert.ok(candidates.length > 0, 'candidate economics ledger must contain events');
for (const candidate of candidates) assert.ok(Number.isFinite(candidate.decisionMs), `invalid decision timestamp for ${candidate.candidate_id}`);

const trade1mPath = path.join(dataDir, 'trade_1m.csv');
const tradeBars = readBars(trade1mPath);
const barrierIndex = new BarrierIndex(tradeBars);

const profiles = [];
const eventRows = [];
const tradeRows = [];
const dailyRows = [];
const monthlyRows = [];
const profileSummaries = [];

for (const executionMinutes of spec.history.execution_profiles_minutes) {
  const profile = `${executionMinutes}m`;
  const intervalMs = executionMinutes * 60_000;
  const events = candidates.filter(row => row.profile === profile).sort((a, b) => a.decisionMs - b.decisionMs || a.candidate_id.localeCompare(b.candidate_id));
  const eligibleByTime = new Map();
  for (const event of events) {
    if (bool(event.combined_gate_pass_15bp)) {
      if (!eligibleByTime.has(event.decisionMs)) eligibleByTime.set(event.decisionMs, []);
      eligibleByTime.get(event.decisionMs).push(event);
    }
  }

  let strategyCash = initialCash;
  let lastSignalBar = null;
  let lastExitBar = null;
  let activeTrade = null;
  const profileEventRows = [];
  const profileTrades = [];
  const dispositionCounts = {};
  const profileCandidateMonths = new Map();
  const profileCostGateMonths = new Map();
  const monthBin = (month, key) => {
    if (!month.has(key)) month.set(key, { triggers: 0, cost_gate_passes: 0 });
    return month.get(key);
  };

  for (const event of events) {
    const month = utcMonth(event.decisionMs);
    monthBin(profileCandidateMonths, month).triggers++;
    if (bool(event.combined_gate_pass_15bp)) monthBin(profileCostGateMonths, month).cost_gate_passes++;
    let disposition;
    let order = null;

    if (!bool(event.stop_gate_pass_15bp)) disposition = 'STOP_ATR_GATE';
    else if (!bool(event.cost_gate_pass_15bp)) disposition = 'COST_TO_R_GATE';
    else {
      const sameTime = eligibleByTime.get(event.decisionMs);
      if (sameTime.length > 1) disposition = 'SIMULTANEOUS_EVENT_CONFLICT';
      else {
        if (activeTrade && activeTrade.exitTimeMs !== null && activeTrade.exitTimeMs < event.decisionMs) {
          lastExitBar = Math.floor(activeTrade.exitTimeMs / intervalMs);
          activeTrade = null;
        }
        const decisionBar = Math.floor(event.decisionMs / intervalMs);
        if (activeTrade) disposition = 'POSITION_OPEN';
        else if ((lastExitBar !== null && decisionBar - lastExitBar <= 3) || (lastSignalBar !== null && decisionBar - lastSignalBar <= 3)) disposition = 'COOLDOWN';
        else {
          order = gridAndSize(event, strategyCash, sizing, targetPolicy);
          disposition = order.disposition;
          if (disposition === 'ELIGIBLE') {
            const path = simulatePath(event, tradeBars, barrierIndex, order.entry, order.stop, order.target);
            if (path.outcome === 'UNMODELED_NO_ALIGNED_1M_BAR') disposition = 'NO_ALIGNED_1M_BAR';
            else {
              const direction = event.side === 'LONG' ? 1 : -1;
              const exit = path.exitPrice;
              const exitTime = path.exitTimeMs;
              const markPrice = path.markPrice;
              const terminalPrice = exit ?? markPrice;
              const grossPnl = direction * (terminalPrice - order.entry) * order.size;
              const pnlByBps = {};
              const costByBps = {};
              for (const bps of costScenarios) {
                const fraction = bps / 10_000;
                const cost = fraction * ((order.entry + terminalPrice) / 2) * order.size;
                costByBps[`cost_${bps}bp`] = cost;
                pnlByBps[`net_pnl_${bps}bp`] = grossPnl - cost;
              }
              const holdingUpper = exitTime === null ? null : Math.max(1, Math.ceil((exitTime - event.decisionMs) / 60_000) + 1);
              const trade = {
                candidate_id: event.candidate_id,
                profile,
                side: event.side,
                touch_time_utc: event.touch_time_utc,
                trigger_time_utc: event.trigger_time_utc,
                decision_time_utc: event.decision_time_utc,
                entry_time_utc: iso(event.decisionMs),
                assumed_fill_status: 'CONDITIONAL_FULL_FILL_AT_ROUNDED_LIMIT',
                planned_entry_quote: numeric(event.planned_entry_quote),
                rounded_limit_entry: order.entry,
                rounded_stop: order.stop,
                rounded_target: order.target,
                target_policy_id: targetPolicy.id,
                modeled_target_net_pnl_15bp_quote: order.modeledTargetNet15bp,
                quantity_btc: order.size,
                entry_notional_quote: order.entry * order.size,
                modeled_all_in_risk_quote: order.modeledAllInLoss,
                risk_budget_quote: order.budget,
                cost_gate_15bp: true,
                outcome: path.outcome,
                exit_time_utc: exitTime === null ? null : iso(exitTime),
                exit_price: exit,
                end_mark_price: exit === null ? markPrice : null,
                holding_minutes_upper: holdingUpper,
                gross_pnl_quote: grossPnl,
                gross_R_on_modeled_all_in_risk: grossPnl / order.modeledAllInLoss,
                round_trip_cost_fraction_applied_once: true,
                ...costByBps,
                ...pnlByBps,
              };
              profileTrades.push(trade);
              tradeRows.push(trade);
              lastSignalBar = decisionBar;
              if (exitTime === null) activeTrade = { ...trade, exitTimeMs: null };
              else {
                activeTrade = { ...trade, exitTimeMs: exitTime };
                lastExitBar = Math.floor(exitTime / intervalMs);
              }
              const executedCommission = 0.0005 * order.size * (order.entry + (exit ?? order.entry));
              const realizedGross = exit === null ? 0 : direction * (exit - order.entry) * order.size;
              strategyCash += realizedGross - executedCommission;
              disposition = 'ASSUMED_FULL_FILL';
            }
          }
        }
      }
    }
    dispositionCounts[disposition] = (dispositionCounts[disposition] ?? 0) + 1;
    const row = {
      candidate_id: event.candidate_id,
      profile,
      side: event.side,
      decision_time_utc: event.decision_time_utc,
      utc_month: month,
      risk_gate_15bp: bool(event.combined_gate_pass_15bp),
      disposition,
      rounded_limit_entry: order?.entry ?? null,
      rounded_stop: order?.stop ?? null,
      rounded_target: order?.target ?? null,
      target_policy_id: targetPolicy.id,
      quantity_btc: order?.size ?? null,
      modeled_all_in_risk_quote: order?.modeledAllInLoss ?? null,
      actual_order_observation: 'NOT_OBSERVED',
      actual_fill_status: 'UNKNOWN',
    };
    profileEventRows.push(row);
    eventRows.push(row);
  }

  const monthlyTradeMap = new Map();
  for (const trade of profileTrades) {
    const month = utcMonth(Date.parse(trade.entry_time_utc));
    if (!monthlyTradeMap.has(month)) monthlyTradeMap.set(month, []);
    monthlyTradeMap.get(month).push(trade);
  }
  const allMonths = [...new Set([...profileCandidateMonths.keys(), ...monthlyTradeMap.keys()])].sort();
  for (const month of allMonths) {
    const trades = monthlyTradeMap.get(month) ?? [];
    const net15 = trades.filter(x => x.exit_time_utc !== null).reduce((sum, x) => sum + x.net_pnl_15bp, 0);
    monthlyRows.push({
      profile,
      utc_month: month,
      candidate_triggers: profileCandidateMonths.get(month)?.triggers ?? 0,
      passes_15bp_signal_gates: profileCandidateMonths.get(month)?.cost_gate_passes ?? 0,
      conditional_entries: trades.length,
      closed_trades: trades.filter(x => x.exit_time_utc !== null).length,
      open_at_data_end: trades.filter(x => x.exit_time_utc === null).length,
      gross_pnl_quote: trades.filter(x => x.exit_time_utc !== null).reduce((sum, x) => sum + x.gross_pnl_quote, 0),
      net_pnl_10bp_quote: trades.filter(x => x.exit_time_utc !== null).reduce((sum, x) => sum + x.net_pnl_10bp, 0),
      net_pnl_15bp_quote: net15,
      net_pnl_20bp_quote: trades.filter(x => x.exit_time_utc !== null).reduce((sum, x) => sum + x.net_pnl_20bp, 0),
    });
  }

  const dayClose = new Map();
  for (const bar of tradeBars) dayClose.set(utcDay(bar.timeMs), { timeMs: bar.timeMs, close: bar.close });
  let cumulative = Object.fromEntries(costScenarios.map(bps => [bps, 0]));
  let peak = Object.fromEntries(costScenarios.map(bps => [bps, initialCash]));
  let maxDrawdown = Object.fromEntries(costScenarios.map(bps => [bps, 0]));
  const realizedTradeIds = new Set();
  const days = [...dayClose.keys()].sort();
  for (const day of days) {
    const endExclusive = Date.parse(`${day}T00:00:00.000Z`) + 86_400_000;
    for (const trade of profileTrades) {
      if (trade.exit_time_utc !== null && Date.parse(trade.exit_time_utc) < endExclusive && !realizedTradeIds.has(trade.candidate_id)) {
        for (const bps of costScenarios) cumulative[bps] += trade[`net_pnl_${bps}bp`];
        realizedTradeIds.add(trade.candidate_id);
      }
    }
    const open = profileTrades.find(trade => {
      const entryMs = Date.parse(trade.entry_time_utc);
      return entryMs < endExclusive && (trade.exit_time_utc === null || Date.parse(trade.exit_time_utc) >= endExclusive);
    });
    const mark = dayClose.get(day).close;
    const equity = {};
    for (const bps of costScenarios) {
      let openNet = 0;
      if (open) {
        const direction = open.side === 'LONG' ? 1 : -1;
        const gross = direction * (mark - open.rounded_limit_entry) * open.quantity_btc;
        const cost = (bps / 10_000) * ((open.rounded_limit_entry + mark) / 2) * open.quantity_btc;
        openNet = gross - cost;
      }
      equity[`marked_equity_${bps}bp_quote`] = initialCash + cumulative[bps] + openNet;
      peak[bps] = Math.max(peak[bps], equity[`marked_equity_${bps}bp_quote`]);
      maxDrawdown[bps] = Math.max(maxDrawdown[bps], (peak[bps] - equity[`marked_equity_${bps}bp_quote`]) / peak[bps]);
    }
    dailyRows.push({ profile, utc_day: day, open_candidate_id: open?.candidate_id ?? '', closing_mark_price: mark, ...equity });
  }

  const scenarioSummaries = costScenarios.map(bps => ({ ...summarizeTrades(profileTrades, bps, initialCash), max_daily_close_marked_drawdown_pct: maxDrawdown[bps] * 100 }));
  const accepted = profileEventRows.filter(row => row.disposition === 'ASSUMED_FULL_FILL').length;
  profileSummaries.push({
    profile,
    execution_minutes: executionMinutes,
    candidate_triggers: events.length,
    signal_gate_passes_15bp: events.filter(row => bool(row.combined_gate_pass_15bp)).length,
    portfolio_conditional_entries: accepted,
    closed_trades: profileTrades.filter(trade => trade.exit_time_utc !== null).length,
    open_positions_at_data_end: profileTrades.filter(trade => trade.exit_time_utc === null).length,
    disposition_counts: dispositionCounts,
    scenarios: scenarioSummaries,
    monthly_rows: allMonths.length,
  });
  profiles.push({ profile, trades: profileTrades, events: profileEventRows });
}

const overallSummaries = costScenarios.map(bps => ({ ...summarizeTrades(tradeRows, bps, initialCash * spec.history.execution_profiles_minutes.length) }));
const report = {
  schema_version: 1,
  report_id: isP2TargetRun ? 'BTC-PERP-P2-NET-TARGET-5-01-SHADOW-2026-10' : spec.model_id,
  generated_at_utc: new Date().toISOString(),
  status: 'conditional_portfolio_replay_complete_profitability_unproven',
  scope: isP2TargetRun
    ? 'P2 feasibility overlay: unchanged P1 signal and risk gates with a modeled target that exceeds $5 net at the 15 bp cost scenario.'
    : spec.purpose,
  assumptions: spec,
  target_policy: targetPolicy,
  ...(isP2TargetRun ? {
    platform_validation: p2PolicySpec.platform_validation,
    native_backtest_limit: p2PolicySpec.native_backtest_limit,
    candidate_outputs: p2PolicySpec.candidate_outputs,
  } : {}),
  data: {
    source_candidate_ledger: 'research/reports/pre_cost_shadow_ledger.csv',
    candidate_rows: candidates.length,
    trade_1m_path: 'research/data/btcusdt_2024-10_2026-09/derived/trade_1m.csv',
    trade_1m_bars: tradeBars.length,
    trade_1m_sha256: sha256(trade1mPath),
    event_ledger_sha256: sha256(path.join(reportDir, 'pre_cost_shadow_ledger.csv')),
    inspection_period_is_not_holdout: true,
  },
  result_semantics: {
    conditional_assumed_fills: true,
    actual_orders: 'NOT_OBSERVED',
    actual_fills: 'UNKNOWN',
    profitability: 'unproven; hypothetical immediate fills and inspected history do not establish live or prospective profitability',
    no_signal_configurations_consumed: 0,
    funding_applied: false,
  },
  initial_cash_quote_per_profile: initialCash,
  profiles: profileSummaries,
  overall_cost_scenarios_across_both_independent_profiles: overallSummaries,
  artifacts: {
    event_disposition_ledger: `research/reports/${outputPrefix}_event_ledger.csv`,
    conditional_trade_ledger: `research/reports/${outputPrefix}_trade_ledger.csv`,
    daily_close_marked_equity: `research/reports/${outputPrefix}_daily_equity.csv`,
    monthly_summary: `research/reports/${outputPrefix}_monthly_summary.csv`,
  },
};

assert.equal(eventRows.length, candidates.length, 'each candidate must receive one portfolio disposition');
assert.equal(tradeRows.length, eventRows.filter(row => row.disposition === 'ASSUMED_FULL_FILL').length, 'accepted candidates each have a modeled trade path');
assert.ok(tradeRows.every(trade => trade.modeled_all_in_risk_quote <= spec.contract_grid_and_sizing.maximum_modeled_loss_quote + 1e-9), 'rounded sizing respects configured all-in risk cap');
assert.ok(tradeRows.every(trade => trade.quantity_btc >= sizing.minQuantity && trade.quantity_btc <= sizing.maxQuantity), 'modeled quantity respects configured contract limits');
if (isP2TargetRun) assert.ok(tradeRows.every(trade => trade.modeled_target_net_pnl_15bp_quote > 5), 'every P2 target must model strictly more than $5 net at 15 bp');

writeCsv(path.join(reportDir, `${outputPrefix}_event_ledger.csv`), eventRows);
writeCsv(path.join(reportDir, `${outputPrefix}_trade_ledger.csv`), tradeRows);
writeCsv(path.join(reportDir, `${outputPrefix}_daily_equity.csv`), dailyRows);
writeCsv(path.join(reportDir, `${outputPrefix}_monthly_summary.csv`), monthlyRows);
const reportSuffix = isP2TargetRun ? 'p2_net5_target_feasibility' : 'p1_portfolio_shadow';
fs.writeFileSync(path.join(reportDir, `${reportSuffix}_report.json`), JSON.stringify(report, null, 2) + '\n', 'utf8');

const md = [
  isP2TargetRun ? '# P2 net-dollar-target portfolio feasibility' : '# P1 conditional portfolio replay',
  '',
  `Generated ${report.generated_at_utc}. This is a conditional historical scenario, not observed execution or evidence of profitability.`,
  '',
  '## Portfolio model',
  '',
  `- Starting research cash: $${initialCash.toLocaleString('en-US')} per profile; one position at a time; no pyramiding.`,
  '- The unchanged 15 bp cost/R and 2.5 ATR candidate gates are applied before portfolio constraints.',
  isP2TargetRun
    ? `- Target policy solves for more than $5 net per trade at the rounded strategy-limit fill using the 15 bp round-trip scenario; it targets $${requiredNetTargetQuote.toFixed(2)} before outward tick rounding. Funding is excluded.`
    : '- Target policy preserves the frozen 1.5R P1 reference.',
  ...(isP2TargetRun ? [
    '- Separate P2 strategy source passed TakeProfit compile and runtime_quick on 5,000 bars; the ephemeral working copy was not saved.',
    '- A matching two-year native platform backtest was not produced: the connected plan allows 5,060 bars, while the requested 5-minute window required 210,240. See `research/reports/p2_strategy_platform_validation.json`.',
    '- The hidden target quote output is theoretical and can be present even if a later sizing or order eligibility check rejects the candidate; reason code 30 means the rounded target fails the configured net target requirement.',
  ] : []),
  '- Orders passing post-rounding quantity, notional, geometry, and $1 modeled stop-risk checks are assumed to fill fully at the rounded 2 bp limit on the decision bar.',
  '- Stop and target are rounded to the captured $0.10 proxy tick. Trade 1m bars determine exits; same-minute stop/target ambiguity is stop-first.',
  '- The round-trip cost scenario is charged once to each modeled P&L result. Funding, spread observations, actual account fees, queue, partial fills, and rejections are unavailable.',
  '- Static tick, quantity, and notional filters are modeled; the dynamic mark-price-based PERCENT_PRICE filter is not modeled.',
  '- Daily drawdown is based on UTC daily close marked equity; it is not intraday maximum drawdown. The 2024-10 through 2026-09 history is inspected development material, not a holdout.',
  '',
  '## Results by profile and cost scenario',
  '',
  '| Profile | Triggers | 15 bp gate passes | Conditional entries | Closed | Cost | Net P&L | Net PF | Mean net P&L/trade | Max daily close drawdown |',
  '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
];
for (const profile of profileSummaries) {
  for (const scenario of profile.scenarios) {
    md.push(`| ${profile.profile} | ${profile.candidate_triggers} | ${profile.signal_gate_passes_15bp} | ${profile.portfolio_conditional_entries} | ${scenario.closed_trades} | ${scenario.cost_scenario_bps} bp | ${scenario.cumulative_net_pnl_quote.toFixed(2)} | ${scenario.net_profit_factor === null ? 'n/a' : scenario.net_profit_factor.toFixed(3)} | ${scenario.mean_net_pnl_quote_per_closed_trade === null ? 'n/a' : scenario.mean_net_pnl_quote_per_closed_trade.toFixed(3)} | ${scenario.max_daily_close_marked_drawdown_pct.toFixed(2)}% |`);
  }
}
md.push('', '## Execution funnel', '');
for (const profile of profileSummaries) {
  md.push(`### ${profile.profile}`, '', `- ${profile.candidate_triggers} candidate events; ${profile.signal_gate_passes_15bp} pass the frozen 15 bp signal gates; ${profile.portfolio_conditional_entries} receive a hypothetical full fill.`);
  for (const [reason, count] of Object.entries(profile.disposition_counts).sort(([a], [b]) => a.localeCompare(b))) md.push(`- ${reason}: ${count}`);
  md.push('');
}
md.push('## Interpretation', '', 'These results impose single-position overlap and cooldown constraints that the candidate-independent shadow study omits. They still assume every eligible limit order fills in full at its modeled limit and use inspected history. They cannot establish realized edge. Treat the 10/15/20 bp results as cost sensitivities, and treat the daily marked drawdown as an end-of-day measure only.', '', `Outputs: \`${outputPrefix}_event_ledger.csv\`, \`${outputPrefix}_trade_ledger.csv\`, \`${outputPrefix}_daily_equity.csv\`, \`${outputPrefix}_monthly_summary.csv\`, and the machine-readable JSON report.`, '', isP2TargetRun ? `Reproduce with \`node research/p1_portfolio_shadow.mjs --net-target-quote=${requiredNetTargetQuote}\`.` : 'Reproduce with `node research/p1_portfolio_shadow.mjs`.');
fs.writeFileSync(path.join(reportDir, `${reportSuffix}_report.md`), md.join('\n') + '\n', 'utf8');

console.log(JSON.stringify({
  report: `research/reports/${reportSuffix}_report.md`,
  candidate_events: eventRows.length,
  profiles: profileSummaries.map(profile => ({ profile: profile.profile, signal_gate_passes_15bp: profile.signal_gate_passes_15bp, conditional_entries: profile.portfolio_conditional_entries, closed_trades: profile.closed_trades, dispositions: profile.disposition_counts })),
  overall_cost_scenarios: overallSummaries,
  actual_orders: 'NOT_OBSERVED',
  actual_fills: 'UNKNOWN',
}, null, 2));
