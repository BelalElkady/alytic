import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import '../helpers/env.js';

import {
  register, login, userFromRequest, verifyEmail, resendVerification,
  forgotPassword, resetPassword, sessionCookie, clearSessionCookie, updatePhone,
  resetThrottlesForTests,
} from '../../src/auth.js';
import {
  getUserByEmail, getUserByVerificationToken, getUserByResetToken,
  setVerificationToken, setResetToken,
} from '../../src/db.js';
import { tokenEmailedTo, uniqueEmail, uniquePhone } from '../helpers/server.js';

// Only used where the number is rejected before it is stored — anything that
// actually registers must use uniquePhone(), since phones are unique per account.
const PHONE = '01012345678';
const PASSWORD = 'Passw0rd!123';

const reqWithCookie = (token) => ({ headers: { cookie: token ? `alytic_session=${token}` : '' } });

/**
 * Register through the real engine and read the row back from Supabase, plus
 * the raw verification token from the emailed link (the row holds its hash).
 */
async function registerAndFetch(email = uniqueEmail(), phone = uniquePhone(), password = PASSWORD) {
  await register({ email, password, name: 'تجربة', phone });
  return { email, user: await getUserByEmail(email), token: await tokenEmailedTo(email, 'verify-email') };
}

/** Ask for a reset link and return the raw token it carries. */
async function requestReset(email) {
  await forgotPassword({ email });
  return tokenEmailedTo(email, 'reset-password');
}

const sha256 = (token) => crypto.createHash('sha256').update(token).digest('hex');

test('register validates email, password and phone', async () => {
  await assert.rejects(() => register({ email: 'not-an-email', password: PASSWORD, phone: PHONE }), /بريد/);
  await assert.rejects(() => register({ email: 'ok@x.dev', password: 'short', phone: PHONE }), /8 حروف/);
  await assert.rejects(() => register({ email: 'ok@x.dev', password: PASSWORD, phone: '12345' }), /رقم موبايل صحيح/);
  // No country code and not an Egyptian mobile: can't tell where it's from.
  await assert.rejects(() => register({ email: 'ok@x.dev', password: PASSWORD, phone: '0991234567' }), /رقم موبايل صحيح/);
  await assert.rejects(() => register({ email: 'ok@x.dev', password: PASSWORD, phone: '+20 22 345 6789' }), /رقم موبايل صحيح/);
  await assert.rejects(() => register({ email: 'ok@x.dev', password: PASSWORD }), /رقم موبايل صحيح/);
});

test('register stores every phone in E.164 — Egyptian spellings and numbers from other countries', async () => {
  // A fresh random tail per case: the numbers are stored, so they must be
  // unique across runs against the shared database.
  const digits = (count) => String(crypto.randomInt(10 ** count)).padStart(count, '0');
  const cases = [];
  for (const prefix of ['010', '011', '012', '015']) {
    let n = `${prefix}${digits(8)}`;
    cases.push([n, `+2${n}`]);
    n = `${prefix}${digits(8)}`;
    cases.push([`+20${n.slice(1)}`, `+2${n}`]);
    n = `${prefix}${digits(8)}`;
    cases.push([`0020${n.slice(1)}`, `+2${n}`]);
    n = `${prefix}${digits(8)}`;
    cases.push([`${prefix} ${n.slice(3, 7)} ${n.slice(7)}`, `+2${n}`]);
  }
  let tail = digits(8);
  cases.push([`+966 5${tail.slice(0, 1)} ${tail.slice(1, 4)} ${tail.slice(4)}`, `+9665${tail}`]);
  tail = digits(9);
  cases.push([`0044 7${tail}`, `+447${tail}`]);
  tail = digits(9);
  cases.push([`+1 (415) 5${tail.slice(0, 2)}-${tail.slice(2, 6)}`, `+14155${tail.slice(0, 6)}`]);
  for (const [raw, expected] of cases) {
    const email = uniqueEmail();
    await register({ email, password: PASSWORD, name: 'ه', phone: raw });
    const user = await getUserByEmail(email);
    assert.equal(user.phone, expected, `phone ${raw}`);
  }
});

test('register records the signup IP; login records the latest login IP', async () => {
  const email = uniqueEmail();
  await register({ email, password: PASSWORD, name: 'ه', phone: uniquePhone(), ip: '198.51.100.23' });
  const created = await getUserByEmail(email);
  assert.equal(created.signup_ip, '198.51.100.23');
  assert.equal(created.last_login_ip, null, 'registering is not a login');

  await login({ email, password: PASSWORD, ip: '203.0.113.9' });
  const after = await getUserByEmail(email);
  assert.equal(after.last_login_ip, '203.0.113.9');
  assert.equal(after.signup_ip, '198.51.100.23', 'the signup IP never changes');

  // A caller with no IP (a script) must not blank the stored one.
  await login({ email, password: PASSWORD });
  assert.equal((await getUserByEmail(email)).last_login_ip, '203.0.113.9');
});

test('register refuses a phone number that already has an account', async () => {
  const phone = uniquePhone();
  await registerAndFetch(uniqueEmail(), phone);
  // Same number in another spelling is still the same number.
  await assert.rejects(
    () => register({ email: uniqueEmail(), password: PASSWORD, name: 'تاني', phone: `+20${phone.slice(1)}` }),
    /مسجّل بحساب تاني/,
  );
});

test('updatePhone refuses another account\'s number but accepts your own', async () => {
  const { user: owner } = await registerAndFetch();
  const { user: other } = await registerAndFetch();
  await assert.rejects(() => updatePhone({ userId: other.id, phone: owner.phone }), /مسجّل بحساب تاني/);
  await assert.doesNotReject(() => updatePhone({ userId: owner.id, phone: owner.phone }));
});

test('register treats an alias of an existing email as that account', async () => {
  const [local, domain] = uniqueEmail().split('@');
  const { user } = await registerAndFetch(`${local}@${domain}`);
  await assert.doesNotReject(() =>
    register({ email: `${local}+again@${domain}`, password: PASSWORD, name: 'مكرر', phone: uniquePhone() }));
  assert.equal(await getUserByEmail(`${local}+again@${domain}`), null, 'no second account for the alias');
  const after = await getUserByEmail(`${local}@${domain}`);
  assert.equal(after.verification_token_hash, user.verification_token_hash, 'the original account is untouched');
});

test('register refuses disposable-mail addresses', async () => {
  await assert.rejects(
    () => register({ email: 'x@mailinator.com', password: PASSWORD, name: 'ه', phone: uniquePhone() }),
    /مؤقت/,
  );
});

test('register stores the account unverified with a verification token', async () => {
  const { user, token } = await registerAndFetch();
  assert.equal(user.email_verified, false);
  assert.ok(token, 'registration must email a verification token');
  assert.equal(user.verification_token, null, 'the raw token is never stored');
  assert.equal(user.verification_token_hash, sha256(token));
  assert.ok(user.verification_token_expires);
  assert.equal(user.is_admin, false);
});

test('register never reveals that an email is already taken', async () => {
  const { email, user } = await registerAndFetch();
  // Same email again: identical quiet result, no second row, no token rotation.
  await assert.doesNotReject(() => register({ email, password: PASSWORD, name: 'مكرر', phone: uniquePhone() }));
  const after = await getUserByEmail(email);
  assert.ok(after, 'the original account is untouched');
  assert.equal(after.id, user.id);
  assert.equal(after.verification_token_hash, user.verification_token_hash, 'the original token stays valid');
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
  const { user, token } = await registerAndFetch();
  const verified = await verifyEmail({ token });
  assert.equal(verified.user.emailVerified ?? verified.user.email_verified, true);
  const after = await getUserByEmail(user.email);
  assert.equal(after.verification_token_hash, null, 'the token is cleared once used');
  await assert.rejects(() => verifyEmail({ token }), /غير صالح|مستخدم/);
});

test('verifyEmail: an expired token is rejected with its own message', async () => {
  const { user, token } = await registerAndFetch();
  await setVerificationToken(user.id, token, new Date(Date.now() - 1000).toISOString());
  await assert.rejects(() => verifyEmail({ token }), /منتهي الصلاحية/);
});

test('resendVerification stays silent for unknown or verified emails and rotates otherwise', async () => {
  await assert.doesNotReject(() => resendVerification({ email: 'ghost@nowhere.dev' }));
  const { user, token } = await registerAndFetch();
  await verifyEmail({ token });
  await assert.doesNotReject(() => resendVerification({ email: user.email })); // verified → quiet no-op

  const { user: fresh, token: before } = await registerAndFetch();
  await resendVerification({ email: fresh.email });
  const after = await getUserByEmail(fresh.email);
  assert.notEqual(after.verification_token_hash, fresh.verification_token_hash, 'a resend must rotate the token');
  assert.notEqual(after.verification_token_hash, null);
  await assert.rejects(() => verifyEmail({ token: before }), /غير صالح|مستخدم/);
  await assert.doesNotReject(async () => verifyEmail({ token: await tokenEmailedTo(fresh.email, 'verify-email') }));
});

test('forgotPassword stays silent for unknown emails and issues a reset token for known ones', async () => {
  await assert.doesNotReject(() => forgotPassword({ email: 'ghost@nowhere.dev' }));
  const { user } = await registerAndFetch();
  const token = await requestReset(user.email);
  const after = await getUserByEmail(user.email);
  assert.ok(token, 'a reset link must be emailed');
  assert.equal(after.reset_token, null, 'the raw token is never stored');
  assert.equal(after.reset_token_hash, sha256(token));
  assert.ok(after.reset_token_expires);
});

test('resetPassword changes the password and spends the token', async () => {
  const { user } = await registerAndFetch();
  const token = await requestReset(user.email);

  await assert.rejects(() => resetPassword({ token, password: 'short' }), /8 حروف/);
  await resetPassword({ token, password: 'NewPassword!42' });

  const spent = await getUserByEmail(user.email);
  assert.equal(spent.reset_token_hash, null, 'the reset token is cleared once used');
  await assert.rejects(() => resetPassword({ token, password: 'NewPassword!42' }), /غير صالح|مستخدم/);

  await assert.rejects(() => login({ email: user.email, password: PASSWORD }), /غير صحيحة/);
  const { token: session } = await login({ email: user.email, password: 'NewPassword!42' });
  assert.ok(await userFromRequest(reqWithCookie(session)));
});

test('resetPassword: an expired token is refused', async () => {
  const { user } = await registerAndFetch();
  const token = await requestReset(user.email);
  await setResetToken(user.id, token, new Date(Date.now() - 1000).toISOString());
  await assert.rejects(() => resetPassword({ token, password: 'NewPassword!42' }), /منتهي الصلاحية/);
});

test('a password reset signs out every session issued before it', async () => {
  const { email, user } = await registerAndFetch();
  const { token: oldSession } = await login({ email, password: PASSWORD });
  assert.ok(await userFromRequest(reqWithCookie(oldSession)), 'the pre-reset session works');

  await resetPassword({ token: await requestReset(email), password: 'NewPassword!42' });

  // Same cookie, new password hash — the fingerprint no longer matches.
  assert.equal(await userFromRequest(reqWithCookie(oldSession)), null, 'old sessions must be rejected after a reset');
  const { token: newSession } = await login({ email, password: 'NewPassword!42' });
  assert.ok(await userFromRequest(reqWithCookie(newSession)));
});

test('a second reset request inside the mail cooldown is ignored, so one address cannot be mail-bombed', async () => {
  resetThrottlesForTests();
  const { user } = await registerAndFetch();
  await forgotPassword({ email: user.email });
  const first = (await getUserByEmail(user.email)).reset_token_hash;
  await forgotPassword({ email: user.email });
  const second = (await getUserByEmail(user.email)).reset_token_hash;
  assert.equal(second, first, 'no new token (and no new email) while the cooldown runs');
});

test('reset tokens are one-per-email — a second request replaces the first', async () => {
  resetThrottlesForTests();
  const { user } = await registerAndFetch();
  const first = await requestReset(user.email);
  resetThrottlesForTests(); // as if the cooldown had elapsed
  const second = await requestReset(user.email);
  assert.notEqual(first, second);
  await assert.rejects(() => resetPassword({ token: first, password: 'NewPassword!42' }), /غير صالح|مستخدم/);
  await assert.doesNotReject(() => resetPassword({ token: second, password: 'NewPassword!42' }));
});

test('login locks an account after repeated failures, whatever address they come from', async () => {
  resetThrottlesForTests();
  const { email } = await registerAndFetch();
  for (let i = 0; i < 10; i += 1) {
    await assert.rejects(() => login({ email, password: 'wrong-password', ip: `198.51.100.${i}` }), /غير صحيحة/);
  }
  // The right password is refused too while the lock is on, and the error says why.
  await assert.rejects(() => login({ email, password: PASSWORD }), (err) => err.status === 429 && /محاولات دخول كتير/.test(err.message));
  resetThrottlesForTests();
  await assert.doesNotReject(() => login({ email, password: PASSWORD }));
});

test('a successful login clears the failure count', async () => {
  resetThrottlesForTests();
  const { email } = await registerAndFetch();
  for (let i = 0; i < 9; i += 1) await assert.rejects(() => login({ email, password: 'wrong-password' }), /غير صحيحة/);
  await login({ email, password: PASSWORD });
  for (let i = 0; i < 9; i += 1) await assert.rejects(() => login({ email, password: 'wrong-password' }), /غير صحيحة/);
  await assert.doesNotReject(() => login({ email, password: PASSWORD }));
});

test('login and register refuse passwords that are not strings or are absurdly long', async () => {
  const { email } = await registerAndFetch();
  await assert.rejects(() => login({ email, password: { $ne: '' } }), /غير صحيحة/);
  await assert.rejects(() => login({ email, password: 'x'.repeat(5000) }), /غير صحيحة/);
  await assert.rejects(() => register({ email: uniqueEmail(), password: 'x'.repeat(129), phone: uniquePhone() }), /128/);
  await assert.rejects(() => register({ email: uniqueEmail(), password: ['12345678'], phone: uniquePhone() }), /8 حروف/);
});

test('an unknown address and a wrong password give the same error', async () => {
  const { email } = await registerAndFetch();
  const unknown = await login({ email: uniqueEmail(), password: PASSWORD }).catch((e) => e.message);
  const wrong = await login({ email, password: 'wrong-password' }).catch((e) => e.message);
  assert.equal(unknown, wrong);
});

test('a verification token survives a password reset (they are independent flows)', async () => {
  const { user, token } = await registerAndFetch();
  await forgotPassword({ email: user.email });
  await assert.doesNotReject(() => verifyEmail({ token }));
  assert.equal(await getUserByVerificationToken(token), null);
});

test('session cookies are HttpOnly; remember=false omits Max-Age; logout clears with Max-Age=0', () => {
  assert.ok(sessionCookie('abc', true).includes('HttpOnly'));
  assert.ok(sessionCookie('abc', true).includes('Max-Age='));
  assert.ok(!sessionCookie('abc', false).includes('Max-Age='), 'remember=false must be a browser-session cookie');
  assert.ok(sessionCookie('abc').includes('alytic_session=abc'));
  assert.ok(clearSessionCookie().includes('Max-Age=0'));
});

test('a spent verification token cannot be looked up again', async () => {
  const { token } = await registerAndFetch();
  assert.ok(await getUserByVerificationToken(token));
  await verifyEmail({ token });
  assert.equal(await getUserByVerificationToken(token), null);
  assert.equal(await getUserByResetToken(token), null, 'tokens live in separate columns');
});