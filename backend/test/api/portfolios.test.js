import test from 'node:test';
import assert from 'node:assert/strict';

import '../helpers/env.js';

import { startServer, request, registerUser } from '../helpers/server.js';
import { primaryPortfolioIdFor, supabase } from '../../src/db.js';

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
