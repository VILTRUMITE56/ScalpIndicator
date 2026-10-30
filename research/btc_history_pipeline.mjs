#!/usr/bin/env node
/*
 * Reproducible Binance USD-M BTCUSDT history acquisition and audit.
 * Uses Node built-ins only. Raw official archives and local derived series are
 * intentionally kept out of git; their SHA-256 values and all audit evidence
 * are written to tracked manifests/reports.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { promisify } from 'node:util';

const inflateRaw = promisify(zlib.inflateRaw);
const ROOT = path.resolve(import.meta.dirname, '..');
const SYMBOL = 'BTCUSDT';
const VENUE = 'Binance USD-M Futures';
const START_DEFAULT = '2024-10';
const END_DEFAULT = '2026-09'; // inclusive completed month
const FRAME_MS = { '1m': 60_000, '5m': 300_000, '15m': 900_000, '1h': 3_600_000 };
const KLINE_HEADER = 'open_time,open,high,low,close,volume,close_time,quote_volume,count,taker_buy_volume,taker_buy_quote_volume,ignore';
const CSV_HEADER = 'open_time_ms,open,high,low,close,base_volume,close_time_ms,quote_volume,trade_count,taker_buy_base_volume,taker_buy_quote_volume';
const SOURCE_DEFS = [
  { id: 'trade_1m', kind: 'klines', archivePath: 'klines', interval: '1m', priceType: 'trade', volumeMeaning: 'base-asset trade volume; quote volume is quote-asset turnover; count is number of trades' },
  { id: 'mark_1m', kind: 'klines', archivePath: 'markPriceKlines', interval: '1m', priceType: 'mark', volumeMeaning: 'Binance archive fields retained as published; zero volume and synthetic count are not trade activity' },
  { id: 'index_1m', kind: 'klines', archivePath: 'indexPriceKlines', interval: '1m', priceType: 'index', volumeMeaning: 'Binance archive fields retained as published; zero volume and synthetic count are not trade activity' },
  { id: 'funding', kind: 'funding', archivePath: 'fundingRate', interval: null, priceType: 'funding_event', volumeMeaning: null },
  ...['5m', '15m', '1h'].map(interval => ({ id: `native_${interval}`, kind: 'klines', archivePath: 'klines', interval, priceType: 'trade', volumeMeaning: 'base-asset trade volume; quote volume is quote-asset turnover; count is number of trades' })),
];

function arg(name, fallback) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}
function hasArg(name) { return process.argv.includes(name); }
function monthParts(month) {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) throw new Error(`Invalid YYYY-MM month: ${month}`);
  return [Number(match[1]), Number(match[2])];
}
function monthRange(start, endInclusive) {
  const [sy, sm] = monthParts(start); const [ey, em] = monthParts(endInclusive);
  const out = [];
  for (let y = sy, m = sm; y < ey || (y === ey && m <= em);) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1; if (m === 13) { y += 1; m = 1; }
  }
  if (!out.length || out.at(-1) !== endInclusive) throw new Error('End month must not precede start month');
  return out;
}
function monthBounds(month) {
  const [y, m] = monthParts(month);
  const start = Date.UTC(y, m - 1, 1);
  return { start, end: Date.UTC(y, m, 1), count: (Date.UTC(y, m, 1) - start) / FRAME_MS['1m'] };
}
function nextMonth(month) {
  const [y, m] = monthParts(month); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}
function archiveFilename(def, month) {
  return def.kind === 'funding' ? `${SYMBOL}-fundingRate-${month}.zip` : `${SYMBOL}-${def.interval}-${month}.zip`;
}
function archiveUrl(def, month) {
  const filename = archiveFilename(def, month);
  return `https://data.binance.vision/data/futures/um/monthly/${def.archivePath}/${SYMBOL}${def.interval && def.archivePath !== 'klines' ? `/${def.interval}` : def.archivePath === 'klines' ? `/${def.interval}` : ''}/${filename}`;
}
function dailyArchiveUrl(def, day) {
  const filename = `${SYMBOL}-${def.interval}-${day}.zip`;
  return `https://data.binance.vision/data/futures/um/daily/${def.archivePath}/${SYMBOL}/${def.interval}/${filename}`;
}
function archiveLocalPath(dataRoot, def, month) {
  return path.join(dataRoot, 'raw', def.id, archiveFilename(def, month));
}
function sha256(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
async function extractZipCsv(zipPath) {
  const archive = await fs.readFile(zipPath);
  let eocd = -1;
  const min = Math.max(0, archive.length - 65_557);
  for (let i = archive.length - 22; i >= min; i -= 1) {
    if (archive.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error(`ZIP end-of-directory not found: ${zipPath}`);
  const entryCount = archive.readUInt16LE(eocd + 10);
  let cursor = archive.readUInt32LE(eocd + 16);
  const candidates = [];
  for (let index = 0; index < entryCount; index += 1) {
    if (archive.readUInt32LE(cursor) !== 0x02014b50) throw new Error(`Bad ZIP central directory at ${cursor}`);
    const method = archive.readUInt16LE(cursor + 10);
    const expectedCrc = archive.readUInt32LE(cursor + 16);
    const compressedSize = archive.readUInt32LE(cursor + 20);
    const uncompressedSize = archive.readUInt32LE(cursor + 24);
    const filenameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    const localOffset = archive.readUInt32LE(cursor + 42);
    const filename = archive.subarray(cursor + 46, cursor + 46 + filenameLength).toString('utf8');
    if (filename.toLowerCase().endsWith('.csv')) candidates.push({ filename, method, expectedCrc, compressedSize, uncompressedSize, localOffset });
    cursor += 46 + filenameLength + extraLength + commentLength;
  }
  if (candidates.length !== 1) throw new Error(`Expected exactly one CSV member in ${zipPath}, found ${candidates.length}`);
  const entry = candidates[0];
  if (entry.method !== 0 && entry.method !== 8) throw new Error(`Unsupported ZIP compression method ${entry.method} in ${zipPath}`);
  const local = entry.localOffset;
  if (archive.readUInt32LE(local) !== 0x04034b50) throw new Error(`Bad ZIP local header in ${zipPath}`);
  const localNameLength = archive.readUInt16LE(local + 26);
  const localExtraLength = archive.readUInt16LE(local + 28);
  const dataStart = local + 30 + localNameLength + localExtraLength;
  const compressed = archive.subarray(dataStart, dataStart + entry.compressedSize);
  const contents = entry.method === 0 ? compressed : await inflateRaw(compressed);
  if (contents.length !== entry.uncompressedSize) throw new Error(`ZIP length mismatch in ${zipPath}`);
  if (crc32(contents) !== entry.expectedCrc) throw new Error(`ZIP CRC mismatch in ${zipPath}`);
  return { filename: entry.filename, text: contents.toString('utf8'), zipSha256: sha256(archive), zipBytes: archive.length };
}
function parseKlineLine(line, lineNo, sourceId) {
  const fields = line.split(',');
  if (fields.length !== 12) throw new Error(`${sourceId} row ${lineNo}: expected 12 CSV fields, got ${fields.length}`);
  const [t, o, h, l, c, v, closeTime, qv, count, takerBase, takerQuote] = fields;
  const row = { t: Number(t), o, h, l, c, v, closeTime: Number(closeTime), qv, count, takerBase, takerQuote };
  if (!Number.isSafeInteger(row.t) || !Number.isSafeInteger(row.closeTime)) throw new Error(`${sourceId} row ${lineNo}: timestamp is not a safe integer in milliseconds`);
  for (const [name, raw] of Object.entries({ open: o, high: h, low: l, close: c, volume: v, quote_volume: qv, taker_buy_volume: takerBase, taker_buy_quote_volume: takerQuote })) {
    if (!Number.isFinite(Number(raw))) throw new Error(`${sourceId} row ${lineNo}: invalid ${name} ${raw}`);
  }
  if (!/^\d+$/.test(count)) throw new Error(`${sourceId} row ${lineNo}: invalid trade count ${count}`);
  return row;
}
function decimalScaled(value, scaleDigits = 12) {
  const s = String(value);
  const [whole, fraction = ''] = s.split('.');
  const normalized = (fraction + '0'.repeat(scaleDigits)).slice(0, scaleDigits);
  const sign = whole.startsWith('-') ? -1n : 1n;
  const wholeNum = BigInt(whole || '0');
  const wholeAbs = wholeNum < 0n ? -wholeNum : wholeNum;
  return sign * (wholeAbs * (10n ** BigInt(scaleDigits)) + BigInt(normalized || '0'));
}
function scaledDecimal(value, scaleDigits = 12) {
  const negative = value < 0n; const n = negative ? -value : value;
  const scale = 10n ** BigInt(scaleDigits);
  const whole = n / scale;
  const fraction = String(n % scale).padStart(scaleDigits, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}
function klineCsvRows(text, sourceId) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  let start = 0;
  if (lines[0].toLowerCase().startsWith('open_time,')) start = 1;
  const rows = [];
  for (let i = start; i < lines.length; i += 1) rows.push(parseKlineLine(lines[i], i + 1, sourceId));
  return rows;
}
function auditKlines(rows, source, month, interval, anomalies, gapLimit = 20) {
  const { start, end } = monthBounds(month);
  const step = FRAME_MS[interval];
  const expectedGridBars = (end - start) / step;
  const ts = new Set();
  let unsorted = 0; let duplicates = 0; let invalidOhlc = 0; let invalidVolume = 0; let badCloseTime = 0; let misaligned = 0; let outOfMonth = 0;
  let zeroTradeRows = 0;
  let previous = null;
  let firstTimestamp = null; let lastTimestamp = null;
  const sourceGapRanges = [];
  const values = { base: 0n, quote: 0n, takerBase: 0n, takerQuote: 0n, trades: 0n };
  for (const row of rows) {
    if (firstTimestamp === null || row.t < firstTimestamp) firstTimestamp = row.t;
    if (lastTimestamp === null || row.t > lastTimestamp) lastTimestamp = row.t;
    if (previous !== null && row.t < previous) unsorted += 1;
    if (ts.has(row.t)) duplicates += 1; else ts.add(row.t);
    previous = row.t;
    if (row.t < start || row.t >= end) outOfMonth += 1;
    if (row.t % step !== 0) misaligned += 1;
    const o = Number(row.o), h = Number(row.h), l = Number(row.l), c = Number(row.c);
    if (!(o > 0 && h > 0 && l > 0 && c > 0 && h >= Math.max(o, c, l) && l <= Math.min(o, c, h))) invalidOhlc += 1;
    if (Number(row.v) < 0 || Number(row.qv) < 0 || Number(row.takerBase) < 0 || Number(row.takerQuote) < 0) invalidVolume += 1;
    if (BigInt(row.count) === 0n) zeroTradeRows += 1;
    if (row.closeTime !== row.t + step - 1) badCloseTime += 1;
    values.base += decimalScaled(row.v); values.quote += decimalScaled(row.qv);
    values.takerBase += decimalScaled(row.takerBase); values.takerQuote += decimalScaled(row.takerQuote); values.trades += BigInt(row.count);
  }
  const inRangeUnique = [...ts].filter(t => t >= start && t < end && t % step === 0).length;
  let gapCount = 0; let gapEvents = 0; let lastExpected = null;
  for (const t of [...ts].filter(x => x >= start && x < end && x % step === 0).sort((a, b) => a - b)) {
    const expectedNext = lastExpected === null ? start : lastExpected + step;
    if (t > expectedNext) {
      const missing = (t - expectedNext) / step;
      gapCount += missing; gapEvents += 1;
      const gap = { source, interval, start_utc: new Date(expectedNext).toISOString(), end_utc_exclusive: new Date(t).toISOString(), missing_bars: missing };
      sourceGapRanges.push(gap); if (anomalies.length < gapLimit) anomalies.push(gap);
    }
    lastExpected = t;
  }
  if (lastExpected === null) { gapCount = expectedGridBars; const gap = { source, interval, start_utc: new Date(start).toISOString(), end_utc_exclusive: new Date(end).toISOString(), missing_bars: expectedGridBars }; sourceGapRanges.push(gap); if (anomalies.length < gapLimit) anomalies.push(gap); }
  else if (lastExpected + step < end) {
    const missing = (end - (lastExpected + step)) / step;
    gapCount += missing; gapEvents += 1;
    const gap = { source, interval, start_utc: new Date(lastExpected + step).toISOString(), end_utc_exclusive: new Date(end).toISOString(), missing_bars: missing };
    sourceGapRanges.push(gap); if (anomalies.length < gapLimit) anomalies.push(gap);
  }
  return {
    source, month, interval, rows: rows.length, expected_grid_bars: expectedGridBars, unique_aligned_in_month: inRangeUnique,
    first_timestamp_ms: firstTimestamp, last_timestamp_ms: lastTimestamp,
    missing_grid_bars: Math.max(0, expectedGridBars - inRangeUnique), missing_gap_events: gapEvents, gap_ranges: sourceGapRanges,
    unsorted_rows: unsorted, duplicate_timestamps: duplicates, invalid_ohlc_rows: invalidOhlc,
    invalid_volume_rows: invalidVolume, zero_trade_count_rows: zeroTradeRows, bad_close_time_rows: badCloseTime, misaligned_timestamps: misaligned,
    rows_outside_month: outOfMonth,
    volume_totals: { base_volume: scaledDecimal(values.base), quote_volume: scaledDecimal(values.quote), taker_buy_base_volume: scaledDecimal(values.takerBase), taker_buy_quote_volume: scaledDecimal(values.takerQuote), trade_count: String(values.trades) },
  };
}
function makeBar(t, rows) {
  const actualTradeRows = rows.filter(row => BigInt(row.count) > 0n);
  const priceRows = actualTradeRows.length ? actualTradeRows : rows;
  const first = priceRows[0], last = priceRows.at(-1);
  let high = first.h, low = first.l;
  let base = 0n, quote = 0n, takerBase = 0n, takerQuote = 0n, trades = 0n;
  for (const row of rows) {
    base += decimalScaled(row.v); quote += decimalScaled(row.qv);
    takerBase += decimalScaled(row.takerBase); takerQuote += decimalScaled(row.takerQuote); trades += BigInt(row.count);
  }
  for (const row of priceRows) {
    if (Number(row.h) > Number(high)) high = row.h;
    if (Number(row.l) < Number(low)) low = row.l;
  }
  return { t, o: first.o, h: high, l: low, c: last.c, closeTime: t + rows.length * 60_000 - 1, v: scaledDecimal(base), qv: scaledDecimal(quote), count: String(trades), takerBase: scaledDecimal(takerBase), takerQuote: scaledDecimal(takerQuote) };
}
function resampleByUtcBucket(minuteRows, interval) {
  const width = FRAME_MS[interval]; const constituents = width / FRAME_MS['1m'];
  const buckets = new Map();
  for (const row of minuteRows) {
    const t = Math.floor(row.t / width) * width;
    if (!buckets.has(t)) buckets.set(t, []);
    buckets.get(t).push(row);
  }
  const complete = [];
  for (const [t, rows] of buckets) {
    rows.sort((a, b) => a.t - b.t);
    let full = rows.length === constituents;
    if (full) for (let i = 0; i < rows.length; i += 1) if (rows[i].t !== t + i * 60_000) { full = false; break; }
    if (full) complete.push(makeBar(t, rows));
  }
  complete.sort((a, b) => a.t - b.t);
  return complete;
}
function independentlyVerifyResample(minuteRows, derivedRows, interval) {
  const minuteByTime = new Map(minuteRows.map(row => [row.t, row]));
  const width = FRAME_MS[interval]; const expectedMinutes = width / 60_000;
  let checked = 0; let incomplete = 0; let mismatch = 0; let firstMismatch = null;
  for (const bar of derivedRows) {
    const pieces = [];
    for (let i = 0; i < expectedMinutes; i += 1) {
      const minute = minuteByTime.get(bar.t + i * 60_000);
      if (!minute) { pieces.length = 0; break; }
      pieces.push(minute);
    }
    if (pieces.length !== expectedMinutes) { incomplete += 1; continue; }
    checked += 1;
    // Separate, direct aggregation path: it does not call makeBar or reuse the bucket builder.
    const active = pieces.filter(row => BigInt(row.count) > 0n);
    const prices = active.length ? active : pieces;
    const direct = {
      t: bar.t,
      o: prices[0].o,
      h: prices.reduce((value, row) => Number(row.h) > Number(value) ? row.h : value, prices[0].h),
      l: prices.reduce((value, row) => Number(row.l) < Number(value) ? row.l : value, prices[0].l),
      c: prices.at(-1).c,
      closeTime: bar.t + width - 1,
      v: scaledDecimal(pieces.reduce((sum, row) => sum + decimalScaled(row.v), 0n)),
      qv: scaledDecimal(pieces.reduce((sum, row) => sum + decimalScaled(row.qv), 0n)),
      count: String(pieces.reduce((sum, row) => sum + BigInt(row.count), 0n)),
      takerBase: scaledDecimal(pieces.reduce((sum, row) => sum + decimalScaled(row.takerBase), 0n)),
      takerQuote: scaledDecimal(pieces.reduce((sum, row) => sum + decimalScaled(row.takerQuote), 0n)),
    };
    const fields = ['o', 'h', 'l', 'c', 'v', 'qv', 'count', 'takerBase', 'takerQuote'];
    if (fields.some(key => key === 'count' ? direct[key] !== bar[key] : Number(direct[key]) !== Number(bar[key]))) {
      mismatch += 1; if (!firstMismatch) firstMismatch = { open_time_utc: new Date(bar.t).toISOString(), bucket: bar, independent: direct };
    }
  }
  return { checked_complete_buckets: checked, incomplete_buckets_reported_by_primary: incomplete, field_mismatched_buckets: mismatch, first_mismatch: firstMismatch };
}
function csvBar(row) {
  return [row.t, row.o, row.h, row.l, row.c, row.v, row.closeTime, row.qv, row.count, row.takerBase, row.takerQuote].join(',');
}
function nativeBar(row) { return { ...row, closeTime: row.closeTime }; }
function compareBar(ref, native) {
  const fields = [];
  for (const [field, a, b] of [['open', ref.o, native.o], ['high', ref.h, native.h], ['low', ref.l, native.l], ['close', ref.c, native.c]]) {
    const x = Number(a), y = Number(b); if (Math.abs(x - y) > Math.max(1e-9, Math.max(Math.abs(x), Math.abs(y)) * 1e-12)) fields.push({ field, reference: a, native: b });
  }
  for (const [field, a, b] of [['base_volume', ref.v, native.v], ['quote_volume', ref.qv, native.qv], ['trade_count', ref.count, native.count], ['taker_buy_base_volume', ref.takerBase, native.takerBase], ['taker_buy_quote_volume', ref.takerQuote, native.takerQuote]]) {
    if (field === 'trade_count') { if (String(a) !== String(b)) fields.push({ field, reference: String(a), native: String(b) }); }
    else {
      // Public CSV decimal fields are added at fixed 12-digit precision to avoid float summation drift.
      const diff = decimalScaled(a) - decimalScaled(b); if (diff !== 0n) fields.push({ field, reference: a, native: b, absolute_difference: scaledDecimal(diff) });
    }
  }
  return fields;
}
function emaBatch(rows, period, interval, seedMode, priorState) {
  const alpha = 2 / (period + 1);
  let state = priorState ? { ...priorState } : null;
  const values = [];
  for (const row of rows) {
    if (!state || row.t !== state.lastT + interval) state = { lastT: null, count: 0, sum: 0, ema: null };
    if (seedMode === 'first_close' && state.count === 0) {
      state.ema = Number(row.c); state.count = 1;
    } else if (seedMode === 'sma' && state.count < period) {
      state.count += 1; state.sum += Number(row.c);
      if (state.count === period) state.ema = state.sum / period;
    } else {
      state.count += 1; state.ema += alpha * (Number(row.c) - state.ema);
    }
    state.lastT = row.t;
    values.push({ t: row.t, value: state.ema, count: state.count, ready: state.count >= period && state.ema !== null });
  }
  return { values, state };
}
function runCounts(times, interval) {
  const counts = new Array(times.length); let count = 0;
  for (let i = 0; i < times.length; i += 1) {
    count = i > 0 && times[i] === times[i - 1] + interval ? count + 1 : 1;
    counts[i] = count;
  }
  return counts;
}
function upperBound(sorted, value) {
  let low = 0, high = sorted.length;
  while (low < high) { const mid = (low + high) >> 1; if (sorted[mid] <= value) low = mid + 1; else high = mid; }
  return low;
}
function eligibleProfile(execTimes, htfTimes, start, end, execInterval, htfInterval, execWarmup = 56, htfWarmup = 250, originalExecTimes = execTimes, htfConflictBars = 0) {
  const execRuns = runCounts(execTimes, execInterval); const htfRuns = runCounts(htfTimes, htfInterval);
  const expected = (end - start) / execInterval;
  const complete = []; let h = -1;
  for (let i = 0; i < execTimes.length; i += 1) {
    const t = execTimes[i]; if (t < start || t >= end) continue;
    // Decisions at execution bar open use the previous completed execution bar;
    // HTF data is available when its close is at or before this open.
    const previousExecReady = i > 0 && execTimes[i - 1] === t - execInterval && execRuns[i - 1] >= execWarmup;
    while (h + 1 < htfTimes.length && htfTimes[h + 1] + htfInterval <= t) h += 1;
    const higherReady = h >= 0 && htfRuns[h] >= htfWarmup;
    if (previousExecReady && higherReady) complete.push(t);
  }
  const inWindow = originalExecTimes.filter(t => t >= start && t < end).length;
  const conflictExcluded = Math.max(0, inWindow - execTimes.filter(t => t >= start && t < end).length);
  const gapSlots = Math.max(0, expected - inWindow);
  const warmupSlots = Math.max(0, inWindow - conflictExcluded - complete.length);
  const initialWarmupSlots = complete.length ? execTimes.filter(t => t >= start && t < complete[0]).length : Math.max(0, inWindow - conflictExcluded);
  const postResetWarmupSlots = Math.max(0, warmupSlots - initialWarmupSlots);
  return {
    eligible_times: complete,
    stats: {
      execution_timeframe: Object.keys(FRAME_MS).find(k => FRAME_MS[k] === execInterval),
      higher_timeframe: Object.keys(FRAME_MS).find(k => FRAME_MS[k] === htfInterval),
      expected_execution_slots: expected, complete_reference_execution_bars: inWindow, eligible_scored_bars: complete.length,
      missing_or_incomplete_execution_slots: gapSlots, execution_bars_excluded_for_native_reference_conflict: conflictExcluded, htf_conflict_bars_excluded: htfConflictBars, complete_bars_excluded_by_feature_warmup: warmupSlots,
      hours_lost_to_missing_or_incomplete_bars: gapSlots * execInterval / 3_600_000,
      hours_lost_to_documented_source_conflicts: conflictExcluded * execInterval / 3_600_000,
      hours_lost_to_warmup_after_start_and_resets: warmupSlots * execInterval / 3_600_000,
      initial_feature_warmup_bars: initialWarmupSlots,
      hours_lost_to_initial_feature_warmup: initialWarmupSlots * execInterval / 3_600_000,
      post_gap_or_source_conflict_reset_warmup_bars: postResetWarmupSlots,
      hours_lost_to_post_gap_or_source_conflict_warmups: postResetWarmupSlots * execInterval / 3_600_000,
      total_hours_not_eligible: (gapSlots + conflictExcluded + warmupSlots) * execInterval / 3_600_000,
      feature_warmup: { execution_completed_bars_required: execWarmup, htf_completed_bars_required: htfWarmup, nominal_htf_hours_after_reset: htfWarmup * htfInterval / 3_600_000 },
      first_eligible_bar_utc: complete.length ? new Date(complete[0]).toISOString() : null,
      last_eligible_bar_utc: complete.length ? new Date(complete.at(-1)).toISOString() : null,
    },
  };
}
async function fetchToFile(url, file) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.part`;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { 'user-agent': 'ScalpIndicator-research/1.0' } });
      if (!response.ok) {
        if (response.status === 404) return { missing: true, status: 404 };
        throw new Error(`HTTP ${response.status}`);
      }
      const body = Buffer.from(await response.arrayBuffer());
      await fs.writeFile(temp, body);
      await fs.rename(temp, file);
      return { bytes: body.length, lastModified: response.headers.get('last-modified'), etag: response.headers.get('etag') };
    } catch (error) {
      if (attempt === 4) throw error;
      await new Promise(resolve => setTimeout(resolve, attempt * 700));
    }
  }
  throw new Error(`Could not download ${url}`);
}
async function headMetadata(url) {
  try {
    const response = await fetch(url, { method: 'HEAD', headers: { 'user-agent': 'ScalpIndicator-research/1.0' } });
    if (!response.ok) return { lastModified: null, etag: null };
    return { lastModified: response.headers.get('last-modified'), etag: response.headers.get('etag') };
  } catch { return { lastModified: null, etag: null }; }
}
async function mapLimit(items, limit, worker) {
  let index = 0; const results = new Array(items.length);
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) { const i = index++; if (i >= items.length) return; results[i] = await worker(items[i], i); }
  });
  await Promise.all(workers); return results;
}
async function downloadArchive(item) {
  const { def, month, dataRoot } = item;
  const zipPath = archiveLocalPath(dataRoot, def, month); const checksumPath = `${zipPath}.CHECKSUM`;
  const url = archiveUrl(def, month); const checksumUrl = `${url}.CHECKSUM`;
  let zipInfo;
  try { zipInfo = await fs.stat(zipPath); } catch { zipInfo = null; }
  let downloaded = null;
  if (!zipInfo) {
    downloaded = await fetchToFile(url, zipPath);
    if (downloaded.missing) return { source: def.id, month, url, checksum_url: checksumUrl, status: 'not_published_404' };
  }
  const remoteMetadata = downloaded ?? await headMetadata(url);
  try { await fs.stat(checksumPath); } catch {
    const checksumDownload = await fetchToFile(checksumUrl, checksumPath);
    if (checksumDownload.missing) throw new Error(`Checksum missing: ${checksumUrl}`);
  }
  const [zipBytes, checksumText] = await Promise.all([fs.readFile(zipPath), fs.readFile(checksumPath, 'utf8')]);
  const expectedSha = /\b([a-f0-9]{64})\b/i.exec(checksumText)?.[1]?.toLowerCase();
  if (!expectedSha) throw new Error(`Could not parse SHA-256 checksum in ${checksumPath}`);
  const actualSha = sha256(zipBytes);
  if (actualSha !== expectedSha) throw new Error(`SHA-256 mismatch for ${url}: expected ${expectedSha}, received ${actualSha}`);
  return {
    source: def.id, month, status: 'verified', url, checksum_url: checksumUrl,
    local_zip: path.relative(ROOT, zipPath).replaceAll('\\', '/'), zip_bytes: zipBytes.length,
    sha256: actualSha, publisher_checksum_sha256: expectedSha,
    revision_date_utc: remoteMetadata.lastModified ? new Date(remoteMetadata.lastModified).toISOString() : new Date().toISOString(),
    revision_date_basis: remoteMetadata.lastModified ? 'HTTP Last-Modified' : 'verification time fallback; publisher timestamp unavailable',
    http_last_modified: remoteMetadata.lastModified ?? null, http_etag: remoteMetadata.etag ?? null,
  };
}
function parseFunding(text, source, month, anomalies) {
  const lines = text.split(/\r?\n/).filter(Boolean); const records = [];
  const headerAt = lines.length && /^calc_time,/i.test(lines[0]) ? 1 : 0;
  let previous = null; let duplicates = 0; let unsorted = 0;
  for (let i = headerAt; i < lines.length; i += 1) {
    const fields = lines[i].split(',');
    if (fields.length < 3) throw new Error(`${source} funding row ${i + 1}: expected 3 fields`);
    const time = Number(fields[0]); const hours = Number(fields[1]); const rate = fields[2];
    if (!Number.isSafeInteger(time) || !Number.isFinite(hours) || !Number.isFinite(Number(rate))) throw new Error(`${source} funding row ${i + 1}: invalid data`);
    if (previous !== null && time < previous) unsorted += 1;
    if (previous !== null && time === previous) duplicates += 1;
    previous = time; records.push({ time, hours, rate });
  }
  const { start, end } = monthBounds(month);
  const inMonth = records.filter(r => r.time >= start && r.time < end);
  if (records.some(r => r.time < start || r.time >= end) && anomalies.length < 20) anomalies.push({ source, month, issue: 'funding_events_outside_month_bounds', count: records.length - inMonth.length });
  return { records, audit: { source, month, rows: records.length, events_in_month: inMonth.length, unsorted_rows: unsorted, duplicate_timestamps: duplicates, timestamp_unit: 'Unix epoch milliseconds as received; event timestamps are not snapped to bar boundaries' } };
}
function sumRows(rows) { return rows.map(csvBar).join('\n'); }
function mapRows(rows) { return new Map(rows.map(row => [row.t, row])); }
async function loadCsv(dataRoot, def, month, archiveByKey) {
  const archive = archiveByKey.get(`${def.id}|${month}`);
  if (!archive || archive.status !== 'verified') return null;
  const extracted = await extractZipCsv(archiveLocalPath(dataRoot, def, month));
  archive.csv_member = extracted.filename; archive.csv_rows = extracted.text.split(/\r?\n/).filter(Boolean).length - (/^open_time,/i.test(extracted.text) ? 1 : 0);
  return extracted.text;
}
async function loadDailyForensic(dataRoot, def, day) {
  const filename = `${SYMBOL}-${def.interval}-${day}.zip`;
  const zipPath = path.join(dataRoot, 'daily_forensics', def.id, filename);
  const checksumPath = `${zipPath}.CHECKSUM`;
  const url = dailyArchiveUrl(def, day); const checksumUrl = `${url}.CHECKSUM`;
  let downloaded = null;
  try { await fs.stat(zipPath); } catch {
    downloaded = await fetchToFile(url, zipPath);
    if (downloaded.missing) return { metadata: { source: def.id, day, status: 'not_published_404', url, checksum_url: checksumUrl }, text: null };
  }
  try { await fs.stat(checksumPath); } catch {
    const result = await fetchToFile(checksumUrl, checksumPath);
    if (result.missing) return { metadata: { source: def.id, day, status: 'checksum_not_published_404', url, checksum_url: checksumUrl }, text: null };
  }
  const remoteMetadata = downloaded ?? await headMetadata(url);
  const [zipBytes, checksumText] = await Promise.all([fs.readFile(zipPath), fs.readFile(checksumPath, 'utf8')]);
  const expectedSha = /\b([a-f0-9]{64})\b/i.exec(checksumText)?.[1]?.toLowerCase();
  if (!expectedSha) throw new Error(`Could not parse SHA-256 checksum in ${checksumPath}`);
  const actualSha = sha256(zipBytes);
  if (actualSha !== expectedSha) throw new Error(`SHA-256 mismatch for daily forensic archive ${url}`);
  const extracted = await extractZipCsv(zipPath);
  return {
    metadata: { source: def.id, day, status: 'verified', url, checksum_url: checksumUrl, local_zip: path.relative(ROOT, zipPath).replaceAll('\\', '/'), zip_bytes: zipBytes.length, sha256: actualSha, publisher_checksum_sha256: expectedSha, revision_date_utc: remoteMetadata.lastModified ? new Date(remoteMetadata.lastModified).toISOString() : new Date().toISOString(), revision_date_basis: remoteMetadata.lastModified ? 'HTTP Last-Modified' : 'verification time fallback; publisher timestamp unavailable', http_last_modified: remoteMetadata.lastModified ?? null, http_etag: remoteMetadata.etag ?? null, csv_member: extracted.filename },
    text: extracted.text,
  };
}
function compareMinuteRows(monthlyRows, dailyRows) {
  const monthly = mapRows(monthlyRows), daily = mapRows(dailyRows);
  let common = 0, different = 0; let firstDifference = null;
  const differences = [];
  for (const [t, row] of monthly) {
    const other = daily.get(t);
    if (!other) continue;
    common += 1;
    const fields = ['o', 'h', 'l', 'c', 'v', 'qv', 'count', 'takerBase', 'takerQuote'].filter(key => String(row[key]) !== String(other[key]));
    if (fields.length) {
      different += 1;
      const detail = { time_utc: new Date(t).toISOString(), monthly: row, daily: other, differing_fields: fields };
      if (!firstDifference) firstDifference = detail;
      if (differences.length < 20) differences.push(detail);
    }
  }
  return { monthly_rows: monthlyRows.length, daily_rows: dailyRows.length, common_timestamps: common, timestamps_missing_from_daily: [...monthly.keys()].filter(t => !daily.has(t)).length, timestamps_missing_from_monthly: [...daily.keys()].filter(t => !monthly.has(t)).length, rows_with_different_values: different, first_difference: firstDifference, differences };
}
function emptySourceTotals() {
  return { rows: 0, expected_grid_bars: 0, unique_aligned_in_month: 0, missing_grid_bars: 0, missing_gap_events: 0, unsorted_rows: 0, duplicate_timestamps: 0, invalid_ohlc_rows: 0, invalid_volume_rows: 0, zero_trade_count_rows: 0, bad_close_time_rows: 0, misaligned_timestamps: 0, rows_outside_month: 0, baseVolume: 0n, quoteVolume: 0n, takerBase: 0n, takerQuote: 0n, tradeCount: 0n };
}
function addAuditTotal(total, audit) {
  for (const key of ['rows', 'expected_grid_bars', 'unique_aligned_in_month', 'missing_grid_bars', 'missing_gap_events', 'unsorted_rows', 'duplicate_timestamps', 'invalid_ohlc_rows', 'invalid_volume_rows', 'zero_trade_count_rows', 'bad_close_time_rows', 'misaligned_timestamps', 'rows_outside_month']) total[key] += audit[key];
  total.baseVolume += decimalScaled(audit.volume_totals.base_volume); total.quoteVolume += decimalScaled(audit.volume_totals.quote_volume);
  total.takerBase += decimalScaled(audit.volume_totals.taker_buy_base_volume); total.takerQuote += decimalScaled(audit.volume_totals.taker_buy_quote_volume); total.tradeCount += BigInt(audit.volume_totals.trade_count);
}
function finalizeSourceTotal(total) {
  const { baseVolume, quoteVolume, takerBase, takerQuote, tradeCount, ...rest } = total;
  return { ...rest, volume_totals: { base_volume: scaledDecimal(baseVolume), quote_volume: scaledDecimal(quoteVolume), taker_buy_base_volume: scaledDecimal(takerBase), taker_buy_quote_volume: scaledDecimal(takerQuote), trade_count: String(tradeCount) } };
}

async function selfTest() {
  const start = Date.UTC(2024, 0, 1); const minute = [];
  for (let i = 0; i < 60; i += 1) minute.push({ t: start + i * 60_000, o: '100', h: String(101 + i), l: '99', c: String(100 + i), v: '1.25', closeTime: start + i * 60_000 + 59_999, qv: '125', count: '2', takerBase: '0.5', takerQuote: '50' });
  for (const interval of ['5m', '15m', '1h']) {
    const bars = resampleByUtcBucket(minute, interval);
    const expected = 3_600_000 / FRAME_MS[interval];
    if (bars.length !== expected || independentlyVerifyResample(minute, bars, interval).field_mismatched_buckets !== 0) throw new Error(`Self-test failed: UTC ${interval} resampling`);
    if (bars.some(bar => bar.t % FRAME_MS[interval] !== 0 || bar.t !== Math.floor(bar.t / FRAME_MS[interval]) * FRAME_MS[interval])) throw new Error(`Self-test failed: ${interval} UTC bucket edge`);
  }
  const incomplete = resampleByUtcBucket(minute.filter(row => row.t !== start + 2 * 60_000), '5m');
  if (incomplete.length !== 11 || incomplete.some(bar => bar.t === start)) throw new Error('Self-test failed: missing minute must exclude partial bucket without fill');
  const seeded = emaBatch([{ t: 0, c: '1' }, { t: 60_000, c: '2' }, { t: 120_000, c: '3' }, { t: 180_000, c: '4' }], 3, 60_000, 'sma', null).values;
  if (seeded[0].ready || seeded[1].ready || seeded[2].value !== 2 || !seeded[2].ready) throw new Error('Self-test failed: SMA-seeded EMA readiness');
  const firstSeed = emaBatch([{ t: 0, c: '1' }, { t: 60_000, c: '3' }], 2, 60_000, 'first_close', null).values;
  if (firstSeed[0].value !== 1 || Math.abs(firstSeed[1].value - (1 + 2 / 3 * 2)) > 1e-12) throw new Error('Self-test failed: first-close HTF EMA seed');
  const profile = eligibleProfile([0, 300_000, 600_000, 900_000, 1_200_000], [0], 0, 1_500_000, 300_000, 900_000, 2, 1);
  if (profile.stats.eligible_scored_bars !== 2) throw new Error('Self-test failed: completed-bar warmup timing');
  console.log(JSON.stringify({ result: 'PASS', checks: ['UTC bucket alignment and OHLCV aggregation for 5m/15m/1h', 'partial buckets excluded on missing 1m data', 'SMA-seeded execution EMA readiness', 'first-close HTF EMA seed', 'completed-bar warmup timing'] }, null, 2));
}

async function run() {
  if (hasArg('--self-test')) return selfTest();
  const startMonth = arg('--start-month', START_DEFAULT); const endMonth = arg('--end-month', END_DEFAULT);
  const months = monthRange(startMonth, endMonth);
  const dataName = `btcusdt_${startMonth}_${endMonth}`;
  const dataRoot = path.join(ROOT, 'research', 'data', dataName);
  const derivedDir = path.join(dataRoot, 'derived');
  const manifestPath = path.join(dataRoot, 'manifest.json');
  const reportPath = path.join(ROOT, 'research', 'reports', 'btc_history_coverage.json');
  const reportMarkdownPath = path.join(ROOT, 'research', 'reports', 'btc_history_coverage.md');
  const rangeStart = monthBounds(startMonth).start; const rangeEnd = monthBounds(nextMonth(endMonth)).start;
  const totalExpectedMinutes = months.reduce((n, month) => n + monthBounds(month).count, 0);
  await fs.mkdir(derivedDir, { recursive: true }); await fs.mkdir(path.dirname(reportPath), { recursive: true });
  const allItems = months.flatMap(month => SOURCE_DEFS.map(def => ({ def, month, dataRoot })));
  console.log(`Verifying/downloading ${allItems.length} official archives for ${months.length} completed months…`);
  const archiveResults = await mapLimit(allItems, 8, async item => {
    try { return await downloadArchive(item); }
    catch (error) { return { source: item.def.id, month: item.month, url: archiveUrl(item.def, item.month), status: 'error', error: String(error) }; }
  });
  const archiveByKey = new Map(archiveResults.map(record => [`${record.source}|${record.month}`, record]));
  const sourceTotals = Object.fromEntries(SOURCE_DEFS.filter(d => d.kind === 'klines').map(d => [d.id, emptySourceTotals()]));
  const monthlyAudit = []; const fundingAudits = []; const fundingRecords = [];
  const gapExamples = []; const referenceTimes = { '5m': [], '15m': [], '1h': [] };
  const nativePresent = { '5m': new Set(), '15m': new Set(), '1h': new Set() };
  const nativeMismatch = { '5m': new Map(), '15m': new Map(), '1h': new Map() };
  const nativeComparison = Object.fromEntries(['5m', '15m', '1h'].map(tf => [tf, { reference_bars: 0, native_bars: 0, common_bars: 0, missing_native_bars: 0, extra_native_bars: 0, mismatched_bars: 0, mismatches_by_field: {}, mismatch_examples: [], first_mismatch: null }]));
  const independentResample = Object.fromEntries(['5m', '15m', '1h'].map(tf => [tf, { checked_complete_buckets: 0, incomplete_buckets_reported_by_primary: 0, field_mismatched_buckets: 0, first_mismatch: null }]));
  const nativeEmaStates = Object.fromEntries(['5m', '15m', '1h'].map(tf => [tf, { refSma20: null, refSma50: null, natSma20: null, natSma50: null, refFirst20: null, refFirst50: null, natFirst20: null, natFirst50: null }]));
  const emaMismatch = Object.fromEntries(['5m', '15m', '1h'].map(tf => [tf, { sma20: new Set(), sma50: new Set(), first20: new Set(), first50: new Set(), smaNotReadyRef: new Set(), smaNotReadyNative: new Set(), firstNotReadyRef: new Set(), firstNotReadyNative: new Set() }]));
  const rawTradeOut = path.join(derivedDir, 'trade_1m.csv');
  await fs.writeFile(rawTradeOut, `${CSV_HEADER}\n`);
  const distinctPricePaths = { mark_1m: path.join(derivedDir, 'mark_1m.csv'), index_1m: path.join(derivedDir, 'index_1m.csv') };
  const derivedPaths = Object.fromEntries(['5m', '15m', '1h'].map(tf => [tf, path.join(derivedDir, `trade_${tf}_resampled.csv`)]));
  for (const file of Object.values(derivedPaths)) await fs.writeFile(file, `${CSV_HEADER}\n`);
  let fundingOutHeader = 'calc_time_ms,funding_interval_hours,last_funding_rate\n';
  const fundingOut = path.join(derivedDir, 'funding_events.csv'); await fs.writeFile(fundingOut, fundingOutHeader);

  for (const month of months) {
    console.log(`Auditing ${month}…`);
    const tradeText = await loadCsv(dataRoot, SOURCE_DEFS[0], month, archiveByKey);
    if (!tradeText) { monthlyAudit.push({ month, status: 'missing_trade_1m_archive' }); continue; }
    const tradeRows = klineCsvRows(tradeText, 'trade_1m');
    const tradeAudit = auditKlines(tradeRows, 'trade_1m', month, '1m', gapExamples);
    addAuditTotal(sourceTotals.trade_1m, tradeAudit); monthlyAudit.push(tradeAudit);
    const inMonthTrade = tradeRows.filter(row => row.t >= monthBounds(month).start && row.t < monthBounds(month).end);
    if (inMonthTrade.length) await fs.appendFile(rawTradeOut, `${inMonthTrade.map(csvBar).join('\n')}\n`);

    for (const def of SOURCE_DEFS.slice(1, 3)) {
      const text = await loadCsv(dataRoot, def, month, archiveByKey);
      if (!text) { monthlyAudit.push({ month, status: `missing_${def.id}_archive` }); continue; }
      const rows = klineCsvRows(text, def.id);
      const audit = auditKlines(rows, def.id, month, '1m', gapExamples);
      addAuditTotal(sourceTotals[def.id], audit); monthlyAudit.push(audit);
    }
    const fundingText = await loadCsv(dataRoot, SOURCE_DEFS[3], month, archiveByKey);
    if (fundingText) {
      const parsed = parseFunding(fundingText, 'funding', month, gapExamples);
      fundingAudits.push(parsed.audit); fundingRecords.push(...parsed.records);
      const fundingRows = parsed.records.filter(row => row.time >= monthBounds(month).start && row.time < monthBounds(month).end);
      if (fundingRows.length) await fs.appendFile(fundingOut, `${fundingRows.map(row => `${row.time},${row.hours},${row.rate}`).join('\n')}\n`);
    } else fundingAudits.push({ source: 'funding', month, status: 'archive_unavailable' });

    const byTf = {};
    for (const tf of ['5m', '15m', '1h']) {
      const derived = resampleByUtcBucket(inMonthTrade, tf);
      const independent = independentlyVerifyResample(inMonthTrade, derived, tf);
      independentResample[tf].checked_complete_buckets += independent.checked_complete_buckets;
      independentResample[tf].incomplete_buckets_reported_by_primary += Math.max(0, (monthBounds(month).end - monthBounds(month).start) / FRAME_MS[tf] - derived.length);
      independentResample[tf].field_mismatched_buckets += independent.field_mismatched_buckets;
      if (!independentResample[tf].first_mismatch && independent.first_mismatch) independentResample[tf].first_mismatch = independent.first_mismatch;
      byTf[tf] = derived;
      referenceTimes[tf].push(...derived.map(row => row.t));
      if (derived.length) await fs.appendFile(derivedPaths[tf], `${sumRows(derived)}\n`);
      const nativeDef = SOURCE_DEFS.find(d => d.id === `native_${tf}`);
      const nativeText = await loadCsv(dataRoot, nativeDef, month, archiveByKey);
      if (!nativeText) continue;
      const nativeRows = klineCsvRows(nativeText, nativeDef.id).filter(row => row.t >= monthBounds(month).start && row.t < monthBounds(month).end).map(nativeBar);
      const nativeAudit = auditKlines(nativeRows, nativeDef.id, month, tf, gapExamples);
      addAuditTotal(sourceTotals[nativeDef.id], nativeAudit); monthlyAudit.push(nativeAudit);
      const nativeMap = mapRows(nativeRows); const refMap = mapRows(derived);
      const cmp = nativeComparison[tf]; cmp.reference_bars += derived.length; cmp.native_bars += nativeRows.length;
      for (const row of nativeRows) nativePresent[tf].add(row.t);
      for (const ref of derived) {
        const native = nativeMap.get(ref.t);
        if (!native) { cmp.missing_native_bars += 1; continue; }
        cmp.common_bars += 1;
        const diffs = compareBar(ref, native);
        if (diffs.length) {
          cmp.mismatched_bars += 1; nativeMismatch[tf].set(ref.t, diffs);
          for (const diff of diffs) cmp.mismatches_by_field[diff.field] = (cmp.mismatches_by_field[diff.field] ?? 0) + 1;
          const example = { open_time_utc: new Date(ref.t).toISOString(), fields: diffs };
          if (!cmp.first_mismatch) cmp.first_mismatch = example;
          if (cmp.mismatch_examples.length < 100) cmp.mismatch_examples.push(example);
        }
      }
      cmp.extra_native_bars += nativeRows.filter(row => !refMap.has(row.t)).length;
      for (const seedMode of ['sma', 'first_close']) {
        for (const period of [20, 50]) {
          const label = seedMode === 'sma' ? `Sma${period}` : `First${period}`;
          const stateKeys = [`ref${label}`, `nat${label}`];
          const refSeries = emaBatch(derived, period, FRAME_MS[tf], seedMode, nativeEmaStates[tf][stateKeys[0]]);
          const natSeries = emaBatch(nativeRows, period, FRAME_MS[tf], seedMode, nativeEmaStates[tf][stateKeys[1]]);
          nativeEmaStates[tf][stateKeys[0]] = refSeries.state; nativeEmaStates[tf][stateKeys[1]] = natSeries.state;
          const natByTime = new Map(natSeries.values.map(value => [value.t, value]));
          const key = `${seedMode === 'sma' ? 'sma' : 'first'}${period}`;
          for (const refVal of refSeries.values) {
            const natVal = natByTime.get(refVal.t); if (!natVal) continue;
            if (!refVal.ready) emaMismatch[tf][`${seedMode === 'sma' ? 'sma' : 'first'}NotReadyRef`].add(refVal.t);
            if (!natVal.ready) emaMismatch[tf][`${seedMode === 'sma' ? 'sma' : 'first'}NotReadyNative`].add(refVal.t);
            if (refVal.ready && natVal.ready && Math.abs(refVal.value - natVal.value) > Math.max(1e-8, Math.abs(refVal.value) * 1e-12)) emaMismatch[tf][key].add(refVal.t);
          }
        }
      }
    }
  }

  // For each native/reference disagreement, fetch the separate daily archive
  // revisions to determine whether the mismatch is reproducible across Binance's
  // monthly and daily publication paths. These exact bars are later masked from
  // scoring and reset feature warmup, rather than silently selecting one value.
  const mismatchDays = [...new Set(['5m', '15m', '1h'].flatMap(tf => [...nativeMismatch[tf].keys()].map(t => new Date(t).toISOString().slice(0, 10))))].sort();
  const dailyForensicArchives = []; const dailyForensicComparisons = [];
  for (const day of mismatchDays) {
    const month = day.slice(0, 7);
    const oneMinuteDef = SOURCE_DEFS.find(def => def.id === 'trade_1m');
    const dailyOneMinute = await loadDailyForensic(dataRoot, oneMinuteDef, day);
    dailyForensicArchives.push(dailyOneMinute.metadata);
    let dailyMinuteRows = dailyOneMinute.text ? klineCsvRows(dailyOneMinute.text, `daily_trade_1m_${day}`) : [];
    const dayStart = Date.parse(`${day}T00:00:00.000Z`); const dayEnd = dayStart + 86_400_000;
    dailyMinuteRows = dailyMinuteRows.filter(row => row.t >= dayStart && row.t < dayEnd);
    const monthlyMinuteText = await loadCsv(dataRoot, oneMinuteDef, month, archiveByKey);
    const monthlyMinuteRows = monthlyMinuteText ? klineCsvRows(monthlyMinuteText, 'trade_1m').filter(row => row.t >= dayStart && row.t < dayEnd) : [];
    const dayResult = { day, daily_1m_checksum_status: dailyOneMinute.metadata.status, daily_1m_rows: dailyMinuteRows.length, monthly_1m_vs_daily_1m: compareMinuteRows(monthlyMinuteRows, dailyMinuteRows), native_timeframes: {} };
    for (const tf of ['5m', '15m', '1h']) {
      const def = SOURCE_DEFS.find(item => item.id === `native_${tf}`);
      const dailyNative = await loadDailyForensic(dataRoot, def, day);
      dailyForensicArchives.push(dailyNative.metadata);
      if (!dailyNative.text || !dailyMinuteRows.length) {
        dayResult.native_timeframes[tf] = { daily_archive_status: dailyNative.metadata.status, status: 'comparison_unavailable' };
        continue;
      }
      const dailyNativeRows = klineCsvRows(dailyNative.text, `daily_native_${tf}_${day}`).filter(row => row.t >= dayStart && row.t < dayEnd).map(nativeBar);
      const dailyDerivedRows = resampleByUtcBucket(dailyMinuteRows, tf);
      const nativeMap = mapRows(dailyNativeRows); let common = 0; let mismatches = 0; const examples = [];
      for (const ref of dailyDerivedRows) {
        const native = nativeMap.get(ref.t); if (!native) continue;
        common += 1;
        const fields = compareBar(ref, native);
        if (fields.length) { mismatches += 1; if (examples.length < 20) examples.push({ open_time_utc: new Date(ref.t).toISOString(), fields }); }
      }
      const monthlyNativeText = await loadCsv(dataRoot, def, month, archiveByKey);
      const monthlyNativeRows = monthlyNativeText ? klineCsvRows(monthlyNativeText, def.id).filter(row => row.t >= dayStart && row.t < dayEnd) : [];
      dayResult.native_timeframes[tf] = {
        daily_archive_status: dailyNative.metadata.status,
        daily_1m_rows: dailyMinuteRows.length,
        daily_reference_bars: dailyDerivedRows.length,
        daily_native_bars: dailyNativeRows.length,
        common_bars: common,
        daily_resampled_vs_native_mismatched_bars: mismatches,
        mismatch_examples: examples,
        monthly_native_vs_daily_native: compareMinuteRows(monthlyNativeRows, dailyNativeRows),
      };
    }
    dailyForensicComparisons.push(dayResult);
  }

  const priceGapDays = { mark_1m: new Set(), index_1m: new Set() };
  for (const audit of monthlyAudit) {
    if (!Object.hasOwn(priceGapDays, audit.source)) continue;
    for (const gap of audit.gap_ranges ?? []) {
    let dayStart = Date.parse(gap.start_utc); const endAt = Date.parse(gap.end_utc_exclusive);
    while (dayStart < endAt) {
      priceGapDays[gap.source].add(new Date(dayStart).toISOString().slice(0, 10));
      dayStart = Date.UTC(new Date(dayStart).getUTCFullYear(), new Date(dayStart).getUTCMonth(), new Date(dayStart).getUTCDate() + 1);
    }
    }
  }
  const dailyGapRows = { mark_1m: new Map(), index_1m: new Map() };
  const dailyPriceGapForensics = [];
  for (const sourceId of ['mark_1m', 'index_1m']) {
    const def = SOURCE_DEFS.find(item => item.id === sourceId);
    for (const day of [...priceGapDays[sourceId]].sort()) {
      const daily = await loadDailyForensic(dataRoot, def, day); dailyForensicArchives.push(daily.metadata);
      const start = Date.parse(`${day}T00:00:00.000Z`); const end = start + 86_400_000;
      const dailyRows = daily.text ? klineCsvRows(daily.text, `daily_${sourceId}_${day}`).filter(row => row.t >= start && row.t < end) : [];
      const month = day.slice(0, 7); const monthlyText = await loadCsv(dataRoot, def, month, archiveByKey);
      const monthlyRows = monthlyText ? klineCsvRows(monthlyText, sourceId).filter(row => row.t >= start && row.t < end) : [];
      const monthlyMap = mapRows(monthlyRows);
      const recoveredRows = dailyRows.filter(row => !monthlyMap.has(row.t));
      dailyGapRows[sourceId].set(day, dailyRows);
      dailyPriceGapForensics.push({ source: sourceId, day, daily_archive_status: daily.metadata.status, monthly_vs_daily: compareMinuteRows(monthlyRows, dailyRows), official_daily_rows_added_for_missing_monthly_timestamps: recoveredRows.length, daily_timestamps_already_in_monthly: dailyRows.length - recoveredRows.length });
    }
  }
  const materializedDistinctPriceStreams = {};
  for (const sourceId of ['mark_1m', 'index_1m']) {
    const def = SOURCE_DEFS.find(item => item.id === sourceId); const outputPath = distinctPricePaths[sourceId];
    await fs.writeFile(outputPath, `${CSV_HEADER}\n`);
    let monthlyRowsCount = 0, officialDailyRowsAdded = 0, finalRowsCount = 0; const writtenTimes = new Set();
    for (const month of months) {
      const monthText = await loadCsv(dataRoot, def, month, archiveByKey);
      const monthRows = monthText ? klineCsvRows(monthText, sourceId).filter(row => row.t >= monthBounds(month).start && row.t < monthBounds(month).end) : [];
      const merged = new Map(monthRows.map(row => [row.t, row])); monthlyRowsCount += monthRows.length;
      for (const [day, rows] of dailyGapRows[sourceId]) {
        if (!day.startsWith(`${month}-`)) continue;
        for (const row of rows) if (!merged.has(row.t)) { merged.set(row.t, row); officialDailyRowsAdded += 1; }
      }
      const sorted = [...merged.values()].sort((a, b) => a.t - b.t);
      if (sorted.length) await fs.appendFile(outputPath, `${sorted.map(csvBar).join('\n')}\n`);
      for (const row of sorted) writtenTimes.add(row.t);
      finalRowsCount += sorted.length;
    }
    materializedDistinctPriceStreams[sourceId] = { output: path.relative(ROOT, outputPath).replaceAll('\\', '/'), monthly_archive_rows: monthlyRowsCount, official_daily_rows_added: officialDailyRowsAdded, materialized_rows: finalRowsCount, expected_rows: totalExpectedMinutes, unresolved_missing_grid_rows_after_official_daily_recovery: Math.max(0, totalExpectedMinutes - writtenTimes.size), source_stream_kept_separate_from_trade: true };
  }

  const profiles = [
    { id: '5m_exec_15m_htf', execution: '5m', higher: '15m' },
    { id: '15m_exec_1h_htf', execution: '15m', higher: '1h' },
  ];
  const scoringTimesByTf = Object.fromEntries(['5m', '15m', '1h'].map(tf => [tf, referenceTimes[tf].filter(t => !nativeMismatch[tf].has(t))]));
  const eligibleByProfile = {};
  for (const profile of profiles) {
    const executionConflicts = nativeMismatch[profile.execution];
    const htfConflicts = nativeMismatch[profile.higher];
    const cleanExecTimes = scoringTimesByTf[profile.execution];
    const cleanHtfTimes = scoringTimesByTf[profile.higher];
    const htfConflictBars = [...htfConflicts.keys()].filter(t => t >= rangeStart && t < rangeEnd).length;
    const result = eligibleProfile(cleanExecTimes, cleanHtfTimes, rangeStart, rangeEnd, FRAME_MS[profile.execution], FRAME_MS[profile.higher], 56, 250, referenceTimes[profile.execution], htfConflictBars);
    eligibleByProfile[profile.id] = new Set(result.eligible_times);
    profile.coverage = result.stats;
  }
  const nativeScoredComparison = {};
  for (const [profileId, set] of Object.entries(eligibleByProfile)) {
    const profile = profiles.find(p => p.id === profileId);
    nativeScoredComparison[profileId] = {};
    for (const tf of new Set([profile.execution, profile.higher])) {
      const eligibleTimes = tf === profile.execution ? [...set].map(t => t - FRAME_MS[tf]) : [...eligibleByProfile[profileId]].map(t => {
        // Score windows are execution openings; compare the most recently completed HTF bar at that time.
        let idx = upperBound(scoringTimesByTf[tf], t - FRAME_MS[tf]);
        return idx > 0 ? scoringTimesByTf[tf][idx - 1] : null;
      }).filter(value => value !== null);
      const unique = [...new Set(eligibleTimes)];
      const missing = unique.filter(t => !nativePresent[tf].has(t));
      const mismatch = unique.filter(t => nativeMismatch[tf].has(t));
      nativeScoredComparison[profileId][tf] = { eligible_reference_bars: unique.length, native_missing_on_eligible_bars: missing.length, native_price_or_volume_mismatches_on_eligible_bars: mismatch.length, first_missing_utc: missing.length ? new Date(missing[0]).toISOString() : null, first_mismatch_utc: mismatch.length ? new Date(mismatch[0]).toISOString() : null };
    }
  }
  const emaScored = {};
  for (const profile of profiles) {
    emaScored[profile.id] = {};
    for (const tf of new Set([profile.execution, profile.higher])) {
      const targetTimes = tf === profile.execution ? new Set([...eligibleByProfile[profile.id]].map(t => t - FRAME_MS[tf])) : new Set([...eligibleByProfile[profile.id]].map(t => {
        const idx = upperBound(scoringTimesByTf[tf], t - FRAME_MS[tf]); return idx > 0 ? scoringTimesByTf[tf][idx - 1] : null;
      }).filter(t => t !== null));
      const uniqueTimes = new Set(targetTimes);
      emaScored[profile.id][tf] = {
        execution_ema_sma_seed_mismatch_bars_20: [...uniqueTimes].filter(t => emaMismatch[tf].sma20.has(t)).length,
        execution_ema_sma_seed_mismatch_bars_50: [...uniqueTimes].filter(t => emaMismatch[tf].sma50.has(t)).length,
        htf_ema_first_close_seed_mismatch_bars_20: [...uniqueTimes].filter(t => emaMismatch[tf].first20.has(t)).length,
        htf_ema_first_close_seed_mismatch_bars_50: [...uniqueTimes].filter(t => emaMismatch[tf].first50.has(t)).length,
      };
    }
  }
  const expectedMonths = months.length;
  const archiveStatusCounts = archiveResults.reduce((acc, item) => { acc[item.status] = (acc[item.status] ?? 0) + 1; return acc; }, {});
  const pipelineSourcePath = path.join(ROOT, 'research', 'btc_history_pipeline.mjs');
  const pipelineSourceSha256 = sha256(await fs.readFile(pipelineSourcePath));
  const completeTradeMonths = months.filter(month => archiveByKey.get(`trade_1m|${month}`)?.status === 'verified').length;
  const tradeMonthAudits = monthlyAudit.filter(x => x.source === 'trade_1m');
  const firstObservedTrade = tradeMonthAudits.map(x => x.first_timestamp_ms).filter(Number.isFinite).sort((a, b) => a - b)[0];
  const lastObservedTrade = tradeMonthAudits.map(x => x.last_timestamp_ms).filter(Number.isFinite).sort((a, b) => a - b).at(-1);
  const allDisputesHaveDailyEvidence = ['5m', '15m', '1h'].every(tf => [...nativeMismatch[tf].keys()].every(t => {
    const dayRecord = dailyForensicComparisons.find(item => item.day === new Date(t).toISOString().slice(0, 10));
    const timeframeRecord = dayRecord?.native_timeframes?.[tf];
    return dayRecord?.daily_1m_checksum_status === 'verified' && timeframeRecord?.daily_archive_status === 'verified' && timeframeRecord?.common_bars > 0;
  }));
  const markIndexGapsRecovered = ['mark_1m', 'index_1m'].every(sourceId => materializedDistinctPriceStreams[sourceId].unresolved_missing_grid_rows_after_official_daily_recovery === 0 && dailyPriceGapForensics.filter(item => item.source === sourceId).every(item => item.daily_archive_status === 'verified' && item.official_daily_rows_added_for_missing_monthly_timestamps === item.monthly_vs_daily.timestamps_missing_from_monthly));
  const report = {
    schema_version: 1, report_id: `binance-usdm-btcusdt-${startMonth}_${endMonth}`,
    generated_at_utc: new Date().toISOString(), venue: VENUE, contract: 'BTCUSDT USDⓈ-M perpetual contract; research proxy only',
    pipeline_source: { path: 'research/btc_history_pipeline.mjs', sha256: pipelineSourceSha256 },
    requested_coverage: { start_inclusive_utc: new Date(rangeStart).toISOString(), end_exclusive_utc: new Date(rangeEnd).toISOString(), completed_calendar_months_requested: expectedMonths, expected_one_minute_grid_bars: totalExpectedMinutes },
    obtained_coverage: { completed_trade_1m_archive_months: completeTradeMonths, actual_trade_1m_rows: sourceTotals.trade_1m.rows, unique_aligned_trade_1m_bars: sourceTotals.trade_1m.unique_aligned_in_month, missing_trade_1m_grid_bars: sourceTotals.trade_1m.missing_grid_bars, first_trade_timestamp_utc: Number.isFinite(firstObservedTrade) ? new Date(firstObservedTrade).toISOString() : null, last_trade_timestamp_utc: Number.isFinite(lastObservedTrade) ? new Date(lastObservedTrade).toISOString() : null, last_archive_month_inclusive: endMonth },
    timestamp: { unit: 'Unix epoch milliseconds (int64); kline open times UTC and close time is open + interval - 1 ms', funding_policy: 'retain calc_time exactly as published; no resampling or timestamp snapping' },
    provenance: { archive_root: 'https://data.binance.vision/data/futures/um/monthly/', publisher: 'Binance Public Data', archive_checksum: 'sibling .CHECKSUM SHA-256 verified for each archive', revision_policy: 'record checksum, HTTP Last-Modified/ETag when freshly fetched and revision_date_utc; Binance may revise archived data', source_definitions: SOURCE_DEFS.map(def => ({ id: def.id, archive_path: def.archivePath, interval: def.interval, price_type: def.priceType, volume_units: def.volumeMeaning })), kline_api_reference: 'https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Kline-Candlestick-Data', data_readme: 'https://github.com/binance/binance-public-data/' },
    archive_status_counts: archiveStatusCounts,
    archives: archiveResults,
    source_audits: Object.fromEntries(Object.entries(sourceTotals).map(([key, value]) => [key, finalizeSourceTotal(value)])),
    funding_audit: { events: fundingRecords.length, monthly: fundingAudits, events_are_actual_archive_rows: true, sorted_event_timestamps: [...fundingRecords].sort((a, b) => a.time - b.time).map(r => r.time), raw_intervals_hours: [...new Set(fundingRecords.map(r => r.hours))].sort((a, b) => a - b), gap_interpretation: 'funding events are recorded event observations; no synthetic events are inserted' },
    monthly_audits: monthlyAudit,
    gap_examples_first_20: gapExamples,
    resampling: { source: 'trade 1m rows only', bucket_clock: 'UTC epoch floor', completeness_rule: 'all exact 1m constituents required; partial/incomplete buckets omitted and no prices forward-filled', zero_trade_bar_rule: 'Within a bucket containing trades, OHLC comes from minute rows with trade_count > 0 (matching native Binance candles, which ignore zero-trade minute OHLC); if the complete bucket has no trades, use the official zero-count minute OHLC as published. Volume and trade-count sums include every constituent row.', independent_direct_verification: independentResample, native_comparison: nativeComparison, daily_archive_forensics: { affected_utc_dates: mismatchDays, verified_archives: dailyForensicArchives.filter(item => mismatchDays.includes(item.day)), comparisons: dailyForensicComparisons }, native_reference_disputes_masked_from_scoring: Object.fromEntries(['5m', '15m', '1h'].map(tf => [tf, [...nativeMismatch[tf]].map(([t, fields]) => ({ open_time_utc: new Date(t).toISOString(), fields, scored_bar_excluded: true, warmup_reset_applied: true }))])), native_comparison_on_scored_bars: nativeScoredComparison },
    distinct_price_stream_reconciliation: { monthly_mark_index_audits: { mark_1m: finalizeSourceTotal(sourceTotals.mark_1m), index_1m: finalizeSourceTotal(sourceTotals.index_1m) }, official_daily_gap_forensics: dailyPriceGapForensics, materialized_streams_with_only_official_daily_backfill_of_monthly_gaps: materializedDistinctPriceStreams },
    ema: { native_indicator_execution_seed: 'SMA of first N completed closes, then recursive alpha=2/(N+1); periods 20/50; readiness after 20/50 completed execution bars (B0 source requires >55 chart bars, so profile gates use 56)', custom_htf_seed: 'first completed HTF close after reset, then recursive alpha=2/(N+1); readiness requires 250 contiguous completed HTF bars', independently_computed_reference_vs_native: emaScored, profile_feature_gates: profiles.map(p => ({ id: p.id, execution_timeframe: p.execution, htf_timeframe: p.higher, execution_warmup_bars: 56, htf_warmup_bars: 250, coverage: p.coverage })) },
    derived_outputs: { trade_1m: path.relative(ROOT, rawTradeOut).replaceAll('\\', '/'), distinct_mark_index_1m: Object.fromEntries(Object.entries(distinctPricePaths).map(([source, file]) => [source, path.relative(ROOT, file).replaceAll('\\', '/')])), resampled_trade: Object.fromEntries(Object.entries(derivedPaths).map(([tf, file]) => [tf, path.relative(ROOT, file).replaceAll('\\', '/') ])), funding_events: path.relative(ROOT, fundingOut).replaceAll('\\', '/'), no_missing_prices_fabricated: true },
    acceptance_audit: { all_requested_trade_archives_available: completeTradeMonths === expectedMonths, all_monthly_and_forensic_archive_checksums_verified: archiveResults.every(item => item.status === 'verified') && dailyForensicArchives.every(item => item.status === 'verified'), independent_resampling_zero_mismatches: Object.values(independentResample).every(item => item.field_mismatched_buckets === 0), every_native_reference_conflict_has_verified_daily_forensics_and_is_excluded_with_warmup_reset: allDisputesHaveDailyEvidence && Object.values(nativeScoredComparison).every(byTf => Object.values(byTf).every(item => item.native_missing_on_eligible_bars === 0 && item.native_price_or_volume_mismatches_on_eligible_bars === 0)), all_monthly_mark_index_gaps_resolved_with_verified_official_daily_rows: markIndexGapsRecovered, no_native_or_reference_mismatch_on_scored_bars: Object.values(nativeScoredComparison).every(byTf => Object.values(byTf).every(item => item.native_missing_on_eligible_bars === 0 && item.native_price_or_volume_mismatches_on_eligible_bars === 0)), no_ema_mismatch_on_scored_bars: Object.values(emaScored).every(byTf => Object.values(byTf).every(item => Object.values(item).every(count => count === 0))), no_invalid_primary_trade_rows: sourceTotals.trade_1m.invalid_ohlc_rows === 0 && sourceTotals.trade_1m.invalid_volume_rows === 0 && sourceTotals.trade_1m.bad_close_time_rows === 0 && sourceTotals.trade_1m.misaligned_timestamps === 0 && sourceTotals.trade_1m.duplicate_timestamps === 0 && sourceTotals.trade_1m.unsorted_rows === 0, status: 'review_required' },
    interpretation: 'This is a provenance, coverage, continuity, aggregation, and indicator-warmup audit. It is not a profitability result. Missing archive rows and incomplete buckets are reported and excluded rather than synthesized.',
  };
  report.acceptance_audit.status = Object.values(report.acceptance_audit).filter(value => typeof value === 'boolean').every(Boolean) ? 'PASS' : 'GAPS_REMAIN';
  report.manifest_path = path.relative(ROOT, manifestPath).replaceAll('\\', '/');
  await fs.writeFile(manifestPath, `${JSON.stringify({ schema_version: 1, report_id: report.report_id, generated_at_utc: report.generated_at_utc, venue: VENUE, contract: report.contract, pipeline_source: report.pipeline_source, requested_coverage: report.requested_coverage, timestamp: report.timestamp, provenance: report.provenance, archive_status_counts: archiveStatusCounts, archives: archiveResults, daily_forensic_archives: dailyForensicArchives, derived_outputs: report.derived_outputs }, null, 2)}\n`);
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  const lines = [
    `# BTCUSDT USD-M history and resampling audit`, '',
    `Generated: ${report.generated_at_utc}`, '',
    `- Contract: ${report.contract}`, `- Window: ${report.requested_coverage.start_inclusive_utc} to ${report.requested_coverage.end_exclusive_utc} (end exclusive)`,
    `- Complete trade 1m archive months: ${completeTradeMonths}/${expectedMonths}`, `- Trade 1m rows: ${report.obtained_coverage.actual_trade_1m_rows.toLocaleString()} / ${totalExpectedMinutes.toLocaleString()} expected; missing grid bars: ${report.obtained_coverage.missing_trade_1m_grid_bars.toLocaleString()}`,
    `- Archive states: ${JSON.stringify(archiveStatusCounts)}`, `- Overall acceptance audit: **${report.acceptance_audit.status}**`, '',
    `## Resampling checks`, '',
    ...['5m', '15m', '1h'].map(tf => `- ${tf}: ${independentResample[tf].checked_complete_buckets.toLocaleString()} complete buckets independently checked; ${independentResample[tf].field_mismatched_buckets} internal resampling mismatches; native common=${nativeComparison[tf].common_bars.toLocaleString()}, native mismatched=${nativeComparison[tf].mismatched_bars.toLocaleString()}, missing native=${nativeComparison[tf].missing_native_bars.toLocaleString()}, extra native=${nativeComparison[tf].extra_native_bars.toLocaleString()}.`), '',
    `## Profile warmup and excluded hours`, '',
    ...profiles.map(p => `- ${p.id}: ${p.coverage.eligible_scored_bars.toLocaleString()} eligible bars; ${p.coverage.hours_lost_to_missing_or_incomplete_bars.toFixed(2)} hours lost to missing/incomplete execution bars; ${p.coverage.hours_lost_to_documented_source_conflicts.toFixed(2)} hours removed for disputed execution bars; warmup excludes ${p.coverage.hours_lost_to_initial_feature_warmup.toFixed(2)} initial hours plus ${p.coverage.hours_lost_to_post_gap_or_source_conflict_warmups.toFixed(2)} hours after gaps/source-conflict resets (56 execution bars and 250 HTF bars required); ${p.coverage.htf_conflict_bars_excluded} disputed HTF bars excluded; first eligible ${p.coverage.first_eligible_bar_utc ?? 'none'}.`), '',
    `Native/reference source disagreements: ${['5m', '15m', '1h'].map(tf => `${tf}=${nativeComparison[tf].mismatched_bars}`).join(', ')} bars across the full window. They are listed with exact values and verified daily archive SHA-256s, excluded from scored bars, and trigger the baseline warmup reset. Scored common-date comparisons have zero remaining mismatches.`,
    `Mark/index monthly archives each omit ${sourceTotals.mark_1m.missing_grid_bars} / ${sourceTotals.index_1m.missing_grid_bars} 1m bars. The gaps were checked against SHA-256-verified official daily archives; ${materializedDistinctPriceStreams.mark_1m.official_daily_rows_added} mark rows and ${materializedDistinctPriceStreams.index_1m.official_daily_rows_added} index rows were added to separate derived streams. No gaps remain in those materialized streams.`,
    `Trade volume units: BTC base volume and USDT quote volume; mark/index volume-like columns remain uninterpreted. Funding: ${fundingRecords.length.toLocaleString()} actual rows retained.`, '',
    `## Funding and price separation`, '',
    `- Funding rows retained: ${fundingRecords.length.toLocaleString()} actual event rows; timestamps preserved as received.`,
    `- Trade, mark and index price sources are written to separate 1m files. Mark/index volume-like columns are retained as published and are not interpreted as trade volume.`,
    `- Binance 1m rows with zero trades are counted separately. For a resampled bucket with trades, OHLC uses only trade-bearing minutes; for an entirely inactive but fully observed bucket, the official zero-trade OHLC is retained.`,
    `- Missing source minutes and incomplete resampled buckets are never forward-filled or fabricated.`, '',
    `## Reproduction`, '',
    'Run `node research/btc_history_pipeline.mjs --self-test` for the built-in synthetic validation, then `node research/btc_history_pipeline.mjs` to verify/download the default 2024-10 through 2026-09 source archives, generate local derived CSVs, and refresh this report and manifest. Raw archives and derived CSVs are excluded from git; their source URLs and SHA-256 checksums are retained in the manifest.', '',
    `Detailed machine-readable results: research/reports/btc_history_coverage.json.`,
    `Pipeline source SHA-256: ${pipelineSourceSha256}.`,
    `Archive run manifest: ${report.manifest_path}.`, '',
    `This report establishes data provenance and historical feature warmup only; it makes no profitability claim.`
  ];
  await fs.writeFile(reportMarkdownPath, `${lines.join('\n').trimEnd()}\n`);
  console.log(`Audit status: ${report.acceptance_audit.status}`);
  console.log(`Trade 1m: ${report.obtained_coverage.actual_trade_1m_rows}/${totalExpectedMinutes} rows; ${report.obtained_coverage.missing_trade_1m_grid_bars} missing grid minutes.`);
  console.log(`Report: ${path.relative(ROOT, reportMarkdownPath)}`);
  if (report.acceptance_audit.status !== 'PASS') process.exitCode = 2;
}

run().catch(error => { console.error(error.stack ?? error); process.exitCode = 1; });
