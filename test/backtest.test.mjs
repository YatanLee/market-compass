import assert from 'node:assert/strict';
import test from 'node:test';
import { getDemoPrices } from '../fixtures/demo-data.mjs';
import { InputError, runBacktest, validatePriceRows } from '../src/backtest.mjs';

function makePrices(count = 100, close = 100) {
  const start = new Date('2025-01-01T00:00:00.000Z');
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(start.getTime() + index * 86_400_000).toISOString().slice(0, 10);
    return { date, close };
  });
}

function run(prices, overrides = {}) {
  return runBacktest({
    symbol: 'CSV-DEMO',
    strategy: 'buy_hold',
    lookback: 20,
    feeBps: 10,
    slippageBps: 5,
    initialCapital: 100_000,
    splitRatio: 0.7,
    prices,
    ...overrides,
  });
}

test('uses one fixed chronological holdout interval for strategy and benchmark', () => {
  const result = run(getDemoPrices('SPY'));
  assert.equal(result.dataKind, 'imported');
  assert.equal(result.split.trainBars, 280);
  assert.equal(result.split.testBars, 120);
  assert.equal(result.split.trainEnd, getDemoPrices('SPY')[279].date);
  assert.equal(result.split.testStart, getDemoPrices('SPY')[280].date);
  assert.equal(result.split.testEnd, getDemoPrices('SPY').at(-1).date);
  assert.equal(result.curve.length, result.split.testBars);
  assert.deepEqual(result.curve.map((point) => point.date), getDemoPrices('SPY').slice(280).map((point) => point.date));
  assert.ok(result.curve.every((point) => Number.isFinite(point.equity) && Number.isFinite(point.benchmark)));
  assert.ok(result.assumptions.some((item) => item.includes('i-2')));
  assert.ok(result.assumptions.some((item) => item.includes('252')));
  assert.ok(result.warnings.some((item) => item.includes('調整後價格')));
});

test('keeps imported prices separate from ticker identity', () => {
  const result = runBacktest({
    symbol: 'IMPORTED',
    strategy: 'buy_hold',
    lookback: 20,
    feeBps: 0,
    slippageBps: 0,
    initialCapital: 100_000,
    splitRatio: 0.7,
    prices: makePrices(),
  });
  assert.equal(result.symbol, 'IMPORTED');
  assert.equal(result.dataKind, 'imported');
  assert.ok(result.warnings.some((warning) => warning.includes('標的身分未驗證')));
});

test('applies the close i-2 signal to the close i-1 to close i return interval', () => {
  const prices = makePrices();
  prices[68].close = 200;
  prices[69].close = 50;
  prices[70].close = 75;
  const result = run(prices, { strategy: 'sma', lookback: 5, feeBps: 0, slippageBps: 0 });
  assert.equal(result.split.testStart, prices[70].date);
  assert.equal(result.curve[0].position, 1);
  assert.equal(result.curve[0].equity, 150_000);
});

test('charges entry costs without allowing long-only equity below zero', () => {
  const prices = makePrices();
  prices[70].close = 1;
  for (let index = 71; index < prices.length; index += 1) prices[index].close = 1;
  const result = run(prices, {
    feeBps: 500,
    slippageBps: 500,
    initialCapital: 100,
  });
  assert.equal(result.curve[0].position, 1);
  assert.equal(result.curve[0].equity, 0.9);
  assert.equal(result.curve[0].benchmark, 0.9);
  assert.ok(result.curve.every((point) => point.equity >= 0 && point.benchmark >= 0));
  assert.equal(result.metrics.totalReturnPct, result.benchmark.totalReturnPct);
});

test('charges costs at exposure changes and benchmark entry on the same holdout interval', () => {
  const prices = makePrices();
  prices[68].close = 200;
  prices[69].close = 50;
  prices[70].close = 75;
  prices[71].close = 80;
  const result = run(prices, { strategy: 'sma', lookback: 5, feeBps: 100, slippageBps: 100 });
  assert.equal(result.curve[0].position, 1);
  assert.equal(result.curve[0].equity, 147_000);
  assert.equal(result.curve[1].equity, 144_060);
  assert.equal(result.curve[0].benchmark, 147_000);
  assert.ok(result.metrics.trades >= 2);
  assert.ok(result.metrics.turnover >= 2);
});

test('rejects bounded-price inputs that still overflow a long/cash equity curve', () => {
  const prices = makePrices();
  for (let index = 0; index < prices.length; index += 1) {
    prices[index].close = index % 2 === 0 ? 1e12 : 1e-12;
  }
  assert.throws(() => run(prices, {
    strategy: 'sma',
    lookback: 5,
    feeBps: 0,
    slippageBps: 0,
    initialCapital: 100,
  }), /數值溢位/);
});

test('returns null Sharpe when daily variation is zero', () => {
  const result = run(makePrices(), { feeBps: 0, slippageBps: 0 });
  assert.equal(result.metrics.sharpe, null);
  assert.equal(result.metrics.volatilityPct, 0);
});

test('rejects non-fixed split, insufficient samples, and lookbacks that exceed training data', () => {
  assert.throws(() => run(makePrices(), { splitRatio: 0.6 }), InputError);
  assert.throws(() => run(makePrices(99)), /至少需要 100 筆/);
  assert.throws(() => run(makePrices(100), { lookback: 252 }), /訓練資料可支援/);
  assert.throws(() => run(makePrices(), { lookback: 4 }), /回看期間/);
});

test('validates strict dates, ascending uniqueness, finite closes, and row bounds', () => {
  const invalidDate = makePrices();
  invalidDate[5].date = '2025-02-30';
  assert.throws(() => validatePriceRows(invalidDate), /有效的 YYYY-MM-DD/);

  const unsorted = makePrices();
  [unsorted[4], unsorted[5]] = [unsorted[5], unsorted[4]];
  assert.throws(() => validatePriceRows(unsorted), /遞增且不得重複/);

  const duplicate = makePrices();
  duplicate[5].date = duplicate[4].date;
  assert.throws(() => validatePriceRows(duplicate), /遞增且不得重複/);

  for (const close of [NaN, Infinity, 0, -1, 1e13, 1e-20]) {
    const rows = makePrices();
    rows[8].close = close;
    assert.throws(() => validatePriceRows(rows), /收盤價/);
  }
  assert.throws(() => validatePriceRows(makePrices(5001)), /最多 5000 筆/);
});

test('accepts a 100-row imported series with same-day-sized price bounds', () => {
  const rows = makePrices();
  assert.equal(validatePriceRows(rows).length, 100);
});
