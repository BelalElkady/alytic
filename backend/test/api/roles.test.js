/**
 * Roles: admin, marketer and regular user, and who may change them.
 * Same harness as the other API suites — real app in-process, a fresh random
 * user per test, the shared Supabase project underneath (see helpers/env.js).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import '../helpers/env.js';

import { startServer, request, registerUser } from '../helpers/server.js';
import { getUserByEmail, setUserRole } from '../../src/db.js';

const ctx = await startServer();
const { baseUrl } = ctx;

test.after(() => ctx.close());

/** A signed-in account with the given role. The role is set straight in the database — there is no signup path that grants one. */
async function accountWithRole(role) {
  const account = await registerUser(baseUrl);
  if (role !== 'user') await setUserRole(account.user.id, role);
  return account;
}

const setRole = (actor, targetId, role) =>
  request(baseUrl, 'POST', `/api/admin/users/${targetId}/role`, { cookie: actor.cookie, body: { role } });

const roleInDb = async (email) => {
  const row = await getUserByEmail(email);
  return { admin: row.is_admin, marketer: row.is_marketer };
};

test('an admin can make a user a marketer, an admin, and back to a regular user', async () => {
  const admin = await accountWithRole('admin');
  const target = await registerUser(baseUrl);

  for (const [role, expected] of [
    ['marketer', { admin: false, marketer: true }],
    ['admin', { admin: true, marketer: false }],
    ['user', { admin: false, marketer: false }],
  ]) {
    const res = await setRole(admin, target.user.id, role);
    assert.equal(res.status, 200, res.text);
    assert.equal(res.body.role, role);
    // One role at a time: promoting a marketer must clear the marketer flag.
    assert.deepEqual(await roleInDb(target.email), expected, `after → ${role}`);
  }
});

test('a role change takes effect on the target’s existing session at once', async () => {
  const admin = await accountWithRole('admin');
  const target = await registerUser(baseUrl);

  assert.equal((await request(baseUrl, 'GET', '/api/admin/users', { cookie: target.cookie })).status, 403);
  assert.equal((await setRole(admin, target.user.id, 'admin')).status, 200);
  assert.equal((await request(baseUrl, 'GET', '/api/admin/users', { cookie: target.cookie })).status, 200);
  assert.equal((await setRole(admin, target.user.id, 'user')).status, 200);
  assert.equal((await request(baseUrl, 'GET', '/api/admin/users', { cookie: target.cookie })).status, 403);
});

test('a marketer reads the users table and can do nothing else', async () => {
  const marketer = await accountWithRole('marketer');
  const other = await registerUser(baseUrl);

  assert.equal((await request(baseUrl, 'GET', '/api/admin/users', { cookie: marketer.cookie })).status, 200);
  assert.equal((await request(baseUrl, 'GET', '/api/admin/online', { cookie: marketer.cookie })).status, 200);

  assert.equal((await request(baseUrl, 'GET', '/api/admin/support', { cookie: marketer.cookie })).status, 403);
  assert.equal((await request(baseUrl, 'GET', '/api/admin/blog-drafts', { cookie: marketer.cookie })).status, 403);
  // Not even the role change: a marketer can't promote themselves or anyone.
  assert.equal((await setRole(marketer, other.user.id, 'admin')).status, 403);
  assert.equal((await setRole(marketer, marketer.user.id, 'admin')).status, 403);
  assert.deepEqual(await roleInDb(marketer.email), { admin: false, marketer: true });
});

test('a regular user can not change roles, including their own', async () => {
  const user = await registerUser(baseUrl);
  const other = await registerUser(baseUrl);

  assert.equal((await setRole(user, other.user.id, 'marketer')).status, 403);
  assert.equal((await setRole(user, user.user.id, 'admin')).status, 403);
  assert.deepEqual(await roleInDb(user.email), { admin: false, marketer: false });
});

test('an admin can not change their own role, the system account, or use an unknown role', async () => {
  const admin = await accountWithRole('admin');
  const target = await registerUser(baseUrl);

  const self = await setRole(admin, admin.user.id, 'user');
  assert.equal(self.status, 400);
  assert.deepEqual(await roleInDb(admin.email), { admin: true, marketer: false });

  assert.equal((await setRole(admin, 'local', 'marketer')).status, 400);
  assert.equal((await setRole(admin, target.user.id, 'superuser')).status, 400);
  assert.equal((await setRole(admin, target.user.id, undefined)).status, 400);
  assert.equal((await setRole(admin, 'no-such-user', 'marketer')).status, 404);
  assert.deepEqual(await roleInDb(target.email), { admin: false, marketer: false });
});

test('an admin can demote another admin, and the users list reports each role', async () => {
  const first = await accountWithRole('admin');
  const second = await accountWithRole('admin');
  const marketer = await accountWithRole('marketer');

  const list = await request(baseUrl, 'GET', '/api/admin/users', { cookie: first.cookie });
  assert.equal(list.status, 200, list.text);
  const byEmail = Object.fromEntries(list.body.users.map((u) => [u.email, u]));
  assert.equal(byEmail[second.email].isAdmin, true);
  assert.equal(byEmail[marketer.email].isMarketer, true);
  assert.equal(byEmail[marketer.email].isAdmin, false);

  assert.equal((await setRole(first, second.user.id, 'user')).status, 200);
  assert.deepEqual(await roleInDb(second.email), { admin: false, marketer: false });
  assert.equal((await request(baseUrl, 'GET', '/api/admin/users', { cookie: second.cookie })).status, 403);
});
