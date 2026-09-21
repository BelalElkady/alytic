import '../helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { runWithTenant, currentTenant } from '../../src/tenancy/context.js';
import { encryptSecret, decryptSecret } from '../../src/tenancy/secrets.js';
import { normalizeHost, tenantForHost, defaultTenant, publicTenant, isPlatformAdmin, canEditIndices } from '../../src/tenancy/registry.js';
import { currentDb, platformDb } from '../../src/supabaseClient.js';
import { sanitizeBrand, sanitizeConfig } from '../../src/api/platform.js';

// ---- host resolution ----------------------------------------------------------

test('normalizeHost: case, port, www and URLs all fold onto the bare host', () => {
  assert.equal(normalizeHost('Example.COM'), 'example.com');
  assert.equal(normalizeHost('www.example.com:8080'), 'example.com');
  assert.equal(normalizeHost('https://www.example.com/path?q=1'), 'example.com');
  assert.equal(normalizeHost('a.example.com, proxy.internal'), 'a.example.com');
  assert.equal(normalizeHost(''), null);
  assert.equal(normalizeHost(undefined), null);
});

test('tenantForHost: loopback is always the default site', () => {
  assert.equal(tenantForHost('localhost:3000'), defaultTenant());
  assert.equal(tenantForHost('127.0.0.1'), defaultTenant());
});

// ---- per-request database -------------------------------------------------------

test('currentDb: follows the tenant context, and is the platform database outside one', async () => {
  assert.equal(currentDb(), platformDb);
  const fakeDb = { marker: 'tenant-db' };
  await runWithTenant({ id: 'clientx', db: fakeDb }, async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(currentTenant().id, 'clientx');
    assert.equal(currentDb(), fakeDb);
  });
  assert.equal(currentDb(), platformDb);
});

// ---- stored database keys -----------------------------------------------------------

test('secrets: a sealed key opens only with the same master key and untouched', () => {
  const previous = process.env.TENANT_SECRETS_KEY;
  try {
    process.env.TENANT_SECRETS_KEY = crypto.randomBytes(32).toString('hex');
    const sealed = encryptSecret('service-role-key-value');
    assert.notEqual(sealed, 'service-role-key-value');
    assert.equal(decryptSecret(sealed), 'service-role-key-value');

    const parts = sealed.split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    assert.throws(() => decryptSecret(parts.join('.')));

    const otherKey = crypto.randomBytes(32).toString('hex');
    process.env.TENANT_SECRETS_KEY = otherKey;
    assert.throws(() => decryptSecret(sealed));

    process.env.TENANT_SECRETS_KEY = 'too-short';
    assert.throws(() => encryptSecret('x'));
  } finally {
    if (previous === undefined) delete process.env.TENANT_SECRETS_KEY;
    else process.env.TENANT_SECRETS_KEY = previous;
  }
});

// ---- what the platform panel accepts ------------------------------------------------

test('sanitizeBrand: colors that could break out of the <style> block are refused', () => {
  assert.deepEqual(sanitizeBrand({ colors: { primary: 'oklch(0.5 0.2 150)', info: '#1d4ed8' } }).colors, {
    primary: 'oklch(0.5 0.2 150)',
    info: '#1d4ed8',
  });
  assert.throws(() => sanitizeBrand({ colors: { primary: 'red;}body{display:none' } }));
  assert.throws(() => sanitizeBrand({ colors: { primary: 'red</style><script>alert(1)</script>' } }));
  assert.throws(() => sanitizeBrand({ colors: { 'primary;x': 'red' } }));
});

test('sanitizeBrand: logo and favicon must be https or a site path', () => {
  assert.equal(sanitizeBrand({ logoUrl: '/brands/x/logo.svg' }).logoUrl, '/brands/x/logo.svg');
  assert.throws(() => sanitizeBrand({ logoUrl: 'javascript:alert(1)' }));
  assert.throws(() => sanitizeBrand({ logoUrl: 'http://example.com/logo.png' }));
  assert.throws(() => sanitizeBrand({ faviconUrl: '/../../etc/passwd' }));
});

test('sanitizeBrand: analytics IDs are format-checked, unknown fields dropped', () => {
  assert.throws(() => sanitizeBrand({ analytics: { gaId: "G-1234'); alert(1);//" } }));
  const brand = sanitizeBrand({ name: 'Client X', analytics: { gaId: 'G-ABC1234' }, script: '<script>' });
  assert.deepEqual(brand, { name: 'Client X', analytics: { gaId: 'G-ABC1234' } });
});

test('sanitizeConfig: sender, emails and prices are checked', () => {
  assert.equal(sanitizeConfig({ emailFrom: 'Client X <no-reply@clientx.com>' }).emailFrom, 'Client X <no-reply@clientx.com>');
  assert.throws(() => sanitizeConfig({ emailFrom: 'X <a@b.com>\r\nBcc: victim@example.com' }));
  assert.throws(() => sanitizeConfig({ adminEmails: ['not-an-email'] }));
  assert.throws(() => sanitizeConfig({ prices: { trader_monthly: -5 } }));
  assert.deepEqual(sanitizeConfig({ prices: { trader_monthly: '350' } }).prices, { trader_monthly: 350 });
});

// ---- what leaves the server -------------------------------------------------------------

test('publicTenant: no database, staff emails or payment details', () => {
  const view = publicTenant(defaultTenant());
  const text = JSON.stringify(view);
  assert.equal('db' in view, false);
  assert.equal('config' in view, false);
  assert.equal(text.includes('adminEmails'), false);
  assert.equal(text.includes('instapay'), false);
});

test('isPlatformAdmin: only a verified admin on the default site', () => {
  const email = (process.env.PLATFORM_ADMIN_EMAILS ?? process.env.ADMIN_EMAILS ?? 'belal.elkady4@gmail.com').split(',')[0].trim();
  const admin = { email, isAdmin: true, emailVerified: true };
  assert.equal(isPlatformAdmin(admin, defaultTenant()), true);
  assert.equal(isPlatformAdmin({ ...admin, emailVerified: false }, defaultTenant()), false);
  assert.equal(isPlatformAdmin({ ...admin, email: 'someone@else.com' }, defaultTenant()), false);
  assert.equal(isPlatformAdmin(admin, { ...defaultTenant(), isDefault: false }), false);
});

test('canEditIndices: any verified admin on the default site, nobody on a client site', () => {
  const admin = { email: 'someone@else.com', isAdmin: true, emailVerified: true };
  assert.equal(canEditIndices(admin, defaultTenant()), true);
  assert.equal(canEditIndices({ ...admin, emailVerified: false }, defaultTenant()), false);
  assert.equal(canEditIndices({ ...admin, isAdmin: false }, defaultTenant()), false);
  assert.equal(canEditIndices(admin, { ...defaultTenant(), isDefault: false }), false);
});
