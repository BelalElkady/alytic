import test from 'node:test';
import assert from 'node:assert/strict';

import '../helpers/env.js';

import { startServer, request, registerUser } from '../helpers/server.js';
import { primaryPortfolioIdFor, supabase, setUserAdmin } from '../../src/db.js';

const ctx = await startServer();
const { baseUrl } = ctx;
test.after(() => ctx.close());

test('a request with no X-Portfolio-Id header falls back to the primary Portfolio', async () => {
  const { cookie } = await registerUser(baseUrl);
  const res = await request(baseUrl, 'GET', '/api/portfolio', { cookie }); // no header
  assert.equal(res.status, 200, res.text);
});

test('a header naming a Portfolio owned by a different User falls back to primary, not an error', async () => {
  const other = await registerUser(baseUrl);
  const otherPortfolioId = await primaryPortfolioIdFor(other.user.id); // test-only import from db.js
  // A distinctive cash value on the foreign Portfolio — if the header were
  // wrongly honored, the response would show this exact number.
  await supabase.from('portfolios').update({ state_json: { cash: 999999, positions: {}, log: {} } }).eq('id', otherPortfolioId);

  const { cookie, user } = await registerUser(baseUrl);
  const ownPortfolioId = await primaryPortfolioIdFor(user.id);
  const { data: own } = await supabase.from('portfolios').select('state_json').eq('id', ownPortfolioId).single();
  const ownCash = own.state_json?.cash ?? 0; // a freshly registered Portfolio has no state_json row yet

  const res = await request(baseUrl, 'GET', '/api/portfolio', { cookie, headers: { 'x-portfolio-id': String(otherPortfolioId) } });
  assert.equal(res.status, 200, res.text); // not 403/404 — silently falls back
  // Proves the fallback by value, not just status: the response must be the
  // requester's OWN primary Portfolio, never the foreign one's distinctive cash.
  assert.notEqual(res.body.cash, 999999);
  assert.equal(res.body.cash, ownCash);
});

test('a header naming a Portfolio the requester owns (not their primary) addresses that Portfolio', async () => {
  const { cookie, user } = await registerUser(baseUrl);
  // No higher-level "create a second Portfolio" API exists yet — insert one
  // directly via supabase, same technique Task 1/Task 3's other tests use.
  const { data: second } = await supabase.from('portfolios').insert({
    user_id: user.id, name: 'محفظة ثانية', ordinal: 1,
    state_json: { cash: 424242, positions: {}, log: {} },
  }).select('id').single();

  const res = await request(baseUrl, 'GET', '/api/portfolio', { cookie, headers: { 'x-portfolio-id': String(second.id) } });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.cash, 424242); // addressed the owned, non-primary Portfolio, not the primary
});

test('GET /api/portfolios values a non-active Portfolio from its last-saved snapshot, never a live quote', async () => {
  const { cookie, user } = await registerUser(baseUrl);
  const primaryId = await primaryPortfolioIdFor(user.id);
  // No higher-level "create a second Portfolio" API exists yet — insert one
  // directly (Task 1's technique), with a fabricated log entry standing in
  // for a real daily close, so this test can assert on a known number
  // without needing live price data or a running daily-close job.
  const { data: second } = await supabase.from('portfolios').insert({
    user_id: user.id, name: 'محفظة ثانية', ordinal: 1,
    state_json: { cash: 1000, positions: {}, log: { '2026-01-01': { total: 5000, pl: 250, cash: 1000 } } },
  }).select('id').single();

  const res = await request(baseUrl, 'GET', '/api/portfolios', { cookie });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.portfolios.length, 2);
  const active = res.body.portfolios.find((p) => p.id === primaryId);
  const inactive = res.body.portfolios.find((p) => p.id === second.id);
  assert.equal(active.active, true);
  assert.equal(inactive.active, false);
  // The fabricated log entry's numbers, verbatim — proves this came from the
  // stored snapshot, not a live-quote computation (there are no live quotes
  // for an empty positions map to even price).
  assert.equal(inactive.value, 5000);
  assert.equal(inactive.pl, 250);
  assert.equal(inactive.cash, 1000);
  assert.equal(res.body.activePortfolioId, primaryId);
});

test('a free-tier User is already at the 1-Portfolio cap, so POST /api/portfolios 403s', async () => {
  const { cookie } = await registerUser(baseUrl);
  const res = await request(baseUrl, 'POST', '/api/portfolios', { cookie, body: { name: 'محفظة ثانية', style: 'trader' } });
  assert.equal(res.status, 403, res.text);
});

test('POST /api/portfolios rejects a missing or unknown style', async () => {
  const { cookie, user } = await registerUser(baseUrl);
  await setUserAdmin(user.id, true); // trader — cap 3, so this fails on style, not cap
  const missing = await request(baseUrl, 'POST', '/api/portfolios', { cookie, body: { name: 'محفظة' } });
  assert.equal(missing.status, 400, missing.text);
  const unknown = await request(baseUrl, 'POST', '/api/portfolios', { cookie, body: { name: 'محفظة', style: 'nope' } });
  assert.equal(unknown.status, 400, unknown.text);
});

test('a الحريفة User can create up to 3 Portfolios, and a 4th 403s', async () => {
  const { cookie, user } = await registerUser(baseUrl);
  await setUserAdmin(user.id, true);
  const second = await request(baseUrl, 'POST', '/api/portfolios', { cookie, body: { name: 'الثانية', style: 'trader' } });
  assert.equal(second.status, 201, second.text);
  const third = await request(baseUrl, 'POST', '/api/portfolios', { cookie, body: { name: 'الثالثة', style: 'long' } });
  assert.equal(third.status, 201, third.text);
  const fourth = await request(baseUrl, 'POST', '/api/portfolios', { cookie, body: { name: 'الرابعة', style: 'medium' } });
  assert.equal(fourth.status, 403, fourth.text);

  const list = await request(baseUrl, 'GET', '/api/portfolios', { cookie });
  assert.equal(list.body.portfolios.length, 3);
  assert.equal(list.body.cap, 3);
  assert.deepEqual(list.body.portfolios.map((p) => p.readOnly), [false, false, false]);
  assert.equal(list.body.portfolios[1].name, 'الثانية');
  assert.equal(list.body.portfolios[1].style, 'trader');
});

test('a Portfolio past the User\'s cap is marked read-only; the first stays writable', async () => {
  const { cookie, user } = await registerUser(baseUrl); // free/trial — cap 1
  const primaryId = await primaryPortfolioIdFor(user.id);
  // No "downgrade" needed to see a read-only Portfolio: a free/trial account's
  // cap is already 1, so a second (directly inserted, same technique the
  // pre-existing tests above use) Portfolio is read-only from the start.
  const { data: second } = await supabase.from('portfolios').insert({
    user_id: user.id, name: 'الثانية', ordinal: 1, state_json: { cash: 0, positions: {}, log: {} },
  }).select('id').single();
  const res = await request(baseUrl, 'GET', '/api/portfolios', { cookie });
  assert.equal(res.body.cap, 1);
  const first = res.body.portfolios.find((p) => p.id === primaryId);
  const extra = res.body.portfolios.find((p) => p.id === second.id);
  assert.equal(first.readOnly, false);
  assert.equal(extra.readOnly, true);
});
