/**
 * End-to-end HTTP tests over the real Express app.
 *
 * The harness (helpers/server.js) runs the app in-process on an OS-assigned
 * port, with no AI key. The database is the real Supabase project (see
 * helpers/env.js) — isolation comes from every test using its own randomly
 * generated user, not from a throwaway database.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import '../helpers/env.js';

import { startServer, request, sessionFrom, registerUser, uniqueEmail } from '../helpers/server.js';
import { supabase } from '../../src/supabaseClient.js';
import { writeBars, synthBars } from '../helpers/bars.js';

// Fixture bars so POST /api/snapshot never needs to fetch real market data.
await writeBars('ABUK', synthBars({ sessions: 300, start: 100, driftPct: 0.12, seed: 33 }));

const ctx = await startServer();
const { baseUrl } = ctx;

test.after(() => ctx.close());

test('health reports a no-key AI layer and the tracked universe', async () => {
  const res = await request(baseUrl, 'GET', '/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.aiAvailable, false);
  assert.ok(res.body.universeSize > 100);
});

test('the root redirects browsers to the EGXpert frontend', async () => {
  const res = await request(baseUrl, 'GET', '/');
  assert.equal(res.status, 302);
  assert.match(res.headers.get('location'), /localhost:8080/);
});

test('reference data is public: universe and indices need no login', async () => {
  const universe = await request(baseUrl, 'GET', '/api/universe');
  assert.equal(universe.status, 200);
  assert.ok(Array.isArray(universe.body.stocks));
  assert.ok(universe.body.stocks.some((s) => s.code === 'ABUK'));
  assert.equal(universe.body.aiAvailable, false);
  assert.ok(universe.body.rules.sizing.riskPerTradePct > 0);

  const indices = await request(baseUrl, 'GET', '/api/indices');
  assert.equal(indices.status, 200);
  assert.ok(Object.keys(indices.body.indices ?? {}).length > 0);
});

test('every protected endpoint answers 401 in Arabic without a session', async () => {
  for (const path of ['/api/portfolio', '/api/analyze/ABUK', '/api/scan?codes=ABUK', '/api/log', '/api/settings']) {
    const res = await request(baseUrl, 'GET', path);
    assert.equal(res.status, 401, `${path} should require auth`);
    assert.ok(res.body.error.includes('سجّل الدخول'), res.text);
  }
  const post = await request(baseUrl, 'POST', '/api/portfolio/trade', { body: { code: 'ABUK', side: 'buy', shares: 1, price: 1 } });
  assert.equal(post.status, 401);
});

test('register issues a session cookie and a public user object', async () => {
  const res = await request(baseUrl, 'POST', '/api/auth/register', {
    body: { email: uniqueEmail(), password: 'Passw0rd!123', name: 'حساب', phone: '01012345678' },
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.user.emailVerified, false);
  assert.equal(res.body.user.passwordHash, undefined);
  const rawCookie = res.setCookies.find((c) => c.startsWith('alytic_session='));
  assert.ok(rawCookie, 'a session cookie must be set');
  assert.match(rawCookie, /HttpOnly/);
});

test('register rejects a bad email with the engine\'s Arabic message', async () => {
  const res = await request(baseUrl, 'POST', '/api/auth/register', {
    body: { email: 'nope', password: 'Passw0rd!123' },
  });
  assert.equal(res.status, 500);
  assert.ok(res.body.error.includes('بريد'));
});

test('registering the same email twice reports the known conflict', async () => {
  const email = uniqueEmail();
  await request(baseUrl, 'POST', '/api/auth/register', { body: { email, password: 'Passw0rd!123', phone: '01012345678' } });
  const again = await request(baseUrl, 'POST', '/api/auth/register', { body: { email, password: 'Passw0rd!123', phone: '01012345678' } });
  assert.equal(again.status, 500);
  assert.equal(again.body.error, 'البريد الإلكتروني مسجل بالفعل');
});

test('register rejects a missing phone number with its own Arabic message', async () => {
  const res = await request(baseUrl, 'POST', '/api/auth/register', {
    body: { email: uniqueEmail(), password: 'Passw0rd!123' },
  });
  assert.equal(res.status, 500);
  assert.ok(res.body.error.includes('موبايل'));
});

test('login sets the cookie; a wrong password fails with the Arabic message', async () => {
  const { email, cookie, raw } = await registerUser(baseUrl);
  assert.equal(raw.status, 201);

  const bad = await request(baseUrl, 'POST', '/api/auth/login', { body: { email, password: 'Nope12345' } });
  assert.equal(bad.status, 500);
  assert.ok(bad.body.error.includes('غير صحيحة'));

  const good = await request(baseUrl, 'POST', '/api/auth/login', { body: { email, password: 'Passw0rd!123' } });
  assert.equal(good.status, 200);
  assert.ok(good.body.user.id);
});

test('/api/auth/me follows the cookie, and logout kills the session client-side', async () => {
  const { cookie } = await registerUser(baseUrl);
  const me = await request(baseUrl, 'GET', '/api/auth/me', { cookie });
  assert.equal(me.status, 200);
  assert.ok(me.body.user.email);

  const out = await request(baseUrl, 'POST', '/api/auth/logout');
  assert.equal(out.status, 200);
  assert.match(out.setCookies.join(' '), /Max-Age=0/);
  assert.equal(out.body.ok, true);
});

test('the whole portfolio lifecycle over HTTP', async () => {
  const { cookie } = await registerUser(baseUrl);

  // cash first
  let res = await request(baseUrl, 'POST', '/api/portfolio/cash', { body: { cash: 200_000 }, cookie });
  assert.equal(res.status, 200);
  assert.equal(res.body.cash, 200_000);

  res = await request(baseUrl, 'GET', '/api/portfolio', { cookie });
  assert.equal(res.status, 200);
  assert.equal(res.body.capital, 200_000);
  assert.deepEqual(res.body.positions, {});
  assert.deepEqual(res.body.tracked, []);

  // bad trade payloads → 400
  res = await request(baseUrl, 'POST', '/api/portfolio/trade', { body: { code: 'ABUK' }, cookie });
  assert.equal(res.status, 400);
  assert.ok(res.body.error.includes('code'));

  // a code outside the universe is refused loudly, not silently booked
  res = await request(baseUrl, 'POST', '/api/portfolio/trade', {
    body: { code: 'FAKE', side: 'buy', shares: 10, price: 5 }, cookie,
  });
  assert.equal(res.status, 500);
  assert.ok(res.body.error.includes('مش في قائمة'));

  // a real buy
  res = await request(baseUrl, 'POST', '/api/portfolio/trade', {
    body: { code: 'abuk', side: 'buy', shares: 100, price: 50 }, cookie,
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.positions.ABUK.shares, 100);
  assert.equal(res.body.positions.ABUK.avgCost, 50);
  const commission = 100 * 50 * 0.002;
  assert.equal(res.body.cash, +(200_000 - 5000 - commission).toFixed(2));
  assert.equal(res.body.capital, +(res.body.cash + 5000).toFixed(2));

  // partial sell realises P&L
  res = await request(baseUrl, 'POST', '/api/portfolio/trade', {
    body: { code: 'ABUK', side: 'sell', shares: 40, price: 55 }, cookie,
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.positions.ABUK.shares, 60);
  assert.equal(res.body.positions.ABUK.avgCost, 50);
  assert.ok(res.body.realizedPnl > 0);

  // manual holding correction
  res = await request(baseUrl, 'POST', '/api/portfolio/holding', {
    body: { code: 'ABUK', shares: 55, avgCost: 48 }, cookie,
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.positions.ABUK.shares, 55);
  assert.equal(res.body.positions.ABUK.avgCost, 48);

  res = await request(baseUrl, 'POST', '/api/portfolio/holding', {
    body: { code: 'NOPE', shares: 1 }, cookie,
  });
  assert.equal(res.status, 500);
  assert.ok(res.body.error.includes('مفيش مركز'));

  res = await request(baseUrl, 'POST', '/api/portfolio/holding', {
    body: { code: 'ABUK', shares: -3 }, cookie,
  });
  assert.equal(res.status, 400);

  // levels
  res = await request(baseUrl, 'POST', '/api/portfolio/levels', {
    body: { code: 'ABUK', stop: 44, target: 60 }, cookie,
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.positions.ABUK.stop, 44);

  // watchlist (favorites) add + remove
  res = await request(baseUrl, 'POST', '/api/portfolio/watchlist', {
    body: { code: 'SWDY', note: 'راقبه' }, cookie,
  });
  assert.equal(res.status, 200);
  assert.ok(res.body.watchlist.SWDY);
  assert.equal(res.body.watchlist.SWDY.note, 'راقبه');
  res = await request(baseUrl, 'POST', '/api/portfolio/watchlist', { body: { code: 'SWDY', remove: true }, cookie });
  assert.equal(res.body.watchlist.SWDY, undefined);

  res = await request(baseUrl, 'GET', '/api/portfolio', { cookie });
  assert.deepEqual(res.body.tracked.sort(), ['ABUK']);
});

test('settings validation and persistence', async () => {
  const { cookie } = await registerUser(baseUrl);
  let res = await request(baseUrl, 'GET', '/api/settings', { cookie });
  assert.equal(res.status, 200);
  assert.equal(res.body.settings.commissionPct, 0.2);

  res = await request(baseUrl, 'POST', '/api/settings', { body: { commissionPct: 0.35 }, cookie });
  assert.equal(res.status, 200);
  res = await request(baseUrl, 'GET', '/api/settings', { cookie });
  assert.equal(res.body.settings.commissionPct, 0.35);

  for (const bad of [-1, 9, 'x']) {
    const invalid = await request(baseUrl, 'POST', '/api/settings', { body: { commissionPct: bad }, cookie });
    assert.equal(invalid.status, 400);
  }
});

test('reset wipes the log by default and everything with scope=all', async () => {
  const { cookie } = await registerUser(baseUrl);
  await request(baseUrl, 'POST', '/api/portfolio/cash', { body: { cash: 10_000 }, cookie });
  await request(baseUrl, 'POST', '/api/portfolio/trade', {
    body: { code: 'ABUK', side: 'buy', shares: 10, price: 10 }, cookie,
  });
  let res = await request(baseUrl, 'POST', '/api/reset', { body: { scope: 'log' }, cookie });
  assert.equal(res.status, 200);
  res = await request(baseUrl, 'GET', '/api/portfolio', { cookie });
  assert.deepEqual(res.body.trades, []);
  assert.ok(res.body.positions.ABUK, 'positions survive a log reset');

  res = await request(baseUrl, 'POST', '/api/reset', { body: { scope: 'all' }, cookie });
  assert.equal(res.status, 200);
  res = await request(baseUrl, 'GET', '/api/portfolio', { cookie });
  assert.equal(res.body.cash, 0);
  assert.deepEqual(res.body.positions, {});
  assert.deepEqual(res.body.watchlist, {});
});

test('the daily log round-trips through the API', async () => {
  const { cookie } = await registerUser(baseUrl);
  await request(baseUrl, 'POST', '/api/portfolio/trade', {
    body: { code: 'ABUK', side: 'buy', shares: 100, price: 40 }, cookie,
  });
  const snap = await request(baseUrl, 'POST', '/api/snapshot', { body: {}, cookie });
  assert.equal(snap.status, 200, snap.text);
  assert.ok(snap.body.saved);
  assert.ok(snap.body.days >= 1);

  const log = await request(baseUrl, 'GET', '/api/log', { cookie });
  assert.equal(log.status, 200);
  assert.ok(log.body.days.includes(snap.body.saved));
  assert.ok(log.body.log[snap.body.saved].prices.ABUK > 0);

  const note = await request(baseUrl, 'POST', '/api/log/note', {
    body: { date: snap.body.saved, note: 'اختبار' }, cookie,
  });
  assert.equal(note.status, 200);
  assert.equal(note.body.entry.note, 'اختبار');
});

test('AI-only endpoints degrade to a plain 503 when no key is configured', async () => {
  const { cookie } = await registerUser(baseUrl);
  const review = await request(baseUrl, 'POST', '/api/review', { body: {}, cookie });
  assert.equal(review.status, 503);
  assert.equal(review.body.aiAvailable, false);
  const analysis = await request(baseUrl, 'GET', '/api/market-analysis', { cookie });
  assert.equal(analysis.status, 503);
  const fundamentals = await request(baseUrl, 'GET', '/api/fundamentals/ABUK', { cookie });
  assert.equal(fundamentals.status, 503);
  const screenshot = await request(baseUrl, 'POST', '/api/portfolio/import-screenshot', {
    cookie, headers: { 'content-type': 'image/png' }, body: { png: true },
  });
  assert.equal(screenshot.status, 503);
});

test('email verification completes over HTTP', async () => {
  const email = uniqueEmail();
  const reg = await request(baseUrl, 'POST', '/api/auth/register', {
    body: { email, password: 'Passw0rd!123', name: 'ف', phone: '01012345678' },
  });
  const { data: row } = await supabase.from('users').select('verification_token').eq('id', reg.body.user.id).single();
  const token = row.verification_token;
  const res = await request(baseUrl, 'POST', '/api/auth/verify', { body: { token } });
  assert.equal(res.status, 200);
  assert.equal(res.body.user.emailVerified, true);
});