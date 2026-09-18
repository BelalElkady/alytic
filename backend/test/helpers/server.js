/**
 * In-process API test harness.
 *
 * Imports the real Express app (after env.js has redirected the DB and bar
 * cache) and listens on an OS-assigned port, so suites never collide with a
 * locally running dev server and never touch production data.
 */
import { once } from 'node:events';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

import './env.js';

let appModulePromise = null;
function loadApp() {
  appModulePromise ??= import('../../src/api/server.js').then((m) => m.default);
  return appModulePromise;
}

export async function startServer() {
  const app = await loadApp();
  const server = app.listen(0);
  await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return {
    server,
    baseUrl,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** Minimal JSON client — mirrors what the browser sees, cookies included.
 *
 * Every request presents its own X-Forwarded-For: the app trusts the proxy
 * header (`trust proxy 1`, set by nginx in production), so tests inherit the
 * same per-client rate-limit buckets real visitors get — one bucket per call
 * instead of the whole suite sharing 127.0.0.1 and tripping the 429s.
 */
export async function request(baseUrl, method, path, { body, cookie, headers = {} } = {}) {
  const ip = headers['x-forwarded-for'] ?? `10.${crypto.randomInt(1, 255)}.${crypto.randomInt(1, 255)}.${crypto.randomInt(1, 255)}`;
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'x-forwarded-for': ip,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return {
    status: res.status,
    headers: res.headers,
    setCookies: res.headers.getSetCookie?.() ?? [],
    body: json,
    text,
  };
}

/** Extract the alytic_session cookie value from a Set-Cookie header list. */
export function sessionFrom(setCookies) {
  const header = setCookies.find((c) => c.startsWith('alytic_session='));
  if (!header) return null;
  return header.split(';')[0];
}

export const uniqueEmail = () => `t-${crypto.randomUUID()}@test.local`;

/**
 * A random valid Egyptian mobile number. Phones are unique per account (see
 * idx_users_phone), and the tests share one real database, so a fixed number
 * would make every registration after the first collide.
 */
export const uniquePhone = () =>
  `01${['0', '1', '2', '5'][crypto.randomInt(4)]}${String(crypto.randomInt(100_000_000)).padStart(8, '0')}`;

/** Register a fresh user over HTTP, then sign in; returns { user, cookie, email, raw }.
 *
 * Registration itself never signs anyone in (and never reveals whether an
 * email was already taken — see auth.js) — it just answers `{ ok: true }`.
 * The session cookie only exists after a successful login, so the helper
 * performs that second step and hands back the cookie it produced.
 *
 * The email is confirmed before signing in because the free trial (and so
 * every paid endpoint) stays locked until it is — pass { verify: false } to
 * get the raw unverified account instead.
 */
export async function registerUser(baseUrl, email = uniqueEmail(), { verify = true } = {}) {
  const raw = await request(baseUrl, 'POST', '/api/auth/register', {
    body: { email, password: 'Passw0rd!123', name: 'Test User', phone: uniquePhone() },
  });
  assert.equal(raw.status, 201, `register failed: ${raw.text}`);
  assert.deepEqual(raw.body, { ok: true }, 'registration must not leak account state');
  assert.equal(sessionFrom(raw.setCookies), null, 'register must not set a session cookie');

  if (verify) {
    const { getUserByEmail } = await import('../../src/db.js');
    const token = (await getUserByEmail(email)).verification_token;
    const verified = await request(baseUrl, 'POST', '/api/auth/verify', { body: { token } });
    assert.equal(verified.status, 200, `verify failed: ${verified.text}`);
  }

  const login = await request(baseUrl, 'POST', '/api/auth/login', {
    body: { email, password: 'Passw0rd!123' },
  });
  assert.equal(login.status, 200, `login after register failed: ${login.text}`);
  return { user: login.body.user, cookie: sessionFrom(login.setCookies), email, raw: login };
}