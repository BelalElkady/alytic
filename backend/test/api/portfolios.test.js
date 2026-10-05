import test from 'node:test';
import assert from 'node:assert/strict';

import '../helpers/env.js';

import { startServer, request, registerUser } from '../helpers/server.js';
import { primaryPortfolioIdFor, supabase, setUserAdmin, getPortfolioById } from '../../src/db.js';

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
    state_json: { cash: 1000, positions: {}, log: { '2026-01-01': { total: 5000, positionsValue: 4000, pl: 250, cash: 1000 } } },
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
  // for an empty positions map to even price). `value` is positions only —
  // matching what the active Portfolio's live `value` means on the frontend
  // (frontend/src/lib/store.tsx totals.value) — so a card can safely show
  // `value + cash` without double-counting cash already folded into `total`.
  assert.equal(inactive.value, 4000);
  assert.equal(inactive.pl, 250);
  assert.equal(inactive.cash, 1000);
  assert.equal(res.body.activePortfolioId, primaryId);
});

test('GET /api/portfolios falls back to the state_json style when the portfolios.style column is null', async () => {
  const { cookie, user } = await registerUser(baseUrl);
  const primaryId = await primaryPortfolioIdFor(user.id);
  // The signup trigger leaves portfolios.style null (schema.sql); a pre-migration
  // account's real style lives only in state_json.settings.investStyle.
  await supabase.from('portfolios').update({
    state_json: { cash: 0, positions: {}, log: {}, settings: { investStyle: 'trader' } },
  }).eq('id', primaryId);

  const res = await request(baseUrl, 'GET', '/api/portfolios', { cookie });
  const primary = res.body.portfolios.find((p) => p.id === primaryId);
  assert.equal(primary.style, 'trader');
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
  const initial = await request(baseUrl, 'GET', '/api/portfolios', { cookie });
  const usedStyles = new Set(initial.body.portfolios.map((portfolio) => portfolio.style));
  const styles = ['trader', 'medium', 'long'].filter((style) => !usedStyles.has(style));
  const second = await request(baseUrl, 'POST', '/api/portfolios', { cookie, body: { name: 'الثانية', style: styles[0] } });
  assert.equal(second.status, 201, second.text);
  const third = await request(baseUrl, 'POST', '/api/portfolios', { cookie, body: { name: 'الثالثة', style: styles[1] } });
  assert.equal(third.status, 201, third.text);
  const fourth = await request(baseUrl, 'POST', '/api/portfolios', { cookie, body: { name: 'الرابعة', style: styles[2] } });
  assert.equal(fourth.status, 403, fourth.text);

  const list = await request(baseUrl, 'GET', '/api/portfolios', { cookie });
  assert.equal(list.body.portfolios.length, 3);
  assert.equal(list.body.cap, 3);
  assert.deepEqual(list.body.portfolios.map((p) => p.readOnly), [false, false, false]);
  assert.equal(list.body.portfolios[1].name, 'الثانية');
  assert.equal(new Set(list.body.portfolios.map((portfolio) => portfolio.style)).size, 3);
});

test('POST /api/portfolios rejects a trading style already assigned to a wallet', async () => {
  const { cookie, user } = await registerUser(baseUrl);
  await setUserAdmin(user.id, true);
  const existing = await request(baseUrl, 'POST', '/api/portfolios', {
    cookie,
    body: { name: 'محفظة المضاربة', style: 'trader' },
  });
  assert.equal(existing.status, 201, existing.text);
  const res = await request(baseUrl, 'POST', '/api/portfolios', {
    cookie,
    body: { name: 'محفظة مكررة', style: 'trader' },
  });
  assert.equal(res.status, 409, res.text);
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

test('PATCH /api/portfolios/:id renames and restyles a writable Portfolio', async () => {
  const { cookie, user } = await registerUser(baseUrl);
  await setUserAdmin(user.id, true);
  const created = await request(baseUrl, 'POST', '/api/portfolios', { cookie, body: { name: 'الثانية', style: 'trader' } });
  // The two-place style write (Global Constraints): the column, checked via
  // GET below, and state_json.settings.investStyle — what the recommendation
  // engine actually reads — checked here directly after creation.
  const afterCreate = await getPortfolioById(created.body.id);
  assert.equal(afterCreate.state.settings?.investStyle, 'trader');

  const res = await request(baseUrl, 'PATCH', `/api/portfolios/${created.body.id}`, { cookie, body: { name: 'اسم جديد', style: 'long' } });
  assert.equal(res.status, 200, res.text);
  const afterRename = await getPortfolioById(created.body.id);
  assert.equal(afterRename.state.settings?.investStyle, 'long');

  const list = await request(baseUrl, 'GET', '/api/portfolios', { cookie });
  const renamed = list.body.portfolios.find((p) => p.id === created.body.id);
  assert.equal(renamed.name, 'اسم جديد');
  assert.equal(renamed.style, 'long');
});

test('PATCH /api/portfolios/:id rejects a style used by another wallet', async () => {
  const { cookie, user } = await registerUser(baseUrl);
  await setUserAdmin(user.id, true);
  const first = await request(baseUrl, 'POST', '/api/portfolios', {
    cookie,
    body: { name: 'الثانية', style: 'trader' },
  });
  assert.equal(first.status, 201, first.text);
  const created = await request(baseUrl, 'POST', '/api/portfolios', {
    cookie,
    body: { name: 'الثالثة', style: 'medium' },
  });
  assert.equal(created.status, 201, created.text);
  const res = await request(baseUrl, 'PATCH', `/api/portfolios/${created.body.id}`, {
    cookie,
    body: { style: 'trader' },
  });
  assert.equal(res.status, 409, res.text);
});

// Read-only via a direct insert (as above), not a downgrade: see Task 1's
// ledgered ruling on registerUser + setUserAdmin(false) mid-test and session caching.
test('PATCH on a Portfolio past the cap 403s — it is read-only', async () => {
  const { cookie, user } = await registerUser(baseUrl); // free/trial — cap 1
  const { data: second } = await supabase.from('portfolios').insert({
    user_id: user.id, name: 'الثانية', ordinal: 1, state_json: { cash: 0, positions: {}, log: {} },
  }).select('id').single();
  const res = await request(baseUrl, 'PATCH', `/api/portfolios/${second.id}`, { cookie, body: { name: 'محاولة' } });
  assert.equal(res.status, 403, res.text);
});

test('PATCH on another User\'s Portfolio 404s — never reveals that the id exists', async () => {
  const other = await registerUser(baseUrl);
  const otherPortfolioId = await primaryPortfolioIdFor(other.user.id);
  const { cookie } = await registerUser(baseUrl);
  const res = await request(baseUrl, 'PATCH', `/api/portfolios/${otherPortfolioId}`, { cookie, body: { name: 'محاولة' } });
  assert.equal(res.status, 404, res.text);
  // Must be this route's own "Portfolio not found" — not Express's generic
  // "route not found", which would also be a 404 and make this test pass
  // before the route is even implemented.
  assert.equal(res.body.error, 'المحفظة غير موجودة');
});

test('DELETE on another User\'s Portfolio 404s — never reveals that the id exists', async () => {
  const other = await registerUser(baseUrl);
  const otherPortfolioId = await primaryPortfolioIdFor(other.user.id);
  const { cookie } = await registerUser(baseUrl);
  const res = await request(baseUrl, 'DELETE', `/api/portfolios/${otherPortfolioId}`, { cookie });
  assert.equal(res.status, 404, res.text);
  assert.equal(res.body.error, 'المحفظة غير موجودة');
});

test('a malformed :id 404s on PATCH and DELETE, same as a foreign one', async () => {
  const { cookie } = await registerUser(baseUrl);
  const patchRes = await request(baseUrl, 'PATCH', '/api/portfolios/not-a-number', { cookie, body: { name: 'محاولة' } });
  assert.equal(patchRes.status, 404, patchRes.text);
  assert.equal(patchRes.body.error, 'المحفظة غير موجودة');
  const deleteRes = await request(baseUrl, 'DELETE', '/api/portfolios/not-a-number', { cookie });
  assert.equal(deleteRes.status, 404, deleteRes.text);
  assert.equal(deleteRes.body.error, 'المحفظة غير موجودة');
});

test('DELETE on a User\'s only Portfolio 400s', async () => {
  const { cookie, user } = await registerUser(baseUrl);
  const onlyId = await primaryPortfolioIdFor(user.id);
  const res = await request(baseUrl, 'DELETE', `/api/portfolios/${onlyId}`, { cookie });
  assert.equal(res.status, 400, res.text);
});

test('DELETE succeeds on a read-only Portfolio — deleting is how a User promotes the next one', async () => {
  const { cookie, user } = await registerUser(baseUrl); // free/trial — cap 1
  const { data: second } = await supabase.from('portfolios').insert({
    user_id: user.id, name: 'الثانية', ordinal: 1, state_json: { cash: 0, positions: {}, log: {} },
  }).select('id').single();
  const res = await request(baseUrl, 'DELETE', `/api/portfolios/${second.id}`, { cookie });
  assert.equal(res.status, 200, res.text);
  const list = await request(baseUrl, 'GET', '/api/portfolios', { cookie });
  assert.equal(list.body.portfolios.length, 1);
});

test('deleting the active Portfolio: a request still carrying its (now-deleted) id falls back to the primary, not an error', async () => {
  const { cookie, user } = await registerUser(baseUrl);
  await setUserAdmin(user.id, true);
  const primaryId = await primaryPortfolioIdFor(user.id);
  const created = await request(baseUrl, 'POST', '/api/portfolios', { cookie, body: { name: 'الثانية', style: 'trader' } });
  const headers = { 'x-portfolio-id': String(created.body.id) };
  // Confirm the header actually addresses the new Portfolio before deleting it.
  const before = await request(baseUrl, 'GET', '/api/portfolios', { cookie, headers });
  assert.equal(before.body.activePortfolioId, created.body.id);

  const del = await request(baseUrl, 'DELETE', `/api/portfolios/${created.body.id}`, { cookie });
  assert.equal(del.status, 200, del.text);

  // Same stale header as before the delete — must silently fall back, like
  // any other header naming a Portfolio that no longer resolves.
  const after = await request(baseUrl, 'GET', '/api/portfolios', { cookie, headers });
  assert.equal(after.status, 200, after.text);
  assert.equal(after.body.activePortfolioId, primaryId);
});
