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

/** Minimal JSON client — mirrors what the browser sees, cookies included. */
export async function request(baseUrl, method, path, { body, cookie, headers = {} } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
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

/** Register a fresh user over HTTP; returns { user, cookie, raw }. */
export async function registerUser(baseUrl, email = uniqueEmail()) {
  const raw = await request(baseUrl, 'POST', '/api/auth/register', {
    body: { email, password: 'Passw0rd!123', name: 'Test User', phone: '01012345678' },
  });
  assert.equal(raw.status, 201, `register failed: ${raw.text}`);
  return { user: raw.body.user, cookie: sessionFrom(raw.setCookies), email, raw };
}