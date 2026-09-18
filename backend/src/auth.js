import crypto from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import {
  DuplicateUserError,
  createUser,
  getUserByCanonicalEmail,
  getUserByEmail,
  getUserById,
  getUserByGoogleId,
  getUserByPhone,
  getUserByResetToken,
  getUserByVerificationToken,
  linkGoogleAccount,
  markEmailVerified,
  setResetToken,
  setUserName,
  setUserPassword,
  setUserPhone,
  setVerificationToken,
  touchUserLogin,
} from './db.js';
import { sendEmail } from './email.js';
import { isDisposableEmail } from './emailIdentity.js';
import { INVALID_PHONE_MESSAGE, normalizePhone } from './phone.js';
import { verificationEmailHtml, resetPasswordEmailHtml, registrationConfirmedEmailHtml, alreadyRegisteredEmailHtml } from './emailTemplates.js';

const SESSION_COOKIE = 'alytic_session';
const SESSION_TTL = 1000 * 60 * 60 * 24 * 30;

// Every session cookie is an HMAC over this secret (see encodeSession/
// decodeSession below) — anyone who knows it can forge a valid session for
// any user id without ever knowing a password. The fallback below is
// world-readable in this repo's own source, so it must never actually be
// used outside local dev: refuse to boot in production rather than silently
// signing tokens with a secret an attacker can read on GitHub.
if (!process.env.SESSION_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SESSION_SECRET غير مضبوط — لازم قيمة عشوائية طويلة في .env قبل تشغيل الإنتاج (مثلاً: openssl rand -hex 32)');
  }
  console.warn('[auth] SESSION_SECRET غير مضبوط — بيستخدم قيمة افتراضية غير آمنة (مقبول في التطوير المحلي بس، أبدًا في الإنتاج)');
}
const SESSION_SECRET = process.env.SESSION_SECRET ?? 'change-this-session-secret-in-env';

const VERIFICATION_TTL = 1000 * 60 * 60 * 24; // 24h
const RESET_TTL = 1000 * 60 * 60; // 1h
const APP_URL = process.env.APP_URL ?? process.env.FRONTEND_URL ?? 'http://localhost:8080';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? null;
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

// Emails that get is_admin=true the moment their account is first created
// (register or Google sign-in) — comma-separated in .env. There is no UI for
// granting admin beyond this and scripts/make-admin.mjs on purpose.
const ADMIN_EMAILS = new Set(
  (process.env.ADMIN_EMAILS ?? 'belal.elkady4@gmail.com')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),
);

const PHONE_TAKEN_MESSAGE = 'رقم الموبايل ده مسجّل بحساب تاني. لو ده حسابك سجّل دخول بيه.';

/** One account per phone number — the strongest per-person signal we collect, since it can't be minted like an email alias. */
async function assertPhoneAvailable(phone, exceptUserId = null) {
  const owner = await getUserByPhone(phone);
  if (owner && owner.id !== exceptUserId) throw new Error(PHONE_TAKEN_MESSAGE);
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, derived) => {
      if (err) reject(err);
      else resolve({ salt, hash: derived.toString('hex') });
    });
  });
}

async function passwordMatches(password, user) {
  const { hash } = await hashPassword(password, user.password_salt ?? user.passwordSalt);
  const expected = Buffer.from(user.password_hash ?? user.passwordHash, 'hex');
  const actual = Buffer.from(hash, 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    phone: user.phone ?? null,
    createdAt: user.created_at ?? user.createdAt,
    emailVerified: Boolean(user.email_verified ?? user.emailVerified),
    isAdmin: Boolean(user.is_admin ?? user.isAdmin),
  };
}

const passwordHashOf = (user) => user.password_hash ?? user.passwordHash;

// A short fingerprint of the current password hash, embedded in every
// session token and re-checked on every request (see userFromRequest). This
// is what makes a password reset actually invalidate sessions issued before
// it — otherwise the HMAC signature alone stays valid for the full 30-day
// TTL no matter how many times the password changes. Truncated: this only
// needs to detect "the password changed", never to verify or reveal it.
const passwordFingerprint = (passwordHash) =>
  crypto.createHash('sha256').update(String(passwordHash)).digest('hex').slice(0, 16);

function encodeSession(userId, passwordHash) {
  const payload = Buffer.from(
    JSON.stringify({ sub: userId, exp: Date.now() + SESSION_TTL, pv: passwordFingerprint(passwordHash) }),
  ).toString('base64url');
  const signature = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function decodeSession(value) {
  if (!value) return null;
  const [payload, signature] = value.split('.');
  if (!payload || !signature) return null;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return data.exp > Date.now() ? data : null;
  } catch { return null; }
}

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((part) => part.trim().split('=').map(decodeURIComponent)).filter(([key, value]) => key && value));
}

function makeVerificationToken() {
  return crypto.randomBytes(32).toString('hex');
}

/** Delivered over Resend's SMTP relay — see email.js. Never throws: a broken provider must not fail registration. */
async function sendVerificationEmail(user, token) {
  const link = `${APP_URL}/verify-email?token=${token}`;
  await sendEmail({ to: user.email, subject: 'فعّل بريدك الإلكتروني في EGXpert', html: verificationEmailHtml(link) });
}

function makeResetToken() {
  return crypto.randomBytes(32).toString('hex');
}

/** See sendVerificationEmail above. */
async function sendResetEmail(user, token) {
  const link = `${APP_URL}/reset-password?token=${token}`;
  await sendEmail({ to: user.email, subject: 'إعادة تعيين كلمة السر في EGXpert', html: resetPasswordEmailHtml(link) });
}

/** Sent once, right after a user's email is confirmed — see verifyEmail below. */
async function sendRegistrationConfirmedEmail(user) {
  await sendEmail({ to: user.email, subject: 'حسابك في EGXpert جاهز', html: registrationConfirmedEmailHtml(user.name, APP_URL) });
}

/**
 * Sent to the real owner instead of telling the requester the email is
 * taken — see register() below. Never throws, same as every other
 * transactional send.
 */
async function sendAlreadyRegisteredEmail(user) {
  await sendEmail({
    to: user.email,
    subject: 'محاولة تسجيل حساب جديد بإيميلك في EGXpert',
    html: alreadyRegisteredEmailHtml(user.name, APP_URL),
  });
}

/**
 * Registration never reveals whether an email is already taken — the same
 * discipline resendVerification/forgotPassword already apply. A brand-new
 * account gets the usual verification email; an existing one gets a notice
 * instead, and either way the caller sees an identical `{ }` result with no
 * session. This also means registration no longer logs the caller straight
 * in (it used to hand back a session token here) — the frontend now shows a
 * "check your email" screen and the user logs in afterward like anyone else.
 */
export async function register({ email, password, name, phone, ip }) {
  const normalized = String(email).trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(normalized)) throw new Error('اكتب بريد إلكتروني صحيح');
  if (String(password).length < 8) throw new Error('كلمة المرور لازم تكون 8 حروف على الأقل');
  if (isDisposableEmail(normalized)) throw new Error('البريد المؤقت مش مسموح — استخدم بريدك الشخصي');
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) throw new Error(INVALID_PHONE_MESSAGE);

  // Any spelling of an address that already has an account (m.e@gmail.com,
  // me+2@gmail.com, ...) is treated exactly like the same address: silent to
  // the caller, notice to the real owner — see canonicalEmail.
  const existing = (await getUserByEmail(normalized)) ?? (await getUserByCanonicalEmail(normalized));
  if (existing) {
    await sendAlreadyRegisteredEmail(existing);
    return;
  }
  await assertPhoneAvailable(normalizedPhone);

  const { salt, hash } = await hashPassword(password);
  const token = makeVerificationToken();
  const user = {
    id: crypto.randomUUID(),
    email: normalized,
    name: String(name ?? '').trim().slice(0, 80),
    phone: normalizedPhone,
    signupIp: ip,
    passwordSalt: salt,
    passwordHash: hash,
    isAdmin: ADMIN_EMAILS.has(normalized),
    verificationToken: token,
    verificationTokenExpires: new Date(Date.now() + VERIFICATION_TTL).toISOString(),
    createdAt: new Date().toISOString(),
  };
  try {
    await createUser(user);
  } catch (err) {
    // Two requests raced past the checks above and the unique index caught
    // the loser. Same outcomes as the pre-checks: phone is told, email is silent.
    if (err instanceof DuplicateUserError) {
      if (err.field === 'phone') throw new Error(PHONE_TAKEN_MESSAGE);
      return;
    }
    throw err;
  }
  await sendVerificationEmail(user, token);
}

export async function login({ email, password, ip }) {
  const normalized = String(email).trim().toLowerCase();
  const user = await getUserByEmail(normalized);
  if (!user || !(await passwordMatches(password, user))) throw new Error('البريد الإلكتروني أو كلمة المرور غير صحيحة');
  await touchUserLogin(user.id, new Date().toISOString(), ip);
  return { user: publicUser(user), token: encodeSession(user.id, passwordHashOf(user)) };
}

/** Verifies a Google ID token and signs the matching Alytic user in, creating or linking an account as needed. */
export async function googleSignIn({ credential, ip }) {
  if (!googleClient) throw new Error('تسجيل الدخول بجوجل غير مفعّل على الخادم');
  if (!credential) throw new Error('بيانات جوجل غير صالحة');

  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
    payload = ticket.getPayload();
  } catch {
    throw new Error('تعذر التحقق من حساب جوجل');
  }
  if (!payload?.email || !payload.sub) throw new Error('تعذر التحقق من حساب جوجل');

  const normalized = payload.email.toLowerCase();
  let user = await getUserByGoogleId(payload.sub);
  if (!user) {
    const existing = await getUserByEmail(normalized);
    if (existing) {
      // Same email already has a password account — attach this Google
      // identity to it instead of creating a duplicate. Google has already
      // confirmed the address, so this also settles verification.
      await linkGoogleAccount(existing.id, payload.sub);
      user = await getUserById(existing.id);
    } else if (await getUserByCanonicalEmail(normalized)) {
      // A different spelling of an address that already has an account
      // (dots, +tag, googlemail) — the same mailbox, so no second account.
      throw new Error('البريد ده مسجّل بالفعل بشكل تاني. سجّل دخول بالحساب الأصلي.');
    } else {
      // Google accounts never use the password path, but the column is
      // NOT NULL — fill it with a random value nobody is ever given.
      const { salt, hash } = await hashPassword(crypto.randomBytes(32).toString('hex'));
      const created = {
        id: crypto.randomUUID(),
        email: normalized,
        name: String(payload.name ?? '').trim().slice(0, 80),
        passwordSalt: salt,
        passwordHash: hash,
        googleId: payload.sub,
        signupIp: ip,
        emailVerified: Boolean(payload.email_verified),
        isAdmin: ADMIN_EMAILS.has(normalized),
        createdAt: new Date().toISOString(),
      };
      await createUser(created);
      user = await getUserById(created.id);
    }
  }

  await touchUserLogin(user.id, new Date().toISOString(), ip);
  return { user: publicUser(user), token: encodeSession(user.id, passwordHashOf(user)) };
}

export async function verifyEmail({ token }) {
  const user = token ? await getUserByVerificationToken(String(token)) : null;
  if (!user) throw new Error('رابط التفعيل غير صالح أو مستخدم من قبل');
  if (user.verification_token_expires && new Date(user.verification_token_expires).getTime() < Date.now()) {
    throw new Error('رابط التفعيل منتهي الصلاحية، اطلب رابط جديد');
  }
  await markEmailVerified(user.id);
  await sendRegistrationConfirmedEmail(user);
  return { user: publicUser({ ...user, email_verified: true }) };
}

/** Fills in the phone number for an already-signed-in user — the path a Google account (which never collects one) has to take to satisfy the same requirement as a normal registration. */
export async function updatePhone({ userId, phone }) {
  const normalized = normalizePhone(phone);
  if (!normalized) throw new Error(INVALID_PHONE_MESSAGE);
  await assertPhoneAvailable(normalized, userId);
  try {
    await setUserPhone(userId, normalized);
  } catch (err) {
    if (err instanceof DuplicateUserError) throw new Error(PHONE_TAKEN_MESSAGE);
    throw err;
  }
  const user = await getUserById(userId);
  return { user: publicUser(user) };
}

/** Lets a signed-in user correct their own display name from the profile page. */
export async function updateName({ userId, name }) {
  const trimmed = String(name ?? '').trim().slice(0, 100);
  if (!trimmed) throw new Error('اكتب اسم صحيح');
  await setUserName(userId, trimmed);
  const user = await getUserById(userId);
  return { user: publicUser(user) };
}

/** Always resolves quietly (no error, no indication whether the email exists) to avoid leaking registered addresses. */
export async function resendVerification({ email }) {
  const normalized = String(email ?? '').trim().toLowerCase();
  const user = await getUserByEmail(normalized);
  if (!user || user.email_verified) return;
  const token = makeVerificationToken();
  const expiresAt = new Date(Date.now() + VERIFICATION_TTL).toISOString();
  await setVerificationToken(user.id, token, expiresAt);
  await sendVerificationEmail(user, token);
}

/** Always resolves quietly (no error, no indication whether the email exists) to avoid leaking registered addresses. */
export async function forgotPassword({ email }) {
  const normalized = String(email ?? '').trim().toLowerCase();
  const user = await getUserByEmail(normalized);
  if (!user) return;
  const token = makeResetToken();
  const expiresAt = new Date(Date.now() + RESET_TTL).toISOString();
  await setResetToken(user.id, token, expiresAt);
  await sendResetEmail(user, token);
}

export async function resetPassword({ token, password }) {
  const user = token ? await getUserByResetToken(String(token)) : null;
  if (!user) throw new Error('رابط إعادة التعيين غير صالح أو مستخدم من قبل');
  if (user.reset_token_expires && new Date(user.reset_token_expires).getTime() < Date.now()) {
    throw new Error('رابط إعادة التعيين منتهي الصلاحية، اطلب رابط جديد');
  }
  if (String(password).length < 8) throw new Error('كلمة المرور لازم تكون 8 حروف على الأقل');
  const { salt, hash } = await hashPassword(password);
  await setUserPassword(user.id, { salt, hash });
}

export async function userFromRequest(req) {
  const session = decodeSession(parseCookies(req.headers.cookie ?? '')[SESSION_COOKIE]);
  if (!session) return null;
  const user = await getUserById(session.sub);
  if (!user) return null;
  // A token issued before the most recent password change carries the old
  // fingerprint and is rejected here — this is what makes reset-password
  // actually sign out every other session instead of leaving old cookies
  // valid for their full 30-day life.
  if (session.pv !== passwordFingerprint(passwordHashOf(user))) return null;
  return publicUser(user);
}

// Secure is conditional on NODE_ENV rather than always-on because local dev
// serves the frontend over plain http://localhost — a Secure cookie set
// there would never be sent back, breaking login outside production.
const COOKIE_SECURE = process.env.NODE_ENV === 'production' ? '; Secure' : '';

// remember=false omits Max-Age entirely, making it a browser session cookie
// — gone once the browser actually closes, rather than persisting the full
// 30 days. The token's own `exp` (see encodeSession) still caps it at 30
// days either way; this only controls how long the *cookie* sticks around.
export function sessionCookie(token, remember = true) {
  const maxAge = remember ? `; Max-Age=${SESSION_TTL / 1000}` : '';
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax${COOKIE_SECURE}${maxAge}`;
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax${COOKIE_SECURE}; Max-Age=0`;
}
