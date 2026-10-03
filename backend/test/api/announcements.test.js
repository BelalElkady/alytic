import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import '../helpers/env.js';

// Must be set before helpers/server.js's startServer() does its first
// (lazily deferred) import of src/api/server.js, which is what reads this
// into the tenancy registry's PLATFORM_ADMIN_EMAILS set.
const platformAdminEmail = `platform-admin-${crypto.randomUUID()}@test.local`;
process.env.ADMIN_EMAILS = platformAdminEmail;

import { startServer, request, registerUser, sessionFrom } from '../helpers/server.js';
import { setUserRole } from '../../src/db.js';

const ctx = await startServer();
const { baseUrl } = ctx;
test.after(() => ctx.close());

// registerUser() always runs the full register -> verify -> login cycle, but
// `register` is a silent no-op for an email that already has an account (see
// auth.js) and `markEmailVerified` clears verification_token once consumed —
// so a second full registerUser() call for the same email would try to
// verify with an already-spent (now null) token and fail. Several tests in
// this file share one fixed platform-admin email, so this memoizes the
// account: register+verify happens once, and later calls just log back in
// (login never re-checks email_verified — see auth.js).
let platformAdminAccount = null;
async function platformAdmin() {
  if (platformAdminAccount) {
    const login = await request(baseUrl, 'POST', '/api/auth/login', {
      body: { email: platformAdminEmail, password: 'Passw0rd!123' },
    });
    assert.equal(login.status, 200, `platform admin re-login failed: ${login.text}`);
    return { ...platformAdminAccount, cookie: sessionFrom(login.setCookies), raw: login };
  }
  const account = await registerUser(baseUrl, platformAdminEmail);
  await setUserRole(account.user.id, 'admin');
  platformAdminAccount = account;
  return account;
}

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

function futureWindow(hoursFromNow = 1, durationHours = 2) {
  const startsAt = new Date(Date.now() + hoursFromNow * 3600_000).toISOString();
  const endsAt = new Date(Date.now() + (hoursFromNow + durationHours) * 3600_000).toISOString();
  return { startsAt, endsAt };
}

test('a plain admin (not the platform-admin email) gets 403 from every /api/admin/announcements route', async () => {
  const other = await registerUser(baseUrl);
  await setUserRole(other.user.id, 'admin');
  const { startsAt, endsAt } = futureWindow();
  assert.equal((await request(baseUrl, 'GET', '/api/admin/announcements', { cookie: other.cookie })).status, 403);
  assert.equal(
    (await request(baseUrl, 'POST', '/api/admin/announcements', {
      cookie: other.cookie,
      body: { title: 't', body: 'b', startsAt, endsAt },
    })).status,
    403,
  );
});

test('an anonymous request gets 401', async () => {
  assert.equal((await request(baseUrl, 'GET', '/api/admin/announcements')).status, 401);
});

test('the platform admin can create, list, update and delete an announcement', async () => {
  const admin = await platformAdmin();
  const { startsAt, endsAt } = futureWindow();

  const created = await request(baseUrl, 'POST', '/api/admin/announcements', {
    cookie: admin.cookie,
    body: { title: 'ميزة جديدة', body: 'شرح الميزة', imageUrls: ['https://example.com/a.png'], videoUrl: 'https://youtu.be/dQw4w9WgXcQ', startsAt, endsAt },
  });
  assert.equal(created.status, 201, created.text);
  assert.equal(created.body.announcement.title, 'ميزة جديدة');
  assert.equal(created.body.announcement.videoUrl, 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
  const id = created.body.announcement.id;

  const listed = await request(baseUrl, 'GET', '/api/admin/announcements', { cookie: admin.cookie });
  assert.equal(listed.status, 200);
  assert.ok(listed.body.announcements.some((a) => a.id === id));

  const updated = await request(baseUrl, 'PUT', `/api/admin/announcements/${id}`, {
    cookie: admin.cookie,
    body: { title: 'عنوان معدّل', body: 'شرح معدّل', imageUrls: [], videoUrl: null, startsAt, endsAt },
  });
  assert.equal(updated.status, 200, updated.text);
  assert.equal(updated.body.announcement.title, 'عنوان معدّل');

  const deleted = await request(baseUrl, 'DELETE', `/api/admin/announcements/${id}`, { cookie: admin.cookie });
  assert.equal(deleted.status, 200);
  const listedAfter = await request(baseUrl, 'GET', '/api/admin/announcements', { cookie: admin.cookie });
  assert.ok(!listedAfter.body.announcements.some((a) => a.id === id));
});

test('creating an announcement rejects startsAt >= endsAt', async () => {
  const admin = await platformAdmin();
  const res = await request(baseUrl, 'POST', '/api/admin/announcements', {
    cookie: admin.cookie,
    body: { title: 't', body: 'b', startsAt: '2026-01-02T00:00:00Z', endsAt: '2026-01-01T00:00:00Z' },
  });
  assert.equal(res.status, 400);
});

test('creating an announcement rejects a video URL that is not YouTube/Vimeo', async () => {
  const admin = await platformAdmin();
  const { startsAt, endsAt } = futureWindow();
  const res = await request(baseUrl, 'POST', '/api/admin/announcements', {
    cookie: admin.cookie,
    body: { title: 't', body: 'b', videoUrl: 'https://evil.example.com/x', startsAt, endsAt },
  });
  assert.equal(res.status, 400);
});

test('the image upload endpoint stores a valid PNG and rejects non-image bytes', async () => {
  const admin = await platformAdmin();
  const ok = await fetch(`${baseUrl}/api/admin/announcements/image`, {
    method: 'POST',
    headers: { cookie: admin.cookie, 'content-type': 'image/png' },
    body: PNG_1PX,
  });
  assert.equal(ok.status, 201);
  const { url } = await ok.json();
  assert.match(url, /^https:\/\//);

  const bad = await fetch(`${baseUrl}/api/admin/announcements/image`, {
    method: 'POST',
    headers: { cookie: admin.cookie, 'content-type': 'image/png' },
    body: Buffer.from('not a real png'),
  });
  assert.equal(bad.status, 415);
});
