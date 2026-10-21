import test from 'node:test';
import assert from 'node:assert/strict';

import '../helpers/env.js';

import { startServer, request, registerUser } from '../helpers/server.js';
import { supabase, setUserAdmin } from '../../src/db.js';

const ctx = await startServer();
const { baseUrl } = ctx;
test.after(() => ctx.close());

const READONLY_REJECTED = 'المحفظة دي للعرض بس — باقتك الحالية بتسمح بمحفظة واحدة';

/** Every #103-gated endpoint, with a body shape each route's own validation accepts. */
const GATED_REQUESTS = [
  ['POST', '/api/portfolio/trade', { code: 'ABUK', side: 'buy', shares: 1, price: 1 }],
  ['POST', '/api/portfolio/trades/0', { shares: 1, price: 1 }],
  ['POST', '/api/portfolio/trades/0/delete', {}],
  ['POST', '/api/portfolio/cash', { cash: 500 }],
  ['POST', '/api/portfolio/corporate-action', { code: 'ABUK', lastBefore: '2026-01-01', action: 'dismiss' }],
  ['POST', '/api/portfolio/levels', { code: 'ABUK', stop: 10 }],
  ['POST', '/api/portfolio/holding', { code: 'ABUK', shares: 1 }],
  ['POST', '/api/portfolio/watchlist', { code: 'ABUK', action: 'add' }],
  ['POST', '/api/snapshot', {}],
  ['POST', '/api/log/note', { date: '2026-01-01', note: 'x' }],
  ['POST', '/api/settings/style', { style: 'trader' }],
  ['POST', '/api/portfolio/import-screenshot', {}],
];

async function readOnlySecondPortfolio(user) {
  const { data } = await supabase.from('portfolios').insert({
    user_id: user.id, name: 'الثانية', ordinal: 1, state_json: { cash: 0, positions: {}, log: {} },
  }).select('id').single();
  return data.id;
}

test('every #103-gated endpoint 403s on a read-only Portfolio, with the shared rejection message', async () => {
  const { cookie, user } = await registerUser(baseUrl); // free/trial — cap 1
  const secondId = await readOnlySecondPortfolio(user);
  const headers = { 'x-portfolio-id': String(secondId) };

  for (const [method, path, body] of GATED_REQUESTS) {
    const res = await request(baseUrl, method, path, { cookie, headers, body });
    assert.equal(res.status, 403, `${method} ${path} → ${res.status}: ${res.text}`);
    assert.equal(res.body.error, READONLY_REJECTED, `${method} ${path}`);
  }
});

test('the primary Portfolio (rank 0) stays writable for every tier, including a never-subscribed account', async () => {
  const { cookie } = await registerUser(baseUrl);
  const res = await request(baseUrl, 'POST', '/api/portfolio/cash', { cookie, body: { cash: 500 } });
  assert.equal(res.status, 200, res.text);
});

test('a trader can write to a non-primary Portfolio that is within the 3-cap', async () => {
  const { cookie, user } = await registerUser(baseUrl);
  await setUserAdmin(user.id, true); // trader — cap 3
  const secondId = await readOnlySecondPortfolio(user); // rank 1, under cap 3
  const res = await request(baseUrl, 'POST', '/api/portfolio/cash', {
    cookie, headers: { 'x-portfolio-id': String(secondId) }, body: { cash: 500 },
  });
  assert.equal(res.status, 200, res.text);
});

test('reads stay open on a read-only Portfolio', async () => {
  const { cookie, user } = await registerUser(baseUrl);
  const secondId = await readOnlySecondPortfolio(user);
  const headers = { 'x-portfolio-id': String(secondId) };
  for (const path of ['/api/portfolio', '/api/portfolios', '/api/log']) {
    const res = await request(baseUrl, 'GET', path, { cookie, headers });
    assert.equal(res.status, 200, `${path} → ${res.status}: ${res.text}`);
  }
});

// #103's list left these two out; #147 added them because both rewrite
// history, so a view-only Portfolio could otherwise still be wiped.
test('log/backfill and reset are refused on a read-only Portfolio too', async () => {
  const { cookie, user } = await registerUser(baseUrl);
  const secondId = await readOnlySecondPortfolio(user);
  const headers = { 'x-portfolio-id': String(secondId) };
  const resetRes = await request(baseUrl, 'POST', '/api/reset', { cookie, headers, body: { scope: 'log' } });
  assert.equal(resetRes.status, 403, resetRes.text);
  const backfillRes = await request(baseUrl, 'POST', '/api/log/backfill', { cookie, headers, body: {} });
  assert.equal(backfillRes.status, 403, backfillRes.text);
});

test('creating a Portfolio is unaffected by this new middleware', async () => {
  const { cookie, user } = await registerUser(baseUrl);
  await setUserAdmin(user.id, true);
  const res = await request(baseUrl, 'POST', '/api/portfolios', { cookie, body: { name: 'جديدة', style: 'trader' } });
  assert.equal(res.status, 201, res.text);
});
