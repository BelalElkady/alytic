import test from 'node:test';
import assert from 'node:assert/strict';

import '../helpers/env.js';

import RULES from '../../src/config/rules.js';
import {
  recordTrade, editTrade, setLevels, trackedCodes, recordSnapshot, setNote, withPortfolio,
  loadPortfolio, recordCashFlow, positionsFlow,
} from '../../src/portfolio.js';
import { register } from '../../src/auth.js';
import { getUserByEmail } from '../../src/db.js';
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

test('editing a buy re-averages the position, moves cash by the difference and re-prices later sells', async () => {
  let p = await recordTrade(base(), { code: CODE, side: 'buy', shares: 100, price: 50 });
  p = await recordTrade(p, { code: CODE, side: 'buy', shares: 100, price: 60 });
  p = await recordTrade(p, { code: CODE, side: 'sell', shares: 50, price: 70 });
  const edited = editTrade(p, 0, { code: CODE, side: 'buy', shares: 100, price: 40 });

  assert.equal(edited.positions.ABUK.shares, 150);
  assert.equal(edited.positions.ABUK.avgCost, 50);
  assert.equal(edited.cash, +(p.cash + 100 * 10 + p.trades[0].commission - edited.trades[0].commission).toFixed(2));
  const realized = +(50 * (70 - 50) - p.trades[2].commission).toFixed(2);
  assert.equal(edited.trades[2].realized, realized);
  assert.equal(edited.realizedPnl, realized);
});

test('an edit that changes nothing leaves the book as it was', async () => {
  let p = await recordTrade(base(), { code: CODE, side: 'buy', shares: 100, price: 50 });
  p = await recordTrade(p, { code: CODE, side: 'sell', shares: 30, price: 55 });
  const t = p.trades[1];
  const edited = editTrade(p, 1, { code: t.code, side: t.side, shares: t.shares, price: t.price, date: t.date });
  assert.deepEqual(edited.positions, p.positions);
  assert.equal(edited.cash, p.cash);
  assert.equal(edited.realizedPnl, p.realizedPnl);
});

test('deleting a trade keeps a holding that came from outside the log', async () => {
  // e.g. 200 shares at 30 imported from a screenshot, then one logged buy.
  let p = { ...base(), positions: { [CODE]: { shares: 200, avgCost: 30, stop: 25, target: null, openedAt: '2026-01-01' } } };
  p = await recordTrade(p, { code: CODE, side: 'buy', shares: 100, price: 60 });
  const edited = editTrade(p, 0, null);

  assert.equal(edited.trades.length, 0);
  assert.equal(edited.positions.ABUK.shares, 200);
  assert.equal(edited.positions.ABUK.avgCost, 30);
  assert.equal(edited.positions.ABUK.stop, 25);
  assert.equal(edited.cash, 100_000);
});

test('moving a trade to another stock updates both positions', async () => {
  let p = await recordTrade(base(), { code: CODE, side: 'buy', shares: 10, price: 50 });
  const edited = editTrade(p, 0, { code: 'COMI', side: 'buy', shares: 10, price: 50 });
  assert.equal(edited.positions.ABUK, undefined);
  assert.equal(edited.positions.COMI.shares, 10);
  assert.equal(edited.cash, p.cash);
});

test('an edit or delete that would leave a sell uncovered refuses', async () => {
  let p = await recordTrade(base(), { code: CODE, side: 'buy', shares: 10, price: 50 });
  p = await recordTrade(p, { code: CODE, side: 'sell', shares: 10, price: 55 });
  assert.throws(() => editTrade(p, 0, { code: CODE, side: 'buy', shares: 5, price: 50 }), /أكتر من اللي كان عندك/);
  assert.throws(() => editTrade(p, 0, null), /أكتر من اللي كان عندك/);
  assert.throws(() => editTrade(p, 5, null), /مش موجودة/);
});

test('withPortfolio serialises concurrent writes — the lost-update regression', async () => {
  // portfolios.user_id has a real FK to users, so the queue test needs a user row.
  // register() returns nothing by design — read the created row back by email.
  const email = uniqueEmail();
  await register({ email, password: 'Passw0rd!123', phone: '01012345678' });
  const userId = (await getUserByEmail(email)).id;
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

test('recordSnapshot takes cash flows since the prior close out of the day change', () => {
  const held = (close, changePct = 0) => [{
    code: 'ABUK',
    usable: true,
    snapshot: { price: { close, changePct } },
    position: { shares: 100, avgCost: 45, stop: 42, marketValue: 100 * close, unrealizedEgp: 100 * (close - 45) },
  }];
  const priorAt = new Date('2026-09-13T11:30:00Z');
  let p = { ...base(50_000), positions: { ABUK: { shares: 100, avgCost: 45 } } };
  p = recordSnapshot(p, held(50), '2026-09-13', priorAt);

  // A deposit after that close, before one made after the next close is saved.
  p = recordCashFlow({ ...p, cash: 100_000 }, 50_000, 'cash', new Date('2026-09-13T14:00:00Z'));
  p = recordCashFlow(p, 999, 'cash', new Date('2026-09-14T15:00:00Z'));
  const next = recordSnapshot(p, held(51), '2026-09-14', new Date('2026-09-14T11:30:00Z')).log['2026-09-14'];
  assert.equal(next.cashFlow, 50_000);
  assert.equal(next.dayChange, 100); // 100 shares × +1, not +50,100
  assert.equal(next.dayChangePct, +((100 / 105_000) * 100).toFixed(2));
});

test('recordSnapshot\'s first entry measures a +10% move on the value before it', () => {
  const analyses = [{
    code: 'ABUK',
    usable: true,
    snapshot: { price: { close: 110, changePct: 10 } },
    position: { shares: 1, avgCost: 100, marketValue: 110, unrealizedEgp: 10 },
  }];
  const entry = Object.values(recordSnapshot(base(0), analyses).log)[0];
  assert.equal(entry.dayChange, 10);
  assert.equal(entry.dayChangePct, 10);
});

test('positionsFlow values changed share counts at the given prices', () => {
  const before = { ABUK: { shares: 100, avgCost: 45 }, SWDY: { shares: 10, avgCost: 20 } };
  const after = { ABUK: { shares: 150, avgCost: 40 }, COMI: { shares: 5, avgCost: 70 } };
  const prices = new Map([['ABUK', 50], ['SWDY', 30]]);
  // +50 ABUK @50, −10 SWDY @30, +5 COMI at its average cost (no price)
  assert.equal(positionsFlow(before, after, prices), 2500 - 300 + 350);
});

test('setNote edits an existing day and refuses days with no data', () => {
  const portfolio = base();
  assert.throws(() => setNote(portfolio, '2026-01-01', 'hi'), /مفيش بيانات/);
  const withLog = { ...portfolio, log: { '2026-01-02': { total: 1, note: null } } };
  const updated = setNote(withLog, '2026-01-02', 'يوم حلو');
  assert.equal(updated.log['2026-01-02'].note, 'يوم حلو');
  assert.equal(withLog.log['2026-01-02'].note, null, 'must not mutate the input portfolio');
});