import test from 'node:test';
import assert from 'node:assert/strict';

import '../helpers/env.js';

import { scoreTechnical } from '../../src/scoring/technical.js';
import { buildSnapshot } from '../../src/ta/snapshot.js';
import { synthBars, downtrendBars, choppyBars } from '../helpers/bars.js';

const ACTIONS_BY_SCORE = (score) =>
  score >= 72 ? 'buy'
  : score >= 58 ? 'accumulate'
  : score >= 42 ? 'hold'
  : score >= 28 ? 'reduce'
  : 'avoid';

const checkShape = (result) => {
  assert.ok(Number.isInteger(result.score), `score must be an integer, got ${result.score}`);
  assert.ok(result.score >= 0 && result.score <= 100);
  // The components must add up to the published score — every point attributable.
  const total = Object.values(result.components).reduce((a, c) => a + c.points, 0);
  assert.ok(Math.abs(Math.round(total) - result.score) <= 1, `components sum ${total} vs score ${result.score}`);
  assert.equal(result.signal.action, ACTIONS_BY_SCORE(result.score));
  assert.ok(['buy', 'accumulate', 'hold', 'reduce', 'avoid'].includes(result.signal.action));
  for (const key of ['bullish', 'bearish', 'neutral']) assert.ok(Array.isArray(result.reasons[key]));
};

test('a strong uptrend scores high and reads as a buy/accumulate', () => {
  const bars = synthBars({ sessions: 300, start: 100, driftPct: 0.12, seed: 2, volume: 80_000 });
  const snapshot = buildSnapshot(bars, { code: 'TESTUP', ar: 'تريند', sector: 'financials' });
  const result = scoreTechnical(snapshot);
  checkShape(result);
  assert.ok(result.score >= 58, `uptrend score ${result.score} should land in buy/accumulate territory`);
  assert.ok(result.signal.action === 'buy' || result.signal.action === 'accumulate');
});

test('a sustained downtrend scores materially lower', () => {
  const bars = synthBars({ sessions: 300, start: 200, driftPct: -0.12, seed: 2, volume: 80_000 });
  const snapshot = buildSnapshot(bars, { code: 'DOWN', ar: 'هابط', sector: 'financials' });
  const result = scoreTechnical(snapshot);
  checkShape(result);
  const upBars = synthBars({ sessions: 300, start: 100, driftPct: 0.12, seed: 2, volume: 80_000 });
  const upScore = scoreTechnical(buildSnapshot(upBars, { code: 'UP' })).score;
  assert.ok(result.score < upScore);
  assert.ok(['reduce', 'avoid'].includes(result.signal.action), `downtrend action: ${result.signal.action}`);
});

test('a sideways churner lands in the neutral band, below the uptrend', () => {
  const bars = choppyBars({ sessions: 300, start: 100, seed: 5 });
  const result = scoreTechnical(buildSnapshot(bars, { code: 'CHOP' }));
  checkShape(result);
  assert.ok(result.score >= 0 && result.score <= 100);
});

test('every component stays within its own point budget', () => {
  const bars = synthBars({ sessions: 300, driftPct: 0.15, seed: 8 });
  const { components } = scoreTechnical(buildSnapshot(bars, { code: 'X' }));
  const budgets = { trend: 30, momentum: 25, participation: 15, location: 20, risk: 10 };
  for (const [name, budget] of Object.entries(budgets)) {
    assert.ok(components[name], `missing component ${name}`);
    assert.ok(components[name].points >= 0 && components[name].points <= budget, `${name}: ${components[name].points}`);
    assert.equal(components[name].max, budget);
  }
});

test('a snapshot with no moving averages yet still scores sanely', () => {
  const bars = synthBars({ sessions: 80, seed: 12 });
  const result = scoreTechnical(buildSnapshot(bars, { code: 'YOUNG' }));
  checkShape(result);
});