import test from 'node:test';
import assert from 'node:assert/strict';

import '../helpers/env.js';

import { checkQuality, SEVERITY } from '../../src/data/quality.js';
import {
  synthBars, frozenBars, staleBars, thinHistoryBars, lowVolumeBars,
  choppyBars, writeBars, tradingDates,
} from '../helpers/bars.js';

const fatalMessages = (result) =>
  result.issues.filter((i) => i.level === SEVERITY.FATAL).map((i) => i.message);

test('a healthy series passes clean', () => {
  const result = checkQuality(synthBars({ sessions: 260, seed: 3 }), { code: 'HEAL' });
  assert.equal(result.ok, true);
  assert.equal(result.severity, SEVERITY.OK);
  assert.deepEqual(result.issues, []);
  assert.equal(result.barsCount, 260);
});

test('no bars at all is fatal immediately', () => {
  const result = checkQuality(null, { code: 'X' });
  assert.equal(result.ok, false);
  assert.equal(result.issues[0].level, SEVERITY.FATAL);
});

test('short history (<60 sessions) is fatal', () => {
  const result = checkQuality(thinHistoryBars(), { code: 'THIN' });
  assert.equal(result.ok, false);
  assert.ok(fatalMessages(result).some((m) => m.includes('60')));
});

test('the ORAS failure mode: frozen series is fatal', () => {
  const result = checkQuality(frozenBars({ sessions: 80 }), { code: 'ORAS' });
  assert.equal(result.ok, false);
  assert.ok(fatalMessages(result).some((m) => m.includes('مجمدة')));
  // and the distinct-close check independently rejects it too
  assert.ok(fatalMessages(result).some((m) => m.includes('سعر مختلف')));
});

test('stale data past the tolerance is fatal', () => {
  const result = checkQuality(staleBars({ sessions: 120 }), { code: 'STALE' });
  assert.equal(result.ok, false);
  assert.ok(fatalMessages(result).some((m) => m.includes('متأخرة')));
});

test('dead volume is fatal', () => {
  const result = checkQuality(lowVolumeBars(), { code: 'DEAD' });
  assert.equal(result.ok, false);
  assert.ok(fatalMessages(result).some((m) => m.includes('مش بيتداول')));
});

test('mostly-zero volume warns', () => {
  const bars = choppyBars({ sessions: 120 }).map((b, i) => (i % 3 === 0 ? b : { ...b, v: 0 }));
  const result = checkQuality(bars, { code: 'QUIET' });
  assert.equal(result.ok, true);
  assert.ok(result.issues.some((i) => i.message.includes('بدون حجم')));
});

test('rare trading (few sessions in the last 90 days) is fatal', () => {
  const dates = tradingDates(260);
  const cutoff = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
  const old = dates.filter((d) => d < cutoff);
  const recentKept = dates.filter((d) => d >= cutoff).slice(-15);
  const bars = synthBars({ dates: [...old, ...recentKept] });
  const result = checkQuality(bars, { code: 'RARE' });
  assert.equal(result.ok, false);
  assert.ok(fatalMessages(result).some((m) => m.includes('تداول نادر')));
});

test('inverted or non-positive prices are fatal', () => {
  const bars = synthBars({ sessions: 120, seed: 5 });
  bars[50] = { ...bars[50], h: bars[50].l - 1 };
  const result = checkQuality(bars, { code: 'BAD' });
  assert.equal(result.ok, false);
  assert.ok(fatalMessages(result).some((m) => m.includes('غير منطقية')));
});

test('a 45%+ single-session gap warns about unadjusted splits', () => {
  const bars = synthBars({ sessions: 120, seed: 11 });
  bars[100].c = +(bars[99].c * 0.5).toFixed(2);
  bars[100].o = bars[99].c;
  bars[100].h = bars[100].l + 1;
  const result = checkQuality(bars, { code: 'SPLIT' });
  assert.equal(result.ok, true);
  assert.ok(result.issues.some((i) => i.message.includes('تجزئة')));
});

test('partially frozen series (55% unchanged closes) warns about weak liquidity', () => {
  const bars = synthBars({ sessions: 120, seed: 13 });
  const start = bars.length - 60;
  for (let i = start; i < bars.length - 1; i += 2) bars[i].c = bars[i + 1].c;
  const result = checkQuality(bars, { code: 'SEMI' });
  assert.equal(result.ok, true);
  assert.ok(result.issues.some((i) => i.level === SEVERITY.WARN && i.message.includes('ثابت')));
});

test('fixtures round-trip through the bar cache', async () => {
  const bars = synthBars({ sessions: 130, seed: 21 });
  const payload = await writeBars('TESTQ', bars);
  assert.equal(payload.bars.length, 130);
  assert.equal(payload.bars[0].date.length, 10);
});