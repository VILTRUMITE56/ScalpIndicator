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
const timeEndpoint = 'https://fapi.binance.com/fapi/v1/time';
const output = path.join(root, 'research/data/binance_btcusdt_contract_snapshot.json');
const contractSpecPath = path.join(root, 'research/specs/contract_risk_controls_p1.json');

const requestOptions = { cache: 'no-store', headers: { accept: 'application/json', 'cache-control': 'no-cache', pragma: 'no-cache' } };
const response = await fetch(endpoint, requestOptions);
if (!response.ok) throw new Error(`Binance exchangeInfo returned HTTP ${response.status}; no snapshot was written.`);
const capturedAtUtc = new Date().toISOString();
const rawBody = await response.text();
const body = JSON.parse(rawBody);
const timeResponse = await fetch(timeEndpoint, requestOptions);
if (!timeResponse.ok) throw new Error(`Binance server-time endpoint returned HTTP ${timeResponse.status}; snapshot freshness cannot be checked.`);
const timeBody = await timeResponse.json();
assert.ok(Array.isArray(body.symbols), 'exchangeInfo response contains symbols');
assert.ok(Number.isFinite(timeBody.serverTime), 'server-time response contains serverTime');
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
const percentPrice = filters.PERCENT_PRICE;
for (const [name, filter] of Object.entries({ PRICE_FILTER: price, LOT_SIZE: limitLot, MARKET_LOT_SIZE: marketLot, MIN_NOTIONAL_OR_NOTIONAL: notional, PERCENT_PRICE: percentPrice })) {
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

const captureToReferenceDeltaSeconds = Number(((timeBody.serverTime - Date.parse(capturedAtUtc)) / 1000).toFixed(3));
const snapshotPayload = {
  schema_version: 1,
  status: Math.abs(captureToReferenceDeltaSeconds) <= 300 ? 'FRESH_OFFICIAL_METADATA' : 'STALE_OFFICIAL_METADATA',
  captured_at_utc: capturedAtUtc,
  endpoint,
  freshness_reference_endpoint: timeEndpoint,
  exchange_info_server_time_ms_ignored: body.serverTime ?? null,
  freshness_reference_server_time_ms: timeBody.serverTime,
  capture_to_reference_delta_seconds: captureToReferenceDeltaSeconds,
  freshness_threshold_seconds: 300,
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
    percent_price: percentPrice,
    all_symbol_filters: symbol.filters,
  },
  raw_response_sha256_utf8: crypto.createHash('sha256').update(rawBody, 'utf8').digest('hex'),
  raw_symbol_sha256: crypto.createHash('sha256').update(JSON.stringify(symbol)).digest('hex'),
  source_docs: [
    'https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data#exchange-information',
    'https://developers.binance.com/en/docs/products/derivatives-trading-usds-margined-futures/common-definition',
  ],
  freshness_method: 'Compare captured_at_utc with the subsequent official /fapi/v1/time serverTime. Binance documentation says to ignore exchangeInfo.serverTime for current server time.',
  limits: 'Freshness is checked against the official server-time endpoint. Metadata does not establish historical filters, user-specific fees, actual fills, or execution venue selection.',
};

fs.writeFileSync(output, JSON.stringify(snapshotPayload, null, 2) + '\n', 'utf8');
const contract = JSON.parse(fs.readFileSync(contractSpecPath, 'utf8'));
contract.live_contract_snapshot = {
  status: snapshotPayload.status === 'FRESH_OFFICIAL_METADATA' ? 'FRESH_OFFICIAL_METADATA_RESEARCH_PROXY' : 'STALE_OFFICIAL_METADATA_RESEARCH_PROXY',
  checked_utc_date: capturedAtUtc.slice(0, 10),
  endpoint,
  freshness_reference_endpoint: timeEndpoint,
  captured_at_utc: capturedAtUtc,
  exchange_info_server_time_ms_ignored: body.serverTime ?? null,
  freshness_reference_server_time_ms: timeBody.serverTime,
  capture_to_reference_delta_seconds: captureToReferenceDeltaSeconds,
  freshness_threshold_seconds: 300,
  response_sha256_utf8: crypto.createHash('sha256').update(rawBody, 'utf8').digest('hex'),
  symbol: symbol.symbol,
  contract_status: symbol.status,
  contract_type: symbol.contractType,
  base_asset: symbol.baseAsset,
  quote_asset: symbol.quoteAsset,
  margin_asset: symbol.marginAsset,
  price_tick: Number(price.tickSize),
  price_min: Number(price.minPrice),
  price_max: Number(price.maxPrice),
  limit_quantity_step: Number(limitLot.stepSize),
  limit_quantity_min: Number(limitLot.minQty),
  limit_quantity_max: Number(limitLot.maxQty),
  market_quantity_step: Number(marketLot.stepSize),
  market_quantity_min: Number(marketLot.minQty),
  market_quantity_max: Number(marketLot.maxQty),
  minimum_notional: Number(notional.minNotional ?? notional.notional),
  percent_price_multiplier_up: Number(percentPrice.multiplierUp),
  percent_price_multiplier_down: Number(percentPrice.multiplierDown),
  linear_multiplier_base_per_quantity: 1,
  snapshot_file: path.relative(root, output).replaceAll('\\', '/'),
  capture_note: Math.abs(captureToReferenceDeltaSeconds) <= 300
    ? 'Official metadata captured within the 300-second freshness threshold using the subsequent /fapi/v1/time response. Binance is a research proxy only; execution venue is unconfirmed.'
    : 'Official metadata response was not within the 300-second freshness threshold of the subsequent /fapi/v1/time response. Do not treat it as a current filter snapshot.',
};
fs.writeFileSync(contractSpecPath, JSON.stringify(contract, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ output: path.relative(root, output), contract_spec: path.relative(root, contractSpecPath), captured_at_utc: snapshotPayload.captured_at_utc, freshness_status: snapshotPayload.status, capture_to_reference_delta_seconds: captureToReferenceDeltaSeconds, symbol: symbol.symbol, filter_types: Object.keys(filters) }, null, 2));
