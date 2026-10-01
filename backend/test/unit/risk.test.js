import test from 'node:test';
import assert from 'node:assert/strict';

import '../helpers/env.js';

import RULES from '../../src/config/rules.js';
import { rulesForStyle } from '../../src/config/styles.js';
import {
  computeStop, computeTrailingStop, computeLongTermStop, positionSize,
  riskReward, positionRecommendation, liquidityCheck, consecutiveClosesUnder,
} from '../../src/scoring/risk.js';

/** Minimal snapshot with just the fields the risk math reads. */
const snap = ({ price = 100, atr14 = 2, supports = [], resistances = [], trendScore = 0, priceVsSma200Pct = null, sma200 = null, avgTurnoverEgp = 5_000_000 } = {}) => ({
  price: { close: price, pctFrom52wHigh: null },
  volatility: { atr14, atrPct: atr14 ? +((atr14 / price) * 100).toFixed(2) : null, squeeze: false },
  levels: { supports, resistances },
  volume: { avgTurnoverEgp, obvTrend: null, relativeVolume: null },
  trend: { score: trendScore, label: '' },
  movingAverages: { sma200: priceVsSma200Pct == null ? null : price, priceVsSma200Pct, goldenCross: null },
});

test('computeStop: structure wins when a defended support exists', () => {
  const s = computeStop(snap({ supports: [{ price: 95, strength: 60, distancePct: -5 }] }), 100);
  assert.equal(s.basis, 'structure');
  assert.equal(s.stop, 94.05); // 95 × (1 − 1%)
  assert.equal(s.riskPct, 5.95);
  assert.deepEqual(s.supportDefended, { price: 95, strength: 60 });
  assert.equal(s.capped, false);
});

test('computeStop: no support falls back to the volatility stop', () => {
  const s = computeStop(snap({ atr14: 2 }), 100);
  assert.equal(s.basis, 'volatility');
  assert.equal(s.stop, 93); // 100 − 3.5×2
  assert.equal(s.riskPct, 7);
});

test('computeStop: close-to-close ATR takes precedence over high/low ATR', () => {
  const base = snap({ atr14: 4 });
  const s = computeStop({ ...base, volatility: { ...base.volatility, closeAtr14: 2 } }, 100);
  assert.equal(s.stop, 93); // 100 − 3.5×2, not 3.5×4
});

test('computeStop: a structural stop inside the noise band widens to the ATR floor', () => {
  const s = computeStop(snap({ atr14: 2, supports: [{ price: 99, strength: 60 }] }), 100);
  assert.equal(s.basis, 'volatility_floor');
  assert.equal(s.stop, 96); // 100 − 2×2
});

test('computeStop: a support beyond the noise band is skipped for the volatility stop', () => {
  const s = computeStop(snap({ atr14: 2, supports: [{ price: 80, strength: 60 }] }), 100);
  assert.equal(s.basis, 'volatility');
  assert.equal(s.stop, 93); // 79.2 is 20.8% away, past 3.5×2 — not this trade's invalidation
  assert.equal(s.supportDefended, null);
  assert.equal(s.capped, false);
});

test('computeStop: noise wider than maxStopPct caps risk and flags the cap', () => {
  const s = computeStop(snap({ atr14: 4 }), 100);
  assert.equal(s.basis, 'risk_cap');
  assert.equal(s.capped, true);
  assert.equal(s.stop, 88); // 12% below
  assert.equal(s.riskPct, 12);
});

test('computeStop: an ultra-tight natural stop pins to the minimum', () => {
  const s = computeStop(snap({ atr14: 0.1 }), 100);
  assert.equal(s.basis, 'min_stop');
  assert.equal(s.stop, 97); // minStopPct 3%
  assert.equal(s.riskPct, 3);
});

test('computeStop: supports above the entry are ignored', () => {
  const s = computeStop(snap({ supports: [{ price: 110, strength: 90 }] }), 100);
  assert.equal(s.basis, 'volatility');
});

test('computeTrailingStop: dormant until the activation profit', () => {
  const t = computeTrailingStop({ avgCost: 100, currentPrice: 110, runningHigh: 110, existingStop: 90 });
  assert.equal(t.active, false);
  assert.equal(t.stop, 90);
  assert.equal(t.moved, false);
});

test('computeTrailingStop: active past the activation profit, 8% under the peak', () => {
  const t = computeTrailingStop({ avgCost: 100, currentPrice: 120, runningHigh: 125, existingStop: 95 });
  assert.equal(t.active, true);
  assert.equal(t.stop, 115); // 125 × 0.92
  assert.equal(t.moved, true);
});

test('computeTrailingStop: ratchets up only — never below the existing stop', () => {
  const t = computeTrailingStop({ avgCost: 100, currentPrice: 120, runningHigh: 125, existingStop: 118 });
  assert.equal(t.active, true);
  assert.equal(t.stop, 118);
  assert.equal(t.moved, false);
});

test('computeTrailingStop: disabled rules keep the existing stop', () => {
  const rules = { ...RULES, trailing: { ...RULES.trailing, enabled: false } };
  const t = computeTrailingStop({ avgCost: 100, currentPrice: 130, runningHigh: 130, existingStop: 90 }, rules);
  assert.equal(t.active, false);
  assert.equal(t.stop, 90);
});

test('computeLongTermStop: needs a 200-day average above the price', () => {
  const noMa = computeLongTermStop({ price: { close: 100 }, movingAverages: { sma200: null } });
  assert.equal(noMa.stop, null);
  const below = computeLongTermStop({ price: { close: 100 }, movingAverages: { sma200: 105 } });
  assert.equal(below.stop, null);
  assert.ok(below.note.includes('200'));
});

test('computeLongTermStop: sits on sma200 but never tighter than the tactical stop', () => {
  const s = computeLongTermStop({ price: { close: 100 }, movingAverages: { sma200: 90 } }, 95);
  assert.equal(s.stop, 90);
  assert.equal(s.basis, 'sma200');
  assert.equal(s.riskPct, 10);
  // Tactical stop below the 200-day average is already wider — it wins.
  const wider = computeLongTermStop({ price: { close: 100 }, movingAverages: { sma200: 90 } }, 85);
  assert.equal(wider.stop, 85);
});

test('positionSize: the 1.5% risk budget binds a normal setup', () => {
  const s = positionSize({ capital: 1_000_000, entry: 100, stop: 90, avgTurnoverEgp: 5_000_000 });
  assert.equal(s.shares, 1500);
  assert.equal(s.riskEgp, 15000);
  assert.equal(s.riskPctOfCapital, 1.5);
  assert.equal(s.costEgp, 150000);
  assert.ok(s.bindingConstraint.includes('ميزانية المخاطرة'));
  assert.equal(s.reason, null);
});

test('positionSize: the concentration cap binds a tight stop', () => {
  const s = positionSize({ capital: 1_000_000, entry: 10, stop: 9.5, avgTurnoverEgp: 5_000_000 });
  assert.equal(s.shares, 15_000);
  assert.ok(s.bindingConstraint.includes('للمركز الواحد'));
});

test('positionSize: sector exposure shrinks the headroom', () => {
  const s = positionSize({ capital: 1_000_000, entry: 10, stop: 9.5, avgTurnoverEgp: 5_000_000, sectorExposureEgp: 280_000 });
  assert.equal(s.shares, 2000);
  assert.ok(s.bindingConstraint.includes('للقطاع'));
});

test('positionSize: illiquid names are clipped to a slice of daily turnover', () => {
  const s = positionSize({ capital: 1_000_000, entry: 100, stop: 90, avgTurnoverEgp: 100_000 });
  assert.equal(s.shares, 100);
  assert.ok(s.bindingConstraint.includes('السيولة'));
});

test('positionSize: a stop at or above the entry is refused', () => {
  const s = positionSize({ capital: 1_000_000, entry: 100, stop: 100, avgTurnoverEgp: 5_000_000 });
  assert.equal(s.shares, 0);
  assert.ok(s.reason.includes('وقف غير صالح'));
});

test('riskReward: reward over risk in R, null when there is no risk', () => {
  assert.equal(riskReward(100, 90, 130), 3);
  assert.equal(riskReward(100, 100, 130), null);
  assert.equal(riskReward(100, 110, 130), null);
});

test('positionRecommendation: a breached stop overrides everything', () => {
  const r = positionRecommendation(
    { snapshot: snap({ price: 89 }), position: { avgCost: 100, shares: 100 }, trailing: { stop: 95, active: false, moved: false }, midTarget: null },
  );
  assert.equal(r.action, 'exit_stop');
  assert.deepEqual(r.order, { side: 'sell', qty: 100, price: 89 });
});

test('consecutiveClosesUnder: counts the run of closes under the stop, newest first', () => {
  assert.equal(consecutiveClosesUnder([120, 118, 105], 114.7), 1);
  assert.equal(consecutiveClosesUnder([120, 105, 108], 114.7), 2);
  assert.equal(consecutiveClosesUnder([105, 108, 120], 114.7), 0); // newest is above: the run is over
  assert.equal(consecutiveClosesUnder([105, 114.7], 114.7), 0); // a close on the stop is not under it
  assert.equal(consecutiveClosesUnder([], 100), 0);
});

test('rulesForStyle: only the long style needs two closes under the stop', () => {
  assert.equal(RULES.stop.confirmCloses, 1);
  assert.equal(rulesForStyle(RULES, 'trader').stop.confirmCloses, 1);
  assert.equal(rulesForStyle(RULES, 'medium').stop.confirmCloses, 1);
  assert.equal(rulesForStyle(RULES, 'long').stop.confirmCloses, 2);
  // The override leaves the rest of the stop block, the keep-a-core option included, alone.
  assert.equal(rulesForStyle(RULES, 'long').stop.fundamentalHold.allowed, true);
  assert.equal(rulesForStyle(RULES, 'long').stop.honorOn, 'close');
});

test('positionRecommendation: the first close under a two-close stop is a hold, not an exit', () => {
  // The SWDY shape: 870 shares at 84.45, a stop at 114.7, one close at 105 under it.
  const r = positionRecommendation({
    snapshot: snap({ price: 105 }),
    position: { avgCost: 84.45, shares: 870 },
    trailing: { stop: 114.7, active: true, moved: false },
    midTarget: 139.7,
    partialTaken: true,
    stopBreached: false,
    stopWarning: { closesUnder: 1, needed: 2 },
  });
  assert.equal(r.action, 'hold');
  assert.equal(r.order, null);
  assert.match(r.text, /أول إغلاق تحت الوقف 114\.7/);
});

test('positionRecommendation: a fired stop still exits whatever the warning says', () => {
  const r = positionRecommendation({
    snapshot: snap({ price: 105 }),
    position: { avgCost: 84.45, shares: 870 },
    trailing: { stop: 114.7, active: true, moved: false },
    midTarget: null,
    stopBreached: true,
    stopWarning: null,
  });
  assert.equal(r.action, 'exit_stop');
  assert.equal(r.order.qty, 870);
});

test('positionRecommendation: a profit rule outranks the stop warning', () => {
  const r = positionRecommendation({
    snapshot: snap({ price: 140 }),
    position: { avgCost: 84.45, shares: 870 },
    trailing: { stop: 150, active: true, moved: false },
    midTarget: 139.7,
    stopBreached: false,
    stopWarning: { closesUnder: 1, needed: 2 },
  });
  assert.equal(r.action, 'take_target');
});

test('positionRecommendation: the first of several closes under the stop names how many are left', () => {
  const r = positionRecommendation({
    snapshot: snap({ price: 105 }),
    position: { avgCost: 100, shares: 100 },
    trailing: { stop: 114.7, active: true, moved: false },
    midTarget: null,
    stopBreached: false,
    stopWarning: { closesUnder: 1, needed: 3 },
  });
  assert.match(r.text, /2 إغلاقات/);
});

test('positionRecommendation: mid target reached → sell a third', () => {
  const r = positionRecommendation(
    { snapshot: snap({ price: 120 }), position: { avgCost: 100, shares: 90 }, trailing: { stop: 95, active: false, moved: false }, midTarget: 118 },
  );
  assert.equal(r.action, 'take_target');
  assert.equal(r.order.qty, 30); // floor(90 × 1/3)
  assert.equal(r.order.side, 'sell');
});

test('positionRecommendation: 15%+ profit banks 30% as a limit above price', () => {
  const r = positionRecommendation(
    { snapshot: snap({ price: 116 }), position: { avgCost: 100, shares: 100 }, trailing: { stop: 95, active: false, moved: false }, midTarget: 200 },
  );
  assert.equal(r.action, 'sell_part');
  assert.equal(r.order.qty, 30);
  assert.equal(r.order.price, 118.32); // +2% limit
});

test('positionRecommendation: within 3% of the stop is a hold warning', () => {
  const r = positionRecommendation(
    { snapshot: snap({ price: 100 }), position: { avgCost: 100, shares: 100 }, trailing: { stop: 98, active: false, moved: false }, midTarget: null },
  );
  assert.equal(r.action, 'hold');
  assert.ok(r.text.includes('قريب من الوقف'));
  assert.equal(r.order, null);
});

test('positionRecommendation: a leader pulling back above sma200 may be added to', () => {
  const s = snap({ price: 100, trendScore: 60, priceVsSma200Pct: 5 });
  const r = positionRecommendation(
    { snapshot: s, position: { avgCost: 110, shares: 100 }, trailing: { stop: 92, active: false, moved: false }, midTarget: null },
  );
  assert.equal(r.action, 'buy_more');
});

test('positionRecommendation: plain hold when nothing triggers', () => {
  const r = positionRecommendation(
    { snapshot: snap({ price: 100 }), position: { avgCost: 98, shares: 100 }, trailing: { stop: 90, active: false, moved: false }, midTarget: 150 },
  );
  assert.equal(r.action, 'hold');
  assert.ok(r.text.includes('مربح'));
});

test('liquidityCheck gates on average daily turnover', () => {
  assert.equal(liquidityCheck({ volume: { avgTurnoverEgp: 5_000_000 } }).ok, true);
  const weak = liquidityCheck({ volume: { avgTurnoverEgp: 1_000_000 } });
  assert.equal(weak.ok, false);
  assert.ok(weak.note.includes('سيولة ضعيفة'));
});

test('invest styles only override the four behaviour groups', () => {
  const trader = rulesForStyle(RULES, 'trader');
  assert.equal(trader.trailing.trailPct, 4);
  assert.equal(trader.entry.minRiskReward, 1.5);
  assert.equal(trader.sizing.riskPerTradePct, 1);
  assert.equal(trader.stop.noiseMultiple, RULES.stop.noiseMultiple, 'stop rules must be untouched by a style');
  assert.equal(trader.liquidity.minAvgTurnoverEgp, RULES.liquidity.minAvgTurnoverEgp);
  const medium = rulesForStyle(RULES, 'medium');
  assert.equal(medium.trailing.trailPct, RULES.trailing.trailPct);
  assert.equal(rulesForStyle(RULES, 'nope'), RULES);
});