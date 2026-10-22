import test from 'node:test';
import assert from 'node:assert/strict';

import '../helpers/env.js';
import { testEmail } from '../helpers/test-database.js';

// Must be set before helpers/server.js's startServer() does its first
// (lazily deferred) import of src/api/server.js, which is what reads this
// into the tenancy registry's PLATFORM_ADMIN_EMAILS set.
const platformAdminEmail = testEmail('platform-admin');
process.env.ADMIN_EMAILS = platformAdminEmail;

import { startServer, request, registerUser, sessionFrom } from '../helpers/server.js';
import { setUserRole, createAnnouncement, deleteAnnouncement } from '../../src/db.js';

const ctx = await startServer();
const { baseUrl } = ctx;
test.after(() => ctx.close());

// registerUser() always runs the full register -> verify -> login cycle, but
// `register` is a silent no-op for an email that already has an account (see
// auth.js) and `markEmailVerified` clears verification_token_hash once
// consumed — so a second full registerUser() call for the same email would
// try to verify with the first, already-spent emailed token and fail. Several tests in
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

function windowAround(nowOffsetHours, spanHours) {
  const startsAt = new Date(Date.now() + (nowOffsetHours - spanHours / 2) * 3600_000).toISOString();
  const endsAt = new Date(Date.now() + (nowOffsetHours + spanHours / 2) * 3600_000).toISOString();
  return { startsAt, endsAt };
}

test('an announcement that has not started yet is not active', async () => {
  const row = await createAnnouncement({ title: 't', body: 'b', imageUrls: [], videoUrl: null, ...windowAround(5, 1) });
  const user = await registerUser(baseUrl);
  const res = await request(baseUrl, 'GET', '/api/announcements/active', { cookie: user.cookie });
  assert.equal(res.status, 200);
  assert.equal(res.body.announcement, null);
  await deleteAnnouncement(row.id);
});

test('an announcement that already ended is not active', async () => {
  const row = await createAnnouncement({ title: 't', body: 'b', imageUrls: [], videoUrl: null, ...windowAround(-5, 1) });
  const user = await registerUser(baseUrl);
  const res = await request(baseUrl, 'GET', '/api/announcements/active', { cookie: user.cookie });
  assert.equal(res.body.announcement, null);
  await deleteAnnouncement(row.id);
});

test('an announcement whose window covers now is active, until dismissed', async () => {
  const row = await createAnnouncement({ title: 'ميزة', body: 'شرح', imageUrls: ['https://example.com/a.png'], videoUrl: null, ...windowAround(0, 2) });
  const user = await registerUser(baseUrl);

  const before = await request(baseUrl, 'GET', '/api/announcements/active', { cookie: user.cookie });
  assert.equal(before.body.announcement.id, row.id);
  assert.deepEqual(before.body.announcement.imageUrls, ['https://example.com/a.png']);

  const dismiss = await request(baseUrl, 'POST', `/api/announcements/${row.id}/dismiss`, { cookie: user.cookie });
  assert.equal(dismiss.status, 200);

  const after = await request(baseUrl, 'GET', '/api/announcements/active', { cookie: user.cookie });
  assert.equal(after.body.announcement, null);

  await deleteAnnouncement(row.id);
});

test('dismissing is idempotent and only hides the announcement for that one account', async () => {
  const row = await createAnnouncement({ title: 't', body: 'b', imageUrls: [], videoUrl: null, ...windowAround(0, 2) });
  const u1 = await registerUser(baseUrl);
  const u2 = await registerUser(baseUrl);

  await request(baseUrl, 'POST', `/api/announcements/${row.id}/dismiss`, { cookie: u1.cookie });
  await request(baseUrl, 'POST', `/api/announcements/${row.id}/dismiss`, { cookie: u1.cookie }); // second call must not error

  assert.equal((await request(baseUrl, 'GET', '/api/announcements/active', { cookie: u1.cookie })).body.announcement, null);
  assert.equal((await request(baseUrl, 'GET', '/api/announcements/active', { cookie: u2.cookie })).body.announcement.id, row.id);

  await deleteAnnouncement(row.id);
});

test('of two overlapping active announcements, the one with the later startsAt wins', async () => {
  const older = await createAnnouncement({ title: 'older', body: 'b', imageUrls: [], videoUrl: null, ...windowAround(0, 4) });
  const newer = await createAnnouncement({ title: 'newer', body: 'b', imageUrls: [], videoUrl: null, ...windowAround(0, 2) });
  const user = await registerUser(baseUrl);

  const res = await request(baseUrl, 'GET', '/api/announcements/active', { cookie: user.cookie });
  assert.equal(res.body.announcement.id, newer.id);

  await deleteAnnouncement(older.id);
  await deleteAnnouncement(newer.id);
});

test('an anonymous request to the public announcement endpoints is rejected', async () => {
  assert.equal((await request(baseUrl, 'GET', '/api/announcements/active')).status, 401);
});

test('a button needs both a label and a link, and the link must be an in-app path or https', async () => {
  const admin = await platformAdmin();
  const { startsAt, endsAt } = futureWindow();
  const post = (extra) => request(baseUrl, 'POST', '/api/admin/announcements', { cookie: admin.cookie, body: { title: 't', body: 'b', startsAt, endsAt, ...extra } });

  assert.equal((await post({ ctaLabel: 'اشترك' })).status, 400);
  assert.equal((await post({ ctaUrl: '/subscribe' })).status, 400);
  assert.equal((await post({ ctaLabel: 'اشترك', ctaUrl: 'javascript:alert(1)' })).status, 400);
  assert.equal((await post({ ctaLabel: 'اشترك', ctaUrl: '//evil.example.com' })).status, 400);
  assert.equal((await post({ audiences: ['vip'] })).status, 400);

  const ok = await post({ ctaLabel: ' اشترك دلوقتي ', ctaUrl: '/subscribe', audiences: ['trial_ending', 'expired'] });
  assert.equal(ok.status, 201, ok.text);
  assert.equal(ok.body.announcement.ctaLabel, 'اشترك دلوقتي');
  assert.equal(ok.body.announcement.ctaUrl, '/subscribe');
  assert.deepEqual(ok.body.announcement.audiences, ['trial_ending', 'expired']);
  await deleteAnnouncement(ok.body.announcement.id);
});

test('the active announcement carries its button, and is only shown to the targeted audience', async () => {
  // A brand-new, email-verified account is in the free trial, with days left.
  const row = await createAnnouncement({
    title: 'للمنتهي اشتراكهم', body: 'b', imageUrls: [], videoUrl: null,
    ctaLabel: 'جدّد', ctaUrl: '/subscribe', audiences: ['expired', 'never'], ...windowAround(0, 2),
  });
  const user = await registerUser(baseUrl);
  assert.equal((await request(baseUrl, 'GET', '/api/announcements/active', { cookie: user.cookie })).body.announcement, null);
  await deleteAnnouncement(row.id);

  const forTrial = await createAnnouncement({
    title: 'للتجربة', body: 'b', imageUrls: [], videoUrl: null,
    ctaLabel: 'اشترك', ctaUrl: '/subscribe', audiences: ['trial'], ...windowAround(0, 2),
  });
  const shown = await request(baseUrl, 'GET', '/api/announcements/active', { cookie: user.cookie });
  assert.equal(shown.body.announcement.id, forTrial.id);
  assert.deepEqual(shown.body.announcement.cta, { label: 'اشترك', url: '/subscribe' });
  await deleteAnnouncement(forTrial.id);
});

test('an announcement without a button or audiences still reaches everyone, with cta null', async () => {
  const row = await createAnnouncement({ title: 't', body: 'b', imageUrls: [], videoUrl: null, ...windowAround(0, 2) });
  const user = await registerUser(baseUrl);
  const res = await request(baseUrl, 'GET', '/api/announcements/active', { cookie: user.cookie });
  assert.equal(res.body.announcement.id, row.id);
  assert.equal(res.body.announcement.cta, null);
  await deleteAnnouncement(row.id);
});
