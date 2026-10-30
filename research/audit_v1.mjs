// Audits preserved MCP snapshots. Does not execute Indie or place orders.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const names = ['5m_base', '15m_base', '5m_sensitivity', '15m_sensitivity'];
const rows = [];
for (const name of names) {
  const snapshot = JSON.parse(fs.readFileSync(path.join(root, 'results/v1', `${name}.json`), 'utf8'));
  const m = snapshot.metrics;
  assert.equal(snapshot.source.script_version, 4);
  assert.ok(Math.abs(m.realized_pnl + m.open_pnl - m.total_pnl_currency) < 1e-7);
  assert.ok(Math.abs(m.initial_capital + m.total_pnl_currency - m.final_capital) < 1e-7);
  const orders = snapshot.recent_orders;
  const trades = snapshot.recent_trades;
  const overlaps = [];
  for (const trade of trades.filter(t => t.state === 'TRADE_STATE_OPEN')) {
    const entryIndexes = trade.trade_updates.map(u => u.order_index);
    for (const entry of orders.filter(o => entryIndexes.includes(o.index))) {
      if (entry.execution_type !== 'ORDER_EXECUTION_TYPE_MARKET') continue;
      for (const protective of orders) {
        if (protective.execution_type !== 'ORDER_EXECUTION_TYPE_STOP') continue;
        if (protective.status_v2 !== 'ORDER_STATUS_V2_FILLED') continue;
        if (protective.direction !== entry.direction) continue;
        const matchingTime = (entry.exbits ?? []).find(fill =>
          (protective.exbits ?? []).some(p => p.execution_time === fill.execution_time));
        const closedTrade = trades.find(t => t.state === 'TRADE_STATE_CLOSE' &&
          t.trade_updates.some(u => u.order_index === protective.index));
        if (matchingTime && closedTrade) {
          overlaps.push({
            timestamp_utc: matchingTime.execution_time,
            protective_exit_order: protective.index,
            queued_market_order: entry.index,
            closed_trade: closedTrade.index,
            unintended_open_trade: trade.index,
            direction: entry.direction,
            opened_quantity: entry.filled_size,
          });
        }
      }
    }
  }
  if (name.endsWith('sensitivity')) assert.equal(overlaps.length, 1);
  rows.push({
    run: name,
    instance_id: snapshot.indicator_instance_id,
    captured_at: snapshot.captured_at,
    history_sufficient: snapshot.is_history_depth_sufficient,
    closed_trades: m.total_trades,
    realized_pnl: m.realized_pnl,
    open_pnl: m.open_pnl,
    total_pnl: m.total_pnl_currency,
    final_capital: m.final_capital,
    overlapping_exits_opening_new_positions: overlaps,
  });
}

const costFraction = 0.0015;
const maxCostToRisk = 0.20;
const maxStopAtr = 2.5;
const minimumStopFraction = costFraction / maxCostToRisk;
const minimumAtrFraction = minimumStopFraction / maxStopAtr;
assert.ok(Math.abs(minimumStopFraction - 0.0075) < 1e-12);
assert.ok(Math.abs(minimumAtrFraction - 0.003) < 1e-12);

const sourceHashes = {};
for (const file of ['indie/btc_pullback_indicator.indie', 'indie/btc_pullback_strategy.indie']) {
  sourceHashes[file] = crypto.createHash('sha256')
    .update(fs.readFileSync(path.join(root, file))).digest('hex');
}
const output = {
  scope: 'Arithmetic and order-ledger audit of retained snapshots; not a rerun or Indie runtime test.',
  report_source: {
    script_version: 4,
    indicator_sha256: '5ab41af7484ab7f7661889d52c216f8d2af99b7926513aac69b51c1869a2ec90',
    strategy_sha256: '2ea6e2e91a971ff6d447759b28aaf4226b8bf5fbb44f95d695bb4e848632d97e',
    note: 'Hashes recorded before the source paths were updated for v2. Raw snapshots retain script version 4 metadata.',
  },
  current_working_source_sha256: sourceHashes,
  cost_gate: {
    cost_fraction: costFraction,
    max_cost_to_risk: maxCostToRisk,
    minimum_stop_fraction: minimumStopFraction,
    minimum_atr_fraction: minimumAtrFraction,
    example_price: 81000,
    minimum_stop_distance: 81000 * minimumStopFraction,
    minimum_target_distance_at_1_5R: 81000 * minimumStopFraction * 1.5,
  },
  runs: rows,
};
const serialized = JSON.stringify(output, null, 2) + '\n';
if (process.argv.includes('--write')) {
  fs.writeFileSync(path.join(root, 'results/v1/audit.json'), serialized);
}
console.log(serialized);
