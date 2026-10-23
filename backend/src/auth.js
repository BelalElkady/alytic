import crypto from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import {
  DuplicateUserError,
  createUser,
  getUserByCanonicalEmail,
  getUserByEmail,
  getUserById,
  getSessionUser,
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
import { canonicalEmail } from './emailIdentity.js';
import { currentTenant } from './tenancy/context.js';
import { DEFAULT_TENANT_ID } from './tenancy/registry.js';

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
if (process.env.NODE_ENV === 'production' && process.env.SESSION_SECRET && process.env.SESSION_SECRET.length < 32) {
  console.warn('[security] SESSION_SECRET أقصر من 32 حرف — استخدم قيمة عشوائية أطول (openssl rand -hex 32). تغييرها بيسجّل خروج كل المستخدمين مرة واحدة.');
}
const SESSION_SECRET = process.env.SESSION_SECRET ?? 'change-this-session-secret-in-env';

const VERIFICATION_TTL = 1000 * 60 * 60 * 24; // 24h
const RESET_TTL = 1000 * 60 * 60; // 1h
const PLATFORM_APP_URL = process.env.APP_URL ?? process.env.FRONTEND_URL ?? 'http://localhost:8080';

// Every link in an email, and every brand word in a subject line, is the
// site the request came in on — see tenancy/registry.js.
const appUrl = () => currentTenant()?.appUrl ?? PLATFORM_APP_URL;
const brandName = () => currentTenant()?.brand?.name ?? 'EGXpert';
const tenantId = () => currentTenant()?.id ?? DEFAULT_TENANT_ID;

// A site can have its own Google OAuth client (its own consent-screen name).
// Without one it uses the platform's, which then needs that site's domain
// listed as an authorized JavaScript origin in Google Cloud.
const googleClients = new Map();
function googleClientFor() {
  const clientId = currentTenant()?.config?.googleClientId ?? process.env.GOOGLE_CLIENT_ID ?? null;
  if (!clientId) return null;
  if (!googleClients.has(clientId)) googleClients.set(clientId, new OAuth2Client(clientId));
  return { clientId, client: googleClients.get(clientId) };
}

// Emails that get is_admin=true the moment their account is first created
// (register or Google sign-in). For the original site that is ADMIN_EMAILS in
// .env; for a client site it is adminEmails in its tenant config, set from
// the platform panel. There is no UI for granting admin beyond this and
// scripts/make-admin.mjs on purpose.
const ENV_ADMIN_EMAILS = (process.env.ADMIN_EMAILS ?? 'belal.elkady4@gmail.com')
  .split(',')
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);
const isAdminEmail = (email) => (currentTenant()?.config?.adminEmails ?? ENV_ADMIN_EMAILS).includes(email);

// Same idea for marketers (read-only view of the users table): MARKETER_EMAILS
// for the original site, marketerEmails in the tenant config for a client site.
// An address that is also an admin address stays a plain admin.
const ENV_MARKETER_EMAILS = (process.env.MARKETER_EMAILS ?? '')
  .split(',')
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);
const isMarketerEmail = (email) =>
  !isAdminEmail(email) && (currentTenant()?.config?.marketerEmails ?? ENV_MARKETER_EMAILS).includes(email);

const PHONE_TAKEN_MESSAGE = 'رقم الموبايل ده مسجّل بحساب تاني. لو ده حسابك سجّل دخول بيه.';

/** One account per phone number — the strongest per-person signal we collect, since it can't be minted like an email alias. */
async function assertPhoneAvailable(phone, exceptUserId = null) {
  const owner = await getUserByPhone(phone);
  if (owner && owner.id !== exceptUserId) throw new Error(PHONE_TAKEN_MESSAGE);
}

// scrypt is deliberately expensive, so an unbounded password is a cheap way to
// burn server CPU; and anything that isn't a string must never reach it.
const MAX_PASSWORD_LENGTH = 128;
const MIN_PASSWORD_LENGTH = 8;
const PASSWORD_LENGTH_MESSAGE = 'كلمة المرور لازم تكون 8 حروف على الأقل ومتزيدش عن 128 حرف';
const isPasswordShapeOk = (password) => typeof password === 'string' && password.length <= MAX_PASSWORD_LENGTH;
const isPasswordLengthOk = (password) => isPasswordShapeOk(password) && password.length >= MIN_PASSWORD_LENGTH;

// Logging in as an address with no account used to return as soon as the
// lookup missed, while a real address then paid for a scrypt run — a
// measurable difference that tells an attacker which emails are registered.
// A miss now spends the same work against a throwaway salt/hash.
const DUMMY_SALT = crypto.randomBytes(16).toString('hex');
const DUMMY_HASH = crypto.randomBytes(64).toString('hex');

// Per-account brute-force throttle, on top of the per-IP limiter in server.js:
// that one is defeated by rotating addresses, this one follows the *target*.
// Failed attempts only; a success clears the count. In-memory on purpose — this
// is one process behind nginx — so a restart forgets it, which is acceptable
// for a throttle. Keyed by canonical email so dotted/+tag spellings of one
// mailbox share a counter.
const LOGIN_FAILURE_LIMIT = 10;
const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;
const failedLogins = new Map(); // key -> { count, since }
const TOO_MANY_ATTEMPTS = 'محاولات دخول كتير على الحساب ده — استنى 15 دقيقة أو استخدم "نسيت كلمة السر".';
const tooManyAttempts = () => Object.assign(new Error(TOO_MANY_ATTEMPTS), { status: 429, expose: true, userMessage: TOO_MANY_ATTEMPTS });

function loginKey(email) {
  return `${tenantId()}:${canonicalEmail(email) ?? email}`;
}
function loginLocked(key, now = Date.now()) {
  const entry = failedLogins.get(key);
  if (!entry) return false;
  if (now - entry.since > LOGIN_FAILURE_WINDOW_MS) {
    failedLogins.delete(key);
    return false;
  }
  return entry.count >= LOGIN_FAILURE_LIMIT;
}
function noteLoginFailure(key, now = Date.now()) {
  const entry = failedLogins.get(key);
  if (!entry || now - entry.since > LOGIN_FAILURE_WINDOW_MS) failedLogins.set(key, { count: 1, since: now });
  else entry.count += 1;
  // Bounded: an attacker cycling through made-up addresses must not grow this forever.
  if (failedLogins.size > 50_000) {
    for (const [k, v] of failedLogins) if (now - v.since > LOGIN_FAILURE_WINDOW_MS) failedLogins.delete(k);
    if (failedLogins.size > 50_000) failedLogins.clear();
  }
}

// One mail per recipient per cooldown for the mails a stranger can trigger by
// typing someone else's address (verification, reset, "someone tried to
// register with your email"). The per-IP limiter doesn't stop a botnet from
// mail-bombing one inbox through this app.
const MAIL_COOLDOWN_MS = 2 * 60 * 1000;
const mailSentAt = new Map(); // `${kind}:${email}` -> ms
function mailAllowed(kind, email, now = Date.now()) {
  const key = `${tenantId()}:${kind}:${email}`;
  const last = mailSentAt.get(key);
  if (last && now - last < MAIL_COOLDOWN_MS) return false;
  mailSentAt.set(key, now);
  if (mailSentAt.size > 50_000) {
    for (const [k, at] of mailSentAt) if (now - at >= MAIL_COOLDOWN_MS) mailSentAt.delete(k);
    if (mailSentAt.size > 50_000) mailSentAt.clear();
  }
  return true;
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
    emailVerifiedAt: user.email_verified_at ?? user.emailVerifiedAt ?? null,
    isAdmin: Boolean(user.is_admin ?? user.isAdmin),
    isMarketer: Boolean(user.is_marketer ?? user.isMarketer),
    isSuspended: Boolean(user.is_suspended ?? user.isSuspended),
    suspensionMessage: user.suspension_message ?? user.suspensionMessage ?? null,
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
    JSON.stringify({ sub: userId, tn: tenantId(), exp: Date.now() + SESSION_TTL, pv: passwordFingerprint(passwordHash) }),
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
  const decode = (s) => {
    try { return decodeURIComponent(s); } catch { return s; }
  };
  return Object.fromEntries(header.split(';').map((part) => part.trim().split('=').map(decode)).filter(([key, value]) => key && value));
}

function makeVerificationToken() {
  return crypto.randomBytes(32).toString('hex');
}

/** Delivered over Resend's SMTP relay — see email.js. Never throws: a broken provider must not fail registration. */
async function sendVerificationEmail(user, token) {
  const link = `${appUrl()}/verify-email?token=${token}`;
  await sendEmail({ to: user.email, subject: `فعّل بريدك الإلكتروني في ${brandName()}`, html: verificationEmailHtml(link) });
}

function makeResetToken() {
  return crypto.randomBytes(32).toString('hex');
}

/** See sendVerificationEmail above. */
async function sendResetEmail(user, token) {
  const link = `${appUrl()}/reset-password?token=${token}`;
  await sendEmail({ to: user.email, subject: `إعادة تعيين كلمة السر في ${brandName()}`, html: resetPasswordEmailHtml(link) });
}

/** Sent once, right after a user's email is confirmed — see verifyEmail below. */
async function sendRegistrationConfirmedEmail(user) {
  await sendEmail({ to: user.email, subject: `حسابك في ${brandName()} جاهز`, html: registrationConfirmedEmailHtml(user.name, appUrl()) });
}

/**
 * Sent to the real owner instead of telling the requester the email is
 * taken — see register() below. Never throws, same as every other
 * transactional send.
 */
async function sendAlreadyRegisteredEmail(user) {
  await sendEmail({
    to: user.email,
    subject: `محاولة تسجيل حساب جديد بإيميلك في ${brandName()}`,
    html: alreadyRegisteredEmailHtml(user.name, appUrl()),
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
  if (normalized.length > 254 || !/^\S+@\S+\.\S+$/.test(normalized)) throw new Error('اكتب بريد إلكتروني صحيح');
  if (!isPasswordLengthOk(password)) throw new Error(PASSWORD_LENGTH_MESSAGE);
  if (isDisposableEmail(normalized)) throw new Error('البريد المؤقت مش مسموح — استخدم بريدك الشخصي');
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) throw new Error(INVALID_PHONE_MESSAGE);

  // Any spelling of an address that already has an account (m.e@gmail.com,
  // me+2@gmail.com, ...) is treated exactly like the same address: silent to
  // the caller, notice to the real owner — see canonicalEmail.
  const existing = (await getUserByEmail(normalized)) ?? (await getUserByCanonicalEmail(normalized));
  if (existing) {
    if (mailAllowed('exists', existing.email)) await sendAlreadyRegisteredEmail(existing);
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
    isAdmin: isAdminEmail(normalized),
    isMarketer: isMarketerEmail(normalized),
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
  const normalized = String(email ?? '').trim().toLowerCase();
  const BAD_CREDENTIALS = 'البريد الإلكتروني أو كلمة المرور غير صحيحة';
  if (!isPasswordShapeOk(password) || !normalized || normalized.length > 254) throw new Error(BAD_CREDENTIALS);
  const key = loginKey(normalized);
  if (loginLocked(key)) throw tooManyAttempts();
  const user = await getUserByEmail(normalized);
  const ok = user
    ? await passwordMatches(password, user)
    : (await passwordMatches(password, { password_salt: DUMMY_SALT, password_hash: DUMMY_HASH }), false);
  if (!ok) {
    noteLoginFailure(key);
    throw new Error(BAD_CREDENTIALS);
  }
  failedLogins.delete(key);
  await touchUserLogin(user.id, new Date().toISOString(), ip);
  return { user: publicUser(user), token: encodeSession(user.id, passwordHashOf(user)) };
}

/** Verifies a Google ID token and signs the matching Alytic user in, creating or linking an account as needed. */
export async function googleSignIn({ credential, ip }) {
  const google = googleClientFor();
  if (!google) throw new Error('تسجيل الدخول بجوجل غير مفعّل على الخادم');
  if (!credential) throw new Error('بيانات جوجل غير صالحة');

  let payload;
  try {
    const ticket = await google.client.verifyIdToken({ idToken: credential, audience: google.clientId });
    payload = ticket.getPayload();
  } catch {
    throw new Error('تعذر التحقق من حساب جوجل');
  }
  if (!payload?.email || !payload.sub) throw new Error('تعذر التحقق من حساب جوجل');
  // Google vouching for the token is not the same as Google vouching that the
  // holder owns the address; only an email_verified account may sign in or link.
  if (payload.email_verified !== true) throw new Error('بريد جوجل ده مش متأكد منه — أكّده من حساب جوجل الأول.');

  const normalized = payload.email.toLowerCase();
  let user = await getUserByGoogleId(payload.sub);
  if (!user) {
    const existing = await getUserByEmail(normalized);
    if (existing) {
      // Same email already has a password account — attach this Google
      // identity to it instead of creating a duplicate. Google has already
      // confirmed the address, so this also settles verification.
      //
      // If that password account was never email-verified, whoever created it
      // may not own the address (someone could have registered a victim's email
      // ahead of time, planning to inherit the account once the victim signs in
      // with Google). Its password and any pending links are discarded so only
      // the Google identity — which does prove ownership — can open it.
      if (!existing.email_verified) {
        const { salt, hash } = await hashPassword(crypto.randomBytes(32).toString('hex'));
        await setUserPassword(existing.id, { salt, hash });
        await setVerificationToken(existing.id, null, null);
      }
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
        emailVerified: true,
        isAdmin: isAdminEmail(normalized),
        isMarketer: isMarketerEmail(normalized),
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
  return { user: publicUser({ ...user, email_verified: true, email_verified_at: new Date().toISOString() }) };
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
  if (!mailAllowed('verify', user.email)) return;
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
  if (!mailAllowed('reset', user.email)) return;
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
  if (!isPasswordLengthOk(password)) throw new Error(PASSWORD_LENGTH_MESSAGE);
  const { salt, hash } = await hashPassword(password);
  await setUserPassword(user.id, { salt, hash });
}

export async function userFromRequest(req) {
  const session = decodeSession(parseCookies(req.headers.cookie ?? '')[SESSION_COOKIE]);
  if (!session) return null;
  // A session belongs to the site that issued it. Cookies are per domain so a
  // browser won't normally carry one across, but this makes a token copied
  // from one client's site worthless on another's, including for the 'local'
  // CLI user id that exists in every tenant database. Tokens from before
  // tenants existed carry no tn and belong to the default site.
  if ((session.tn ?? DEFAULT_TENANT_ID) !== tenantId()) return null;
  const user = await getSessionUser(session.sub);
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

/** Test hook: forgets the in-memory login-failure and mail-cooldown counters. */
export function resetThrottlesForTests() {
  failedLogins.clear();
  mailSentAt.clear();
}
