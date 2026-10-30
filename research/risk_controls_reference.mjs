// Deterministic contract-rounding, worst-case risk and paper-ledger reference.
// Synthetic filters in fixtures are deliberately not labelled as Binance data.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reportDir = path.join(root, 'research/reports');

function plainDecimal(value) {
  const source = String(value).trim().toLowerCase();
  const match = source.match(/^([+-]?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/);
  if (!match) throw new TypeError(`Invalid decimal: ${value}`);
  const sign = match[1] === '-' ? '-' : '';
  const whole = match[2];
  const fraction = match[3] ?? '';
  const exponent = Number(match[4] ?? 0);
  let digits = whole + fraction;
  let scale = fraction.length - exponent;
  if (scale < 0) { digits += '0'.repeat(-scale); scale = 0; }
  if (digits.length === 0) digits = '0';
  return { integer: BigInt(`${sign}${digits}`), scale };
}

function alignDecimals(values) {
  const parsed = values.map(plainDecimal);
  const scale = Math.max(...parsed.map(row => row.scale));
  const integers = parsed.map(row => row.integer * (10n ** BigInt(scale - row.scale)));
  return { integers, scale };
}

function decimalNumber(integer, scale) {
  const negative = integer < 0n;
  let digits = (negative ? -integer : integer).toString();
  if (scale > 0) {
    digits = digits.padStart(scale + 1, '0');
    digits = `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  }
  const result = Number(`${negative ? '-' : ''}${digits}`);
  if (!Number.isFinite(result)) throw new RangeError('Decimal conversion exceeded Number range');
  return result;
}

function quantize(value, step, origin = '0', direction = 'floor') {
  if (!['floor', 'ceil'].includes(direction)) throw new TypeError(`Unsupported rounding direction: ${direction}`);
  const { integers, scale } = alignDecimals([value, origin, step]);
  const [valueInt, originInt, stepInt] = integers;
  if (valueInt < 0n || originInt < 0n || stepInt <= 0n) throw new RangeError('Prices, quantities, origins and steps must be non-negative with a positive step');
  const delta = valueInt - originInt;
  if (delta < 0n) throw new RangeError('Value is below the filter origin');
  let multiples = delta / stepInt;
  if (direction === 'ceil' && delta % stepInt !== 0n) multiples++;
  return decimalNumber(originInt + multiples * stepInt, scale);
}

function aligned(value, step, origin = '0') {
  try {
    const rounded = quantize(value, step, origin, 'floor');
    const { integers } = alignDecimals([value, rounded]);
    return integers[0] === integers[1];
  } catch { return false; }
}

function assertPositive(value, name) {
  if (value === null || value === undefined || String(value).trim() === '' || !Number.isFinite(Number(value)) || Number(value) <= 0) throw new TypeError(`${name} must be a positive finite number`);
}

function isFiniteProvidedNumber(value) {
  return value !== null && value !== undefined && String(value).trim() !== '' && Number.isFinite(Number(value));
}

function validateMarket(market) {
  assert.ok(['LINEAR_BASE_QUANTITY', 'INVERSE_FIXED_QUOTE_FACE'].includes(market.contractModel), 'explicit linear or inverse contract model required');
  assertPositive(market.multiplier, 'contract multiplier');
  const { priceFilter, limitLotFilter, marketLotFilter } = market;
  assert.ok(priceFilter && limitLotFilter && marketLotFilter, 'price, limit-lot and market-lot filters are required');
  assertPositive(priceFilter.tickSize, 'price tick size');
  for (const [name, filter] of [['limit lot', limitLotFilter], ['market lot', marketLotFilter]]) {
    assertPositive(filter.stepSize, `${name} step size`);
    assert.ok(isFiniteProvidedNumber(filter.minQty) && Number(filter.minQty) >= 0, `${name} minimum quantity must be non-negative`);
    assert.ok(isFiniteProvidedNumber(filter.maxQty) && Number(filter.maxQty) > 0, `${name} maximum quantity must be positive`);
    assert.ok(Number(filter.minQty) <= Number(filter.maxQty), `${name} minimum quantity must not exceed maximum quantity`);
  }
  assert.ok(isFiniteProvidedNumber(priceFilter.minPrice) && Number(priceFilter.minPrice) >= 0, 'price minimum must be non-negative');
  assert.ok(isFiniteProvidedNumber(priceFilter.maxPrice) && Number(priceFilter.maxPrice) >= 0, 'price maximum must be non-negative');
  assert.ok(Number(priceFilter.maxPrice) === 0 || Number(priceFilter.maxPrice) >= Number(priceFilter.minPrice), 'price maximum must be zero (unbounded) or at least the minimum');
  assert.ok(isFiniteProvidedNumber(market.minimumNotionalQuote) && Number(market.minimumNotionalQuote) >= 0, 'minimum notional must be non-negative');
  if (market.minimumExitNotionalQuote !== undefined && market.minimumExitNotionalQuote !== null) {
    assert.ok(isFiniteProvidedNumber(market.minimumExitNotionalQuote) && Number(market.minimumExitNotionalQuote) >= 0, 'minimum exit notional must be non-negative');
  }
  return market;
}

function notionalQuote(market, quantity, price) {
  if (market.contractModel === 'LINEAR_BASE_QUANTITY') return quantity * market.multiplier * price;
  return quantity * market.multiplier;
}

function pnlQuote(market, sideSign, quantity, entry, exit) {
  if (market.contractModel === 'LINEAR_BASE_QUANTITY') return sideSign * quantity * market.multiplier * (exit - entry);
  return sideSign * quantity * market.multiplier * (exit / entry - 1);
}

function roundPrices({ side, entry, stop, target, market }) {
  validateMarket(market);
  if (!['LONG', 'SHORT'].includes(side)) return { ok: false, reason: 'INVALID_SIDE' };
  const entryDirection = side === 'LONG' ? 'floor' : 'ceil';
  const stopDirection = side === 'LONG' ? 'ceil' : 'floor';
  const targetDirection = side === 'LONG' ? 'ceil' : 'floor';
  try {
    const origin = market.priceFilter.minPrice;
    const rounded = {
      entry: quantize(entry, market.priceFilter.tickSize, origin, entryDirection),
      stop: quantize(stop, market.priceFilter.tickSize, origin, stopDirection),
      target: quantize(target, market.priceFilter.tickSize, origin, targetDirection),
    };
    const values = Object.values(rounded);
    if (values.some(price => price < Number(market.priceFilter.minPrice) || (Number(market.priceFilter.maxPrice) > 0 && price > Number(market.priceFilter.maxPrice)))) return { ok: false, reason: 'PRICE_FILTER_BOUNDS' };
    if (side === 'LONG' ? !(rounded.stop < rounded.entry && rounded.target > rounded.entry) : !(rounded.stop > rounded.entry && rounded.target < rounded.entry)) {
      return { ok: false, reason: 'WRONG_SIDE_LEVEL_AFTER_ROUNDING', rounded };
    }
    if (values.some(price => !aligned(price, market.priceFilter.tickSize, origin))) return { ok: false, reason: 'PRICE_TICK_MISMATCH', rounded };
    return { ok: true, ...rounded };
  } catch (error) {
    return { ok: false, reason: `PRICE_ROUNDING:${error.message}` };
  }
}

function roundQuantityForEntryAndProtection(rawQuantity, market) {
  const entryFilter = market.limitLotFilter;
  const exitFilter = market.marketLotFilter;
  const { integers, scale } = alignDecimals([
    rawQuantity,
    entryFilter.minQty,
    entryFilter.stepSize,
    exitFilter.minQty,
    exitFilter.stepSize,
  ]);
  const [raw, entryMin, entryStep, exitMin, exitStep] = integers;
  if ([entryStep, exitStep].some(value => value <= 0n)) return { ok: false, reason: 'INVALID_LOT_STEP' };
  if (raw < 0n) return { ok: false, reason: 'INVALID_RAW_QUANTITY' };
  let candidate = entryMin + ((raw - entryMin) / entryStep) * entryStep;
  if (raw < entryMin) return { ok: false, reason: 'MIN_LIMIT_QUANTITY' };
  const lower = entryMin > exitMin ? entryMin : exitMin;
  const maxEntry = plainDecimal(entryFilter.maxQty).integer * (10n ** BigInt(scale - plainDecimal(entryFilter.maxQty).scale));
  const maxExit = plainDecimal(exitFilter.maxQty).integer * (10n ** BigInt(scale - plainDecimal(exitFilter.maxQty).scale));
  const upper = maxEntry < maxExit ? maxEntry : maxExit;
  for (let attempts = 0; candidate >= lower && candidate <= upper && attempts < 100_000; attempts++, candidate -= entryStep) {
    if ((candidate - exitMin) % exitStep === 0n) {
      return { ok: true, quantity: decimalNumber(candidate, scale), step_iterations: attempts };
    }
  }
  return { ok: false, reason: 'NO_COMMON_LIMIT_AND_MARKET_LOT_SIZE' };
}

function roundAndValidatePlan({ side, entry, stop, target, rawQuantity, market }) {
  const prices = roundPrices({ side, entry, stop, target, market });
  if (!prices.ok) return prices;
  const sized = roundQuantityForEntryAndProtection(rawQuantity, market);
  if (!sized.ok) return sized;
  const quantity = sized.quantity;
  const entryFilter = market.limitLotFilter;
  const exitFilter = market.marketLotFilter;
  if (quantity > Number(entryFilter.maxQty) || quantity > Number(exitFilter.maxQty)) return { ok: false, reason: 'LOT_MAX_QTY' };
  if (quantity < Number(entryFilter.minQty) || quantity < Number(exitFilter.minQty)) return { ok: false, reason: 'LOT_MIN_QTY' };
  if (!aligned(quantity, entryFilter.stepSize, entryFilter.minQty) || !aligned(quantity, exitFilter.stepSize, exitFilter.minQty)) return { ok: false, reason: 'LOT_STEP_MISMATCH' };
  const entryNotional = notionalQuote(market, quantity, prices.entry);
  if (entryNotional < Number(market.minimumNotionalQuote)) return { ...prices, ok: false, reason: 'MIN_NOTIONAL', quantity, entry_notional_quote: entryNotional };
  const exitMinimum = Number(market.minimumExitNotionalQuote ?? market.minimumNotionalQuote);
  const stopNotional = notionalQuote(market, quantity, prices.stop);
  const targetNotional = notionalQuote(market, quantity, prices.target);
  if (stopNotional < exitMinimum || targetNotional < exitMinimum) {
    return { ...prices, ok: false, reason: 'MIN_PROTECTIVE_EXIT_NOTIONAL', quantity, entry_notional_quote: entryNotional, stop_notional_quote: stopNotional, target_notional_quote: targetNotional, minimum_exit_notional_quote: exitMinimum };
  }
  return { ok: true, side, quantity, ...prices, entry_notional_quote: entryNotional, stop_notional_quote: stopNotional, target_notional_quote: targetNotional, limit_market_lot_alignment_iterations: sized.step_iterations };
}

function adverseFillPrices({ side, entry, stop, entrySlippageBps, stopSlippageBps }) {
  if (![entrySlippageBps, stopSlippageBps].every(value => isFiniteProvidedNumber(value) && Number(value) >= 0)) throw new TypeError('Explicit non-negative entry and stop slippage bps are required');
  const entryRate = Number(entrySlippageBps) / 10_000;
  const stopRate = Number(stopSlippageBps) / 10_000;
  if (side === 'LONG') return { entryFill: entry * (1 + entryRate), stopFill: stop * (1 - stopRate) };
  if (side === 'SHORT') return { entryFill: entry * (1 - entryRate), stopFill: stop * (1 + stopRate) };
  throw new TypeError('side must be LONG or SHORT');
}

function allInStopRisk({ side, quantity, entry, stop, market, entryFeeRate, exitFeeRate, entrySlippageBps, stopSlippageBps, fundingReserveQuote }) {
  if (![entryFeeRate, exitFeeRate, entrySlippageBps, stopSlippageBps, fundingReserveQuote].every(value => isFiniteProvidedNumber(value) && Number(value) >= 0)) {
    return { status: 'INCOMPLETE_COST_MODEL', all_in_loss_quote: null };
  }
  const sideSign = side === 'LONG' ? 1 : -1;
  const { entryFill, stopFill } = adverseFillPrices({ side, entry, stop, entrySlippageBps, stopSlippageBps });
  if (side === 'LONG' ? stopFill >= entryFill : stopFill <= entryFill) return { status: 'INVALID_STOP_AFTER_SLIPPAGE', all_in_loss_quote: null };
  const grossStopPnl = pnlQuote(market, sideSign, quantity, entryFill, stopFill);
  const entryFeeQuote = notionalQuote(market, quantity, entryFill) * Number(entryFeeRate);
  const exitFeeQuote = notionalQuote(market, quantity, stopFill) * Number(exitFeeRate);
  const allInLoss = Math.max(0, -grossStopPnl) + entryFeeQuote + exitFeeQuote + Number(fundingReserveQuote);
  return {
    status: 'MODELED_WITH_EXPLICIT_ASSUMPTIONS',
    entry_fill_stress: entryFill,
    stop_fill_stress: stopFill,
    gross_stop_pnl_quote: grossStopPnl,
    entry_fee_quote: entryFeeQuote,
    exit_fee_quote: exitFeeQuote,
    funding_reserve_quote: Number(fundingReserveQuote),
    all_in_loss_quote: allInLoss,
  };
}

function sizeForRisk({ side, entry, stop, target, marginUsd, leverage, maxLossQuote, entryFeeRate, exitFeeRate, entrySlippageBps, stopSlippageBps, fundingReserveQuote, market }) {
  validateMarket(market);
  if (![marginUsd, leverage, maxLossQuote].every(value => Number.isFinite(Number(value)) && Number(value) > 0)) return { ok: false, reason: 'INVALID_MARGIN_LEVERAGE_OR_RISK_BUDGET' };
  if (![entryFeeRate, exitFeeRate, entrySlippageBps, stopSlippageBps, fundingReserveQuote].every(value => isFiniteProvidedNumber(value) && Number(value) >= 0)) {
    return { ok: false, reason: 'UNRESOLVED_FEES_SLIPPAGE_OR_FUNDING_RESERVE' };
  }
  const prices = roundPrices({ side, entry, stop, target, market });
  if (!prices.ok) return prices;
  const unitRisk = allInStopRisk({ side, quantity: 1, entry: prices.entry, stop: prices.stop, market, entryFeeRate, exitFeeRate, entrySlippageBps, stopSlippageBps, fundingReserveQuote: 0 });
  if (unitRisk.status !== 'MODELED_WITH_EXPLICIT_ASSUMPTIONS' || unitRisk.all_in_loss_quote <= 0) return { ok: false, reason: 'UNMODELED_UNIT_RISK' };
  const riskQuantity = (Number(maxLossQuote) - Number(fundingReserveQuote)) / unitRisk.all_in_loss_quote;
  if (!(riskQuantity > 0)) return { ok: false, reason: 'FUNDING_RESERVE_CONSUMES_RISK_BUDGET' };
  const notionalPerUnit = notionalQuote(market, 1, prices.entry);
  const marginQuantity = Number(marginUsd) * Number(leverage) / notionalPerUnit;
  const rawQuantity = Math.min(riskQuantity, marginQuantity);
  const plan = roundAndValidatePlan({ side, entry: prices.entry, stop: prices.stop, target: prices.target, rawQuantity, market });
  if (!plan.ok) return plan;
  const risk = allInStopRisk({ side, quantity: plan.quantity, entry: plan.entry, stop: plan.stop, market, entryFeeRate, exitFeeRate, entrySlippageBps, stopSlippageBps, fundingReserveQuote });
  if (risk.status !== 'MODELED_WITH_EXPLICIT_ASSUMPTIONS') return { ok: false, reason: risk.status };
  if (risk.all_in_loss_quote > Number(maxLossQuote) + 1e-10) return { ok: false, reason: 'ROUNDED_SIZE_EXCEEDS_LOSS_BUDGET', plan, risk };
  const notional = notionalQuote(market, plan.quantity, plan.entry);
  if (notional > Number(marginUsd) * Number(leverage) + 1e-10) return { ok: false, reason: 'LEVERAGED_NOTIONAL_CAP', plan, risk };
  return { ok: true, plan, risk, notional_quote: notional, posted_margin_usd: Number(marginUsd), leverage: Number(leverage) };
}

function averageEntryPrice(market, oldQty, oldPrice, newQty, newPrice) {
  if (oldQty === 0) return newPrice;
  if (market.contractModel === 'LINEAR_BASE_QUANTITY') return (oldQty * oldPrice + newQty * newPrice) / (oldQty + newQty);
  return (oldQty + newQty) / (oldQty / oldPrice + newQty / newPrice);
}

class PaperRiskLedger {
  constructor({ initialEquityQuote, market, dailyLossLimitQuote = null, maxDrawdownFraction = null, maxTradeLossQuote = null }) {
    validateMarket(market);
    assertPositive(initialEquityQuote, 'initial equity');
    for (const [name, value] of [['daily loss limit', dailyLossLimitQuote], ['drawdown fraction', maxDrawdownFraction], ['per-trade loss limit', maxTradeLossQuote]]) {
      if (value !== null && (!Number.isFinite(Number(value)) || Number(value) <= 0)) throw new TypeError(`${name} must be null or positive`);
    }
    this.initialEquityQuote = Number(initialEquityQuote);
    this.market = market;
    this.dailyLossLimitQuote = dailyLossLimitQuote === null ? null : Number(dailyLossLimitQuote);
    this.maxDrawdownFraction = maxDrawdownFraction === null ? null : Number(maxDrawdownFraction);
    this.maxTradeLossQuote = maxTradeLossQuote === null ? null : Number(maxTradeLossQuote);
    this.realizedGrossPnlQuote = 0;
    this.feesPaidQuote = 0;
    this.fundingCashflowQuote = 0;
    this.tradeActive = false;
    this.tradeRealizedGrossPnlQuote = 0;
    this.tradeFeesPaidQuote = 0;
    this.tradeFundingCashflowQuote = 0;
    this.openEntryFeesQuote = 0;
    this.lastClosedTrade = null;
    this.tradeLossLockLatched = false;
    this.positionSize = 0;
    this.averageEntry = null;
    this.lastMarkPrice = null;
    this.pendingEntryId = null;
    this.protectiveOrdersActive = false;
    this.protectiveQuantity = 0;
    this.dayKey = null;
    this.dayStartEquityQuote = this.initialEquityQuote;
    this.peakEquityQuote = this.initialEquityQuote;
    this.dailyLockLatched = false;
    this.drawdownLockLatched = false;
    this.drawdownLockReason = null;
    this.events = [];
  }

  unrealizedPnlQuote() {
    if (!this.positionSize || this.lastMarkPrice === null || this.averageEntry === null) return 0;
    const sign = Math.sign(this.positionSize);
    return pnlQuote(this.market, sign, Math.abs(this.positionSize), this.averageEntry, this.lastMarkPrice);
  }

  equityQuote() {
    return this.initialEquityQuote + this.realizedGrossPnlQuote - this.feesPaidQuote + this.fundingCashflowQuote + this.unrealizedPnlQuote();
  }

  tradeNetPnlQuote() {
    if (!this.tradeActive) return this.lastClosedTrade?.net_pnl_quote ?? 0;
    return this.tradeRealizedGrossPnlQuote + this.unrealizedPnlQuote() - this.tradeFeesPaidQuote + this.tradeFundingCashflowQuote;
  }

  _advanceUtcDay(timestamp, boundaryMarkPrice = null) {
    if (boundaryMarkPrice !== null) this.lastMarkPrice = Number(boundaryMarkPrice);
    const date = new Date(timestamp).toISOString().slice(0, 10);
    if (this.dayKey === null) this.dayKey = date;
    else if (date !== this.dayKey) {
      this.dayKey = date;
      this.dayStartEquityQuote = this.equityQuote();
      this.dailyLockLatched = false;
    }
  }

  _evaluateLocks(timestamp, reason) {
    this._advanceUtcDay(timestamp);
    const equity = this.equityQuote();
    if (equity > this.peakEquityQuote) this.peakEquityQuote = equity;
    const dailyLoss = Math.max(0, this.dayStartEquityQuote - equity);
    const drawdown = this.peakEquityQuote > 0 ? Math.max(0, (this.peakEquityQuote - equity) / this.peakEquityQuote) : 0;
    if (this.dailyLossLimitQuote !== null && dailyLoss >= this.dailyLossLimitQuote) this.dailyLockLatched = true;
    if (this.maxDrawdownFraction !== null && drawdown >= this.maxDrawdownFraction) {
      this.drawdownLockLatched = true;
      this.drawdownLockReason = 'PEAK_TO_TROUGH_DRAWDOWN';
    }
    const tradeNetPnl = this.tradeNetPnlQuote();
    if (this.tradeActive && this.maxTradeLossQuote !== null && tradeNetPnl <= -this.maxTradeLossQuote) this.tradeLossLockLatched = true;
    const locked = this.dailyLockLatched || this.drawdownLockLatched || this.tradeLossLockLatched;
    const lockReason = [this.dailyLockLatched ? 'DAILY_LOSS' : null, this.drawdownLockLatched ? this.drawdownLockReason : null, this.tradeLossLockLatched ? 'TRADE_LOSS_BUDGET' : null].filter(Boolean).join('+') || 'NONE';
    this.events.push({
      timestamp_utc: new Date(timestamp).toISOString(), reason, equity_quote: equity,
      daily_loss_quote: dailyLoss, peak_drawdown_fraction: drawdown,
      trade_net_pnl_quote: tradeNetPnl, max_trade_loss_quote: this.maxTradeLossQuote,
      entry_locked: locked, entry_lock_reason: lockReason,
      cancel_pending_entry_requested: locked && this.pendingEntryId !== null,
      pending_entry_id_retained: this.pendingEntryId,
      protective_orders_preserved: this.protectiveOrdersActive,
      protective_quantity: this.protectiveQuantity,
      protection_gap_quantity: Math.max(0, Math.abs(this.positionSize) - (this.protectiveOrdersActive ? this.protectiveQuantity : 0)),
      position_fully_protected: this.positionSize === 0 || (this.protectiveOrdersActive && this.protectiveQuantity >= Math.abs(this.positionSize)),
      automatic_flatten_requested: false,
    });
    return this.events.at(-1);
  }

  setPendingEntry(orderId) {
    if (typeof orderId !== 'string' || orderId.length === 0) throw new TypeError('pending entry order id must be a non-empty string');
    if (this.dailyLockLatched || this.drawdownLockLatched || this.tradeLossLockLatched) throw new Error('entry lock prevents submitting a pending entry');
    if (this.positionSize !== 0) throw new Error('new entry cannot be submitted while a position is open');
    if (this.pendingEntryId !== null) throw new Error('an entry order is already pending');
    this.pendingEntryId = orderId;
  }

  resolvePendingEntry(orderId) {
    if (this.pendingEntryId !== orderId) throw new Error('Pending entry identity mismatch');
    this.pendingEntryId = null;
  }

  applyFill({ side, quantity, price, feeRate, timestamp, reduceOnly = false, protectionAttached = false }) {
    if (!['BUY', 'SELL'].includes(side)) throw new TypeError('fill side must be BUY or SELL');
    if (![quantity, price, feeRate].every(value => isFiniteProvidedNumber(value)) || Number(quantity) <= 0 || Number(price) <= 0 || Number(feeRate) < 0) throw new TypeError('fill quantity, price and fee must be valid');
    const qty = Number(quantity);
    const fillPrice = Number(price);
    const fillSign = side === 'BUY' ? 1 : -1;
    if ((this.positionSize === 0 || Math.sign(this.positionSize) === fillSign) && reduceOnly) throw new Error('reduce-only fill cannot increase or open exposure');
    if (this.positionSize !== 0 && Math.sign(this.positionSize) !== fillSign && qty > Math.abs(this.positionSize)) throw new Error('over-close rejected; paper ledger cannot reverse a position');
    this._advanceUtcDay(timestamp, fillPrice);
    const fee = notionalQuote(this.market, qty, fillPrice) * Number(feeRate);
    this.feesPaidQuote += fee;
    if (this.positionSize === 0 || Math.sign(this.positionSize) === fillSign) {
      const oldQty = Math.abs(this.positionSize);
      if (oldQty === 0) {
        this.tradeActive = true;
        this.tradeRealizedGrossPnlQuote = 0;
        this.tradeFeesPaidQuote = 0;
        this.tradeFundingCashflowQuote = 0;
        this.openEntryFeesQuote = 0;
      }
      this.tradeFeesPaidQuote += fee;
      this.openEntryFeesQuote += fee;
      this.averageEntry = averageEntryPrice(this.market, oldQty, this.averageEntry ?? fillPrice, qty, fillPrice);
      this.positionSize += fillSign * qty;
      this.lastMarkPrice ??= fillPrice;
      if (protectionAttached) {
        this.protectiveOrdersActive = true;
        this.protectiveQuantity = Math.abs(this.positionSize);
      } else if (oldQty === 0) {
        this.protectiveOrdersActive = false;
        this.protectiveQuantity = 0;
      }
    } else {
      const oldAbs = Math.abs(this.positionSize);
      const realizedPnl = pnlQuote(this.market, Math.sign(this.positionSize), qty, this.averageEntry, fillPrice);
      this.realizedGrossPnlQuote += realizedPnl;
      this.tradeRealizedGrossPnlQuote += realizedPnl;
      this.tradeFeesPaidQuote += fee;
      this.openEntryFeesQuote = Math.max(0, this.openEntryFeesQuote * (1 - qty / oldAbs));
      this.positionSize += fillSign * qty;
      if (Math.abs(this.positionSize) <= 1e-12) {
        this.positionSize = 0;
        this.averageEntry = null;
        this.protectiveOrdersActive = false;
        this.protectiveQuantity = 0;
        this.openEntryFeesQuote = 0;
        this.tradeActive = false;
        this.lastClosedTrade = {
          realized_gross_pnl_quote: this.tradeRealizedGrossPnlQuote,
          fees_paid_quote: this.tradeFeesPaidQuote,
          signed_funding_cashflow_quote: this.tradeFundingCashflowQuote,
          net_pnl_quote: this.tradeRealizedGrossPnlQuote - this.tradeFeesPaidQuote + this.tradeFundingCashflowQuote,
        };
        if (this.maxTradeLossQuote !== null && this.lastClosedTrade.net_pnl_quote <= -this.maxTradeLossQuote) this.tradeLossLockLatched = true;
      } else {
        this.protectiveQuantity = this.protectiveOrdersActive ? Math.min(this.protectiveQuantity, Math.abs(this.positionSize)) : 0;
      }
      this.lastMarkPrice = fillPrice;
    }
    return this._evaluateLocks(timestamp, 'FILL');
  }

  recordFunding({ timestamp, signedCashflowQuote }) {
    if (!isFiniteProvidedNumber(signedCashflowQuote)) throw new TypeError('signed funding cash flow must be finite');
    this._advanceUtcDay(timestamp);
    this.fundingCashflowQuote += Number(signedCashflowQuote);
    if (this.tradeActive && this.positionSize !== 0) this.tradeFundingCashflowQuote += Number(signedCashflowQuote);
    return this._evaluateLocks(timestamp, 'FUNDING');
  }

  mark({ timestamp, price }) {
    assertPositive(price, 'mark price');
    this._advanceUtcDay(timestamp, Number(price));
    return this._evaluateLocks(timestamp, 'MARK');
  }

  canEnter() {
    return !this.dailyLockLatched && !this.drawdownLockLatched && !this.tradeLossLockLatched && this.positionSize === 0 && this.pendingEntryId === null;
  }

  resetTradeLossLock({ timestamp }) {
    if (this.positionSize !== 0 || this.pendingEntryId !== null) throw new Error('trade-loss lock reset requires a flat position and no pending entry');
    this.tradeLossLockLatched = false;
    return this._evaluateLocks(timestamp, 'MANUAL_TRADE_LOSS_RESET');
  }

  resetDrawdownLock({ timestamp }) {
    if (this.positionSize !== 0 || this.pendingEntryId !== null) throw new Error('drawdown lock reset requires a flat position and no pending entry');
    this.drawdownLockLatched = false;
    this.drawdownLockReason = null;
    this.peakEquityQuote = this.equityQuote();
    this.dayStartEquityQuote = this.equityQuote();
    this._advanceUtcDay(timestamp);
    return this._evaluateLocks(timestamp, 'MANUAL_DRAWDOWN_RESET');
  }

  snapshot() {
    return {
      initial_equity_quote: this.initialEquityQuote,
      realized_gross_pnl_quote: this.realizedGrossPnlQuote,
      commissions_paid_quote: this.feesPaidQuote,
      signed_funding_cashflow_quote: this.fundingCashflowQuote,
      unrealized_mark_pnl_quote: this.unrealizedPnlQuote(),
      marked_equity_quote: this.equityQuote(),
      position_size_signed: this.positionSize,
      average_entry: this.averageEntry,
      mark_price: this.lastMarkPrice,
      daily_loss_limit_quote: this.dailyLossLimitQuote,
      max_drawdown_fraction: this.maxDrawdownFraction,
      max_trade_loss_quote: this.maxTradeLossQuote,
      daily_lock_latched: this.dailyLockLatched,
      drawdown_lock_latched: this.drawdownLockLatched,
      trade_loss_lock_latched: this.tradeLossLockLatched,
      trade_net_pnl_quote: this.tradeNetPnlQuote(),
      trade_realized_gross_pnl_quote: this.tradeRealizedGrossPnlQuote,
      trade_fees_paid_quote: this.tradeFeesPaidQuote,
      trade_funding_cashflow_quote: this.tradeFundingCashflowQuote,
      open_entry_fees_quote: this.openEntryFeesQuote,
      last_closed_trade: this.lastClosedTrade,
      pending_entry_id: this.pendingEntryId,
      protective_orders_active: this.protectiveOrdersActive,
      protective_quantity: this.protectiveQuantity,
      protection_gap_quantity: Math.max(0, Math.abs(this.positionSize) - (this.protectiveOrdersActive ? this.protectiveQuantity : 0)),
      position_fully_protected: this.positionSize === 0 || (this.protectiveOrdersActive && this.protectiveQuantity >= Math.abs(this.positionSize)),
      can_enter: this.canEnter(),
    };
  }
}

function reconcileOpenRisk({ ledger, side, plannedQuantity, stop, maxLossQuote, exitFeeRate, stopSlippageBps, futureFundingReserveQuote }) {
  if (!(ledger instanceof PaperRiskLedger)) throw new TypeError('a PaperRiskLedger instance is required');
  if (!['LONG', 'SHORT'].includes(side)) return { status: 'INVALID_SIDE', new_entries_allowed: false };
  const costInputs = [maxLossQuote, exitFeeRate, stopSlippageBps, futureFundingReserveQuote];
  if (!costInputs.every(value => isFiniteProvidedNumber(value) && Number(value) >= 0) || Number(maxLossQuote) <= 0 || !isFiniteProvidedNumber(plannedQuantity) || Number(plannedQuantity) <= 0 || !isFiniteProvidedNumber(stop) || Number(stop) <= 0) {
    return { status: 'INCOMPLETE_RISK_INPUTS', new_entries_allowed: false };
  }
  if (ledger.positionSize === 0 || !ledger.tradeActive || ledger.averageEntry === null) return { status: 'NO_OPEN_POSITION', new_entries_allowed: false };
  const actualSide = ledger.positionSize > 0 ? 'LONG' : 'SHORT';
  if (actualSide !== side) return { status: 'SIDE_MISMATCH', actual_side: actualSide, new_entries_allowed: false };
  if (ledger.lastMarkPrice === null) return { status: 'MARK_UNAVAILABLE', new_entries_allowed: false };
  if (side === 'LONG' ? Number(stop) >= ledger.averageEntry : Number(stop) <= ledger.averageEntry) return { status: 'INVALID_STOP_FOR_ACTUAL_AVERAGE_FILL', new_entries_allowed: false };

  const quantity = Math.abs(ledger.positionSize);
  const stopRate = Number(stopSlippageBps) / 10_000;
  const stressedStopFill = side === 'LONG' ? Number(stop) * (1 - stopRate) : Number(stop) * (1 + stopRate);
  const stopGrossPnl = pnlQuote(ledger.market, side === 'LONG' ? 1 : -1, quantity, ledger.averageEntry, stressedStopFill);
  const exitFee = notionalQuote(ledger.market, quantity, stressedStopFill) * Number(exitFeeRate);
  const projectedNetPnlAtStop = ledger.tradeRealizedGrossPnlQuote + stopGrossPnl - ledger.tradeFeesPaidQuote + ledger.tradeFundingCashflowQuote - exitFee - Number(futureFundingReserveQuote);
  const allInLossQuote = Math.max(0, -projectedNetPnlAtStop);
  const sizeExceedsPlan = quantity > Number(plannedQuantity) + 1e-10;
  const protectionGap = Math.max(0, quantity - (ledger.protectiveOrdersActive ? ledger.protectiveQuantity : 0));
  const fullyProtected = protectionGap <= 1e-10;
  const withinBudget = allInLossQuote <= Number(maxLossQuote) + 1e-10;
  const status = !fullyProtected ? 'POSITION_NOT_FULLY_PROTECTED'
    : sizeExceedsPlan ? 'FILLED_SIZE_EXCEEDS_PLAN'
      : withinBudget ? 'WITHIN_BUDGET' : 'OVER_BUDGET';
  return {
    status,
    actual_side: actualSide,
    planned_quantity: Number(plannedQuantity),
    actual_position_quantity: quantity,
    actual_average_fill_price: ledger.averageEntry,
    current_mark_price: ledger.lastMarkPrice,
    marked_equity_quote: ledger.equityQuote(),
    stop_price: Number(stop),
    stressed_stop_fill_price: stressedStopFill,
    realized_gross_pnl_quote: ledger.tradeRealizedGrossPnlQuote,
    open_gross_pnl_at_stressed_stop_quote: stopGrossPnl,
    fees_paid_on_trade_quote: ledger.tradeFeesPaidQuote,
    entry_fees_on_open_quantity_quote: ledger.openEntryFeesQuote,
    estimated_exit_fee_quote: exitFee,
    realized_funding_cashflow_quote: ledger.tradeFundingCashflowQuote,
    future_funding_reserve_quote: Number(futureFundingReserveQuote),
    projected_net_pnl_at_stressed_stop_quote: projectedNetPnlAtStop,
    all_in_loss_quote: allInLossQuote,
    max_loss_quote: Number(maxLossQuote),
    protective_quantity: ledger.protectiveOrdersActive ? ledger.protectiveQuantity : 0,
    protection_gap_quantity: protectionGap,
    position_fully_protected: fullyProtected,
    size_exceeds_plan: sizeExceedsPlan,
    per_trade_loss_lock_latched: ledger.tradeLossLockLatched,
    new_entries_allowed: false,
    note: 'An open position cannot admit another entry. This stop stress is a model; a gap or venue failure can exceed the budget.',
  };
}

function runFixtures() {
  const linear = validateMarket({
    name: 'SYNTHETIC_LINEAR_FIXTURE_ONLY', contractModel: 'LINEAR_BASE_QUANTITY', multiplier: 1,
    priceFilter: { minPrice: '0.5', maxPrice: '1000000', tickSize: '0.5' },
    limitLotFilter: { minQty: '0.01', maxQty: '100', stepSize: '0.01' },
    marketLotFilter: { minQty: '0.01', maxQty: '100', stepSize: '0.01' },
    minimumNotionalQuote: 5,
  });
  const inverse = validateMarket({
    name: 'SYNTHETIC_INVERSE_FIXTURE_ONLY', contractModel: 'INVERSE_FIXED_QUOTE_FACE', multiplier: 100,
    priceFilter: { minPrice: '0.1', maxPrice: '1000000', tickSize: '0.1' },
    limitLotFilter: { minQty: '1', maxQty: '10000', stepSize: '1' },
    marketLotFilter: { minQty: '1', maxQty: '10000', stepSize: '1' },
    minimumNotionalQuote: 100,
  });
  const rows = [];
  const record = (name, detail) => rows.push({ fixture: name, status: 'PASS', detail: JSON.stringify(detail) });

  const long = roundAndValidatePlan({ side: 'LONG', entry: 100.3, stop: 96.3, target: 105.7, rawQuantity: 1.239, market: linear });
  assert.deepEqual({ ok: long.ok, entry: long.entry, stop: long.stop, target: long.target, quantity: long.quantity }, { ok: true, entry: 100, stop: 96.5, target: 106, quantity: 1.23 });
  record('linear_long_rounding_directions', long);

  const short = roundAndValidatePlan({ side: 'SHORT', entry: 100.3, stop: 104.3, target: 94.3, rawQuantity: 1.239, market: linear });
  assert.deepEqual({ ok: short.ok, entry: short.entry, stop: short.stop, target: short.target, quantity: short.quantity }, { ok: true, entry: 100.5, stop: 104, target: 94, quantity: 1.23 });
  record('linear_short_rounding_directions', short);

  const offsetGrid = validateMarket({
    name: 'SYNTHETIC_NONZERO_FILTER_ORIGIN_FIXTURE_ONLY', contractModel: 'LINEAR_BASE_QUANTITY', multiplier: 1,
    priceFilter: { minPrice: '0.05', maxPrice: '1000', tickSize: '0.1' },
    limitLotFilter: { minQty: '0.05', maxQty: '10', stepSize: '0.1' },
    marketLotFilter: { minQty: '0.05', maxQty: '10', stepSize: '0.15' },
    minimumNotionalQuote: 0.001,
  });
  const offsetPlan = roundAndValidatePlan({ side: 'LONG', entry: 0.34, stop: 0.14, target: 0.54, rawQuantity: 0.34, market: offsetGrid });
  assert.deepEqual({ ok: offsetPlan.ok, entry: offsetPlan.entry, stop: offsetPlan.stop, target: offsetPlan.target, quantity: offsetPlan.quantity }, { ok: true, entry: 0.25, stop: 0.15, target: 0.55, quantity: 0.05 });
  record('nonzero_filter_origins_and_common_limit_market_lot_grid', offsetPlan);

  const minQty = roundAndValidatePlan({ side: 'LONG', entry: 100, stop: 99, target: 102, rawQuantity: 0.009, market: linear });
  assert.equal(minQty.ok, false); assert.equal(minQty.reason, 'MIN_LIMIT_QUANTITY');
  record('minimum_quantity_rejected_not_rounded_up', minQty);

  const minNotional = roundAndValidatePlan({ side: 'LONG', entry: 100, stop: 99, target: 102, rawQuantity: 0.01, market: linear });
  assert.equal(minNotional.ok, false); assert.equal(minNotional.reason, 'MIN_NOTIONAL');
  record('minimum_entry_notional_rejected_with_false_status', minNotional);

  const exitMinimum = roundAndValidatePlan({ side: 'LONG', entry: 100, stop: 99, target: 101, rawQuantity: 0.1, market: { ...linear, minimumExitNotionalQuote: 15 } });
  assert.equal(exitMinimum.ok, false, JSON.stringify(exitMinimum)); assert.equal(exitMinimum.reason, 'MIN_PROTECTIVE_EXIT_NOTIONAL');
  record('protective_exit_minimum_notional_rejected', exitMinimum);

  const allIn = allInStopRisk({ side: 'LONG', quantity: 1, entry: 100, stop: 99, market: linear, entryFeeRate: 0.0005, exitFeeRate: 0.0005, entrySlippageBps: 2, stopSlippageBps: 20, fundingReserveQuote: 0 });
  assert.ok(allIn.all_in_loss_quote > 1, 'stress path exceeds declared $1 cap and must reject full size');
  const sized = sizeForRisk({ side: 'LONG', entry: 100.3, stop: 99.3, target: 102, marginUsd: 5, leverage: 20, maxLossQuote: 1, entryFeeRate: 0.0005, exitFeeRate: 0.0005, entrySlippageBps: 2, stopSlippageBps: 20, fundingReserveQuote: 0, market: linear });
  assert.equal(sized.ok, true); assert.ok(sized.risk.all_in_loss_quote <= 1); assert.ok(sized.notional_quote <= 100);
  record('size_recomputed_after_rounding_and_all_in_costs', { unscaled_one_unit_stress: allIn, accepted: sized });

  const shortSized = sizeForRisk({ side: 'SHORT', entry: 100.3, stop: 101.3, target: 98, marginUsd: 5, leverage: 20, maxLossQuote: 1, entryFeeRate: 0.0005, exitFeeRate: 0.0005, entrySlippageBps: 2, stopSlippageBps: 20, fundingReserveQuote: 0, market: linear });
  assert.equal(shortSized.ok, true); assert.ok(shortSized.risk.all_in_loss_quote <= 1);
  record('short_size_recomputed_after_rounding_and_all_in_costs', shortSized);

  const noRiskAtMin = validateMarket({ ...linear, limitLotFilter: { minQty: '1', maxQty: '100', stepSize: '1' }, marketLotFilter: { minQty: '1', maxQty: '100', stepSize: '1' }, minimumNotionalQuote: 5 });
  const impossibleMin = sizeForRisk({ side: 'LONG', entry: 100, stop: 90, target: 115, marginUsd: 5, leverage: 20, maxLossQuote: 1, entryFeeRate: 0.0005, exitFeeRate: 0.0005, entrySlippageBps: 0, stopSlippageBps: 0, fundingReserveQuote: 0, market: noRiskAtMin });
  assert.equal(impossibleMin.ok, false); assert.equal(impossibleMin.reason, 'MIN_LIMIT_QUANTITY');
  record('minimum_order_over_budget_rejected', impossibleMin);

  const inverseLoss = pnlQuote(inverse, 1, 2, 10_000, 9_900);
  assert.ok(Math.abs(inverseLoss - (-2)) < 1e-10, 'inverse fixed-$100 contracts convert the coin PnL at exit price to a $2 loss');
  const inverseRisk = allInStopRisk({ side: 'LONG', quantity: 2, entry: 10_000, stop: 9_900, market: inverse, entryFeeRate: 0, exitFeeRate: 0, entrySlippageBps: 0, stopSlippageBps: 0, fundingReserveQuote: 0 });
  assert.ok(Math.abs(inverseRisk.all_in_loss_quote - 2) < 1e-10);
  record('inverse_contract_formula_explicit', { pnl_quote: inverseLoss, risk: inverseRisk });

  const ledger = new PaperRiskLedger({ initialEquityQuote: 100, market: linear });
  ledger.applyFill({ side: 'BUY', quantity: 0.4, price: 100, feeRate: 0.0005, timestamp: '2026-10-30T10:00:00Z', protectionAttached: true });
  ledger.applyFill({ side: 'BUY', quantity: 0.6, price: 101, feeRate: 0.0005, timestamp: '2026-10-30T10:01:00Z', protectionAttached: true });
  assert.ok(Math.abs(ledger.averageEntry - 100.6) < 1e-12); assert.equal(ledger.protectiveQuantity, 1);
  ledger.mark({ timestamp: '2026-10-30T10:02:00Z', price: 99 });
  ledger.recordFunding({ timestamp: '2026-10-30T16:00:00Z', signedCashflowQuote: -0.1 });
  const afterExitPartial = ledger.applyFill({ side: 'SELL', quantity: 0.25, price: 98, feeRate: 0.0005, timestamp: '2026-10-30T16:01:00Z', reduceOnly: true });
  assert.equal(ledger.positionSize, 0.75); assert.equal(ledger.protectiveOrdersActive, true); assert.equal(ledger.protectiveQuantity, 0.75);
  assert.ok(ledger.feesPaidQuote > 0); assert.equal(ledger.fundingCashflowQuote, -0.1); assert.equal(afterExitPartial.protective_orders_preserved, true);
  record('partial_fills_fees_funding_marked_equity_and_protection', ledger.snapshot());

  const reconciled = new PaperRiskLedger({ initialEquityQuote: 1000, market: linear, maxTradeLossQuote: 1 });
  reconciled.setPendingEntry('reconcile-partial-1');
  reconciled.applyFill({ side: 'BUY', quantity: 0.04, price: 100, feeRate: 0.0005, timestamp: '2026-10-30T11:00:00Z', protectionAttached: true });
  reconciled.applyFill({ side: 'BUY', quantity: 0.06, price: 100.1, feeRate: 0.0005, timestamp: '2026-10-30T11:01:00Z', protectionAttached: true });
  reconciled.resolvePendingEntry('reconcile-partial-1');
  reconciled.recordFunding({ timestamp: '2026-10-30T12:00:00Z', signedCashflowQuote: -0.005 });
  reconciled.mark({ timestamp: '2026-10-30T12:01:00Z', price: 100.0 });
  const partialReconciliation = reconcileOpenRisk({ ledger: reconciled, side: 'LONG', plannedQuantity: 0.1, stop: 99.5, maxLossQuote: 1, exitFeeRate: 0.0005, stopSlippageBps: 5, futureFundingReserveQuote: 0.01 });
  assert.equal(partialReconciliation.status, 'WITHIN_BUDGET');
  assert.ok(Math.abs(partialReconciliation.actual_average_fill_price - 100.06) < 1e-10);
  assert.ok(partialReconciliation.all_in_loss_quote < 1);
  assert.equal(partialReconciliation.marked_equity_quote, reconciled.equityQuote());
  assert.equal(partialReconciliation.position_fully_protected, true);
  record('reconcile_partial_fills_fees_funding_mark_and_protection', partialReconciliation);

  const overBudgetReconcileLedger = new PaperRiskLedger({ initialEquityQuote: 1000, market: linear, maxTradeLossQuote: 1 });
  overBudgetReconcileLedger.applyFill({ side: 'BUY', quantity: 0.5, price: 100, feeRate: 0.0005, timestamp: '2026-10-30T12:30:00Z', protectionAttached: true });
  const overBudgetReconciliation = reconcileOpenRisk({ ledger: overBudgetReconcileLedger, side: 'LONG', plannedQuantity: 0.5, stop: 98, maxLossQuote: 1, exitFeeRate: 0.0005, stopSlippageBps: 200, futureFundingReserveQuote: 0.1 });
  assert.equal(overBudgetReconciliation.status, 'OVER_BUDGET');
  assert.ok(overBudgetReconciliation.all_in_loss_quote > 1);
  assert.equal(overBudgetReconciliation.position_fully_protected, true);
  assert.equal(overBudgetReconciliation.new_entries_allowed, false);
  record('actual_partial_fill_stop_stress_detects_over_budget_exposure', overBudgetReconciliation);

  const daily = new PaperRiskLedger({ initialEquityQuote: 100, market: linear, dailyLossLimitQuote: 5 });
  daily.setPendingEntry('pending-demo-1');
  daily.applyFill({ side: 'BUY', quantity: 1, price: 100, feeRate: 0, timestamp: '2026-10-30T23:50:00Z', protectionAttached: true });
  const dailyLock = daily.mark({ timestamp: '2026-10-30T23:59:00Z', price: 90 });
  assert.equal(dailyLock.entry_locked, true); assert.equal(dailyLock.cancel_pending_entry_requested, true); assert.equal(dailyLock.pending_entry_id_retained, 'pending-demo-1'); assert.equal(dailyLock.protective_orders_preserved, true); assert.equal(dailyLock.automatic_flatten_requested, false);
  const afterUtcReset = daily.mark({ timestamp: '2026-10-31T00:00:00Z', price: 90 });
  assert.equal(afterUtcReset.entry_locked, false); assert.equal(daily.protectiveOrdersActive, true); assert.equal(daily.unrealizedPnlQuote(), -10);
  record('daily_lock_open_loss_pending_cancel_protection_and_utc_reset', { locked: dailyLock, after_reset: afterUtcReset, snapshot: daily.snapshot() });

  const rolloverGap = new PaperRiskLedger({ initialEquityQuote: 100, market: linear, dailyLossLimitQuote: 5 });
  rolloverGap.applyFill({ side: 'BUY', quantity: 1, price: 100, feeRate: 0, timestamp: '2026-10-30T23:58:00Z', protectionAttached: true });
  const gapAtRollover = rolloverGap.mark({ timestamp: '2026-10-31T00:00:00Z', price: 90 });
  assert.equal(gapAtRollover.daily_loss_quote, 0, 'new UTC day starts from the newly marked equity');
  assert.equal(gapAtRollover.entry_locked, false, 'prior-day gap is not double-counted as new-day loss');
  record('utc_rollover_baseline_includes_new_mark', gapAtRollover);

  const drawdown = new PaperRiskLedger({ initialEquityQuote: 100, market: linear, maxDrawdownFraction: 0.05 });
  drawdown.applyFill({ side: 'BUY', quantity: 1, price: 100, feeRate: 0, timestamp: '2026-10-30T12:00:00Z', protectionAttached: true });
  const drawdownLock = drawdown.mark({ timestamp: '2026-10-30T13:00:00Z', price: 94 });
  assert.equal(drawdownLock.entry_locked, true); assert.equal(drawdownLock.protective_orders_preserved, true);
  drawdown.mark({ timestamp: '2026-10-31T00:00:00Z', price: 94 });
  assert.equal(drawdown.drawdownLockLatched, true, 'drawdown lock does not reset at UTC midnight');
  assert.throws(() => drawdown.resetDrawdownLock({ timestamp: '2026-10-31T00:01:00Z' }), /flat position/);
  drawdown.applyFill({ side: 'SELL', quantity: 1, price: 94, feeRate: 0, timestamp: '2026-10-31T00:02:00Z', reduceOnly: true });
  drawdown.resetDrawdownLock({ timestamp: '2026-10-31T00:03:00Z' });
  assert.equal(drawdown.drawdownLockLatched, false);
  record('drawdown_lock_latches_until_explicit_flat_reset', { lock: drawdownLock, after_manual_reset: drawdown.snapshot() });

  const partial = new PaperRiskLedger({ initialEquityQuote: 100, market: linear, dailyLossLimitQuote: 5 });
  partial.setPendingEntry('partial-entry-1');
  partial.applyFill({ side: 'BUY', quantity: 0.5, price: 100, feeRate: 0, timestamp: '2026-10-30T14:00:00Z', protectionAttached: true });
  partial.mark({ timestamp: '2026-10-30T14:01:00Z', price: 90 });
  const pendingCancelRequest = partial.events.at(-1);
  assert.equal(pendingCancelRequest.entry_locked, true); assert.equal(pendingCancelRequest.pending_entry_id_retained, 'partial-entry-1');
  partial.applyFill({ side: 'BUY', quantity: 0.1, price: 100.1, feeRate: 0, timestamp: '2026-10-30T14:02:00Z', protectionAttached: true });
  assert.equal(partial.positionSize, 0.6); assert.equal(partial.protectiveQuantity, 0.6); assert.equal(partial.protectiveOrdersActive, true);
  record('partial_fill_after_cancel_request_is_tracked_and_protected', partial.snapshot());

  const lockBlocksNewEntry = new PaperRiskLedger({ initialEquityQuote: 100, market: linear, dailyLossLimitQuote: 1 });
  lockBlocksNewEntry.applyFill({ side: 'BUY', quantity: 1, price: 100, feeRate: 0, timestamp: '2026-10-30T16:00:00Z', protectionAttached: true });
  const lockEvent = lockBlocksNewEntry.mark({ timestamp: '2026-10-30T16:01:00Z', price: 99 });
  assert.equal(lockEvent.entry_locked, true);
  assert.throws(() => lockBlocksNewEntry.setPendingEntry('blocked-entry'), /entry lock prevents/);
  record('latched_lock_rejects_new_pending_entry', lockEvent);

  const protectionGap = new PaperRiskLedger({ initialEquityQuote: 100, market: linear });
  protectionGap.applyFill({ side: 'BUY', quantity: 0.5, price: 100, feeRate: 0, timestamp: '2026-10-30T15:00:00Z', protectionAttached: true });
  const unprotectedIncrement = protectionGap.applyFill({ side: 'BUY', quantity: 0.1, price: 100, feeRate: 0, timestamp: '2026-10-30T15:01:00Z', protectionAttached: false });
  assert.ok(Math.abs(unprotectedIncrement.protection_gap_quantity - 0.1) < 1e-12);
  assert.equal(unprotectedIncrement.position_fully_protected, false);
  const partialProtectionClose = protectionGap.applyFill({ side: 'SELL', quantity: 0.05, price: 100, feeRate: 0, timestamp: '2026-10-30T15:02:00Z', reduceOnly: true });
  assert.ok(Math.abs(partialProtectionClose.protection_gap_quantity - 0.05) < 1e-12, 'partial reduce cannot claim newly covered exposure');
  record('entry_increment_without_protection_is_reported', protectionGap.snapshot());

  const safeReject = new PaperRiskLedger({ initialEquityQuote: 100, market: linear });
  safeReject.applyFill({ side: 'BUY', quantity: 0.2, price: 100, feeRate: 0, timestamp: '2026-10-30T16:30:00Z', protectionAttached: true });
  const beforeOverClose = safeReject.snapshot();
  assert.throws(() => safeReject.applyFill({ side: 'SELL', quantity: 0.21, price: 99, feeRate: 0.001, timestamp: '2026-10-30T16:31:00Z', reduceOnly: true }), /over-close rejected/);
  assert.deepEqual(safeReject.snapshot(), beforeOverClose, 'rejected fill must not mutate fees, position or protection');
  record('overclose_rejected_without_mutating_ledger', safeReject.snapshot());

  const gapLoss = new PaperRiskLedger({ initialEquityQuote: 100, market: linear, maxTradeLossQuote: 1 });
  gapLoss.applyFill({ side: 'BUY', quantity: sized.plan.quantity, price: 100, feeRate: 0.0005, timestamp: '2026-10-30T17:00:00Z', protectionAttached: true });
  const beyondStop = gapLoss.mark({ timestamp: '2026-10-30T17:01:00Z', price: 98.5 });
  assert.ok(100 - beyondStop.equity_quote > 1, 'a gap through the modeled stop may exceed the $1 intended budget');
  assert.equal(beyondStop.entry_locked, true);
  assert.equal(beyondStop.entry_lock_reason, 'TRADE_LOSS_BUDGET');
  assert.equal(beyondStop.protective_orders_preserved, true);
  assert.equal(beyondStop.automatic_flatten_requested, false);
  assert.equal(gapLoss.tradeLossLockLatched, true);
  gapLoss.applyFill({ side: 'SELL', quantity: sized.plan.quantity, price: 98.5, feeRate: 0.0005, timestamp: '2026-10-30T17:02:00Z', reduceOnly: true });
  assert.equal(gapLoss.positionSize, 0);
  assert.equal(gapLoss.canEnter(), false, 'the per-trade loss lock stays latched after the gap-loss position is closed');
  assert.throws(() => gapLoss.setPendingEntry('blocked-after-gap'), /entry lock prevents/);
  gapLoss.resetTradeLossLock({ timestamp: '2026-10-30T17:03:00Z' });
  assert.equal(gapLoss.canEnter(), true, 'only the explicit flat-state reset clears the per-trade loss lock');
  record('gap_through_stop_exposes_budget_locks_entries_and_preserves_protection', { breach: beyondStop, after_close_and_reset: gapLoss.snapshot() });

  const fundingUnknown = sizeForRisk({ side: 'LONG', entry: 100, stop: 99, target: 102, marginUsd: 5, leverage: 20, maxLossQuote: 1, entryFeeRate: 0.0005, exitFeeRate: 0.0005, entrySlippageBps: 2, stopSlippageBps: 10, fundingReserveQuote: null, market: linear });
  assert.equal(fundingUnknown.ok, false); assert.equal(fundingUnknown.reason, 'UNRESOLVED_FEES_SLIPPAGE_OR_FUNDING_RESERVE');
  record('missing_funding_reserve_blocks_risk_sizing', fundingUnknown);

  const feesUnknown = sizeForRisk({ side: 'LONG', entry: 100, stop: 99, target: 102, marginUsd: 5, leverage: 20, maxLossQuote: 1, entryFeeRate: null, exitFeeRate: null, entrySlippageBps: null, stopSlippageBps: null, fundingReserveQuote: 0, market: linear });
  assert.equal(feesUnknown.ok, false); assert.equal(feesUnknown.reason, 'UNRESOLVED_FEES_SLIPPAGE_OR_FUNDING_RESERVE');
  record('missing_account_fees_or_slippage_blocks_risk_sizing', feesUnknown);

  const badGeometry = roundAndValidatePlan({ side: 'LONG', entry: 100, stop: 101, target: 102, rawQuantity: 1, market: linear });
  assert.equal(badGeometry.ok, false); assert.equal(badGeometry.reason, 'WRONG_SIDE_LEVEL_AFTER_ROUNDING');
  record('wrong_side_protective_level_rejected', badGeometry);

  return rows;
}

function csvEscape(value) { return `"${String(value ?? '').replaceAll('"', '""')}"`; }
function writeCsv(file, rows) {
  const fields = Object.keys(rows[0]);
  fs.writeFileSync(file, [fields.join(','), ...rows.map(row => fields.map(key => csvEscape(row[key])).join(','))].join('\n') + '\n', 'utf8');
}

function buildReport(fixtures) {
  return {
    schema_version: 1,
    policy_id: 'BTC-PERP-RISK-OPS-P1',
    generated_at_utc: new Date().toISOString(),
    status: 'PAPER_REFERENCE_FIXTURES_PASS_LIVE_VENUE_UNCONFIRMED_PERSONAL_LOCKS_DISABLED_BY_USER_CHOICE',
    venue_proxy: 'Binance USD-M BTCUSDT perpetual; research-only',
    live_filter_snapshot: 'NOT_CAPTURED: official public exchangeInfo returned HTTP 451 in the research environment; no filter values were invented',
    user_per_trade_loss_budget_quote: 1,
    user_daily_loss_limit_quote: null,
    user_max_drawdown_fraction: null,
    user_account_fees: null,
    user_funding_reserve: null,
    hold_policy: 'TP/SL only; no maximum holding time or timed exit added',
    native_platform_limit: 'TakeProfit documents context.info.tick_size and price_precision plus strategy min order size/value; it does not document exact Binance quantity steps, account fees, or account-level marked equity/day PnL/high-water equity.',
    fixture_count: fixtures.length,
    all_fixtures_pass: true,
    fixtures,
    acceptance_status: {
      rounding_and_formula_engine: 'PASS_ON_SYNTHETIC_FIXTURES',
      live_binance_filter_snapshot: 'OPEN_REQUIRED',
      supplied_fill_reconciliation_engine: 'PASS_PARTIAL_FILLS_FEES_FUNDING_MARKED_EQUITY_STOP_STRESS_AND_PROTECTION_FIXTURES',
      realized_user_fill_reconciliation: 'OPEN_NO_OBSERVED_USER_OR_EXCHANGE_FILL_DATA; synthetic fixtures only',
      user_daily_drawdown_limits: 'APPROVED_DISABLED_BY_USER; parameterized controls are fixture-tested but personal locks are not active',
      native_account_equity_locks: 'NOT_AVAILABLE_IN_DOCUMENTED_STRATEGY_FIELDS',
      risk_lock_fixtures: 'PASS_DAY_BOUNDARIES_OPEN_LOSSES_PARTIAL_FILLS_PROTECTION_GAPS_PER_TRADE_GAP_BREACH_AND_EXPLICIT_RESET',
      hold_policy_registration: 'PASS_TP_SL_ONLY_VERSIONED_NO_TIME_EXIT_ADDED',
      issue_8_close: 'BLOCKED_LIVE_FILTERS_NATIVE_STRATEGY_GRID_INTEGRATION_AND_OBSERVED_FILL_COST_RECONCILIATION',
      profitability: 'NOT_EVALUATED; no claim',
    },
  };
}

const fixtures = runFixtures();
fs.mkdirSync(reportDir, { recursive: true });
writeCsv(path.join(reportDir, 'contract_risk_fixtures.csv'), fixtures);
const report = buildReport(fixtures);
fs.writeFileSync(path.join(reportDir, 'contract_risk_report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
const md = [
  '# Contract rounding, fill risk and loss-control reference', '',
  `Generated: ${report.generated_at_utc}`, '',
  `Status: ${report.status}. This is an offline paper/reference model; it is not connected to a trading account.`, '',
  '## What is implemented', '',
  '- Explicit linear base-quantity and inverse fixed-quote-face PnL models.',
  '- Decimal-grid rounding for entry, stop, target and quantity using venue filter origins; post-rounding direction, limit/market lot, minimum entry/protective-exit notional and risk checks.',
  '- All-in stop-loss sizing includes explicit per-side fee rates, adverse entry/stop slippage and a required funding reserve. It rejects missing assumptions, over-budget minimum orders, invalid levels and risk above the user-reported $1 cap.',
  '- Paper ledger tracks partial fills, weighted entry, per-fill fees, realized and open marked PnL, signed funding, marked equity and protection coverage; rejects over-close without ledger mutation.',
  '- Open-risk reconciliation uses supplied fills and fees, partial exits, funding, current marked equity, planned size, a stressed stop fill and current protection coverage. It reports over-budget, unprotected and over-plan positions.',
  '- Optional per-trade loss locks latch on a marked or realized all-in loss breach, retain protection and require an explicit flat/no-pending reset. Daily/drawdown locks remain separately configurable.',
  '- Parameterized daily and drawdown entry locks preserve protective orders, reject new entries when latched, and record pending-entry cancel requests without dropping identity. UTC reset uses the boundary mark; drawdown requires an explicit flat/no-pending reset.',
  '- No time exit or signal change was added. Personal daily/drawdown values remain null and therefore disabled.', '',
  '## Results and unresolved inputs', '',
  `- Synthetic deterministic fixtures: ${report.fixture_count}/${report.fixture_count} pass. Fixture filter values are test data only.`,
  '- Live Binance BTCUSDT filter snapshot: not captured. The official public exchangeInfo endpoint returned HTTP 451 from this environment. The capture script is included and writes a snapshot only after validating a successful live response.',
  '- Account maker/taker fees, user fills, historical slippage/spread and funding reserve remain unavailable. Sizing is blocked unless fees, slippage and funding reserve are explicitly supplied. Reconciliation fixtures use synthetic fills and costs only.',
  '- Personal daily-loss/drawdown limits remain intentionally disabled by the user. Generic fixture thresholds test control behavior only; they are not personal limits, and no personal lock is active.',
  '- The $1 stop budget is an intended model cap. A gap, liquidation, exchange failure or fill race can exceed it; existing protection is kept and no unverified flatten order is invented.',
  '- TakeProfit documents `self.info.tick_size` and `self.info.price_precision` through `Context.info` (inherited by `MainStrategyContext`) and exposes strategy min order size/value. This permits platform-context price tick handling but is not a captured Binance filter snapshot. Exact quantity steps/maxima, account fees, marked account equity, daily PnL, peak equity and user margin tier remain unavailable as documented script fields.', '',
  '## Issue #8 acceptance state', '',
  '- Reference rounding and post-rounding risk eligibility: fixture-verified with synthetic venue filters; current venue rules are still unverified.',
  '- Supplied-fill reconciliation: fixture-verified for partial fills, fees, funding, marked equity, stressed stop loss, planned size and protective coverage; user/exchange fill records remain absent.',
  '- Native execution integration: not complete. The strategy still relies on a user-entered quantity step and has not been switched to verified venue filters; keep it research-only.',
  '- Daily/drawdown policy: the user-approved choice to leave personal thresholds unset is recorded; generic lock and reset behavior is fixture-verified, while personal account locks remain disabled.',
  '- Holding policy: TP/SL-only with no maximum hold is recorded as BTC-PERP-EXIT-TP-SL-ONLY-1; changes require a separate experiment.',
  '- Profitability: not evaluated by these engineering fixtures.', '',
  '## Fixture coverage', '',
  '| Fixture | Result |', '|---|---|',
  ...fixtures.map(row => `| ${row.fixture} | ${row.status} |`), '',
  '## Reproduce', '',
  '```powershell',
  'node research/risk_controls_reference.mjs',
  'node research/capture_binance_contract_snapshot.mjs',
  '```', '',
  'The capture command requires access to the public Binance USD-M exchangeInfo endpoint. It never uses account credentials and refuses to write a partial or synthetic snapshot.', '',
  '## Decision', '',
  'The reference rounding, supplied-fill reconciliation, equity and lock behavior is fixture-verified. Issue #8 cannot be fully closed yet: current Binance filters, native strategy use of a verified quantity grid, and observed account fill/cost data are absent. The user-approved choice to keep personal daily/drawdown locks disabled is recorded; do not present those controls as active protection. Do not enable live sizing from these fixtures.',
].join('\n');
fs.writeFileSync(path.join(reportDir, 'contract_risk_report.md'), md + '\n', 'utf8');

console.log(JSON.stringify({ report: 'research/reports/contract_risk_report.md', fixture_count: fixtures.length, all_fixtures_pass: true, live_filter_snapshot: report.acceptance_status.live_binance_filter_snapshot, daily_drawdown_policy: report.acceptance_status.user_daily_drawdown_limits }, null, 2));

export { quantize, aligned, validateMarket, roundPrices, roundAndValidatePlan, notionalQuote, pnlQuote, allInStopRisk, sizeForRisk, PaperRiskLedger, reconcileOpenRisk };
