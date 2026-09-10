import test from 'node:test';
import assert from 'node:assert/strict';

import '../helpers/env.js';

import {
  register, login, userFromRequest, verifyEmail, resendVerification,
  sessionCookie, clearSessionCookie,
} from '../../src/auth.js';
import { db } from '../../src/db.js';
import { uniqueEmail } from '../helpers/server.js';

const reqWithCookie = (token) => ({ headers: { cookie: token ? `alytic_session=${token}` : '' } });

test('register validates email, password and duplicates', async () => {
  await assert.rejects(() => register({ email: 'not-an-email', password: 'Passw0rd!123' }), /بريد/);
  await assert.rejects(() => register({ email: 'ok@x.dev', password: 'short' }), /8/);
  const email = uniqueEmail();
  await register({ email, password: 'Passw0rd!123', name: 'أ' });
  await assert.rejects(() => register({ email: email.toUpperCase(), password: 'Passw0rd!123' }), /مسجل/);
});

test('register normalises the email and returns a usable session', async () => {
  const email = uniqueEmail();
  const { user, token } = await register({ email: `  ${email}  `, password: 'Passw0rd!123' });
  assert.equal(user.email, email.toLowerCase());
  assert.equal(user.emailVerified, false);
  const me = await userFromRequest(reqWithCookie(token));
  assert.equal(me.id, user.id);
});

test('a tampered or expired session resolves to no user', async () => {
  const email = uniqueEmail();
  const { token } = await register({ email, password: 'Passw0rd!123' });
  const [payload] = token.split('.');
  assert.equal(await userFromRequest(reqWithCookie(`${payload}.badsig`)), null);
  assert.equal(await userFromRequest(reqWithCookie('')), null);
  assert.equal(await userFromRequest(reqWithCookie(undefined)), null);
});

test('login rejects a wrong password and accepts the right one', async () => {
  const email = uniqueEmail();
  await register({ email, password: 'Passw0rd!123', name: 'تجربة' });
  await assert.rejects(() => login({ email, password: 'WrongPass1' }), /غير صحيحة/);
  const { user, token } = await login({ email: ` ${email} `, password: 'Passw0rd!123' });
  assert.equal(user.email, email);
  const me = await userFromRequest(reqWithCookie(token));
  assert.equal(me.email, email);
});

test('verifyEmail: valid token verifies once, then is spent', async () => {
  const email = uniqueEmail();
  const { user } = await register({ email, password: 'Passw0rd!123' });
  const row = db.prepare('SELECT verification_token, verification_token_expires FROM users WHERE id = ?').get(user.id);
  assert.ok(row.verification_token, 'registration must issue a verification token');

  const verified = await verifyEmail({ token: row.verification_token });
  assert.equal(verified.user.emailVerified, true);
  await assert.rejects(() => verifyEmail({ token: row.verification_token }), /غير صالح|مستخدم/);
  const cleared = db.prepare('SELECT verification_token FROM users WHERE id = ?').get(user.id);
  assert.equal(cleared.verification_token, null);
});

test('verifyEmail: an expired token is rejected with its own message', async () => {
  const email = uniqueEmail();
  const { user } = await register({ email, password: 'Passw0rd!123' });
  const row = db.prepare('SELECT verification_token FROM users WHERE id = ?').get(user.id);
  db.prepare("UPDATE users SET verification_token_expires = datetime('now', '-2 days') WHERE id = ?").run(user.id);
  await assert.rejects(() => verifyEmail({ token: row.verification_token }), /منتهي/);
});

test('resendVerification stays silent for unknown or verified emails', async () => {
  await assert.doesNotReject(() => resendVerification({ email: 'ghost@nowhere.dev' }));
  const email = uniqueEmail();
  const { user } = await register({ email, password: 'Passw0rd!123' });
  const before = db.prepare('SELECT verification_token FROM users WHERE id = ?').get(user.id).verification_token;
  await resendVerification({ email });
  const after = db.prepare('SELECT verification_token FROM users WHERE id = ?').get(user.id).verification_token;
  assert.notEqual(after, before, 'a resend must rotate the token');
  assert.notEqual(after, null);
});

test('session cookies are HttpOnly and logout clears with Max-Age=0', () => {
  assert.ok(sessionCookie('abc').includes('HttpOnly'));
  assert.ok(sessionCookie('abc').includes('alytic_session=abc'));
  assert.ok(clearSessionCookie().includes('Max-Age=0'));
});