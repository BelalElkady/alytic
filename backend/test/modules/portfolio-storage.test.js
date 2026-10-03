import test from 'node:test';
import assert from 'node:assert/strict';

import '../helpers/env.js';

import { primaryPortfolioIdFor, getPortfolioById, putPortfolioById, getUserByEmail } from '../../src/db.js';
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
