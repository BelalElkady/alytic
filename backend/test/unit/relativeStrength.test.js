import test from 'node:test';
import assert from 'node:assert/strict';

import '../helpers/env.js';

import RULES from '../../src/config/rules.js';
import { rulesForStyle } from '../../src/config/styles.js';
import { relativeWeakness } from '../../src/scoring/relativeStrength.js';
import { positionRecommendation } from '../../src/scoring/risk.js';

const day = (i) => `2026-09-${String(i + 1).padStart(2, '0')}`;
const series = (closes) => closes.map((c, i) => ({ date: day(i), c }));
/** An index that moved `pct` over the same eleven sessions. */
const index = (pct) => ({ name: 'EGX70', bars: [{ date: day(0), c: 1000 }, { date: day(10), c: 1000 * (1 + pct / 100) }] });

// 100 → 90 in a straight line: −10% over 10 sessions, last close 90 under the 10-day average 94.5.
const sliding = series(Array.from({ length: 11 }, (_, i) => 100 - i));
const trader = rulesForStyle(RULES, 'trader');
const medium = rulesForStyle(RULES, 'medium');

test('relativeWeakness: a stock trailing its index under its 10-day average fires, with the style\'s quantity', () => {
  const t = relativeWeakness({ bars: sliding, index: index(-1), shares: 100, partialTaken: false }, trader);
  assert.equal(t.stockPct, -10);
  assert.equal(t.indexPct, -1);
  assert.equal(t.lagPts, -9);
  assert.equal(t.ma, 94.5);
  assert.equal(t.belowMa, true);
  assert.equal(t.fired, true);
  assert.equal(t.qty, 50);
  assert.equal(t.remainingShares, 50);
  assert.equal(relativeWeakness({ bars: sliding, index: index(-1), shares: 100, partialTaken: false }, medium).qty, 30);
});

test('relativeWeakness: the medium style needs a wider lag than the trader style', () => {
  // −10% against an index down 7%: 3 points behind.
  assert.equal(relativeWeakness({ bars: sliding, index: index(-7), shares: 100, partialTaken: false }, trader).fired, true);
  assert.equal(relativeWeakness({ bars: sliding, index: index(-7), shares: 100, partialTaken: false }, medium).fired, false);
});

test('relativeWeakness: does not fire above the average, once trimmed, or for the long style', () => {
  // Down 15% over the span but the last close is back over the 10-day average.
  const bounced = series([100, ...Array(9).fill(80), 85]);
  const b = relativeWeakness({ bars: bounced, index: index(0), shares: 100, partialTaken: false }, trader);
  assert.equal(b.belowMa, false);
  assert.equal(b.fired, false);
  const trimmed = relativeWeakness({ bars: sliding, index: index(-1), shares: 100, partialTaken: true }, trader);
  assert.equal(trimmed.alreadyTrimmed, true);
  assert.equal(trimmed.fired, false);
  assert.equal(relativeWeakness({ bars: sliding, index: index(-1), shares: 100, partialTaken: false }, rulesForStyle(RULES, 'long')), null);
});

test('relativeWeakness: no index history or too few sessions is unavailable, never fired', () => {
  const none = relativeWeakness({ bars: sliding, index: null, shares: 100, partialTaken: false }, trader);
  assert.equal(none.available, false);
  assert.equal(none.fired, false);
  assert.equal(relativeWeakness({ bars: sliding.slice(0, 5), index: index(-1), shares: 100, partialTaken: false }, trader).available, false);
  // One share can't be split.
  assert.equal(relativeWeakness({ bars: sliding, index: index(-1), shares: 1, partialTaken: false }, trader).fired, false);
});

const snap = (price) => ({
  price: { close: price },
  trend: { score: 0 },
  movingAverages: { priceVsSma200Pct: null },
});

test('positionRecommendation: a fired R7 trims instead of holding; a breached stop still wins', () => {
  const weakness = relativeWeakness({ bars: sliding, index: index(-1), shares: 100, partialTaken: false }, trader);
  const r = positionRecommendation({ snapshot: snap(90), position: { avgCost: 100, shares: 100 }, trailing: { stop: 85, moved: false }, midTarget: 110, weakness }, trader);
  assert.equal(r.action, 'trim_weak');
  assert.deepEqual(r.order, { side: 'sell', qty: 50, price: 90 });
  const exit = positionRecommendation({ snapshot: snap(84), position: { avgCost: 100, shares: 100 }, trailing: { stop: 85, moved: false }, midTarget: 110, weakness }, trader);
  assert.equal(exit.action, 'exit_stop');
});
