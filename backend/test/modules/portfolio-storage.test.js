import test from 'node:test';
import assert from 'node:assert/strict';

import '../helpers/env.js';

import { primaryPortfolioIdFor, getPortfolioById, putPortfolioById, getUserByEmail, getUserUsage, putUserUsage } from '../../src/db.js';
import { register } from '../../src/auth.js';
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
