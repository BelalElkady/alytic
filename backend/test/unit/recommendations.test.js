import test from 'node:test';
import assert from 'node:assert/strict';

import '../helpers/env.js';

import { evaluateRecommendation, evaluateStockMove } from '../../supabase/functions/evaluate-recommendations/evaluate.js';
import { recommendationRow, isWin, benchmarkFor, wasRight } from '../../src/recommendations.js';

const rec = (over = {}) => ({
  action: 'buy', ref_price: 100, target_price: 110, stop_price: 95, horizon_days: 5, egx30_at_issue: 30000, issued_on: '2026-09-01', ...over,
});
const bar = (date, open, high, low, close) => ({ date, open, high, low, close });
const egx = new Map([['EGX30', new Map([['2026-09-02', 30300], ['2026-09-03', 30600], ['2026-09-06', 29700]])]]);

test('evaluate: a buy that touches its target closes there, measured against EGX30', () => {
  const out = evaluateRecommendation(rec(), [bar('2026-09-02', 101, 104, 99, 103), bar('2026-09-03', 104, 111, 103, 109)], egx);
  assert.equal(out.status, 'hit_target');
  assert.equal(out.exit_price, 110);
  assert.equal(out.return_pct, 10);
  assert.equal(out.excess_return_pct, 8); // EGX30 +2% over the same span
  assert.equal(out.sessions_elapsed, 2);
  assert.equal(out.closed_at.slice(0, 10), '2026-09-03');
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
  assert.equal(evaluateRecommendation(rec(), [bar('2026-09-02', 115, 116, 114, 115)], egx).exit_price, 115);
  const out = evaluateRecommendation(rec(), [bar('2026-09-02', 99, 100, 93, 94), bar('2026-09-03', 88, 90, 87, 89)], egx);
  assert.equal(out.exit_price, 88);
});

test('evaluate: a hold ignores any stop or target it was logged with and expires at the horizon', () => {
  const bars = [bar('2026-09-02', 99, 100, 93, 94), bar('2026-09-03', 94, 112, 93, 98)];
  const out = evaluateRecommendation(rec({ action: 'hold', horizon_days: 2 }), bars, egx);
  assert.equal(out.status, 'expired');
  assert.equal(out.exit_price, 98);
  assert.equal(out.return_pct, -2);
  assert.equal(out.sessions_elapsed, 2);
  const early = evaluateRecommendation(rec({ action: 'hold', horizon_days: 5 }), bars, egx);
  assert.equal(early.status, 'open');
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
  assert.equal(sell.horizon_days, 60);
});

test('recommendationRow: a hold carries no stop or target and the style horizon', () => {
  const hold = recommendationRow({ userId: 'u', code: 'X', action: 'hold', levels: { refPrice: 100, target: 120, stop: 97, horizonSessions: 18 }, style: 'medium', source: 's' });
  assert.equal(hold.action, 'hold');
  assert.equal(hold.target_price, null);
  assert.equal(hold.stop_price, null);
  assert.equal(hold.horizon_days, 20);
});

test('isWin: holds are judged against the index', () => {
  assert.equal(isWin({ action: 'buy', status: 'hit_target', return_pct: 5 }), true);
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
