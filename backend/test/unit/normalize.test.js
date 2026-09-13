import test from 'node:test';
import assert from 'node:assert/strict';

import '../helpers/env.js';

import { normalizeHigher, normalizeLower, normalizeTarget, percentileRank, weightedAverage, clamp } from '../../src/scoring/normalize.js';

test('clamp keeps a value inside [lo, hi] and passes through inside it', () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-5, 0, 10), 0);
  assert.equal(clamp(15, 0, 10), 10);
});

test('normalizeHigher: higher value scores higher, clamped at the ends', () => {
  assert.equal(normalizeHigher(0, 0, 100), 0);
  assert.equal(normalizeHigher(100, 0, 100), 100);
  assert.equal(normalizeHigher(50, 0, 100), 50);
  assert.equal(normalizeHigher(-50, 0, 100), 0, 'below min clamps to 0');
  assert.equal(normalizeHigher(150, 0, 100), 100, 'above max clamps to 100');
});

test('normalizeLower: lower value scores higher, clamped at the ends', () => {
  assert.equal(normalizeLower(0, 0, 100), 100);
  assert.equal(normalizeLower(100, 0, 100), 0);
  assert.equal(normalizeLower(25, 0, 100), 75);
  assert.equal(normalizeLower(-50, 0, 100), 100);
  assert.equal(normalizeLower(150, 0, 100), 0);
});

test('normalizeHigher/normalizeLower return null for missing input, never 0', () => {
  for (const fn of [normalizeHigher, normalizeLower]) {
    assert.equal(fn(null, 0, 100), null);
    assert.equal(fn(undefined, 0, 100), null);
    assert.equal(fn(NaN, 0, 100), null);
    assert.equal(fn(Infinity, 0, 100), null);
  }
});

test('normalizeHigher/normalizeLower degrade to 50 when min === max (no usable range)', () => {
  assert.equal(normalizeHigher(5, 10, 10), 50);
  assert.equal(normalizeLower(5, 10, 10), 50);
});

test('normalizeTarget peaks at the target and decays to 0 at either edge', () => {
  const range = { low: 0.5, target: 1.8, high: 5 };
  assert.equal(normalizeTarget(1.8, range), 100);
  assert.equal(normalizeTarget(0.5, range), 0);
  assert.equal(normalizeTarget(5, range), 0);
  assert.equal(normalizeTarget(0.1, range), 0, 'below low still floors at 0, not negative');
  assert.equal(normalizeTarget(9, range), 0, 'above high still floors at 0, not negative');
  const belowTarget = normalizeTarget(1.15, range); // halfway between low and target
  const aboveTarget = normalizeTarget(3.4, range); // halfway between target and high
  assert.ok(belowTarget > 0 && belowTarget < 100);
  assert.ok(aboveTarget > 0 && aboveTarget < 100);
});

test('normalizeTarget returns null for missing input', () => {
  assert.equal(normalizeTarget(null, { low: 0, target: 1, high: 2 }), null);
});

test('percentileRank: 0 at the bottom, 100 at the top, correct middle', () => {
  const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.equal(percentileRank(0, sorted), 0);
  assert.equal(percentileRank(10, sorted), 100);
  assert.equal(percentileRank(5, sorted), 50);
});

test('percentileRank returns null for missing input or an empty reference set', () => {
  assert.equal(percentileRank(5, []), null);
  assert.equal(percentileRank(null, [1, 2, 3]), null);
});

test('weightedAverage combines weighted values and ignores zero/negative weights', () => {
  assert.equal(weightedAverage([{ value: 100, weight: 1 }, { value: 0, weight: 1 }]), 50);
  assert.equal(weightedAverage([{ value: 80, weight: 3 }, { value: 20, weight: 1 }]), 65);
  assert.equal(weightedAverage([{ value: 80, weight: 1 }, { value: 20, weight: 0 }]), 80, 'a zero-weight entry contributes nothing');
});

test('weightedAverage excludes a missing (null) value instead of treating it as 0', () => {
  // A single null-value part must not drag the average toward 0 — it should
  // simply be excluded and the weight renormalized across what remains.
  assert.equal(weightedAverage([{ value: 80, weight: 1 }, { value: null, weight: 1 }]), 80);
  assert.equal(weightedAverage([{ value: 60, weight: 1 }, { value: null, weight: 5 }]), 60);
});

test('weightedAverage returns null only when nothing usable was supplied', () => {
  assert.equal(weightedAverage([]), null);
  assert.equal(weightedAverage([{ value: null, weight: 1 }]), null);
  assert.equal(weightedAverage([{ value: 5, weight: 0 }]), null);
  assert.equal(weightedAverage(undefined), null);
});

test('weightedAverage treats a real 0 value as data, not as missing', () => {
  assert.equal(weightedAverage([{ value: 0, weight: 1 }]), 0);
  assert.equal(weightedAverage([{ value: 0, weight: 1 }, { value: null, weight: 1 }]), 0);
});
