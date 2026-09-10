import test from 'node:test';
import assert from 'node:assert/strict';

import '../helpers/env.js';

import RULES from '../../src/config/rules.js';
import {
  efficiencyRatio, estimateSessions, describeHorizon, midTermTarget,
  longTermTarget, targetEstimate, buildTargets,
} from '../../src/scoring/targets.js';
import { synthBars, breakoutBars, choppyBars, downtrendBars } from '../helpers/bars.js';

test('efficiencyRatio: 1.0 is a straight line, 0 is pure chop or no motion', () => {
  const line = efficiencyRatio(Array.from({ length: 51 }, (_, i) => i + 1), 50);
  assert.equal(line, 1);
  assert.equal(efficiencyRatio(Array.from({ length: 51 }, () => 100), 50), 0);
  assert.equal(efficiencyRatio([1, 2, 3], 50), null); // too short
  const chop = efficiencyRatio(choppyBars({ sessions: 80 }).map((b) => b.c), 50);
  assert.ok(chop != null && chop < 0.3, `choppy ER should be low, got ${chop}`);
});

test('estimateSessions: atr × er, capped at 1% of price per session', () => {
  assert.equal(estimateSessions(10, 1, 1, 100), 10);
  assert.equal(estimateSessions(10, 1, 1, 500), 10);
  assert.equal(estimateSessions(50, 2, 0.5, 100), 50, '1 EGP/session of honest progress → 50 sessions');
  assert.equal(estimateSessions(10, 1, 0.07), null, 'ER under the honesty floor');
  assert.equal(estimateSessions(10, 0, 1), null);
  assert.equal(estimateSessions(0, 1, 1), null);
  assert.equal(estimateSessions(100_000, 1, 1), null, 'impossible ETA is refused, not fabricated');
});

test('describeHorizon: Arabic count phrasing', () => {
  assert.equal(describeHorizon(null).ar, 'غير محدد — السهم في نطاق عرضي');
  assert.equal(describeHorizon(3).ar, 'خلال أسبوع (3 جلسات)');
  assert.equal(describeHorizon(10).ar, 'حوالي أسبوعين'); // 10 sessions / 5 = 2 → dual
  assert.equal(describeHorizon(21).ar, 'حوالي 4 أسابيع'); // the weeks branch wins up to 21 sessions
  assert.equal(describeHorizon(30).ar, 'شهر إلى شهر ونص');
  assert.equal(describeHorizon(42).ar, 'حوالي شهرين'); // dual months
  assert.equal(describeHorizon(63).ar, 'حوالي 3 أشهر');
  assert.equal(describeHorizon(300).ar, 'أكثر من سنة');
});

test('midTermTarget: a strong resistance is the first anchor', () => {
  const snapshot = {
    price: { close: 100, high52w: 101 },
    volatility: { atr14: 2 },
    levels: { supports: [], resistances: [{ price: 110, strength: 70, touches: 3 }] },
    breakout: null,
    returns: {},
  };
  const bars = synthBars({ sessions: 120, seed: 9 });
  const t = midTermTarget(snapshot, bars, { entry: 100, stop: 95 });
  assert.equal(t.price, 110);
  assert.equal(t.method, 'resistance');
  assert.equal(t.upsidePct, 10);
  assert.equal(t.riskReward, 2);
  assert.equal(t.meetsMinRR, true);
});

test('midTermTarget: ignores a resistance closer than the noise floor', () => {
  const snapshot = {
    price: { close: 100, high52w: 101 },
    volatility: { atr14: 2 },
    levels: { supports: [], resistances: [{ price: 101, strength: 90, touches: 5 }] },
    breakout: null,
    returns: {},
  };
  const t = midTermTarget(snapshot, synthBars({ sessions: 120 }), {});
  // 1 EGP away < 1.5×ATR → falls through to the 6× ATR projection
  assert.equal(t.method, 'atr_projection');
  assert.equal(t.price, 112);
});

test('midTermTarget: 52w high is used when it is overhead', () => {
  const snapshot = {
    price: { close: 100, high52w: 130 },
    volatility: { atr14: 2 },
    levels: { supports: [], resistances: [] },
    breakout: null,
    returns: {},
  };
  const t = midTermTarget(snapshot, synthBars({ sessions: 120 }));
  assert.equal(t.method, 'high_52w');
  assert.equal(t.price, 130);
});

test('midTermTarget: null with no ATR and no structure to anchor on', () => {
  const snapshot = {
    price: { close: 100, high52w: 100.5 },
    volatility: { atr14: null },
    levels: { supports: [], resistances: [] },
    breakout: null,
    returns: {},
  };
  assert.equal(midTermTarget(snapshot, synthBars({ sessions: 120 })), null);
});

test('midTermTarget: anchored to the market price, not a low planned entry', () => {
  // The ZMID regression: a pullback entry must never drag the target under price.
  const snapshot = {
    price: { close: 9.8, high52w: 9.9 },
    volatility: { atr14: 0.2 },
    levels: { supports: [], resistances: [{ price: 12, strength: 70, touches: 4 }] },
    breakout: null,
    returns: {},
  };
  const t = midTermTarget(snapshot, synthBars({ sessions: 120 }), { entry: 8, stop: 7.5 });
  assert.equal(t.price, 12);
  assert.ok(t.upsidePct > 0);
  assert.ok(t.upsideFromEntryPct > t.upsidePct, 'entry below market boosts the entry-relative upside');
});

test('longTermTarget: refuses a downtrend outright', () => {
  const result = longTermTarget(
    { price: { close: 100 }, volatility: { atr14: 2 }, trend: { score: -40 }, returns: {} },
    downtrendBars({ sessions: 120 }),
  );
  assert.equal(result.price, null);
  assert.ok(result.note.includes('هابط'));
});

test('longTermTarget: fib extension vs decayed trend, conservative wins', () => {
  const bars = synthBars({ sessions: 260, start: 80, driftPct: 0.06, seed: 4 });
  const price = bars.at(-1).c;
  const lo = Math.min(...bars.map((b) => b.l));
  const hi = Math.max(...bars.map((b) => b.h));
  const snapshot = {
    price: { close: price },
    volatility: { atr14: 1 },
    trend: { score: 40 },
    returns: { m6: 20 },
  };
  const result = longTermTarget(snapshot, bars, RULES, null);
  assert.ok(result.price != null);
  const fib = +(lo + (hi - lo) * 1.618).toFixed(2);
  const trendProjection = +(price * (1 + 0.2)).toFixed(2);
  assert.equal(result.price, Math.min(fib, trendProjection));
});

test('longTermTarget: flags when the long target lands under the mid target', () => {
  const snapshot = { price: { close: 100 }, volatility: { atr14: 1 }, trend: { score: 40 }, returns: { m6: 4 } };
  const bars = synthBars({ sessions: 260, seed: 8 });
  const result = longTermTarget(snapshot, bars, RULES, 200);
  assert.ok(result.price != null);
  assert.ok(result.price <= 200, '4% six-month pace, halved, must project under 200');
  assert.ok(result.caveat.includes('أقرب من الهدف المتوسط'));
});

test('longTermTarget: nothing to project without trend returns', () => {
  const snapshot = { price: { close: 100 }, volatility: { atr14: 1 }, trend: { score: 5 }, returns: { m6: null } };
  // 50 bars → fibExtension declines (window < 60) and m6 is null → nothing to project
  const result = longTermTarget(snapshot, synthBars({ sessions: 50 }), RULES);
  assert.equal(result.price, null);
  assert.ok(result.note.includes('لا توجد بيانات كافية'));
});

test('targetEstimate: the desk badge language', () => {
  const reached = targetEstimate({ price: 100, target: 95 });
  assert.equal(reached.reached, true);
  assert.equal(targetEstimate({ price: 100, target: null }).reached, true);

  const weeks3 = targetEstimate({ price: 100, target: 110, sessions: 15 });
  assert.equal(weeks3.weeks, 3);
  assert.equal(weeks3.label, '2–4 أسابيع');

  const momentum = targetEstimate({ price: 100, target: 110, sessions: 15, dayChangePct: 4 });
  assert.equal(momentum.note, '↑ زخم');

  const sector = targetEstimate({ price: 100, target: 105, sector: 'banks' });
  assert.equal(sector.weeks, 2); // 5% ÷ 2.5%/week
  assert.equal(sector.label, '1–2 أسبوع');
});

test('buildTargets: real snapshot yields a mid target and an honest long story', () => {
  const bars = breakoutBars({ sessions: 260, base: 100, breakoutTo: 115, volume: 50_000 });
  const snapshot = {
    price: { close: bars.at(-1).c, high52w: Math.max(...bars.map((b) => b.h)) },
    volatility: { atr14: 1.5 },
    levels: { supports: [{ price: bars.at(-1).c * 0.97, strength: 70, distancePct: -3 }], resistances: [{ price: bars.at(-1).c * 1.12, strength: 75, touches: 3 }] },
    breakout: { direction: 'up', barsAgo: 5, level: bars.at(-1).c * 1.005, volumeConfirmed: true },
    trend: { score: 70 },
    returns: { m6: 12 },
  };
  const targets = buildTargets(snapshot, bars, { entry: bars.at(-1).c, stop: bars.at(-1).c * 0.95 });
  assert.ok(targets.mid != null);
  assert.ok(targets.mid.price > bars.at(-1).c);
  assert.ok(targets.efficiencyRatio != null);
  assert.ok(targets.long != null);
  assert.ok(targets.long.price != null || targets.long.note != null);
  assert.ok(targets.mid.horizon.sessions === null || Number.isInteger(targets.mid.horizon.sessions));
});