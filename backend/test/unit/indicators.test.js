import test from 'node:test';
import assert from 'node:assert/strict';

import '../helpers/env.js';

import {
  last, at, sma, ema, wilder, rsi, macd, trueRange, atr, bollinger,
  stochastic, adx, obv, roc, donchian, relativeVolume, linregSlopePct,
  historicalVolatility, maxDrawdown,
} from '../../src/ta/indicators.js';

const approx = (actual, expected, eps = 1e-9, msg = '') =>
  assert.ok(
    actual != null && Math.abs(actual - expected) < eps,
    `expected ${actual} ≈ ${expected} ${msg}`,
  );

const bar = (o, h, l, c, v, date = '2026-01-01') => ({ o, h, l, c, v, date });

test('last/at pick from the end and skip nulls', () => {
  assert.equal(last([null, null, 5]), 5);
  assert.equal(last([null, null]), null);
  assert.equal(last([]), null);
  const arr = [1, 2, 3];
  assert.equal(at(arr, 0), 3);
  assert.equal(at(arr, 1), 2);
  assert.equal(at(arr, 99), null);
});

test('sma: warm-up nulls then rolling mean', () => {
  assert.deepEqual(sma([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
  assert.deepEqual(sma([1, 2], 3), [null, null]);
});

test('sma: a non-numeric value stops the series', () => {
  const out = sma([1, 2, 'x', 4], 2);
  assert.equal(out.length, 4);
  assert.equal(out[1], 1.5);
  assert.equal(out[2], null);
  assert.equal(out[3], null);
});

test('ema: seed is the simple average, then the standard EMA step', () => {
  assert.deepEqual(ema([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
  assert.deepEqual(ema([1, 2], 3), [null, null]);
});

test('wilder: Wilder smoothing, not EMA', () => {
  // seed = (2+4)/2 = 3; then prev + (x - prev)/period
  assert.deepEqual(wilder([2, 4, 6, 8, 10], 2), [null, 3, 4.5, 6.25, 8.125]);
});

test('rsi: pure uptrend pins at 100, pure downtrend at 0', () => {
  const up = rsi([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17], 14);
  assert.equal(last(up), 100);
  const down = rsi([17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1], 14);
  assert.equal(last(down), 0);
});

test('rsi: alternating gains/losses reads 50 at the first computed index', () => {
  const closes = Array.from({ length: 30 }, (_, i) => (i % 2 === 0 ? 0 : 1));
  const out = rsi(closes, 14);
  // First 14 gains/losses average exactly 0.5 / 0.5 → RSI 50 by definition.
  approx(out[14], 50, 1e-9);
});

test('rsi: null through the warm-up window', () => {
  const out = rsi([1, 2, 3, 4, 5], 14);
  assert.equal(out.length, 5);
  assert.ok(out.every((v) => v === null));
});

test('rsi: every value stays within 0..100', () => {
  const closes = Array.from({ length: 200 }, (_, i) => 100 + Math.sin(i / 3) * 10);
  for (const v of rsi(closes, 14)) {
    if (v != null) assert.ok(v >= 0 && v <= 100);
  }
});

test('macd: line starts at the slow EMA warm-up, signal 9 bars later', () => {
  const closes = Array.from({ length: 60 }, (_, i) => 100 + i);
  const { line, signal, hist } = macd(closes, 12, 26, 9);
  assert.equal(line.length, 60);
  assert.equal(signal.length, 60);
  assert.equal(hist.length, 60);
  for (let i = 0; i < 25; i++) assert.equal(line[i], null);
  assert.ok(line[25] != null);
  for (let i = 0; i < 33; i++) assert.equal(signal[i], null);
  assert.ok(signal[33] != null);
  approx(hist[33], line[33] - signal[33], 1e-9);
});

test('trueRange/atr: constant bars give constant ATR', () => {
  const bars = Array.from({ length: 20 }, (_, i) => bar(100, 104, 96, 100, 1000, `2026-01-${String(i + 1).padStart(2, '0')}`));
  assert.deepEqual(trueRange(bars.slice(0, 3)), [8, 8, 8]);
  const a = atr(bars, 14);
  for (let i = 0; i < 13; i++) assert.equal(a[i], null);
  approx(a[13], 8, 1e-9);
  approx(a[19], 8, 1e-9);
});

test('bollinger: flat series collapses to the mid line', () => {
  const closes = Array.from({ length: 20 }, () => 100);
  const b = bollinger(closes, 20, 2);
  approx(b.mid[19], 100, 1e-9);
  approx(b.upper[19], 100, 1e-9);
  approx(b.lower[19], 100, 1e-9);
  approx(b.bandwidth[19], 0, 1e-9);
  approx(b.pctB[19], 0.5, 1e-9);
});

test('bollinger: ramp series matches the textbook mean ± 2σ', () => {
  const closes = Array.from({ length: 20 }, (_, i) => i + 1);
  const b = bollinger(closes, 20, 2);
  const sd = Math.sqrt((20 * 20 - 1) / 12); // variance of 1..20 = (n²-1)/12
  approx(b.mid[19], 10.5, 1e-9);
  approx(b.upper[19], 10.5 + 2 * sd, 1e-9);
  approx(b.lower[19], 10.5 - 2 * sd, 1e-9);
  assert.ok(b.pctB[19] > 0.9);
});

test('stochastic: close at the top of the window reads 100', () => {
  const bars = Array.from({ length: 20 }, (_, i) => bar(100, 110, 90, 110, 1000));
  const { k, d } = stochastic(bars, 14, 3);
  for (let i = 0; i < 13; i++) assert.equal(k[i], null);
  assert.equal(k[13], 100);
  assert.equal(d[15], 100);
});

test('stochastic: close mid-window reads 50', () => {
  const bars = Array.from({ length: 20 }, (_, i) => bar(100, 110, 90, 100, 1000, `2026-02-${String(i + 1).padStart(2, '0')}`));
  const { k } = stochastic(bars, 14, 3);
  assert.equal(k[13], 50);
});

test('adx: too-short series is all null; trend separates DI', () => {
  const few = Array.from({ length: 10 }, (_, i) => bar(100, 101, 99, 100 + i * 0.1, 1000));
  const out = adx(few, 14);
  assert.ok(out.adx.every((v) => v === null));
  assert.ok(out.plusDI.every((v) => v === null));

  const bars = Array.from({ length: 80 }, (_, i) => {
    const c = 100 + i * 1.5;
    return bar(c, c + 1, c - 1, c, 1000, `2026-03-${String((i % 28) + 1).padStart(2, '0')}`);
  });
  const strong = adx(bars, 14);
  assert.ok(strong.adx.at(-1) != null);
  assert.ok(strong.plusDI.at(-1) > strong.minusDI.at(-1));
  for (const v of strong.adx) if (v != null) assert.ok(v >= 0 && v <= 100);
});

test('obv: adds on up days, subtracts on down days, flat is neutral', () => {
  const bars = [
    bar(10, 11, 9, 10, 100),
    bar(10, 12, 10, 11, 200),
    bar(11, 12, 10, 11, 300),
    bar(11, 11.5, 10, 11, 400),
    bar(11, 13, 10, 12, 500),
  ];
  assert.deepEqual(obv(bars), [0, 200, 200, 200, 700]);
});

test('roc: percent change n bars back, null over a zero base', () => {
  assert.deepEqual(roc([100, 110, 121], 1), [null, 10, 10]);
  assert.equal(roc([0, 5], 1)[1], null);
});

test('donchian: rolling high/low over the window', () => {
  const bars = [
    bar(9, 10, 8, 9.5, 1),
    bar(10, 12, 9, 11, 1),
    bar(11, 13, 7, 8, 1),
    bar(8, 14, 10, 12, 1),
  ];
  const { upper, lower } = donchian(bars, 3);
  for (let i = 0; i < 2; i++) {
    assert.equal(upper[i], null);
    assert.equal(lower[i], null);
  }
  assert.equal(upper[2], 13);
  assert.equal(lower[2], 7);
  assert.equal(upper[3], 14);
  assert.equal(lower[3], 7);
});

test('relativeVolume: 1.0 is an average session', () => {
  const bars = Array.from({ length: 21 }, (_, i) => bar(100, 101, 99, 100, i === 20 ? 300 : 100));
  const rel = relativeVolume(bars, 20);
  for (let i = 0; i < 19; i++) assert.equal(rel[i], null);
  approx(rel[19], 1, 1e-9);
  approx(rel[20], 300 / 110, 1e-9);
});

test('linregSlopePct: a straight ramp measures its own percent-per-bar', () => {
  const vals = Array.from({ length: 25 }, (_, i) => 100 + i);
  const slope = linregSlopePct(vals, 20);
  for (let i = 0; i < 18; i++) assert.equal(slope[i], null);
  // window 100..119 → mean 109.5, slope 1 EGP/bar
  approx(slope[19], (1 / 109.5) * 100, 1e-9);
  approx(slope[24], (1 / 114.5) * 100, 1e-9);
});

test('historicalVolatility: constant closes are zero risk', () => {
  const closes = Array.from({ length: 30 }, () => 100);
  const v = historicalVolatility(closes, 20);
  for (let i = 0; i < 19; i++) assert.equal(v[i], null);
  approx(v[29], 0, 1e-9);
});

test('historicalVolatility: known value for a two-bar alternation', () => {
  const r = Math.log(1.01);
  const expected = Math.sqrt(2 * r * r * 248) * 100;
  const v = historicalVolatility([100, 101, 100], 2);
  approx(v[2], expected, 1e-9);
});

test('maxDrawdown: worst peak-to-trough as a negative percent', () => {
  approx(maxDrawdown([100, 120, 90, 110]), -25, 1e-9);
  approx(maxDrawdown([100, 110, 120]), 0, 1e-9);
  approx(maxDrawdown([50]), 0, 1e-9);
  approx(maxDrawdown([10, 5, 2]), -80, 1e-9);
});