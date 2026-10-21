import test from 'node:test';
import assert from 'node:assert/strict';

import '../helpers/env.js';

import { evaluateRecommendation, evaluateStockMove, basisFactors, STYLE_RULES } from '../../supabase/functions/evaluate-recommendations/evaluate.js';
import { RULES } from '../../src/config/rules.js';
import { rulesForStyle } from '../../src/config/styles.js';
import {
  recommendationRow, isWin, benchmarkFor, wasRight, withoutOpenDuplicates, buildTrackRecord, isLegacy, MIN_CLOSED_FOR_HEADLINE,
  fallTargetFrom, levelsFromAnalysis, levelsFromScanRow, MIN_FALL_TARGET_PCT,
} from '../../src/recommendations.js';

const rec = (over = {}) => ({
  action: 'buy', ref_price: 100, target_price: 110, stop_price: 95, horizon_days: 5, egx30_at_issue: 30000, issued_on: '2026-09-01', ...over,
});
const bar = (date, open, high, low, close) => ({ date, open, high, low, close });
const egx = new Map([['EGX30', new Map([['2026-09-02', 30300], ['2026-09-03', 30600], ['2026-09-06', 29700]])]]);

test('STYLE_RULES: the evaluator manages a buy with the same numbers as the app\'s config', () => {
  for (const style of ['trader', 'medium', 'long']) {
    const rules = rulesForStyle(RULES, style);
    assert.deepEqual(STYLE_RULES[style], {
      confirmCloses: rules.stop.confirmCloses ?? 1,
      atTargetFraction: rules.takeProfit.atTargetFraction,
      raiseStopAfterTargetPct: rules.takeProfit.raiseStopAfterTargetPct,
    }, style);
  }
});

// A medium-style buy at 100, target 110, stop 95: a third is sold at 110 on
// 09-03 (+10%, EGX30 +2%) and the stop on the rest goes to 110 × 0.92 = 101.2.
const toTarget = [bar('2026-09-02', 101, 104, 99, 103), bar('2026-09-03', 104, 111, 103, 109)];

test('evaluate: a buy that touches its target sells part there and keeps the rest open', () => {
  const out = evaluateRecommendation(rec(), toTarget, egx);
  assert.equal(out.status, 'open');
  assert.equal(out.target_sessions, 2);
  assert.equal(out.mark_return_pct, 9.33); // ⅓ × 10 + ⅔ × 9 (the rest at the 109 close)
  assert.equal(out.mark_excess_return_pct, 7.33); // ⅓ × 8 + ⅔ × 7
});

test('evaluate: the rest runs to the horizon and the call closes as hit target, blended', () => {
  const out = evaluateRecommendation(rec({ horizon_days: 3 }), [...toTarget, bar('2026-09-06', 109, 110, 106, 108)], egx);
  assert.equal(out.status, 'hit_target');
  assert.equal(out.return_pct, 8.67); // ⅓ × 10 + ⅔ × 8
  assert.equal(out.excess_return_pct, 8.67); // ⅓ × 8 + ⅔ × 9 (EGX30 −1% by 09-06)
  assert.equal(out.exit_price, 108.67);
  assert.equal(out.sessions_elapsed, 3);
  assert.equal(out.target_sessions, 2);
  assert.equal(out.closed_at.slice(0, 10), '2026-09-06');
});

test('evaluate: after the target, a close under the raised stop exits the rest at the next open', () => {
  const bars = [...toTarget, bar('2026-09-06', 105, 106, 100, 100.5), bar('2026-09-07', 99, 100, 98, 99)];
  const out = evaluateRecommendation(rec({ horizon_days: 10 }), bars, egx);
  assert.equal(out.status, 'hit_target');
  assert.equal(out.return_pct, 2.67); // ⅓ × 10 + ⅔ × (−1)
  assert.equal(out.sessions_elapsed, 4);
  assert.equal(out.target_sessions, 2);
  assert.equal(isWin(out), true);
});

test('evaluate: the share sold at the target follows the style', () => {
  const bars = [bar('2026-09-02', 104, 111, 103, 108)];
  // Rest at the 108 close on the horizon's only session: trader sells half, long a quarter.
  assert.equal(evaluateRecommendation(rec({ style: 'trader', horizon_days: 1 }), bars, egx).return_pct, 9); // ½ × 10 + ½ × 8
  assert.equal(evaluateRecommendation(rec({ style: 'long', horizon_days: 1 }), bars, egx).return_pct, 8.5); // ¼ × 10 + ¾ × 8
});

test('evaluate: the long style needs two closes in a row under the stop', () => {
  const bars = [
    bar('2026-09-02', 99, 100, 93, 94), // first close under 95
    bar('2026-09-03', 94, 97, 93, 96), // back above: the count starts again
    bar('2026-09-06', 96, 97, 93, 94),
    bar('2026-09-07', 94, 95, 92, 93), // second in a row: the exit
    bar('2026-09-08', 92, 93, 91, 92),
  ];
  const long = rec({ style: 'long', horizon_days: 10 });
  assert.equal(evaluateRecommendation(long, bars.slice(0, 3), egx).status, 'open');
  const out = evaluateRecommendation(long, bars, egx);
  assert.equal(out.status, 'hit_stop');
  assert.equal(out.exit_price, 92);
  assert.equal(out.sessions_elapsed, 5);
  // One close is enough for the medium style.
  assert.equal(evaluateRecommendation(rec({ horizon_days: 10 }), bars, egx).exit_price, 94);
});

test('evaluate: a stop counts on a close and fills at the next session\'s open', () => {
  const out = evaluateRecommendation(rec(), [bar('2026-09-02', 99, 100, 93, 94), bar('2026-09-03', 93, 96, 92, 95)], egx);
  assert.equal(out.status, 'hit_stop');
  assert.equal(out.exit_price, 93);
  assert.equal(out.return_pct, -7);
  assert.equal(out.sessions_elapsed, 2);
  assert.equal(out.closed_at.slice(0, 10), '2026-09-03');
});

test('evaluate: an intraday dip under the stop that closes above it is not a stop-out', () => {
  const out = evaluateRecommendation(rec(), [bar('2026-09-02', 100, 101, 92, 97), bar('2026-09-03', 97, 99, 96, 98)], egx);
  assert.equal(out.status, 'open');
  assert.equal(out.mark_return_pct, -2);
});

test('evaluate: a close under the stop stays open until the next session is in', () => {
  const out = evaluateRecommendation(rec(), [bar('2026-09-02', 99, 100, 93, 94)], egx);
  assert.equal(out.status, 'open');
  // The breach on the horizon's last session is still a stop-out, not an expiry.
  const last = evaluateRecommendation(rec({ horizon_days: 1 }), [bar('2026-09-02', 99, 100, 93, 94)], egx);
  assert.equal(last.status, 'open');
});

test('evaluate: a session closing under the stop that also touched the target counts as the stop', () => {
  const out = evaluateRecommendation(rec(), [bar('2026-09-02', 100, 112, 93, 94), bar('2026-09-03', 94, 95, 92, 93)], egx);
  assert.equal(out.status, 'hit_stop');
  assert.equal(out.exit_price, 94);
  assert.equal(out.return_pct, -6);
});

test('evaluate: a gap through the target fills at the open; a gap down after a stop close fills at the new open', () => {
  const gapUp = evaluateRecommendation(rec({ horizon_days: 1 }), [bar('2026-09-02', 115, 116, 114, 115)], egx);
  assert.equal(gapUp.status, 'hit_target');
  assert.equal(gapUp.return_pct, 15); // the part sold at the 115 open and the rest at the 115 close
  const out = evaluateRecommendation(rec(), [bar('2026-09-02', 99, 100, 93, 94), bar('2026-09-03', 88, 90, 87, 89)], egx);
  assert.equal(out.exit_price, 88);
});

test('evaluate: from scoring version 4 a hold is closed by its stop on a close, never by a target', () => {
  const bars = [bar('2026-09-02', 99, 112, 93, 94), bar('2026-09-03', 93, 96, 92, 95)];
  const out = evaluateRecommendation(rec({ action: 'hold', horizon_days: 10, scoring_version: 4 }), bars, egx);
  assert.equal(out.status, 'hit_stop');
  assert.equal(out.exit_price, 93);
  assert.equal(out.return_pct, -7);
  assert.equal(isWin({ ...out, action: 'hold' }), false);
  // An intraday dip that closes above the stop keeps it open.
  const dip = evaluateRecommendation(rec({ action: 'hold', horizon_days: 10, scoring_version: 4 }), [bar('2026-09-02', 100, 101, 92, 97)], egx);
  assert.equal(dip.status, 'open');
});

test('evaluate: a hold before version 4 ignores any stop or target it was logged with and expires at the horizon', () => {
  const bars = [bar('2026-09-02', 99, 100, 93, 94), bar('2026-09-03', 94, 112, 93, 98)];
  const out = evaluateRecommendation(rec({ action: 'hold', horizon_days: 2 }), bars, egx);
  assert.equal(out.status, 'expired');
  assert.equal(out.exit_price, 98);
  assert.equal(out.return_pct, -2);
  assert.equal(out.sessions_elapsed, 2);
  const early = evaluateRecommendation(rec({ action: 'hold', horizon_days: 5 }), bars, egx);
  assert.equal(early.status, 'open');
  assert.equal(evaluateRecommendation(rec({ action: 'hold', horizon_days: 2, scoring_version: 3 }), bars, egx).status, 'expired');
});

test('evaluate: no level touched by the horizon expires at that close', () => {
  const bars = ['2026-09-02', '2026-09-03', '2026-09-06'].map((d) => bar(d, 101, 104, 97, 102));
  const out = evaluateRecommendation(rec({ horizon_days: 3 }), bars, egx);
  assert.equal(out.status, 'expired');
  assert.equal(out.exit_price, 102);
  assert.equal(out.return_pct, 2);
  assert.equal(out.excess_return_pct, 3); // EGX30 -1%
});

test('evaluate: still open before the horizon, marked to the last close', () => {
  const out = evaluateRecommendation(rec(), [bar('2026-09-02', 101, 104, 97, 103)], egx);
  assert.equal(out.status, 'open');
  assert.equal(out.mark_return_pct, 3);
  assert.equal(out.sessions_elapsed, 1);
  assert.equal(evaluateRecommendation(rec(), [], egx), null);
});

test('evaluate: sell is scored as a short call', () => {
  const out = evaluateRecommendation(
    rec({ action: 'sell', target_price: null, stop_price: null, horizon_days: 1 }),
    [bar('2026-09-02', 99, 99, 93, 94)],
    egx,
  );
  assert.equal(out.status, 'expired');
  assert.equal(out.return_pct, 6);
  assert.equal(out.excess_return_pct, 7); // index rose 1%: short-index benchmark is -1%
});

test('recommendationRow: maps verdict actions and drops calls with nothing to measure', () => {
  const levels = { refPrice: 100, target: 120, stop: 92, horizonSessions: 18 };
  const row = recommendationRow({ userId: 'u1', code: 'comi', action: 'accumulate', levels, style: 'medium', source: 'portfolio_review', model: 'm', indices: { EGX30: 30000 }, benchmark: 'EGX30' });
  assert.equal(row.action, 'buy');
  assert.equal(row.ticker, 'COMI');
  assert.equal(row.horizon_days, 18);
  assert.equal(row.target_price, 120);
  // The cash review's picks: buy_now is a buy; buy_on_pullback waits for a price, so it isn't logged.
  assert.equal(recommendationRow({ userId: 'u1', code: 'COMI', action: 'buy_now', levels, style: 'medium', source: 'cash_review' }).action, 'buy');
  assert.equal(recommendationRow({ userId: 'u1', code: 'COMI', action: 'buy_on_pullback', levels, style: 'medium', source: 'cash_review' }), null);
  assert.equal(recommendationRow({ userId: 'u1', code: 'COMI', action: 'wait', levels, style: 'medium', source: 's' }), null);
  assert.equal(recommendationRow({ userId: 'u1', code: 'COMI', action: 'buy', levels: { refPrice: 0 }, source: 's' }), null);
});

test('recommendationRow: levels on the wrong side are dropped; sell gets no levels and the style horizon', () => {
  const passed = recommendationRow({ userId: 'u', code: 'X', action: 'buy', levels: { refPrice: 100, target: 95, stop: 101 }, style: 'trader', source: 's' });
  assert.equal(passed.target_price, null);
  assert.equal(passed.stop_price, null);
  assert.equal(passed.horizon_days, 10);
  const sell = recommendationRow({ userId: 'u', code: 'X', action: 'exit', levels: { refPrice: 100, target: 120, stop: 90, horizonSessions: 40 }, style: 'long', source: 's' });
  assert.equal(sell.action, 'sell');
  assert.equal(sell.target_price, null);
  assert.equal(sell.stop_price, null);
  assert.equal(sell.horizon_days, 20); // a sell is judged over a shorter span than a hold
});

test('recommendationRow: a hold carries the position\'s stop, no target, and the style horizon', () => {
  const hold = recommendationRow({ userId: 'u', code: 'X', action: 'hold', levels: { refPrice: 100, target: 120, stop: 97, horizonSessions: 18 }, style: 'medium', source: 's' });
  assert.equal(hold.action, 'hold');
  assert.equal(hold.target_price, null);
  assert.equal(hold.stop_price, 97);
  assert.equal(hold.horizon_days, 20);
  // A stop at or above the price is on the wrong side and dropped.
  assert.equal(recommendationRow({ userId: 'u', code: 'X', action: 'hold', levels: { refPrice: 100, stop: 101 }, style: 'medium', source: 's' }).stop_price, null);
});

test('isWin: holds are judged against the index', () => {
  assert.equal(isWin({ action: 'buy', status: 'hit_target', return_pct: 5 }), true);
  // Part sold at the target, but the rest lost more: the Position lost money.
  assert.equal(isWin({ action: 'buy', status: 'hit_target', return_pct: -0.5 }), false);
  assert.equal(isWin({ action: 'buy', status: 'expired', return_pct: -1 }), false);
  assert.equal(isWin({ action: 'hold', status: 'expired', return_pct: -1, excess_return_pct: 2 }), true);
  assert.equal(isWin({ action: 'buy', status: 'open' }), null);
});

test('evaluate: excess against the call\'s own benchmark and EGX33, from indices_at_issue', () => {
  const closes = new Map([
    ['EGX30', new Map([['2026-09-02', 30300]])],
    ['EGX70', new Map([['2026-09-02', 9800]])],
    ['EGX33', new Map([['2026-09-02', 4040]])],
  ]);
  const out = evaluateRecommendation(
    rec({ horizon_days: 1, benchmark: 'EGX70', indices_at_issue: { EGX30: 30000, EGX70: 10000, EGX33: 4000 } }),
    [bar('2026-09-02', 101, 104, 99, 103)],
    closes,
  );
  assert.equal(out.return_pct, 3);
  assert.equal(out.excess_return_pct, 2); // EGX30 +1%
  assert.equal(out.benchmark_excess_pct, 5); // EGX70 -2%
  assert.deepEqual(out.index_excess, { EGX30: 2, EGX70: 5, EGX33: 2 }); // EGX33 +1%; no EGX100 level recorded
});

test('evaluate: a call logged before benchmarks existed only gets its EGX30 figure', () => {
  const out = evaluateRecommendation(rec({ horizon_days: 1 }), [bar('2026-09-02', 101, 104, 99, 103)], egx);
  assert.equal(out.excess_return_pct, 2);
  assert.equal(out.benchmark_excess_pct, null);
  assert.deepEqual(out.index_excess, { EGX30: 2 });
});

test('benchmarkFor: EGX30 member, then EGX70 member, else EGX100', () => {
  const membership = { EGX30: ['COMI'], EGX70: ['HELI'] };
  assert.equal(benchmarkFor('comi', membership), 'EGX30');
  assert.equal(benchmarkFor('HELI', membership), 'EGX70');
  assert.equal(benchmarkFor('XYZ', membership), 'EGX100');
});

test('recommendationRow: keeps only the index levels the feed returned', () => {
  const row = recommendationRow({
    userId: 'u', code: 'HELI', action: 'buy', levels: { refPrice: 7 }, style: 'medium', source: 's',
    indices: { EGX30: 30000, EGX70: 10000, EGX33: null }, benchmark: 'EGX70',
  });
  assert.equal(row.egx30_at_issue, 30000);
  assert.equal(row.benchmark, 'EGX70');
  assert.deepEqual(row.indices_at_issue, { EGX30: 30000, EGX70: 10000 });
});

test('evaluateStockMove: follows the stock to the end of the horizon, target and stop aside', () => {
  const bars = ['2026-09-02', '2026-09-03', '2026-09-06'].map((d, i) => bar(d, 100, 120, 90, [111, 108, 115][i]));
  // The call itself hit its target on the first session; the stock is still followed.
  const running = evaluateStockMove(rec({ horizon_days: 5 }), bars);
  assert.deepEqual(running, { stock_move_price: 115, stock_move_pct: 15, stock_move_sessions: 3, stock_move_final: false });
  const done = evaluateStockMove(rec({ horizon_days: 2 }), bars);
  assert.deepEqual(done, { stock_move_price: 108, stock_move_pct: 8, stock_move_sessions: 2, stock_move_final: true });
  assert.equal(evaluateStockMove(rec(), []), null);
});

test('wasRight: sell at 55 and the stock went to 60 was wrong', () => {
  assert.equal(wasRight({ action: 'sell', stock_move_pct: 9.09 }), false);
  assert.equal(wasRight({ action: 'reduce', stock_move_pct: -4 }), true);
  assert.equal(wasRight({ action: 'buy', stock_move_pct: 15 }), true);
  assert.equal(wasRight({ action: 'buy', stock_move_pct: 0 }), false);
  assert.equal(wasRight({ action: 'hold', stock_move_pct: 0 }), true);
  assert.equal(wasRight({ action: 'buy', stock_move_pct: null }), null);
});

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);

test('basisFactors: 1 until a session breaks from the one before, then that session\'s raw ratio from there on', () => {
  // POUL: 38.2 reference, then 9.71 (a 3-for-1 split with the sessions the feed skipped folded in), then ordinary sessions.
  const bars = [bar('2026-09-28', 9.6, 9.9, 9.5, 9.71), bar('2026-09-29', 9.7, 9.9, 9.6, 9.8), bar('2026-09-30', 9.8, 9.95, 9.7, 9.9)];
  basisFactors(38.2, bars).forEach((f) => near(f, 9.71 / 38.2));
  // The break comes mid-way: earlier sessions stay on the old basis.
  const late = [bar('d1', 38, 39, 37, 38.5), bar('d2', 9.6, 9.9, 9.5, 9.71), bar('d3', 9.7, 9.9, 9.6, 9.8)];
  const factors = basisFactors(38.2, late);
  assert.equal(factors[0], 1);
  near(factors[1], 9.71 / 38.5);
  near(factors[2], 9.71 / 38.5);
  // Ordinary moves, even the daily limit, never count.
  assert.deepEqual(basisFactors(100, [bar('d1', 100, 110, 99, 110), bar('d2', 110, 111, 99, 99)]), [1, 1]);
});

test('basisFactors: a bonus issue or reverse split is the measured ratio, not a guessed "nice" one', () => {
  near(basisFactors(29.2, [bar('d1', 19.4, 19.8, 19.3, 19.47)])[0], 19.47 / 29.2); // 3-for-2: close to 2/3, not forced to it
  near(basisFactors(2, [bar('d1', 9.8, 10.2, 9.7, 10)])[0], 5);
  near(basisFactors(100, [bar('d1', 60, 61, 58, 59)])[0], 0.59);
});

test('evaluate: a split is not a stop-out, and the return is measured on the new basis', () => {
  // A buy at 38.2 with a stop at 36 and a target at 44; the stock splits on the next session.
  const buy = rec({ ref_price: 38.2, stop_price: 36, target_price: 44, horizon_days: 3 });
  const bars = [bar('2026-09-02', 9.6, 9.9, 9.5, 9.71), bar('2026-09-03', 9.7, 9.9, 9.6, 9.8)];
  const open = evaluateRecommendation(buy, bars, egx);
  assert.equal(open.status, 'open');
  assert.equal(open.mark_return_pct, 0.93); // measured from the split session's close, 9.71: 9.8 / 9.71
  const done = evaluateRecommendation(buy, [...bars, bar('2026-09-06', 9.8, 9.9, 9.7, 9.9)], egx);
  assert.equal(done.status, 'expired');
  assert.equal(done.return_pct, 1.96); // 9.9 / 9.71
});

test('evaluate: the target and stop follow the split, so a real move after it still resolves', () => {
  const buy = rec({ ref_price: 38.2, stop_price: 36, target_price: 44, horizon_days: 5 });
  // After the split the levels are 9.15 and 11.18; a close at 8.9 is a stop, filled at the next open.
  const out = evaluateRecommendation(buy, [bar('2026-09-02', 9.6, 9.9, 9.5, 9.71), bar('2026-09-03', 9.5, 9.6, 8.8, 8.9), bar('2026-09-06', 8.85, 9, 8.8, 8.9)], egx);
  assert.equal(out.status, 'hit_stop');
  assert.equal(out.exit_price, 8.85);
  assert.equal(out.return_pct, -8.86); // 8.85 against the split session's close, 9.71
});

test('evaluateStockMove: the stock\'s move is on the new basis too', () => {
  const move = evaluateStockMove(rec({ ref_price: 38.2, horizon_days: 2 }), [bar('2026-09-02', 9.6, 9.9, 9.5, 9.71), bar('2026-09-03', 9.7, 9.9, 9.6, 9.8)]);
  assert.equal(move.stock_move_pct, 0.93); // 9.8 against the split session's 9.71
  assert.equal(move.stock_move_final, true);
});

test('withoutOpenDuplicates: a repeat of a call the user still has open is not logged again', () => {
  const rows = [{ ticker: 'ORWE', action: 'hold' }, { ticker: 'ORWE', action: 'buy' }, { ticker: 'ABUK', action: 'hold' }];
  assert.deepEqual(withoutOpenDuplicates(rows, ['ORWE:hold', 'EFIH:hold']), [{ ticker: 'ORWE', action: 'buy' }, { ticker: 'ABUK', action: 'hold' }]);
  assert.deepEqual(withoutOpenDuplicates(rows, []), rows);
});

const closedRow = (id, over = {}) => ({
  id, user_id: 'u1', ticker: 'COMI', action: 'buy', ref_price: 100, target_price: 110, stop_price: 95, horizon_days: 10,
  issued_at: '2026-09-20T09:00:00Z', issued_on: '2026-09-20', status: 'hit_target', closed_at: '2026-09-22T12:30:00Z',
  exit_price: 110, return_pct: 10, excess_return_pct: 4, benchmark_excess_pct: 4, sessions_elapsed: 2, scoring_version: 3, ...over,
});

test('isLegacy: only a call stamped with an older scoring version; no stamp at all means current', () => {
  assert.equal(isLegacy({ scoring_version: 1 }), true);
  assert.equal(isLegacy({ scoring_version: 2 }), true);
  assert.equal(isLegacy({ scoring_version: 3 }), false);
  assert.equal(isLegacy({ scoring_version: 4 }), false);
  assert.equal(isLegacy({}), false);
  assert.equal(isLegacy({ scoring_version: null }), false);
});

test('buildTrackRecord: the figures cover current-rules calls only; older ones are listed and tagged', () => {
  const rows = [
    closedRow(1),
    closedRow(2, { status: 'hit_stop', exit_price: 95, return_pct: -5, benchmark_excess_pct: -3, excess_return_pct: -3 }),
    // Closed under the original rules: a stop-out that would distort the average.
    closedRow(3, { scoring_version: 1, status: 'hit_stop', exit_price: 25, return_pct: -75, benchmark_excess_pct: -74, excess_return_pct: -74 }),
    closedRow(4, { scoring_version: 1, status: 'open', closed_at: null, return_pct: null }),
  ];
  const out = buildTrackRecord(rows, 'u1');
  assert.equal(out.summary.closed, 2);
  assert.equal(out.summary.avgReturn, 2.5); // (10 − 5) / 2, not dragged down by the −75
  assert.equal(out.summary.hitRate, 50);
  assert.equal(out.rows.length, 4);
  assert.deepEqual(out.rows.map((r) => r.legacy), [false, false, true, true]);
  assert.equal(out.scoring.legacyTotal, 2);
  assert.equal(out.scoring.legacyClosed, 1);
  assert.equal(out.outcomes.hit_stop.count, 1);
  assert.equal(out.byAction.find((a) => a.action === 'buy').total, 2);
});

test('buildTrackRecord: too early to show rates until enough calls have closed under the current rules', () => {
  const few = buildTrackRecord([closedRow(1), closedRow(2)], 'u1');
  assert.equal(few.scoring.tooEarly, true);
  assert.equal(few.scoring.minClosed, MIN_CLOSED_FOR_HEADLINE);

  const enough = buildTrackRecord(Array.from({ length: MIN_CLOSED_FOR_HEADLINE }, (_, i) => closedRow(i + 1)), 'u1');
  assert.equal(enough.scoring.tooEarly, false);
  // Old calls never count toward the minimum.
  const oldOnly = buildTrackRecord(Array.from({ length: MIN_CLOSED_FOR_HEADLINE }, (_, i) => closedRow(i + 1, { scoring_version: 1 })), 'u1');
  assert.equal(oldOnly.scoring.tooEarly, true);
  assert.equal(oldOnly.summary.closed, 0);
  assert.equal(oldOnly.rows.length, MIN_CLOSED_FOR_HEADLINE);
});

test('buildTrackRecord: a project without the scoring column counts every call as current', () => {
  const rows = [closedRow(1), closedRow(2)].map(({ scoring_version, ...rest }) => rest);
  const out = buildTrackRecord(rows, 'u1');
  assert.equal(out.summary.closed, 2);
  assert.equal(out.scoring.legacyTotal, 0);
});

test('fallTargetFrom: the nearest support at least 3% under the price, else none', () => {
  const supports = [{ price: 99 }, { price: 96 }, { price: 90 }, { price: 80 }];
  assert.equal(MIN_FALL_TARGET_PCT, 3);
  assert.equal(fallTargetFrom(supports, 100), 96); // 99 is too close to be a target
  assert.equal(fallTargetFrom(supports, 97), 90);
  assert.equal(fallTargetFrom([{ price: 99 }], 100), null);
  assert.equal(fallTargetFrom([], 100), null);
  assert.equal(fallTargetFrom(undefined, 100), null);
});

test('recommendationRow: a sell or reduce carries its fall target but never a stop, over a short horizon', () => {
  const levels = { refPrice: 100, target: 130, stop: 92, fallTarget: 94, horizonSessions: 40 };
  const sell = recommendationRow({ userId: 'u', code: 'X', action: 'exit', levels, style: 'medium', source: 's' });
  assert.equal(sell.action, 'sell');
  assert.equal(sell.target_price, 94);
  assert.equal(sell.stop_price, null);
  assert.equal(sell.horizon_days, 10);
  const reduce = recommendationRow({ userId: 'u', code: 'X', action: 'take_profit', levels, style: 'long', source: 's' });
  assert.equal(reduce.target_price, 94);
  assert.equal(reduce.horizon_days, 20);
  assert.equal(recommendationRow({ userId: 'u', code: 'X', action: 'reduce', levels, style: 'trader', source: 's' }).horizon_days, 10);
  // A fall target above the price is on the wrong side and dropped; none given means none logged.
  assert.equal(recommendationRow({ userId: 'u', code: 'X', action: 'exit', levels: { ...levels, fallTarget: 105 }, style: 'medium', source: 's' }).target_price, null);
  assert.equal(recommendationRow({ userId: 'u', code: 'X', action: 'exit', levels: { refPrice: 100 }, style: 'medium', source: 's' }).target_price, null);
  // A hold still keeps the longer horizon and no target; a buy is unchanged.
  const hold = recommendationRow({ userId: 'u', code: 'X', action: 'hold', levels, style: 'long', source: 's' });
  assert.equal(hold.horizon_days, 60);
  assert.equal(hold.target_price, null);
  assert.equal(recommendationRow({ userId: 'u', code: 'X', action: 'buy', levels, style: 'long', source: 's' }).target_price, 130);
});

test('levelsFromScanRow: a long-style pick is judged by the long target, others by the mid one', () => {
  const row = { price: 100, stop: 92, midTarget: { price: 112, horizon: { sessions: 20 } }, longTarget: { price: 130, horizon: { sessions: 90 } } };
  assert.deepEqual(levelsFromScanRow(row, 'long'), { refPrice: 100, target: 130, stop: 92, horizonSessions: 90 });
  assert.deepEqual(levelsFromScanRow(row, 'medium'), { refPrice: 100, target: 112, stop: 92, horizonSessions: 20 });
  // No long target projected (e.g. a downtrend): the mid one stands in.
  assert.equal(levelsFromScanRow({ ...row, longTarget: null }, 'long').target, 112);
});

test('levelsFromAnalysis: reads the fall target from the stock\'s mapped supports', () => {
  const analysis = { snapshot: { price: { close: 100 }, levels: { supports: [{ price: 99 }, { price: 94 }] } }, plan: {} };
  assert.equal(levelsFromAnalysis(analysis, 'medium').fallTarget, 94);
  assert.equal(levelsFromAnalysis({ snapshot: { price: { close: 100 } }, plan: {} }, 'medium').fallTarget, null);
});

test('evaluate: a sell that reaches its fall target is won there, filled at the open if it gapped past it', () => {
  const sell = rec({ action: 'sell', ref_price: 100, target_price: 94, stop_price: null, horizon_days: 10 });
  const hit = evaluateRecommendation(sell, [bar('2026-09-02', 98, 99, 93, 96)], egx);
  assert.equal(hit.status, 'hit_target');
  assert.equal(hit.exit_price, 94);
  assert.equal(hit.return_pct, 6); // the fall, scored as the gain
  assert.equal(hit.sessions_elapsed, 1);
  const gap = evaluateRecommendation(sell, [bar('2026-09-02', 91, 93, 90, 92)], egx);
  assert.equal(gap.exit_price, 91);
  assert.equal(gap.return_pct, 9);
  // A rise never stops it out: no stop, so it runs to the horizon.
  const rise = evaluateRecommendation({ ...sell, horizon_days: 2 }, [bar('2026-09-02', 104, 110, 103, 108), bar('2026-09-03', 108, 112, 107, 110)], egx);
  assert.equal(rise.status, 'expired');
  assert.equal(rise.return_pct, -10);
});
