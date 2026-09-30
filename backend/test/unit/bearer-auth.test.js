import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// auth.js talks to Supabase over HTTP through supabase-js, which uses the global fetch. Stubbing
// fetch lets the real login / session code run without a database.
process.env.SUPABASE_URL = 'http://supabase.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
process.env.SESSION_SECRET = 'unit-test-secret-unit-test-secret-1234';

const salt = 'a'.repeat(32);
const hashOf = (password) => crypto.scryptSync(password, salt, 64).toString('hex');
const row = { id: 'u1', email: 'a@b.co', name: 'A', phone: null, password_salt: salt, password_hash: hashOf('correct horse'), email_verified: true, is_admin: false, is_marketer: false, created_at: '2026-01-01T00:00:00Z' };
let current = row;

globalThis.fetch = async (url, init = {}) => {
  const method = init.method ?? 'GET';
  const body = method === 'GET' ? JSON.stringify(current) : null;
  return new Response(body, { status: method === 'GET' ? 200 : 204, headers: { 'content-type': 'application/json' } });
};

const { login, userFromRequest, refreshedSessionToken } = await import('../../src/auth.js');
const bearer = (token) => ({ headers: { authorization: `Bearer ${token}` } });

test('native login token works as a bearer header and as a cookie', async () => {
  const { token } = await login({ email: 'a@b.co', password: 'correct horse', ip: '1.1.1.1' });
  assert.equal((await userFromRequest(bearer(token))).id, 'u1');
  assert.equal((await userFromRequest({ headers: { cookie: `alytic_session=${encodeURIComponent(token)}` } })).id, 'u1');
});

test('no, malformed or tampered credentials are rejected', async () => {
  const { token } = await login({ email: 'a@b.co', password: 'correct horse', ip: '1.1.1.1' });
  assert.equal(await userFromRequest({ headers: {} }), null);
  assert.equal(await userFromRequest(bearer('garbage')), null);
  assert.equal(await userFromRequest(bearer(token.slice(0, -2) + 'xx')), null);
  assert.equal(await userFromRequest({ headers: { authorization: `Basic ${token}` } }), null);
});

test('refresh issues a fresh token for a valid session and refuses anything else', async () => {
  const { token } = await login({ email: 'a@b.co', password: 'correct horse', ip: '1.1.1.1' });
  await new Promise((r) => setTimeout(r, 5));
  const fresh = await refreshedSessionToken(bearer(token));
  assert.ok(fresh && fresh !== token);
  assert.equal((await userFromRequest(bearer(fresh))).id, 'u1');
  assert.equal(await refreshedSessionToken(bearer('garbage')), null);
  assert.equal(await refreshedSessionToken({ headers: {} }), null);
});

test('a password change signs out every token issued before it (bearer and refresh)', async () => {
  const { token } = await login({ email: 'a@b.co', password: 'correct horse', ip: '1.1.1.1' });
  const changed = { ...row, password_hash: hashOf('a different password') };
  current = changed;
  // getSessionUser caches for 30s; bypass by using a distinct user id for the changed row.
  current = { ...changed, id: 'u1' };
  const { forgetForTests } = await import('../../src/db.js').then((m) => ({ forgetForTests: m.setUserName }));
  await forgetForTests('u1', 'A'); // any users-row write forgets the cached session user
  assert.equal(await userFromRequest(bearer(token)), null);
  assert.equal(await refreshedSessionToken(bearer(token)), null);
  current = row;
});
