import test from 'node:test';
import assert from 'node:assert/strict';

import '../helpers/env.js';

import RULES from '../../src/config/rules.js';
import {
  recordTrade, setLevels, trackedCodes, recordSnapshot, setNote, withPortfolio,
  loadPortfolio,
} from '../../src/portfolio.js';
import { register } from '../../src/auth.js';
import { uniqueEmail } from '../helpers/server.js';

const CODE = 'ABUK'; // any real universe code; recordTrade refuses unknown ones

const base = (cash = 100_000) => ({
  cash,
  positions: {},
  watchlist: {},
  trades: [],
  log: {},
  settings: { commissionPct: RULES.commissionPct },
  realizedPnl: 0,
  updatedAt: null,
});

test('a buy opens a position at the weighted average cost and pays commission', async () => {
  const p = await recordTrade(base(), { code: 'abuk', side: 'buy', shares: 100, price: 50 });
  const commission = 100 * 50 * (RULES.commissionPct / 100);
  assert.equal(p.trades.length, 1);
  assert.equal(p.positions.ABUK.shares, 100);
  assert.equal(p.positions.ABUK.avgCost, 50);
  assert.ok(p.positions.ABUK.openedAt);
  assert.equal(p.cash, +(100_000 - 5000 - commission).toFixed(2));
  assert.equal(p.trades[0].commission, +commission.toFixed(2));
});

test('a second buy averages into the existing position', async () => {
  let p = await recordTrade(base(), { code: CODE, side: 'buy', shares: 100, price: 50 });
  p = await recordTrade(p, { code: CODE, side: 'buy', shares: 100, price: 60 });
  assert.equal(p.positions.ABUK.shares, 200);
  assert.equal(p.positions.ABUK.avgCost, 55);
  assert.equal(p.positions.ABUK.openedAt, p.trades[0].date);
});

test('a sell realises P&L against the existing average and never moves it', async () => {
  let p = await recordTrade(base(), { code: CODE, side: 'buy', shares: 100, price: 50 });
  const commission = 40 * 70 * (RULES.commissionPct / 100);
  p = await recordTrade(p, { code: CODE, side: 'sell', shares: 40, price: 70 });
  assert.equal(p.positions.ABUK.shares, 60);
  assert.equal(p.positions.ABUK.avgCost, 50);
  const realized = +(40 * (70 - 50) - commission).toFixed(2);
  assert.equal(p.realizedPnl, realized);
  assert.equal(p.trades[1].realized, realized);
  // cash: 100000 − 5000 − buy commission(10) + 2800 − sell commission(5.6)
  assert.equal(p.cash, +(100_000 - 5000 - 100 * 50 * (RULES.commissionPct / 100) + 40 * 70 - commission).toFixed(2));
});

test('selling everything closes the position but keeps the trade row', async () => {
  let p = await recordTrade(base(), { code: CODE, side: 'buy', shares: 10, price: 50 });
  p = await recordTrade(p, { code: CODE, side: 'sell', shares: 10, price: 55 });
  assert.equal(p.positions.ABUK, undefined);
  assert.equal(p.trades.length, 2);
});

test('overselling, unknown codes, bad sides and non-positive amounts all refuse', async () => {
  const p = await recordTrade(base(), { code: CODE, side: 'buy', shares: 10, price: 50 });
  await assert.rejects(() => recordTrade(p, { code: CODE, side: 'sell', shares: 11, price: 50 }), /مش 11/);
  await assert.rejects(() => recordTrade(p, { code: 'NOPE1', side: 'buy', shares: 1, price: 50 }), /مش في قائمة/);
  await assert.rejects(() => recordTrade(p, { code: CODE, side: 'hold', shares: 1, price: 50 }), /buy أو sell/);
  await assert.rejects(() => recordTrade(p, { code: CODE, side: 'buy', shares: 0, price: 50 }));
  await assert.rejects(() => recordTrade(p, { code: CODE, side: 'buy', shares: 1, price: -5 }));
});

test('withPortfolio serialises concurrent writes — the lost-update regression', async () => {
  // portfolios.user_id has a real FK to users, so the queue test needs a user row.
  const { user } = await register({ email: uniqueEmail(), password: 'Passw0rd!123', phone: '01012345678' });
  const userId = user.id;
  await withPortfolio(userId, (p) => ({ ...p, cash: 100_000 })); // seed the book
  const jobs = Array.from({ length: 15 }, (_, i) =>
    withPortfolio(userId, (portfolio) =>
      recordTrade(portfolio, { code: CODE, side: 'buy', shares: 10, price: 10 + i }),
    ),
  );
  const final = await Promise.all(jobs).then((results) => results.at(-1));
  assert.equal(final.trades.length, 15, 'every concurrent write must land — none may overwrite another');
  const expectedCash = 100_000 - Array.from({ length: 15 }, (_, i) => 10 * (10 + i) * (1 + RULES.commissionPct / 100))
    .reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(final.cash - expectedCash) < 2, `cash ${final.cash} ≈ ${expectedCash}`);
  assert.equal(final.positions.ABUK.shares, 150);
  // The queue must not leak a resolved promise as a permanent jam point.
  await assert.doesNotReject(() => withPortfolio(userId, (p) => ({ ...p, cash: 42 })));
  assert.equal((await loadPortfolio(userId)).cash, 42);
});

test('setLevels updates an open position and refuses unknown codes', async () => {
  const p = await recordTrade(base(), { code: CODE, side: 'buy', shares: 100, price: 50 });
  const withLevels = setLevels(p, CODE, { stop: 45, target: 65 });
  assert.equal(withLevels.positions.ABUK.stop, 45);
  assert.equal(withLevels.positions.ABUK.target, 65);
  assert.throws(() => setLevels(p, 'ZZZZ', { stop: 1 }), /مفيش مركز/);
  // nulls keep the old values
  const keep = setLevels(withLevels, CODE, { stop: null, target: null });
  assert.equal(keep.positions.ABUK.stop, 45);
  assert.equal(keep.positions.ABUK.target, 65);
});

test('trackedCodes unions held and watched names, deduplicated', () => {
  const p = { ...base(), positions: { ABUK: { shares: 1, avgCost: 1 } }, watchlist: { SWDY: {}, ABUK: {} } };
  assert.deepEqual(trackedCodes(p).sort(), ['ABUK', 'SWDY']);
});

test('recordSnapshot writes today\'s entry, preserving any earlier note', () => {
  const portfolio = { ...base(50_000), positions: { ABUK: { shares: 100, avgCost: 45 } } };
  const analyses = [{
    code: 'ABUK',
    usable: true,
    snapshot: { price: { close: 50, changePct: 1.5 } },
    position: {
      shares: 100,
      avgCost: 45,
      stop: 42,
      marketValue: 5000,
      unrealizedEgp: 500,
      trailing: { moved: false },
      recommendation: { action: 'hold', text: 'خليك معاها' },
    },
  }];
  const updated = recordSnapshot(portfolio, analyses);
  const day = Object.keys(updated.log)[0];
  const entry = updated.log[day];
  assert.equal(entry.total, 55_000); // 5000 positions + 50_000 cash
  assert.equal(entry.positionsValue, 5000);
  assert.equal(entry.cash, 50_000);
  assert.equal(entry.prices.ABUK, 50);
  assert.equal(entry.recs.ABUK.action, 'hold');

  // A second snapshot the same day must not clobber a note written in between.
  const noted = { ...updated, log: { ...updated.log, [day]: { ...entry, note: 'ملاحظة', total: 1 } } };
  const again = recordSnapshot(noted, analyses, day);
  assert.equal(again.log[day].note, 'ملاحظة');
  assert.ok(again.log[day].total > 1);
});

test('setNote edits an existing day and refuses days with no data', () => {
  const portfolio = base();
  assert.throws(() => setNote(portfolio, '2026-01-01', 'hi'), /مفيش بيانات/);
  const withLog = { ...portfolio, log: { '2026-01-02': { total: 1, note: null } } };
  const updated = setNote(withLog, '2026-01-02', 'يوم حلو');
  assert.equal(updated.log['2026-01-02'].note, 'يوم حلو');
  assert.equal(withLog.log['2026-01-02'].note, null, 'must not mutate the input portfolio');
});