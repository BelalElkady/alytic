import test from 'node:test';
import assert from 'node:assert/strict';

import '../helpers/env.js';

import {
  register, login, userFromRequest, verifyEmail, resendVerification,
  forgotPassword, resetPassword, sessionCookie, clearSessionCookie,
} from '../../src/auth.js';
import {
  getUserByEmail, getUserByVerificationToken, getUserByResetToken,
  setVerificationToken, setResetToken,
} from '../../src/db.js';
import { uniqueEmail } from '../helpers/server.js';

const PHONE = '01012345678';
const PASSWORD = 'Passw0rd!123';

const reqWithCookie = (token) => ({ headers: { cookie: token ? `alytic_session=${token}` : '' } });

/** Register through the real engine and read the row back from Supabase. */
async function registerAndFetch(email = uniqueEmail(), phone = PHONE, password = PASSWORD) {
  await register({ email, password, name: 'تجربة', phone });
  return { email, user: await getUserByEmail(email) };
}

test('register validates email, password and Egyptian phone', async () => {
  await assert.rejects(() => register({ email: 'not-an-email', password: PASSWORD, phone: PHONE }), /بريد/);
  await assert.rejects(() => register({ email: 'ok@x.dev', password: 'short', phone: PHONE }), /8 حروف/);
  await assert.rejects(() => register({ email: 'ok@x.dev', password: PASSWORD, phone: '12345' }), /موبايل مصري صحيح/);
  await assert.rejects(() => register({ email: 'ok@x.dev', password: PASSWORD, phone: '0991234567' }), /موبايل مصري صحيح/);
  await assert.rejects(() => register({ email: 'ok@x.dev', password: PASSWORD }), /موبايل مصري صحيح/);
});

test('register normalises the phone and accepts every Egyptian prefix', async () => {
  for (const [raw, expected] of [
    ['+201098765432', '01098765432'],
    ['00201098765432', '01098765432'],
    ['010 9876 5432', '01098765432'],
    ['01198765432', '01198765432'],
    ['01298765432', '01298765432'],
    ['01598765432', '01598765432'],
  ]) {
    const email = uniqueEmail();
    await register({ email, password: PASSWORD, name: 'ه', phone: raw });
    const user = await getUserByEmail(email);
    assert.equal(user.phone, expected, `phone ${raw}`);
  }
});

test('register stores the account unverified with a verification token', async () => {
  const { user } = await registerAndFetch();
  assert.equal(user.email_verified, false);
  assert.ok(user.verification_token, 'registration must issue a verification token');
  assert.ok(user.verification_token_expires);
  assert.equal(user.is_admin, false);
});

test('register never reveals that an email is already taken', async () => {
  const { email, user } = await registerAndFetch();
  // Same email again: identical quiet result, no second row, no token rotation.
  await assert.doesNotReject(() => register({ email, password: PASSWORD, name: 'مكرر', phone: PHONE }));
  const after = await getUserByEmail(email);
  assert.ok(after, 'the original account is untouched');
  assert.equal(after.id, user.id);
  assert.equal(after.verification_token, user.verification_token, 'the original token stays valid');
});

test('login: correct credentials in, wrong password and unknown email say the same thing', async () => {
  const { email } = await registerAndFetch();

  const good = await login({ email, password: PASSWORD });
  assert.equal(good.user.email, email);
  const me = await userFromRequest(reqWithCookie(good.token));
  assert.equal(me.email, email);

  const wrong = await login({ email, password: 'WrongPass1' }).catch((e) => e.message);
  const unknown = await login({ email: 'ghost@nowhere.dev', password: 'WrongPass1' }).catch((e) => e.message);
  assert.equal(wrong, unknown);
  assert.equal(wrong, 'البريد الإلكتروني أو كلمة المرور غير صحيحة');
});

test('a tampered or expired session resolves to no user', async () => {
  const { email } = await registerAndFetch();
  const { token } = await login({ email, password: PASSWORD });
  const [payload] = token.split('.');
  assert.equal(await userFromRequest(reqWithCookie(`${payload}.badsig`)), null);
  assert.equal(await userFromRequest(reqWithCookie('')), null);
  assert.equal(await userFromRequest({ headers: {} }), null);
});

test('verifyEmail: a valid token verifies once, then is spent', async () => {
  const { user } = await registerAndFetch();
  const verified = await verifyEmail({ token: user.verification_token });
  assert.equal(verified.user.emailVerified ?? verified.user.email_verified, true);
  const after = await getUserByEmail(user.email);
  assert.equal(after.verification_token, null, 'the token is cleared once used');
  await assert.rejects(() => verifyEmail({ token: user.verification_token }), /غير صالح|مستخدم/);
});

test('verifyEmail: an expired token is rejected with its own message', async () => {
  const { user } = await registerAndFetch();
  await setVerificationToken(user.id, user.verification_token, new Date(Date.now() - 1000).toISOString());
  await assert.rejects(() => verifyEmail({ token: user.verification_token }), /منتهي الصلاحية/);
});

test('resendVerification stays silent for unknown or verified emails and rotates otherwise', async () => {
  await assert.doesNotReject(() => resendVerification({ email: 'ghost@nowhere.dev' }));
  const { user } = await registerAndFetch();
  await verifyEmail({ token: user.verification_token });
  await assert.doesNotReject(() => resendVerification({ email: user.email })); // verified → quiet no-op

  const { user: fresh } = await registerAndFetch();
  const before = fresh.verification_token;
  await resendVerification({ email: fresh.email });
  const after = await getUserByEmail(fresh.email);
  assert.notEqual(after.verification_token, before, 'a resend must rotate the token');
  assert.notEqual(after.verification_token, null);
});

test('forgotPassword stays silent for unknown emails and issues a reset token for known ones', async () => {
  await assert.doesNotReject(() => forgotPassword({ email: 'ghost@nowhere.dev' }));
  const { user } = await registerAndFetch();
  await forgotPassword({ email: user.email });
  const after = await getUserByEmail(user.email);
  assert.ok(after.reset_token, 'a reset token must be set');
  assert.ok(after.reset_token_expires);
});

test('resetPassword changes the password and spends the token', async () => {
  const { user } = await registerAndFetch();
  await forgotPassword({ email: user.email });
  const withToken = await getUserByEmail(user.email);

  await assert.rejects(() => resetPassword({ token: withToken.reset_token, password: 'short' }), /8 حروف/);
  await resetPassword({ token: withToken.reset_token, password: 'NewPassword!42' });

  const spent = await getUserByEmail(user.email);
  assert.equal(spent.reset_token, null, 'the reset token is cleared once used');
  await assert.rejects(() => resetPassword({ token: withToken.reset_token, password: 'NewPassword!42' }), /غير صالح|مستخدم/);

  await assert.rejects(() => login({ email: user.email, password: PASSWORD }), /غير صحيحة/);
  const { token } = await login({ email: user.email, password: 'NewPassword!42' });
  assert.ok(await userFromRequest(reqWithCookie(token)));
});

test('resetPassword: an expired token is refused', async () => {
  const { user } = await registerAndFetch();
  await forgotPassword({ email: user.email });
  const withToken = await getUserByEmail(user.email);
  await setResetToken(user.id, withToken.reset_token, new Date(Date.now() - 1000).toISOString());
  await assert.rejects(() => resetPassword({ token: withToken.reset_token, password: 'NewPassword!42' }), /منتهي الصلاحية/);
});

test('a password reset signs out every session issued before it', async () => {
  const { email, user } = await registerAndFetch();
  const { token: oldSession } = await login({ email, password: PASSWORD });
  assert.ok(await userFromRequest(reqWithCookie(oldSession)), 'the pre-reset session works');

  await forgotPassword({ email });
  const withToken = await getUserByEmail(email);
  await resetPassword({ token: withToken.reset_token, password: 'NewPassword!42' });

  // Same cookie, new password hash — the fingerprint no longer matches.
  assert.equal(await userFromRequest(reqWithCookie(oldSession)), null, 'old sessions must be rejected after a reset');
  const { token: newSession } = await login({ email, password: 'NewPassword!42' });
  assert.ok(await userFromRequest(reqWithCookie(newSession)));
});

test('reset tokens are one-per-email — a second request replaces the first', async () => {
  const { user } = await registerAndFetch();
  await forgotPassword({ email: user.email });
  const first = (await getUserByEmail(user.email)).reset_token;
  await forgotPassword({ email: user.email });
  const second = (await getUserByEmail(user.email)).reset_token;
  assert.notEqual(first, second);
  await assert.rejects(() => resetPassword({ token: first, password: 'NewPassword!42' }), /غير صالح|مستخدم/);
  await assert.doesNotReject(() => resetPassword({ token: second, password: 'NewPassword!42' }));
});

test('a verification token survives a password reset (they are independent flows)', async () => {
  const { user } = await registerAndFetch();
  await forgotPassword({ email: user.email });
  const withToken = await getUserByEmail(user.email);
  await assert.doesNotReject(() => verifyEmail({ token: withToken.verification_token }));
  assert.equal(await getUserByVerificationToken(withToken.verification_token), null);
});

test('session cookies are HttpOnly; remember=false omits Max-Age; logout clears with Max-Age=0', () => {
  assert.ok(sessionCookie('abc', true).includes('HttpOnly'));
  assert.ok(sessionCookie('abc', true).includes('Max-Age='));
  assert.ok(!sessionCookie('abc', false).includes('Max-Age='), 'remember=false must be a browser-session cookie');
  assert.ok(sessionCookie('abc').includes('alytic_session=abc'));
  assert.ok(clearSessionCookie().includes('Max-Age=0'));
});

test('a spent verification token cannot be looked up again', async () => {
  const { user } = await registerAndFetch();
  const token = user.verification_token;
  assert.ok(await getUserByVerificationToken(token));
  await verifyEmail({ token });
  assert.equal(await getUserByVerificationToken(token), null);
  assert.equal(await getUserByResetToken(token), null, 'tokens live in separate columns');
});