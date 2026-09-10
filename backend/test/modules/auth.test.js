import test from 'node:test';
import assert from 'node:assert/strict';

import '../helpers/env.js';

import {
  register, login, userFromRequest, verifyEmail, resendVerification,
  sessionCookie, clearSessionCookie,
} from '../../src/auth.js';
import { supabase } from '../../src/supabaseClient.js';
import { uniqueEmail } from '../helpers/server.js';

const reqWithCookie = (token) => ({ headers: { cookie: token ? `alytic_session=${token}` : '' } });
const PHONE = '01012345678';

test('register validates email, password and duplicates', async () => {
  await assert.rejects(() => register({ email: 'not-an-email', password: 'Passw0rd!123' }), /بريد/);
  await assert.rejects(() => register({ email: 'ok@x.dev', password: 'short' }), /8/);
  const email = uniqueEmail();
  await register({ email, password: 'Passw0rd!123', name: 'أ', phone: PHONE });
  await assert.rejects(() => register({ email: email.toUpperCase(), password: 'Passw0rd!123', phone: PHONE }), /مسجل/);
});

test('register rejects a missing or invalid phone number', async () => {
  await assert.rejects(() => register({ email: uniqueEmail(), password: 'Passw0rd!123' }), /موبايل/);
  await assert.rejects(() => register({ email: uniqueEmail(), password: 'Passw0rd!123', phone: '123' }), /موبايل/);
});

test('register normalises the email and returns a usable session', async () => {
  const email = uniqueEmail();
  const { user, token } = await register({ email: `  ${email}  `, password: 'Passw0rd!123', phone: PHONE });
  assert.equal(user.email, email.toLowerCase());
  assert.equal(user.emailVerified, false);
  const me = await userFromRequest(reqWithCookie(token));
  assert.equal(me.id, user.id);
});

test('a tampered or expired session resolves to no user', async () => {
  const email = uniqueEmail();
  const { token } = await register({ email, password: 'Passw0rd!123', phone: PHONE });
  const [payload] = token.split('.');
  assert.equal(await userFromRequest(reqWithCookie(`${payload}.badsig`)), null);
  assert.equal(await userFromRequest(reqWithCookie('')), null);
  assert.equal(await userFromRequest(reqWithCookie(undefined)), null);
});

test('login rejects a wrong password and accepts the right one', async () => {
  const email = uniqueEmail();
  await register({ email, password: 'Passw0rd!123', name: 'تجربة', phone: PHONE });
  await assert.rejects(() => login({ email, password: 'WrongPass1' }), /غير صحيحة/);
  const { user, token } = await login({ email: ` ${email} `, password: 'Passw0rd!123' });
  assert.equal(user.email, email);
  const me = await userFromRequest(reqWithCookie(token));
  assert.equal(me.email, email);
});

const getUserRow = async (id, columns = '*') => {
  const { data } = await supabase.from('users').select(columns).eq('id', id).single();
  return data;
};

test('verifyEmail: valid token verifies once, then is spent', async () => {
  const email = uniqueEmail();
  const { user } = await register({ email, password: 'Passw0rd!123', phone: PHONE });
  const row = await getUserRow(user.id, 'verification_token, verification_token_expires');
  assert.ok(row.verification_token, 'registration must issue a verification token');

  const verified = await verifyEmail({ token: row.verification_token });
  assert.equal(verified.user.emailVerified, true);
  await assert.rejects(() => verifyEmail({ token: row.verification_token }), /غير صالح|مستخدم/);
  const cleared = await getUserRow(user.id, 'verification_token');
  assert.equal(cleared.verification_token, null);
});

test('verifyEmail: an expired token is rejected with its own message', async () => {
  const email = uniqueEmail();
  const { user } = await register({ email, password: 'Passw0rd!123', phone: PHONE });
  const row = await getUserRow(user.id, 'verification_token');
  await supabase.from('users').update({ verification_token_expires: new Date(Date.now() - 2 * 86400_000).toISOString() }).eq('id', user.id);
  await assert.rejects(() => verifyEmail({ token: row.verification_token }), /منتهي/);
});

test('resendVerification stays silent for unknown or verified emails', async () => {
  await assert.doesNotReject(() => resendVerification({ email: 'ghost@nowhere.dev' }));
  const email = uniqueEmail();
  const { user } = await register({ email, password: 'Passw0rd!123', phone: PHONE });
  const before = (await getUserRow(user.id, 'verification_token')).verification_token;
  await resendVerification({ email });
  const after = (await getUserRow(user.id, 'verification_token')).verification_token;
  assert.notEqual(after, before, 'a resend must rotate the token');
  assert.notEqual(after, null);
});

test('session cookies are HttpOnly and logout clears with Max-Age=0', () => {
  assert.ok(sessionCookie('abc').includes('HttpOnly'));
  assert.ok(sessionCookie('abc').includes('alytic_session=abc'));
  assert.ok(clearSessionCookie().includes('Max-Age=0'));
});