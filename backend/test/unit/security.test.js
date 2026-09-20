import test from 'node:test';
import assert from 'node:assert/strict';

import {
  safeEqual,
  securityHeaders,
  allowedOriginsFrom,
  originGuard,
  sniffImageType,
  mediaTypeOf,
  safeHttpsUrl,
  publicError,
  GENERIC_ERROR,
  isStockCode,
  isIsoDate,
} from '../../src/security.js';

// ---- safeEqual ---------------------------------------------------------------

test('safeEqual: equal secrets match, anything else does not', () => {
  assert.equal(safeEqual('s3cret-value-1234', 's3cret-value-1234'), true);
  assert.equal(safeEqual('s3cret-value-1234', 's3cret-value-1235'), false);
  assert.equal(safeEqual('short', 'a-much-longer-value'), false);
});

test('safeEqual: a missing or non-string secret never matches, even against itself', () => {
  assert.equal(safeEqual(undefined, undefined), false);
  assert.equal(safeEqual('', ''), false);
  assert.equal(safeEqual(null, 'x'), false);
  assert.equal(safeEqual(123, 123), false);
});

// ---- headers -----------------------------------------------------------------

function fakeRes() {
  const headers = {};
  return { headers, setHeader: (k, v) => { headers[k.toLowerCase()] = v; } };
}

test('securityHeaders: sets the baseline and calls next', () => {
  const res = fakeRes();
  let called = false;
  securityHeaders({}, res, () => { called = true; });
  assert.ok(called);
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.equal(res.headers['x-frame-options'], 'DENY');
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.match(res.headers['content-security-policy'], /default-src 'none'/);
});

// ---- origin guard --------------------------------------------------------------

function run(guard, { method = 'POST', origin, fetchSite } = {}) {
  const headers = {};
  if (origin !== undefined) headers.origin = origin;
  if (fetchSite) headers['sec-fetch-site'] = fetchSite;
  const req = { method, originalUrl: '/api/x?y=1', get: (name) => headers[name.toLowerCase()] };
  let status = null;
  let nextCalled = false;
  const res = { status(code) { status = code; return this; }, json() { return this; } };
  guard(req, res, () => { nextCalled = true; });
  return { status, nextCalled };
}

test('originGuard: same-site and configured origins may write; foreign origins may not', () => {
  const guard = originGuard({ allowedOrigins: ['https://app.example.com'], allowLocalhost: false });
  assert.equal(run(guard, { origin: 'https://app.example.com' }).nextCalled, true);
  assert.equal(run(guard, { origin: 'https://www.app.example.com' }).nextCalled, true, 'www twin of a configured origin');
  assert.equal(run(guard, { origin: 'https://egxpert.com' }).nextCalled, true, 'the production site is always allowed');
  const foreign = run(guard, { origin: 'https://evil.example' });
  assert.equal(foreign.nextCalled, false);
  assert.equal(foreign.status, 403);
  assert.equal(run(guard, { origin: 'null' }).status, 403, 'sandboxed iframes send Origin: null');
});

test('originGuard: reads pass, and so do writes with no Origin (curl, cron, server-side)', () => {
  const guard = originGuard({ allowedOrigins: [], allowLocalhost: false });
  assert.equal(run(guard, { method: 'GET', origin: 'https://evil.example' }).nextCalled, true);
  assert.equal(run(guard, {}).nextCalled, true);
});

test('originGuard: a write the browser itself labels cross-site is refused even without Origin', () => {
  const guard = originGuard({ allowedOrigins: [], allowLocalhost: false });
  assert.equal(run(guard, { fetchSite: 'cross-site' }).status, 403);
  assert.equal(run(guard, { fetchSite: 'same-origin' }).nextCalled, true);
});

test('originGuard: localhost is allowed only when asked (dev), never in production mode', () => {
  const dev = originGuard({ allowedOrigins: [], allowLocalhost: true });
  const prod = originGuard({ allowedOrigins: [], allowLocalhost: false });
  assert.equal(run(dev, { origin: 'http://localhost:8181' }).nextCalled, true);
  assert.equal(run(dev, { origin: 'http://127.0.0.1:8181' }).nextCalled, true);
  assert.equal(run(prod, { origin: 'http://localhost:8181' }).status, 403);
});

test('allowedOriginsFrom: ignores junk and adds the www/apex twin', () => {
  const set = allowedOriginsFrom(['https://example.org/some/path', 'not a url', undefined, 'javascript:alert(1)']);
  assert.ok(set.has('https://example.org'));
  assert.ok(set.has('https://www.example.org'));
  assert.ok(![...set].some((o) => o.startsWith('javascript')));
});

// ---- uploads -----------------------------------------------------------------

const pad = (bytes) => Buffer.concat([Buffer.from(bytes), Buffer.alloc(16)]);

test('sniffImageType: recognises JPEG, PNG and WebP by their bytes', () => {
  assert.equal(sniffImageType(pad([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
  assert.equal(sniffImageType(pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'image/png');
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 2, 3, 4]), Buffer.from('WEBP'), Buffer.alloc(8)]);
  assert.equal(sniffImageType(webp), 'image/webp');
});

test('sniffImageType: SVG, HTML, scripts and short buffers are not images', () => {
  assert.equal(sniffImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')), null);
  assert.equal(sniffImageType(Buffer.from('<!doctype html><script>alert(1)</script>')), null);
  assert.equal(sniffImageType(Buffer.from([0xff, 0xd8])), null);
  assert.equal(sniffImageType('not a buffer'), null);
});

test('mediaTypeOf: strips parameters and case', () => {
  assert.equal(mediaTypeOf('Image/PNG; charset=binary'), 'image/png');
  assert.equal(mediaTypeOf(undefined), '');
});

// ---- URLs ----------------------------------------------------------------------

test('safeHttpsUrl: only https URLs pass', () => {
  assert.equal(safeHttpsUrl('https://images.unsplash.com/photo-1?w=800'), 'https://images.unsplash.com/photo-1?w=800');
  assert.equal(safeHttpsUrl('http://example.com/a.png'), null);
  assert.equal(safeHttpsUrl('javascript:alert(1)'), null);
  assert.equal(safeHttpsUrl('data:image/png;base64,AAAA'), null);
  assert.equal(safeHttpsUrl('//example.com/a.png'), null);
  assert.equal(safeHttpsUrl(null), null);
  assert.equal(safeHttpsUrl(`https://example.com/${'a'.repeat(3000)}`), null, 'over the length cap');
});

// ---- error exposure ------------------------------------------------------------

test('publicError: the app\'s own Arabic messages are shown', () => {
  assert.deepEqual(publicError(new Error('اكتب بريد إلكتروني صحيح')), { status: 500, message: 'اكتب بريد إلكتروني صحيح' });
});

test('publicError: internal errors are replaced with a generic message', () => {
  for (const err of [
    new Error('getUserById: relation "users" does not exist'),
    new Error('connect ECONNREFUSED 127.0.0.1:5432'),
    new TypeError('Cannot read properties of undefined'),
    Object.assign(new Error('تعذر الاتصال'), { code: 'ECONNRESET' }),
    new Error('تعذر جلب البيانات من https://internal.example/secret'),
  ]) {
    assert.equal(publicError(err).message, GENERIC_ERROR, err.message);
  }
});

test('publicError: client-caused body-parser errors keep their 4xx status', () => {
  const tooBig = Object.assign(new Error('request entity too large'), { status: 413, expose: true, type: 'entity.too.large' });
  assert.equal(publicError(tooBig).status, 413);
  const badJson = Object.assign(new SyntaxError('Unexpected token'), { status: 400, expose: true, type: 'entity.parse.failed' });
  assert.equal(publicError(badJson).status, 400);
});

test('publicError: an error may carry its own status and user message (login lockout)', () => {
  const locked = Object.assign(new Error('x'), { status: 429, expose: true, userMessage: 'استنى شوية' });
  assert.deepEqual(publicError(locked), { status: 429, message: 'استنى شوية' });
});

test('publicError: an upstream 4xx (e.g. a model provider) is not passed through as ours', () => {
  const upstream = Object.assign(new Error('429 Provider returned error'), { status: 429 });
  assert.equal(publicError(upstream).status, 500);
});

// ---- input shapes ------------------------------------------------------------

test('isStockCode: 2-10 letters/digits only', () => {
  assert.equal(isStockCode('COMI'), true);
  assert.equal(isStockCode('comi'), true);
  assert.equal(isStockCode('../../etc/passwd'), false);
  assert.equal(isStockCode('A'), false);
  assert.equal(isStockCode('ABCDEFGHIJK'), false);
  assert.equal(isStockCode({ toString: () => 'COMI' }), false);
});

test('isIsoDate: real calendar dates only', () => {
  assert.equal(isIsoDate('2026-09-21'), true);
  assert.equal(isIsoDate('2026-02-30'), false);
  assert.equal(isIsoDate('2026-9-1'), false);
  assert.equal(isIsoDate('__proto__'), false);
  assert.equal(isIsoDate(20260921), false);
});
