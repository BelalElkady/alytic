import crypto from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import {
  createUser,
  getUserByEmail,
  getUserById,
  getUserByGoogleId,
  getUserByVerificationToken,
  linkGoogleAccount,
  markEmailVerified,
  setVerificationToken,
  touchUserLogin,
} from './db.js';

const SESSION_COOKIE = 'alytic_session';
const SESSION_TTL = 1000 * 60 * 60 * 24 * 30;
const SESSION_SECRET = process.env.SESSION_SECRET ?? 'change-this-session-secret-in-env';

const VERIFICATION_TTL = 1000 * 60 * 60 * 24; // 24h
const APP_URL = process.env.APP_URL ?? process.env.FRONTEND_URL ?? 'http://localhost:8080';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? null;
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

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
    createdAt: user.created_at ?? user.createdAt,
    emailVerified: Boolean(user.email_verified ?? user.emailVerified),
    isAdmin: Boolean(user.is_admin ?? user.isAdmin),
  };
}

function encodeSession(userId) {
  const payload = Buffer.from(JSON.stringify({ sub: userId, exp: Date.now() + SESSION_TTL })).toString('base64url');
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

/**
 * Stands in for real email delivery. No SMTP/provider is wired up yet, so the
 * verification link is only logged server-side — swap this for an actual send
 * once one is configured, without touching any of the calling code below.
 */
function sendVerificationEmail(user, token) {
  const link = `${APP_URL}/verify-email?token=${token}`;
  console.log(`[auth] رابط تفعيل البريد لـ ${user.email}: ${link}`);
}

export async function register({ email, password, name }) {
  const normalized = String(email).trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(normalized)) throw new Error('اكتب بريد إلكتروني صحيح');
  if (String(password).length < 8) throw new Error('كلمة المرور لازم تكون 8 حروف على الأقل');
  if (getUserByEmail(normalized)) throw new Error('البريد الإلكتروني مسجل بالفعل');
  const { salt, hash } = await hashPassword(password);
  const token = makeVerificationToken();
  const user = {
    id: crypto.randomUUID(),
    email: normalized,
    name: String(name ?? '').trim().slice(0, 80),
    passwordSalt: salt,
    passwordHash: hash,
    verificationToken: token,
    verificationTokenExpires: new Date(Date.now() + VERIFICATION_TTL).toISOString(),
    createdAt: new Date().toISOString(),
  };
  createUser(user);
  sendVerificationEmail(user, token);
  return { user: publicUser(user), token: encodeSession(user.id) };
}

export async function login({ email, password }) {
  const normalized = String(email).trim().toLowerCase();
  const user = getUserByEmail(normalized);
  if (!user || !(await passwordMatches(password, user))) throw new Error('البريد الإلكتروني أو كلمة المرور غير صحيحة');
  touchUserLogin(user.id, new Date().toISOString());
  return { user: publicUser(user), token: encodeSession(user.id) };
}

/** Verifies a Google ID token and signs the matching Alytic user in, creating or linking an account as needed. */
export async function googleSignIn({ credential }) {
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
  let user = getUserByGoogleId(payload.sub);
  if (!user) {
    const existing = getUserByEmail(normalized);
    if (existing) {
      // Same email already has a password account — attach this Google
      // identity to it instead of creating a duplicate. Google has already
      // confirmed the address, so this also settles verification.
      linkGoogleAccount(existing.id, payload.sub);
      user = getUserById(existing.id);
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
        emailVerified: payload.email_verified ? 1 : 0,
        createdAt: new Date().toISOString(),
      };
      createUser(created);
      user = getUserById(created.id);
    }
  }

  touchUserLogin(user.id, new Date().toISOString());
  return { user: publicUser(user), token: encodeSession(user.id) };
}

export async function verifyEmail({ token }) {
  const user = token ? getUserByVerificationToken(String(token)) : null;
  if (!user) throw new Error('رابط التفعيل غير صالح أو مستخدم من قبل');
  if (user.verification_token_expires && new Date(user.verification_token_expires).getTime() < Date.now()) {
    throw new Error('رابط التفعيل منتهي الصلاحية، اطلب رابط جديد');
  }
  markEmailVerified(user.id);
  return { user: publicUser({ ...user, email_verified: 1 }) };
}

/** Always resolves quietly (no error, no indication whether the email exists) to avoid leaking registered addresses. */
export async function resendVerification({ email }) {
  const normalized = String(email ?? '').trim().toLowerCase();
  const user = getUserByEmail(normalized);
  if (!user || user.email_verified) return;
  const token = makeVerificationToken();
  const expiresAt = new Date(Date.now() + VERIFICATION_TTL).toISOString();
  setVerificationToken(user.id, token, expiresAt);
  sendVerificationEmail(user, token);
}

export async function userFromRequest(req) {
  const session = decodeSession(parseCookies(req.headers.cookie ?? '')[SESSION_COOKIE]);
  if (!session) return null;
  const user = getUserById(session.sub);
  return user ? publicUser(user) : null;
}

export function sessionCookie(token) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL / 1000}`;
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
