#!/usr/bin/env node
/**
 * Security check for the Alytic / EGXpert repo and a deployed instance.
 *
 *   node scripts/security-check.mjs                          repo + configuration checks only
 *   node scripts/security-check.mjs https://egxpert.com      ...plus a live probe of the public site
 *   node scripts/security-check.mjs http://127.0.0.1:3000 --backend
 *                                                             probe the Express API directly
 *   --active   also fire a short burst of bad logins to confirm the rate limit trips
 *              (uses a made-up address; it will rate-limit YOUR address for ~15 min)
 *   --env-file <path>   configuration to audit (default: backend/.env when present)
 *
 * Exit status is 1 when any check FAILs, so it can gate a deploy. WARN means
 * "worth fixing"; INFO is context. The live probe is read-only apart from
 * --active and a handful of unauthenticated requests that are expected to be
 * refused (it never logs in and never sends a real credential).
 *
 * Only run the live probe against a site you own.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import tls from 'node:tls';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(HERE, '..');
const REPO = path.resolve(BACKEND, '..');

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const valueOf = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const targetArg = argv.find((a, i) => /^https?:\/\//i.test(a) && argv[i - 1] !== '--env-file');
const BACKEND_MODE = flag('--backend');
const ACTIVE = flag('--active');

// ---- reporting ---------------------------------------------------------------

const results = [];
const add = (status, area, name, detail = '') => results.push({ status, area, name, detail });
const pass = (area, name, detail) => add('PASS', area, name, detail);
const fail = (area, name, detail) => add('FAIL', area, name, detail);
const warn = (area, name, detail) => add('WARN', area, name, detail);
const info = (area, name, detail) => add('INFO', area, name, detail);

const color = process.stdout.isTTY
  ? { PASS: '\x1b[32m', FAIL: '\x1b[31m', WARN: '\x1b[33m', INFO: '\x1b[36m', reset: '\x1b[0m' }
  : { PASS: '', FAIL: '', WARN: '', INFO: '', reset: '' };

function report() {
  let area = '';
  for (const r of results) {
    if (r.area !== area) {
      area = r.area;
      console.log(`\n${area}`);
    }
    console.log(`  ${color[r.status]}${r.status}${color.reset}  ${r.name}${r.detail ? `\n        ${r.detail}` : ''}`);
  }
  const count = (s) => results.filter((r) => r.status === s).length;
  console.log(`\n${count('PASS')} passed, ${count('FAIL')} failed, ${count('WARN')} warnings, ${count('INFO')} notes`);
  process.exitCode = count('FAIL') > 0 ? 1 : 0;
}

// ---- repository checks ---------------------------------------------------------

const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');
const tryRead = (rel) => {
  try { return read(rel); } catch { return null; }
};

function trackedFiles() {
  try {
    return execFileSync('git', ['ls-files', '-z'], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      .split('\0').filter(Boolean);
  } catch {
    return null;
  }
}

const SECRET_PATTERNS = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ['OpenRouter key', /sk-or-v1-[A-Za-z0-9]{20,}/],
  ['Anthropic key', /sk-ant-[A-Za-z0-9_-]{20,}/],
  ['Resend key', /\bre_[A-Za-z0-9]{20,}\b/],
  ['JWT (e.g. a Supabase key)', /\beyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/],
];
const SKIP_SCAN = /(^|\/)(package-lock\.json|bun\.lock|universe\.generated\.json|.*\.(png|jpe?g|webp|ico|woff2?|xlsx?|gz|csv))$/i;

function checkRepo() {
  const area = 'Repository';
  const files = trackedFiles();
  if (!files) {
    warn(area, 'not a git checkout — skipped tracked-file checks');
    return;
  }

  const envFiles = files.filter((f) => /(^|\/)\.env(\.|$)/.test(f) && !/\.example$/.test(f));
  envFiles.length
    ? fail(area, 'environment files are committed', envFiles.join(', '))
    : pass(area, 'no .env file is tracked by git');

  const ignore = tryRead('.gitignore') ?? '';
  /^\.env\s*$/m.test(ignore) ? pass(area, '.env is git-ignored') : fail(area, '.env is not in .gitignore');

  const hits = [];
  for (const file of files) {
    if (SKIP_SCAN.test(file)) continue;
    let text;
    try { text = fs.readFileSync(path.join(REPO, file), 'utf8'); } catch { continue; }
    if (text.length > 2_000_000) continue;
    text.split(/\r?\n/).forEach((line, i) => {
      for (const [label, re] of SECRET_PATTERNS) {
        if (re.test(line)) hits.push(`${file}:${i + 1} (${label})`);
      }
    });
  }
  hits.length
    ? fail(area, 'possible secrets in tracked files', hits.slice(0, 10).join('\n        ') + (hits.length > 10 ? `\n        …and ${hits.length - 10} more` : ''))
    : pass(area, 'no secret-shaped strings in tracked files');
  info(area, 'history is not scanned', 'a secret removed from a file is still in git history — run gitleaks over the full history once, and rotate anything it finds');
}

/** Guards for the fixes this audit made, so a later refactor cannot silently undo them. */
function checkSourceGuards() {
  const area = 'Source guards';
  const server = tryRead('backend/src/api/server.js');
  if (!server) return warn(area, 'backend/src/api/server.js not found');

  const must = (name, ok, detail) => (ok ? pass(area, name) : fail(area, name, detail));
  must('routing is case-sensitive (paywall and admin gates cannot be dodged with /api/SCAN)', /app\.set\('case sensitive routing', true\)/.test(server), 'app.set(\'case sensitive routing\', true) is missing');
  must('security headers middleware is installed', /app\.use\(securityHeaders\)/.test(server));
  must('cross-origin write guard is installed', /app\.use\(originGuard\(/.test(server));
  must('no static file serving from the API process', !/express\.static\(/.test(server), 'express.static() is back');
  must('X-Powered-By is disabled', /app\.disable\('x-powered-by'\)/.test(server));
  must('cron secrets are compared in constant time', !/X-Cron-Secret'\)\s*[!=]==/.test(server), 'a cron secret is compared with === / !==');
  must('500 responses do not echo err.message', !/status\(500\)\.json\(\{\s*error:\s*err\.message/.test(server));
  must('admin gate requires a verified email', /isAdmin \|\| !req\.user\.emailVerified/.test(server));
  must('unknown tickers are refused before analysis', /if \(!lookup\(code\)\) return res\.status\(404\)/.test(server));

  const auth = tryRead('backend/src/auth.js') ?? '';
  must('session cookie is HttpOnly + SameSite', /HttpOnly; SameSite=(Lax|Strict)/.test(auth));
  must('session secret has no silent production fallback', /NODE_ENV === 'production'[\s\S]{0,200}throw new Error/.test(auth));
  must('Google sign-in requires email_verified', /payload\.email_verified !== true/.test(auth));

  const cache = tryRead('backend/src/data/cache.js') ?? '';
  must('price-cache file names are validated (no path traversal)', /SAFE_CACHE_KEY/.test(cache));

  const schema = tryRead('backend/supabase/schema.sql') ?? '';
  must('schema enables row level security', /enable row level security/i.test(schema));

  const proxy = tryRead('frontend/src/routes/api/public/$.ts') ?? '';
  must('frontend proxy refuses /api/cron', /api\\\/cron/.test(proxy));
}

// ---- configuration checks ------------------------------------------------------

function checkConfig() {
  const area = 'Configuration';
  const file = valueOf('--env-file') ?? path.join(BACKEND, '.env');
  let env = { ...process.env };
  if (fs.existsSync(file)) {
    env = { ...dotenv.parse(fs.readFileSync(file)), ...process.env };
    info(area, `auditing ${path.relative(REPO, file)} (values are never printed)`);
  } else {
    info(area, 'no backend/.env found — auditing the process environment only');
  }
  const production = env.NODE_ENV === 'production' || flag('--production');
  if (!production) info(area, 'not production (NODE_ENV≠production)', 'weak or missing values below are WARN, not FAIL; pass --production to audit as production');
  const bad = production ? fail : warn;

  const secret = env.SESSION_SECRET;
  if (!secret) bad(area, 'SESSION_SECRET is not set', 'sessions would be signed with a secret that is public in this repo');
  else if (secret.length < 32) bad(area, 'SESSION_SECRET is shorter than 32 characters', 'openssl rand -hex 32');
  else pass(area, 'SESSION_SECRET is set and long enough');

  const cron = ['BLOG_CRON_SECRET', 'STOP_PLAN_CRON_SECRET', 'DAILY_CLOSE_CRON_SECRET'];
  const values = cron.map((n) => env[n]).filter(Boolean);
  for (const name of cron) {
    if (!env[name]) info(area, `${name} is not set`, 'the endpoint stays closed (always 403) — fine if you do not use it');
    else if (env[name].length < 24) bad(area, `${name} is shorter than 24 characters`);
    else pass(area, `${name} is set and long enough`);
  }
  if (new Set(values).size !== values.length) bad(area, 'two cron secrets share the same value', 'each trigger should have its own secret');
  if (secret && values.includes(secret)) bad(area, 'a cron secret equals SESSION_SECRET');

  env.ADMIN_EMAILS
    ? pass(area, 'ADMIN_EMAILS is set explicitly')
    : warn(area, 'ADMIN_EMAILS is not set', 'the code falls back to a hard-coded address — make the admin list explicit');
  const front = env.FRONTEND_URL ?? env.APP_URL;
  if (!front) warn(area, 'FRONTEND_URL / APP_URL are not set');
  else if (production && !/^https:\/\//i.test(front)) fail(area, 'FRONTEND_URL / APP_URL is not https', 'emailed verification and reset links would be plain http');
  else pass(area, 'FRONTEND_URL / APP_URL look right');

  env.SUPABASE_SERVICE_ROLE_KEY
    ? pass(area, 'Supabase service-role key is set (server-side only)')
    : warn(area, 'SUPABASE_SERVICE_ROLE_KEY is not set');
  if (production && !env.RESEND_API_KEY) warn(area, 'RESEND_API_KEY is not set', 'verification and password-reset emails will not be delivered');
  if (env.E2E_SKIP_RATE_LIMITS === '1') bad(area, 'E2E_SKIP_RATE_LIMITS=1 disables every rate limiter', 'test-only flag — must not be set on a live server');
}

// ---- live probe ----------------------------------------------------------------

async function probe(url, opts = {}) {
  try {
    const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(20_000), ...opts });
    const text = await res.text().catch(() => '');
    return { res, text, status: res.status };
  } catch (error) {
    return { error };
  }
}

const jsonOf = (text) => {
  try { return JSON.parse(text); } catch { return null; }
};

async function checkTls(host, port) {
  const area = 'Transport';
  await new Promise((resolve) => {
    const socket = tls.connect({ host, port, servername: host, timeout: 10_000 }, () => {
      const cert = socket.getPeerCertificate();
      const days = Math.floor((new Date(cert.valid_to).getTime() - Date.now()) / 86_400_000);
      if (!socket.authorized) fail(area, 'TLS certificate is not trusted', String(socket.authorizationError));
      else if (days < 0) fail(area, 'TLS certificate has expired');
      else if (days < 14) warn(area, `TLS certificate expires in ${days} days`, 'check that certbot renewal is working');
      else pass(area, `TLS certificate is valid for ${days} more days`);
      const proto = socket.getProtocol();
      proto === 'TLSv1.3' || proto === 'TLSv1.2' ? pass(area, `negotiated ${proto}`) : fail(area, `negotiated ${proto}`, 'TLS 1.2 or newer is required');
      socket.end();
      resolve();
    });
    socket.on('error', (err) => { fail(area, 'TLS handshake failed', err.message); resolve(); });
    socket.on('timeout', () => { fail(area, 'TLS handshake timed out'); socket.destroy(); resolve(); });
  });
}

async function checkLive(base) {
  const url = new URL(base);
  const origin = url.origin;
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const api = BACKEND_MODE ? `${origin}/api` : `${origin}/api/public/api`;
  info('Target', `${origin} (${BACKEND_MODE ? 'Express API directly' : 'public site → proxy → API'})`);

  // -- transport
  if (url.protocol === 'https:') {
    await checkTls(url.hostname, Number(url.port) || 443);
    const plain = await probe(`http://${url.hostname}${url.pathname}`);
    if (plain.error) info('Transport', 'plain-http port did not answer', plain.error.message);
    else if ([301, 302, 307, 308].includes(plain.status) && /^https:/i.test(plain.res.headers.get('location') ?? '')) pass('Transport', 'http redirects to https');
    else warn('Transport', `http:// answered ${plain.status} without redirecting to https`);
  } else if (!local) {
    fail('Transport', 'site is served over plain http');
  }

  // -- headers on a page (or on the API when probing it directly)
  const page = await probe(BACKEND_MODE ? `${api}/health` : `${origin}/`);
  if (page.error) {
    fail('Headers', 'could not reach the target', page.error.message);
    return;
  }
  const h = (name) => page.res.headers.get(name);
  const need = (name, value, hint) => (value ? pass('Headers', `${name} is set`, hint ? undefined : String(value).slice(0, 80)) : fail('Headers', `${name} is missing`, hint));
  if (url.protocol === 'https:') need('Strict-Transport-Security', h('strict-transport-security'), 'tells browsers to refuse plain http for a year');
  need('X-Content-Type-Options', /nosniff/i.test(h('x-content-type-options') ?? '') ? 'nosniff' : '', 'must be "nosniff"');
  const csp = h('content-security-policy') ?? '';
  csp ? pass('Headers', 'Content-Security-Policy is set') : fail('Headers', 'Content-Security-Policy is missing');
  (h('x-frame-options') || /frame-ancestors/i.test(csp)) ? pass('Headers', 'clickjacking protection is set (X-Frame-Options / frame-ancestors)') : fail('Headers', 'nothing stops other sites framing this one');
  need('Referrer-Policy', h('referrer-policy'));
  need('Permissions-Policy', h('permissions-policy'));
  h('x-powered-by') ? fail('Headers', 'X-Powered-By reveals the framework', h('x-powered-by')) : pass('Headers', 'X-Powered-By is not sent');
  /\d/.test(h('server') ?? '') ? warn('Headers', 'Server header reveals a version', h('server')) : pass('Headers', 'Server header does not reveal a version');
  if (!BACKEND_MODE && !h('content-security-policy-report-only') && !/script-src/.test(csp)) {
    info('Headers', 'no script-src policy is enforced yet', 'a report-only policy is sent for tuning; promote it once the browser console shows no violations');
  }

  // -- API basics
  const me = await probe(`${api}/auth/me`);
  const meBody = jsonOf(me.text ?? '');
  me.status === 200 && meBody && meBody.user === null ? pass('API', 'anonymous /auth/me answers {user: null}') : fail('API', `/auth/me did not answer as expected (${me.status ?? me.error?.message})`);
  /no-store/i.test(me.res?.headers.get('cache-control') ?? '') ? pass('API', 'API responses are Cache-Control: no-store') : warn('API', 'API responses are cacheable', 'per-user JSON should be no-store');

  // -- everything behind login must refuse an anonymous caller
  const protectedGet = ['/portfolio', '/scan', '/analyze/COMI', '/quotes', '/settings', '/log', '/support/messages', '/review/status', '/fundamentals/COMI', '/market-analysis', '/history/COMI'];
  const leaked = [];
  for (const p of protectedGet) {
    const r = await probe(`${api}${p}`);
    if (r.error) continue;
    if (r.status !== 401) leaked.push(`${p} → ${r.status}`);
  }
  leaked.length ? fail('Access control', 'endpoints behind login answered an anonymous request', leaked.join('\n        ')) : pass('Access control', 'all user endpoints answer 401 to an anonymous caller');

  const variants = ['/SCAN', '/Scan?codes=COMI', '/Analyze/COMI', '/FUNDAMENTALS/COMI', '/Portfolio'];
  const slipped = [];
  for (const p of variants) {
    const r = await probe(`${api}${p}`);
    if (!r.error && ![401, 404].includes(r.status)) slipped.push(`${p} → ${r.status}`);
  }
  slipped.length ? fail('Access control', 'a different letter case gets past the login/paywall gate', slipped.join('\n        ')) : pass('Access control', 'letter-case variants of paid endpoints do not bypass the gates');

  const admin = [];
  for (const p of ['/admin/users', '/admin/indices', '/admin/blog-drafts', '/admin/support', '/admin/online']) {
    const r = await probe(`${api}${p}`);
    if (!r.error && ![401, 403].includes(r.status)) admin.push(`${p} → ${r.status}`);
  }
  admin.length ? fail('Access control', 'admin endpoints answered an anonymous request', admin.join('\n        ')) : pass('Access control', 'admin endpoints refuse anonymous callers');

  const cron = [];
  for (const p of ['/cron/daily-close', '/cron/blog-generate', '/cron/stop-plan-generate']) {
    const r = await probe(`${api}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    if (!r.error && ![403, 404].includes(r.status)) cron.push(`${p} → ${r.status}`);
  }
  cron.length ? fail('Access control', 'cron endpoints ran without the secret', cron.join('\n        ')) : pass('Access control', 'cron endpoints refuse a request with no secret');
  if (!BACKEND_MODE) {
    const r = await probe(`${api}/cron/daily-close`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    r.status === 404 ? pass('Access control', 'cron endpoints are not even reachable through the public site') : warn('Access control', `cron endpoint is reachable through the public site (${r.status})`, 'block /api/public/api/cron in nginx and the frontend proxy');
  }

  // -- cross-site writes and CORS
  const evil = 'https://evil.example';
  const cors = await probe(`${api}/auth/me`, { headers: { origin: evil } });
  const acao = cors.res?.headers.get('access-control-allow-origin');
  acao ? fail('Cross-origin', 'API sends CORS allow headers', `Access-Control-Allow-Origin: ${acao}`) : pass('Cross-origin', 'no CORS allow header is sent to a foreign origin');
  const forged = await probe(`${api}/auth/login`, { method: 'POST', headers: { origin: evil, 'content-type': 'application/json' }, body: JSON.stringify({ email: 'nobody@example.invalid', password: 'x' }) });
  forged.status === 403 ? pass('Cross-origin', 'a write from a foreign origin is refused (403)') : fail('Cross-origin', `a write from a foreign origin was not refused (${forged.status ?? forged.error?.message})`);

  // -- error handling
  const bad = await probe(`${api}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"email":' });
  const leakyBody = /node_modules|\bat .+\(.+:\d+:\d+\)|SyntaxError|<pre>/.test(bad.text ?? '');
  bad.status === 400 && !leakyBody && jsonOf(bad.text) ? pass('Errors', 'malformed JSON gets a clean JSON 400') : fail('Errors', 'malformed JSON did not get a clean JSON 400', `${bad.status ?? bad.error?.message} ${String(bad.text ?? '').slice(0, 120)}`);
  const missing = await probe(`${api}/definitely-not-a-route`);
  const missingLeaks = /Cannot GET|node_modules|<pre>/.test(missing.text ?? '');
  !missingLeaks && [401, 404].includes(missing.status) ? pass('Errors', 'unknown API path gives no framework error page') : warn('Errors', 'unknown API path answered with a framework error page', String(missing.text ?? '').slice(0, 100));

  // -- files that must never be served
  const paths = ['/.env', '/backend/.env', '/.git/config', '/.git/HEAD', '/package.json', '/backend/package.json', '/data/bars/COMI.json', '/backend/data/users.json', '/server.js'];
  const exposed = [];
  for (const p of paths) {
    const r = await probe(`${origin}${p}`);
    if (r.error) continue;
    const body = r.text ?? '';
    if (r.status === 200 && (/SUPABASE|SESSION_SECRET|API_KEY|\[core\]|ref: refs\/|"dependencies"|"bars"/.test(body))) exposed.push(`${p} → ${r.status}`);
  }
  exposed.length ? fail('Exposure', 'sensitive files are downloadable', exposed.join('\n        ')) : pass('Exposure', '.env, .git, package files and data files are not served');

  // -- optional: the rate limiter really trips
  if (ACTIVE) {
    const email = `security-check-${Date.now()}@example.invalid`;
    let tripped = false;
    for (let i = 0; i < 14 && !tripped; i += 1) {
      const r = await probe(`${api}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'wrong-password' }) });
      tripped = r.status === 429;
    }
    tripped ? pass('Rate limiting', 'repeated bad logins are throttled (429)') : fail('Rate limiting', '14 bad logins in a row were never throttled');
  } else {
    info('Rate limiting', 'not exercised', 'pass --active to fire a burst of bad logins (this rate-limits your own address for ~15 minutes)');
  }
}

// ---- run -----------------------------------------------------------------------

console.log('Alytic security check');
checkRepo();
checkSourceGuards();
checkConfig();
if (targetArg) await checkLive(targetArg);
else info('Live probe', 'skipped', 'pass a URL to probe a running site, e.g. node scripts/security-check.mjs https://egxpert.com');
report();
