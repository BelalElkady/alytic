import test from 'node:test';
import assert from 'node:assert/strict';

import '../helpers/env.js';

import {
  savedPrices, findAdjustment, findGap, basisDate, holdsOldBasis, adjustHolding,
  confirmedFactor, decide, detectCorporateActions, applyCorporateActions, resolveCorporateAction,
} from '../../src/corporateActions.js';
import { stampSharesSetAt } from '../../src/portfolio.js';

// POUL, September 2026: 2.688241359 shares for every share held at the close
// of 2026-09-21. The feed's history is divided by the factor; the prices the
// app saved at each close are not.
const FACTOR = 2.688241359;
const DATES = ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24'];
const RAW = [101.5, 102.1, 101.9, 102.4, 102.8, 102.37, 38.3, 38.1, 38.2];
const EVENT_AT = 6; // first session on the new basis
const adjustedBars = DATES.map((date, i) => ({ date, c: i < EVENT_AT ? RAW[i] / FACTOR : RAW[i] }));
const logFrom = (upTo) => Object.fromEntries(DATES.slice(0, upTo).map((d, i) => [d, { prices: { POUL: RAW[i] } }]));

const book = (overrides = {}) => ({
  positions: { POUL: { shares: 385, avgCost: 102.3709, stop: 95, target: 120, openedAt: '2026-05-01', ...overrides } },
  trades: [],
  log: logFrom(DATES.length),
  corporateActions: [],
});

test('saved prices skip backfilled entries', () => {
  const p = { log: { '2026-09-01': { prices: { POUL: 50 }, reconstructed: true }, '2026-09-02': { prices: { POUL: 51 } } } };
  assert.deepEqual(savedPrices(p, 'POUL'), [{ date: '2026-09-02', price: 51 }]);
});

test('the factor is read off saved prices against the adjusted feed', () => {
  const found = findAdjustment(savedPrices(book(), 'POUL'), adjustedBars);
  assert.ok(Math.abs(found.factor / FACTOR - 1) < 0.001);
  assert.equal(found.lastBefore, '2026-09-21');
  assert.equal(found.firstAfter, '2026-09-22');
  assert.equal(found.strong, true);
});

test('no event: saved prices that match the feed give nothing', () => {
  const bars = DATES.map((date, i) => ({ date, c: RAW[i] * 1.01 }));
  assert.equal(findAdjustment(savedPrices(book(), 'POUL'), bars), null);
});

test('a one-off snapshot taken mid-session is not an event', () => {
  const p = book();
  p.log['2026-09-23'].prices.POUL = 36.9; // 3% off the close
  const bars = DATES.map((date, i) => ({ date, c: RAW[i] }));
  assert.equal(findAdjustment(savedPrices(p, 'POUL'), bars), null);
});

test('a feed that has not adjusted yet: the live quote gap is the signal', () => {
  const anchors = savedPrices({ log: logFrom(EVENT_AT) }, 'POUL');
  const gap = findGap(anchors, 38.2, '2026-09-22');
  assert.ok(Math.abs(gap.factor - 102.37 / 38.2) < 1e-9);
  assert.equal(gap.source, 'gap');
  assert.equal(findGap(anchors, 95, '2026-09-22'), null, 'a limit-down day is not a gap');
});

test('holding numbers set after the event are left alone', () => {
  const candidate = findAdjustment(savedPrices(book(), 'POUL'), adjustedBars);
  // Re-imported from the broker on the 27th: already 1,035 at 38.08.
  const reimported = { shares: 1035, avgCost: 38.08, openedAt: '2026-09-27' };
  const p = book(reimported);
  assert.equal(holdsOldBasis(p.positions.POUL, basisDate(p, 'POUL'), candidate, 38.2), false);
  // Same numbers from a legacy position with an old openedAt: the cost decides.
  const legacy = book({ ...reimported, openedAt: '2026-05-01' });
  assert.equal(holdsOldBasis(legacy.positions.POUL, basisDate(legacy, 'POUL'), candidate, 38.2), false);
});

test('a holding set before the event follows it, even deep in profit', () => {
  const candidate = findAdjustment(savedPrices(book(), 'POUL'), adjustedBars);
  const p = book({ avgCost: 38, sharesSetAt: '2026-06-01' }); // bought at 38 pre-event, now worth 102
  assert.equal(holdsOldBasis(p.positions.POUL, basisDate(p, 'POUL'), candidate, 38.2), true);
});

test('adjusting keeps the money in and moves the levels', () => {
  const next = adjustHolding({ shares: 385, avgCost: 102.3709, stop: 95, target: 120 }, FACTOR);
  assert.equal(next.shares, 1035);
  assert.ok(Math.abs(next.shares * next.avgCost - 385 * 102.3709) < 0.1);
  assert.equal(next.stop, +(95 / FACTOR).toFixed(2));
  assert.equal(next.target, +(120 / FACTOR).toFixed(2));
});

test('an announced ratio is used only when the prices agree, either reading of it', () => {
  const candidate = { factor: 2.69, source: 'prices', strong: false };
  assert.equal(confirmedFactor({ found: true, kind: 'merger', sharesAfterPerShare: FACTOR }, candidate), FACTOR);
  assert.equal(confirmedFactor({ found: true, kind: 'bonus', sharesAfterPerShare: FACTOR - 1 }, candidate), FACTOR);
  assert.equal(confirmedFactor({ found: true, kind: 'bonus', sharesAfterPerShare: 2 }, candidate), null);
  assert.equal(confirmedFactor({ found: true, kind: 'rights', sharesAfterPerShare: FACTOR }, candidate), null);
});

test('decide: research, then strong prices, else wait for the user', () => {
  const strong = { factor: 2.6885, source: 'prices', strong: true };
  const weak = { factor: 2.6885, source: 'gap', strong: false };
  assert.deepEqual(decide(weak, { found: true, kind: 'merger', sharesAfterPerShare: FACTOR }), { status: 'applied', factor: FACTOR, confirmedBy: 'research' });
  assert.deepEqual(decide(strong, null), { status: 'applied', factor: 2.6885, confirmedBy: 'prices' });
  assert.equal(decide(weak, null).status, 'pending');
  assert.equal(decide(strong, { found: true, kind: 'rights', sharesAfterPerShare: null }).status, 'pending');
});

test('end to end: detected, researched, applied once, undone', async () => {
  const p = book();
  const research = async () => ({ found: true, kind: 'merger', sharesAfterPerShare: FACTOR, effectiveDate: '2026-09-22', summaryAr: 'اندماج', sourceUrl: null });
  const proposals = await detectCorporateActions(p, { barsFor: async () => adjustedBars, research, today: '2026-09-27', livePrices: new Map([['POUL', 38.2]]) });
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].confirmedBy, 'research');

  const applied = applyCorporateActions(p, proposals);
  assert.equal(applied.positions.POUL.shares, 1035);
  assert.equal(applied.corporateActions[0].status, 'applied');
  assert.equal(applied.cashFlows, undefined, 'no cash flow: the same money, more shares');

  // Run again on the adjusted book: nothing new.
  assert.deepEqual(await detectCorporateActions(applied, { barsFor: async () => adjustedBars, research, today: '2026-09-27' }), []);
  assert.equal(applyCorporateActions(applied, proposals), applied);

  const undone = resolveCorporateAction(applied, { code: 'POUL', lastBefore: '2026-09-21', action: 'undo' });
  assert.equal(undone.positions.POUL.shares, 385);
  assert.equal(undone.corporateActions[0].status, 'undone');
  const redone = resolveCorporateAction(undone, { code: 'POUL', lastBefore: '2026-09-21', action: 'apply' });
  assert.equal(redone.positions.POUL.shares, 1035);
});

test('a pending gap is upgraded once the feed adjusts', async () => {
  const early = { ...book(), log: logFrom(EVENT_AT) };
  const unadjusted = DATES.slice(0, EVENT_AT).map((date, i) => ({ date, c: RAW[i] }));
  const first = await detectCorporateActions(early, { barsFor: async () => unadjusted, today: '2026-09-22', livePrices: new Map([['POUL', 38.3]]) });
  assert.equal(first[0].status, 'pending');
  const pending = applyCorporateActions(early, first);
  assert.equal(pending.positions.POUL.shares, 385);

  const later = await detectCorporateActions(pending, { barsFor: async () => adjustedBars, today: '2026-09-22', livePrices: new Map([['POUL', 38.3]]) });
  assert.equal(later[0].status, 'applied');
  const applied = applyCorporateActions(pending, later);
  assert.equal(applied.positions.POUL.shares, Math.round(385 * later[0].factor));
  assert.equal(applied.corporateActions.length, 1);
});

test('stampSharesSetAt marks only holdings whose numbers changed', () => {
  const before = { positions: { A: { shares: 10, avgCost: 5 }, B: { shares: 3, avgCost: 7 } } };
  const after = { positions: { A: { shares: 10, avgCost: 5, stop: 4 }, B: { shares: 6, avgCost: 6 }, C: { shares: 1, avgCost: 1 } } };
  const stamped = stampSharesSetAt(before, after, new Date('2026-09-27T10:00:00Z'));
  assert.equal(stamped.positions.A.sharesSetAt, undefined);
  assert.equal(stamped.positions.B.sharesSetAt, '2026-09-27');
  assert.equal(stamped.positions.C.sharesSetAt, '2026-09-27');
});
