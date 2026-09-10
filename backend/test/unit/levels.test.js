import test from 'node:test';
import assert from 'node:assert/strict';

import '../helpers/env.js';

import { findPivots, clusterLevels, volumeProfile, buildLevels } from '../../src/ta/levels.js';
import { synthBars, breakoutBars } from '../helpers/bars.js';

const bar = (o, h, l, c, v, date = '2026-01-01') => ({ o, h, l, c, v, date });

test('findPivots: a fractal high registers once', () => {
  const bars = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((i) =>
    bar(100, 100 + i * 0.1, 99, 100, 1000, `2026-04-${String(i).padStart(2, '0')}`),
  );
  bars[5] = { ...bars[5], h: 120 };
  const { highs, lows } = findPivots(bars, 2);
  assert.equal(highs.length, 1);
  assert.equal(highs[0].index, 5);
  assert.equal(highs[0].price, 120);
});

test('findPivots: flat double-tops register once, not zero times', () => {
  const bars = [
    bar(100, 100, 99, 100, 1),
    bar(100, 100, 99, 100, 1),
    bar(100, 102, 99, 100, 1),
    bar(100, 102, 99, 100, 1),
    bar(100, 100, 99, 100, 1),
    bar(100, 100, 99, 100, 1),
  ];
  const { highs } = findPivots(bars, 1);
  assert.equal(highs.length, 1);
  assert.equal(highs[0].index, 2);
});

test('clusterLevels: nearby pivots merge into one stronger level', () => {
  const levels = clusterLevels(
    [
      { index: 98, price: 100.5, volume: 100, date: '2026-01-01' },
      { index: 99, price: 100, volume: 100, date: '2026-01-02' },
    ],
    { tolerancePct: 2, totalBars: 100 },
  );
  assert.equal(levels.length, 1);
  assert.equal(levels[0].touches, 2);
  assert.equal(levels[0].price, 100.25);
  // 2 touches → 22 pts, fresh touch → 30 pts, full volume share → 15 pts
  assert.equal(levels[0].strength, 67);
});

test('clusterLevels: distant pivots stay separate', () => {
  const levels = clusterLevels(
    [
      { index: 98, price: 100, volume: 100, date: '2026-01-01' },
      { index: 99, price: 105, volume: 100, date: '2026-01-02' },
    ],
    { tolerancePct: 2 },
  );
  assert.equal(levels.length, 2);
});

test('volumeProfile: point of control sits at the most-traded shelf', () => {
  const hot = Array.from({ length: 100 }, (_, i) => bar(49.5, 50.5, 49, 50, 1000, `2026-05-${String((i % 28) + 1).padStart(2, '0')}`));
  const cold = Array.from({ length: 10 }, (_, i) => bar(60, 61, 59.5, 60, 100, `2026-06-${String(i + 1).padStart(2, '0')}`));
  const { poc, nodes } = volumeProfile([...hot, ...cold], { buckets: 40 });
  assert.ok(poc != null);
  assert.ok(poc < 52, `poc ${poc} should sit on the hot shelf`);
  assert.ok(nodes.length > 0);
  assert.ok(nodes[0].share >= nodes[nodes.length - 1].share);
});

test('volumeProfile: degenerate single-price series has no profile', () => {
  const bars = Array.from({ length: 30 }, () => bar(50, 50, 50, 50, 100));
  const { poc, nodes } = volumeProfile(bars);
  assert.equal(poc, null);
  assert.deepEqual(nodes, []);
});

test('buildLevels: splits levels around the last close with signed distance', () => {
  const bars = breakoutBars({ sessions: 140, base: 100, breakoutTo: 115, volume: 50_000 });
  const levels = buildLevels(bars, { lookback: 3, tolerancePct: 2, profileBars: 120 });
  const price = levels.price;
  assert.ok(price > 0);
  assert.ok(levels.supports.length > 0);
  assert.ok(levels.resistances.length >= 0);
  for (const s of levels.supports) {
    assert.ok(s.price < price * 0.995, `support ${s.price} must sit under ${price}`);
    assert.ok(s.distancePct < 0);
    assert.ok(s.strength >= 0 && s.strength <= 100);
  }
  for (const r of levels.resistances) {
    assert.ok(r.price > price * 1.005, `resistance ${r.price} must sit over ${price}`);
    assert.ok(r.distancePct > 0);
  }
  // Nearest support is the highest one below the price; nearest resistance the lowest above.
  const sups = levels.supports.map((s) => s.price);
  assert.deepEqual(sups, [...sups].sort((a, b) => b - a));
  const res = levels.resistances.map((r) => r.price);
  assert.deepEqual(res, [...res].sort((a, b) => a - b));
});