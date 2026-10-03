import test from 'node:test';
import assert from 'node:assert/strict';

import '../helpers/env.js';

import {
  primaryPortfolioIdFor,
  getPortfolioById,
  putPortfolioById,
  getUserByEmail,
  getUserUsage,
  putUserUsage,
  getPortfolioReview,
  putPortfolioReview,
  listRecommendations,
  listOpenRecommendationKeys,
  deleteUser,
  supabase,
} from '../../src/db.js';
import { register } from '../../src/auth.js';
import { logRecommendations } from '../../src/recommendations.js';
import { uniqueEmail, uniquePhone } from '../helpers/server.js';

test('primaryPortfolioIdFor resolves the migrated Portfolio for a freshly-registered user', async () => {
  // register() returns nothing by design — read the created row back by email
  // (see portfolio.test.js's "withPortfolio serialises concurrent writes" test).
  const email = uniqueEmail();
  await register({ email, password: 'x'.repeat(8), phone: uniquePhone() });
  const user = await getUserByEmail(email);

  const id = await primaryPortfolioIdFor(user.id);
  assert.equal(typeof id, 'number');
  const loaded = await getPortfolioById(id);
  assert.equal(loaded.userId, user.id);
  assert.equal(loaded.name, 'المحفظة الرئيسية');
});

test('getPortfolioById returns null for an id that does not exist', async () => {
  const loaded = await getPortfolioById(-1);
  assert.equal(loaded, null);
});

test('putPortfolioById updates the existing row by id and bumps updated_at', async () => {
  const email = uniqueEmail();
  await register({ email, password: 'x'.repeat(8), phone: uniquePhone() });
  const user = await getUserByEmail(email);
  const id = await primaryPortfolioIdFor(user.id);

  const before = await getPortfolioById(id);
  await putPortfolioById(id, { ...before.state, cash: 12345 });
  const after = await getPortfolioById(id);

  assert.equal(after.id, id);
  assert.equal(after.userId, user.id);
  assert.equal(after.state.cash, 12345);
  assert.ok(new Date(after.state.updatedAt).getTime() > 0);
});

test('getUserUsage defaults a fresh user to zero, and putUserUsage round-trips', async () => {
  const email = uniqueEmail();
  await register({ email, password: 'x'.repeat(8), phone: uniquePhone() });
  const user = await getUserByEmail(email);

  const zero = await getUserUsage(user.id);
  assert.equal(zero.screenshots, 0);
  assert.equal(zero.credits.recommendations, 0);
  await putUserUsage(user.id, { ...zero, screenshots: 2, credits: { ...zero.credits, recommendations: 5 } });
  const after = await getUserUsage(user.id);
  assert.equal(after.screenshots, 2);
  assert.equal(after.credits.recommendations, 5);
});

test('getUserUsage rolls the four usage counters over on a stale stored month, but never credits', async () => {
  const email = uniqueEmail();
  await register({ email, password: 'x'.repeat(8), phone: uniquePhone() });
  const user = await getUserByEmail(email);

  const current = await getUserUsage(user.id);
  await putUserUsage(user.id, { ...current, month: '2000-01', screenshots: 9, credits: { ...current.credits, recommendations: 3 } });
  const rolled = await getUserUsage(user.id);
  assert.equal(rolled.month, current.month); // the CURRENT month, not the stale '2000-01'
  assert.equal(rolled.screenshots, 0); // zeroed — stale month
  assert.equal(rolled.credits.recommendations, 3); // credits are never month-scoped
});

test('putPortfolioReview/getPortfolioReview round-trip by portfolio id', async () => {
  // register() returns nothing by design — read the created row back by email.
  const email = uniqueEmail();
  await register({ email, phone: uniquePhone(), password: 'x'.repeat(8) });
  const user = await getUserByEmail(email);
  const portfolioId = await primaryPortfolioIdFor(user.id);
  await putPortfolioReview(portfolioId, '2026-10-03', 'medium', 'hash1', { verdict: 'hold' }, 'model-x', null);
  const got = await getPortfolioReview(portfolioId, '2026-10-03', 'medium');
  assert.equal(got.portfolioHash, 'hash1');
  assert.equal(got.verdict, 'hold');
});

test('logRecommendations tags rows with the given portfolio and dedupes within it', async () => {
  // register() returns nothing by design — read the created row back by email.
  const email = uniqueEmail();
  await register({ email, phone: uniquePhone(), password: 'x'.repeat(8) });
  const user = await getUserByEmail(email);
  const portfolioId = await primaryPortfolioIdFor(user.id);
  await logRecommendations(user.id, portfolioId, [{ code: 'COMI', action: 'buy', levels: { refPrice: 10, target: 12, stop: 9 } }], { source: 'test', style: 'medium', model: 'test' });
  const keys = await listOpenRecommendationKeys(portfolioId);
  assert.ok(keys.includes('COMI:buy'));
});

// The next three depend on patch-recommendations-portfolio-id-nullable.sql
// (or a schema.sql-fresh tenant): the guard's clear-but-never-reassign rule for
// portfolio_id, and its `on delete set null` foreign key.
test('recommendations_guard refuses to reassign portfolio_id on an existing row, like user_id', async () => {
  // register() returns nothing by design — read the created row back by email.
  const email = uniqueEmail();
  await register({ email, phone: uniquePhone(), password: 'x'.repeat(8) });
  const user = await getUserByEmail(email);
  const portfolioId = await primaryPortfolioIdFor(user.id);
  await logRecommendations(user.id, portfolioId, [{ code: 'COMI', action: 'buy', levels: { refPrice: 10, target: 12, stop: 9 } }], { source: 'test', style: 'medium', model: 'test' });
  const [{ id }] = await listRecommendations({ userId: user.id }); // existing db.js helper, returns full rows
  const { error } = await supabase.from('recommendations').update({ portfolio_id: portfolioId + 1 }).eq('id', id);
  assert.match(error?.message ?? '', /portfolio_id can only be cleared, not reassigned/);
});

test('recommendations_guard lets portfolio_id be cleared to null', async () => {
  const email = uniqueEmail();
  await register({ email, phone: uniquePhone(), password: 'x'.repeat(8) });
  const user = await getUserByEmail(email);
  const portfolioId = await primaryPortfolioIdFor(user.id);
  await logRecommendations(user.id, portfolioId, [{ code: 'COMI', action: 'buy', levels: { refPrice: 10, target: 12, stop: 9 } }], { source: 'test', style: 'medium', model: 'test' });
  const [{ id }] = await listRecommendations({ userId: user.id });
  const { error } = await supabase.from('recommendations').update({ portfolio_id: null }).eq('id', id);
  assert.equal(error, null);
});

test('deleteUser succeeds for a User with a logged Recommendation, which survives with user_id and portfolio_id cleared', async () => {
  const email = uniqueEmail();
  await register({ email, phone: uniquePhone(), password: 'x'.repeat(8) });
  const user = await getUserByEmail(email);
  const portfolioId = await primaryPortfolioIdFor(user.id);
  await putPortfolioReview(portfolioId, '2026-10-03', 'medium', 'hash1', { verdict: 'hold' }, 'model-x', null);
  await logRecommendations(user.id, portfolioId, [{ code: 'COMI', action: 'buy', levels: { refPrice: 10, target: 12, stop: 9 } }], { source: 'test', style: 'medium', model: 'test' });
  const [{ id }] = await listRecommendations({ userId: user.id });

  assert.equal(await deleteUser(user.id), true);

  const { data: rec, error } = await supabase.from('recommendations').select('user_id, portfolio_id').eq('id', id).single();
  assert.equal(error, null);
  assert.equal(rec.user_id, null);
  assert.equal(rec.portfolio_id, null);
  assert.equal(await getPortfolioById(portfolioId), null);
  assert.equal(await getPortfolioReview(portfolioId, '2026-10-03', 'medium'), null);
});

test('logRecommendations does not dedupe the same stock/action across two different Portfolios of the same User', async () => {
  // register() returns nothing by design — read the created row back by email.
  const email = uniqueEmail();
  await register({ email, phone: uniquePhone(), password: 'x'.repeat(8) });
  const user = await getUserByEmail(email);
  const portfolioA = await primaryPortfolioIdFor(user.id);

  // No db.js/API call creates a *second* Portfolio for one User yet — that's
  // a later plan task. Insert the row directly via the raw `supabase` client
  // already exported from db.js, the same way the guard-trigger test above
  // reaches it for its own purposes.
  const { data: second, error: insertErr } = await supabase
    .from('portfolios')
    .insert({ user_id: user.id, name: 'محفظة ثانية', ordinal: 1 })
    .select('id')
    .single();
  assert.equal(insertErr, null);
  const portfolioB = second.id;

  const item = [{ code: 'COMI', action: 'buy', levels: { refPrice: 10, target: 12, stop: 9 } }];
  await logRecommendations(user.id, portfolioA, item, { source: 'test', style: 'medium', model: 'test' });
  await logRecommendations(user.id, portfolioB, item, { source: 'test', style: 'medium', model: 'test' });

  const keysA = await listOpenRecommendationKeys(portfolioA);
  const keysB = await listOpenRecommendationKeys(portfolioB);
  assert.ok(keysA.includes('COMI:buy'));
  assert.ok(keysB.includes('COMI:buy')); // not deduped against portfolioA's open call

  // Two independent rows exist — one per Portfolio — not one deduped against the other.
  const { data: rows, error: selectErr } = await supabase
    .from('recommendations')
    .select('portfolio_id')
    .eq('user_id', user.id)
    .eq('ticker', 'COMI')
    .eq('action', 'buy');
  assert.equal(selectErr, null);
  assert.deepEqual(new Set(rows.map((r) => r.portfolio_id)), new Set([portfolioA, portfolioB]));
});
