import crypto from 'node:crypto';
import { createUser, getUserByEmail, getUserById, touchUserLogin } from './db.js';

const SESSION_COOKIE = 'alytic_session';
const SESSION_TTL = 1000 * 60 * 60 * 24 * 30;
const SESSION_SECRET = process.env.SESSION_SECRET ?? 'change-this-session-secret-in-env';

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
  return { id: user.id, email: user.email, name: user.name, createdAt: user.created_at ?? user.createdAt };
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

export async function register({ email, password, name }) {
  const normalized = String(email).trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(normalized)) throw new Error('اكتب بريد إلكتروني صحيح');
  if (String(password).length < 8) throw new Error('كلمة المرور لازم تكون 8 حروف على الأقل');
  if (getUserByEmail(normalized)) throw new Error('البريد الإلكتروني مسجل بالفعل');
  const { salt, hash } = await hashPassword(password);
  const user = { id: crypto.randomUUID(), email: normalized, name: String(name ?? '').trim().slice(0, 80), passwordSalt: salt, passwordHash: hash, createdAt: new Date().toISOString() };
  createUser(user);
  return { user: publicUser(user), token: encodeSession(user.id) };
}

export async function login({ email, password }) {
  const normalized = String(email).trim().toLowerCase();
  const user = getUserByEmail(normalized);
  if (!user || !(await passwordMatches(password, user))) throw new Error('البريد الإلكتروني أو كلمة المرور غير صحيحة');
  touchUserLogin(user.id, new Date().toISOString());
  return { user: publicUser(user), token: encodeSession(user.id) };
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
