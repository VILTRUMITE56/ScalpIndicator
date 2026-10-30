// Capture public Binance USD-M BTCUSDT contract filters. No API key is used.
// Run from a network that can access the official public endpoint. A failed
// response never writes a partial or synthetic snapshot.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const endpoint = 'https://fapi.binance.com/fapi/v1/exchangeInfo?symbol=BTCUSDT';
const output = path.join(root, 'research/data/binance_btcusdt_contract_snapshot.json');

const response = await fetch(endpoint, { headers: { accept: 'application/json' } });
if (!response.ok) throw new Error(`Binance exchangeInfo returned HTTP ${response.status}; no snapshot was written.`);
const body = await response.json();
assert.ok(Array.isArray(body.symbols), 'exchangeInfo response contains symbols');
const rows = body.symbols.filter(row => row.symbol === 'BTCUSDT');
assert.equal(rows.length, 1, 'exactly one BTCUSDT symbol is present');
const symbol = rows[0];
assert.equal(symbol.contractType, 'PERPETUAL', 'BTCUSDT is a perpetual contract');
assert.equal(symbol.status, 'TRADING', 'BTCUSDT perpetual is currently trading');
assert.equal(symbol.baseAsset, 'BTC', 'BTC is the base asset');
assert.equal(symbol.quoteAsset, 'USDT', 'USDT is the quote asset');
assert.equal(symbol.marginAsset, 'USDT', 'USDT is the margin asset');

const filters = Object.fromEntries((symbol.filters ?? []).map(filter => [filter.filterType, filter]));
const price = filters.PRICE_FILTER;
const limitLot = filters.LOT_SIZE;
const marketLot = filters.MARKET_LOT_SIZE;
const notional = filters.NOTIONAL ?? filters.MIN_NOTIONAL;
for (const [name, filter] of Object.entries({ PRICE_FILTER: price, LOT_SIZE: limitLot, MARKET_LOT_SIZE: marketLot, MIN_NOTIONAL_OR_NOTIONAL: notional })) {
  assert.ok(filter, `required current filter exists: ${name}`);
}
for (const [name, value] of Object.entries({
  tickSize: price.tickSize,
  limitStepSize: limitLot.stepSize,
  limitMinQty: limitLot.minQty,
  marketStepSize: marketLot.stepSize,
  marketMinQty: marketLot.minQty,
  minimumNotional: notional.minNotional ?? notional.notional,
})) assert.ok(value !== undefined && value !== null && value !== '', `required numeric filter exists: ${name}`);

const snapshotPayload = {
  schema_version: 1,
  status: 'CAPTURED_FROM_OFFICIAL_PUBLIC_EXCHANGEINFO',
  captured_at_utc: new Date().toISOString(),
  endpoint,
  server_time_ms: body.serverTime ?? null,
  symbol: {
    symbol: symbol.symbol,
    contract_type: symbol.contractType,
    status: symbol.status,
    base_asset: symbol.baseAsset,
    quote_asset: symbol.quoteAsset,
    margin_asset: symbol.marginAsset,
    contract_model: 'LINEAR_BASE_QUANTITY',
    quantity_unit: 'BTC base-asset units',
    multiplier_base_per_quantity: 1,
    multiplier_note: 'Linear model convention for BTCUSDT quantity expressed in BTC; this multiplier is explicit in the research model and is not copied from a precision field.',
  },
  filters: {
    price_filter: price,
    limit_lot_size: limitLot,
    market_lot_size: marketLot,
    min_notional_or_notional: notional,
  },
  raw_symbol_sha256: crypto.createHash('sha256').update(JSON.stringify(symbol)).digest('hex'),
  source_docs: [
    'https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data#exchange-information',
    'https://developers.binance.com/en/docs/products/derivatives-trading-usds-margined-futures/common-definition',
  ],
  limits: 'A current public metadata snapshot does not establish historical filters, user-specific fees, actual fills, or execution venue selection.',
};

fs.writeFileSync(output, JSON.stringify(snapshotPayload, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ output: path.relative(root, output), captured_at_utc: snapshotPayload.captured_at_utc, symbol: symbol.symbol, filter_types: Object.keys(filters) }, null, 2));
