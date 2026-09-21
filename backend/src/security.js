/**
 * Cross-cutting security helpers for the API: response headers, cross-origin
 * write protection, constant-time secret comparison, upload sniffing, and the
 * rule for what an error is allowed to tell the client.
 *
 * Kept free of Express app state so each piece can be unit-tested on its own
 * (see test/unit/security.test.js) and reused by scripts.
 */

import crypto from 'node:crypto';

const IS_PROD = process.env.NODE_ENV === 'production';

/**
 * Constant-time string comparison for secrets (cron secrets, tokens). Both
 * sides are hashed first so the comparison runs over equal-length buffers and
 * a wrong-length guess doesn't return faster than a right-length one.
 */
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/**
 * Headers for every response this process sends. The API only ever returns
 * JSON (or a redirect), so the CSP forbids everything — if a response is ever
 * rendered as a document by mistake, nothing in it can run or load. The
 * frontend proxy copies these through to the browser for /api/* calls.
 *
 * `no-store` is the default because almost every /api response is per-user;
 * a handler that wants caching sets its own Cache-Control before responding.
 */
export function securityHeaders(_req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  res.setHeader('Cache-Control', 'no-store');
  next();
}

/** Origins the site is served from in production — always allowed, so a missing env var can't lock every visitor out. */
const KNOWN_SITE_ORIGINS = ['https://egxpert.com', 'https://www.egxpert.com'];

const originOf = (value) => {
  try {
    const url = new URL(String(value).trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : null;
  } catch {
    return null;
  }
};

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Builds the set of origins allowed to make state-changing requests, from the
 * configured site URLs. For each configured origin its www/apex twin is
 * allowed too.
 */
export function allowedOriginsFrom(values) {
  const set = new Set(KNOWN_SITE_ORIGINS);
  for (const value of values) {
    const origin = originOf(value);
    if (!origin) continue;
    set.add(origin);
    const url = new URL(origin);
    if (!LOCAL_HOSTS.has(url.hostname)) {
      const twin = url.hostname.startsWith('www.') ? url.hostname.slice(4) : `www.${url.hostname}`;
      set.add(`${url.protocol}//${twin}${url.port ? `:${url.port}` : ''}`);
    }
  }
  return set;
}

/**
 * Defense in depth on top of the SameSite=Lax session cookie: a browser
 * always sends Origin on a cross-origin write, so a write whose Origin is not
 * one of ours is refused before it reaches any handler. Requests with no
 * Origin at all (curl, the cron workflows, server-side fetches, the API test
 * suite) are not browser cross-site requests and pass — unless the browser
 * says via Sec-Fetch-Site that it is one.
 *
 * Outside production any localhost origin is allowed, so the dev server, the
 * Playwright run on its own port and preview tools keep working.
 *
 * isAllowed(req, origin) admits origins that aren't known up front — a
 * white-label site's own domain, which is added at runtime (see server.js).
 */
export function originGuard({ allowedOrigins, allowLocalhost = !IS_PROD, isAllowed = null } = {}) {
  const allowed = allowedOrigins instanceof Set ? allowedOrigins : allowedOriginsFrom(allowedOrigins ?? []);
  return (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    const raw = req.get('origin');
    if (raw === undefined) {
      if (req.get('sec-fetch-site') === 'cross-site') return refuse(req, res, 'cross-site');
      return next();
    }
    const origin = originOf(raw);
    if (origin && (allowed.has(origin) || isAllowed?.(req, origin) || (allowLocalhost && LOCAL_HOSTS.has(new URL(origin).hostname)))) return next();
    return refuse(req, res, raw);
  };
}

function refuse(req, res, what) {
  console.warn(`[security] blocked cross-origin ${req.method} ${req.originalUrl.split('?')[0]} (origin: ${what})`);
  res.status(403).json({ error: 'الطلب ده مش مسموح من الموقع اللي جاي منه' });
}

/**
 * Identifies an image by its first bytes. Upload endpoints trust neither the
 * Content-Type header nor the file name — a client can label anything as
 * image/png — so the declared type must agree with what the bytes actually are.
 */
export function sniffImageType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.toString('latin1', 0, 4) === 'RIFF' && buffer.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/** The bare media type of a Content-Type header ("image/png; charset=x" -> "image/png"). */
export const mediaTypeOf = (header) => String(header ?? '').split(';')[0].trim().toLowerCase();

/** Only an https URL is allowed through to links and image sources rendered on the public site. */
export function safeHttpsUrl(value, { maxLength = 2048 } = {}) {
  if (typeof value !== 'string' || value.length > maxLength) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * What a client may be told about a failure. Messages this app writes for
 * users are Arabic; anything else is an internal error (a database or network
 * failure, a TypeError) whose text can carry table names, file paths or
 * upstream details, so it is logged in full and replaced with a generic line.
 * Errors that already carry an HTTP status (body-parser: bad JSON, body too
 * large) keep it.
 */
export const GENERIC_ERROR = 'حصل خطأ في الخادم — جرّب تاني بعد شوية.';
const ARABIC = /[؀-ۿ]/;
const INTERNAL_MARKERS = /supabase|postgres|pgrst|relation |column |violates|ECONN|ENOTFOUND|ETIMEDOUT|ENOENT|EACCES|https?:\/\/|\bat \S+ \(|node_modules/i;

export function publicError(err) {
  // body-parser / http-errors mark client-caused failures with expose=true.
  const status = Number(err?.status ?? err?.statusCode);
  if (err?.expose === true && status === 413) return { status: 413, message: 'الطلب كبير أوي' };
  if (err?.expose === true && status >= 400 && status < 500) return { status, message: err.userMessage ?? 'الطلب غير صالح' };
  const message = String(err?.message ?? '');
  const isUserFacing = err?.name === 'Error' && !err.code && ARABIC.test(message) && !INTERNAL_MARKERS.test(message);
  return { status: 500, message: isUserFacing ? message : GENERIC_ERROR };
}

/** A stock ticker as this app spells them: 2-10 letters/digits. Checked before a code is used to build a path, a URL or a model prompt. */
const STOCK_CODE = /^[A-Z0-9]{2,10}$/;
export const isStockCode = (value) => typeof value === 'string' && STOCK_CODE.test(value.toUpperCase().trim());

/** A YYYY-MM-DD calendar date that actually exists. */
export function isIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
