# Feature Announcement Popup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the main site's admin publish a time-boxed feature announcement (title, text, screenshots, optional video) that shows once per account to every signed-in user, manageable from the admin panel.

**Architecture:** Two new tables (`feature_announcements`, `user_announcement_dismissals`) in the shared `backend/supabase/schema.sql`. Admin CRUD + image upload under `/api/admin/announcements`, gated by the existing `isPlatformAdmin` check (main site only — each white-label tenant has its own separate database, so this never reaches client sites). A public `GET /api/announcements/active` / `POST /api/announcements/:id/dismiss` pair, reachable by any signed-in user, picks the one row whose date range covers "now" and that the caller hasn't dismissed. The desk shell mounts a self-contained dialog that fetches the active announcement once and dismisses it on close.

**Tech Stack:** Express + Supabase (`backend/src/db.js`, `backend/src/api/server.js`), React + TanStack Router + shadcn `Dialog` (`frontend/src`), `node:test` (backend), Vitest + Testing Library (frontend).

**Spec:** `docs/superpowers/specs/2026-10-03-feature-announcement-popup-design.md`

## Global Constraints

- Admin write endpoints (`/api/admin/announcements*`) are gated by `isPlatformAdmin(req.user, req.tenant)` — the same function already used for `/api/platform/*`. Do not invent a new gate.
- `body` is plain text (paragraphs separated by a blank line) — never HTML, never the blog's rich-text/block format.
- `video_url` is stored already normalized to a known-safe embed URL (YouTube or Vimeo only); the frontend must never build an iframe `src` from unvalidated input.
- All new user-facing error strings are Arabic, matching the rest of `server.js`.
- Dismissal is server-side, keyed by `(user_id, announcement_id)`, so it survives across devices.
- Follow existing conventions exactly: `supabase.from(...)` (not `platformDb`) for these two tables — see Review Focus below for why.

## Review Focus

- **Two announcements with overlapping active windows.** A reasonable admin expects the most recently started one to win, not an arbitrary or oldest one. (Task 4 test: overlapping windows.)
- **An announcement whose window has just started or is about to end.** `starts_at`/`ends_at` are inclusive (`<=`/`>=`, not `<`/`>`); a reasonable admin expects it visible for the whole range they picked, not cut off one tick early. (Task 4 tests: not-yet-started / already-ended / currently-active windows.)
- **A non-platform-admin admin (regular site admin) hitting the new routes.** The users table already distinguishes "admin" from "platform admin" (`isPlatformAdminEmail`); a regular admin must get 403, not accidentally succeed. (Task 3 test.)
- **A video URL that isn't YouTube/Vimeo, or isn't https.** Since this ends up in an `<iframe src>` shown to every user, a bad or hostile URL must be rejected at write time, not sanitized at render time. (Task 2 unit tests; Task 3 test reusing the helper.)
- **A user who already dismissed the announcement reloading the page.** The whole point of server-side dismissal is that it must not reappear — including for a *different* still-active announcement's data leaking in by a loose query. (Task 4 test: dismiss hides it for that user, not for others.)

---

## Task 1: Schema migration

**Files:**
- Modify: `backend/supabase/schema.sql` (append after the `recommendation_prices` table at the end of the file)

**Interfaces:**
- Produces: tables `feature_announcements` and `user_announcement_dismissals`, used by every later task via `supabase.from(...)`.

- [ ] **Step 1: Append the migration**

```sql
-- A time-boxed "what's new" popup the main site's admin publishes for signed-in
-- users. Each tenant runs this same schema in its own database (see
-- tenancy/registry.js), but these two tables are only ever read/written
-- through isPlatformAdmin-gated routes, so a client tenant's copy stays
-- empty — see docs/superpowers/specs/2026-10-03-feature-announcement-popup-design.md.
create table if not exists feature_announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  image_urls jsonb not null default '[]'::jsonb,
  video_url text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_at timestamptz not null default now(),
  created_by text references users(id)
);
create index if not exists idx_feature_announcements_active_window
  on feature_announcements (starts_at, ends_at);

-- Per-account, so a dismissal survives across devices/browsers.
create table if not exists user_announcement_dismissals (
  user_id text not null references users(id) on delete cascade,
  announcement_id uuid not null references feature_announcements(id) on delete cascade,
  dismissed_at timestamptz not null default now(),
  primary key (user_id, announcement_id)
);
```

- [ ] **Step 2: Apply it to the Supabase project the backend tests and dev server use**

Run the appended block against the project named by `backend/.env`'s
`SUPABASE_URL` (Supabase SQL editor, or `psql`/`supabase db push` against that
connection string — whichever this repo's maintainer normally uses for
`schema.sql` changes). This is a prerequisite for every later task's tests,
which hit this real database.

- [ ] **Step 3: Verify**

In the Supabase SQL editor (or `psql`), run:
```sql
select count(*) from feature_announcements;
select count(*) from user_announcement_dismissals;
```
Expected: both return `0` with no error (tables exist, empty).

- [ ] **Step 4: Commit**

```bash
git add backend/supabase/schema.sql
git commit -m "feat: add feature_announcements and user_announcement_dismissals tables"
```

---

## Task 2: Video URL allow-list helper

**Files:**
- Create: `backend/src/announcementVideo.js`
- Test: `backend/test/unit/announcementVideo.test.js`

**Interfaces:**
- Produces: `normalizeAnnouncementVideoUrl(value: string): string | null` — returns a safe embeddable URL for a YouTube or Vimeo watch URL, or `null` for anything else (wrong host, wrong scheme, malformed, non-string).

- [ ] **Step 1: Write the failing tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAnnouncementVideoUrl } from '../../src/announcementVideo.js';

test('normalizeAnnouncementVideoUrl embeds a youtube.com watch URL', () => {
  assert.equal(
    normalizeAnnouncementVideoUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s'),
    'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
  );
});

test('normalizeAnnouncementVideoUrl embeds a youtu.be short URL', () => {
  assert.equal(
    normalizeAnnouncementVideoUrl('https://youtu.be/dQw4w9WgXcQ'),
    'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
  );
});

test('normalizeAnnouncementVideoUrl embeds a vimeo.com URL', () => {
  assert.equal(
    normalizeAnnouncementVideoUrl('https://vimeo.com/76979871'),
    'https://player.vimeo.com/video/76979871',
  );
});

test('normalizeAnnouncementVideoUrl rejects a non-https URL', () => {
  assert.equal(normalizeAnnouncementVideoUrl('http://www.youtube.com/watch?v=dQw4w9WgXcQ'), null);
});

test('normalizeAnnouncementVideoUrl rejects an unrelated host', () => {
  assert.equal(normalizeAnnouncementVideoUrl('https://evil.example.com/watch?v=dQw4w9WgXcQ'), null);
});

test('normalizeAnnouncementVideoUrl rejects non-string and empty input', () => {
  assert.equal(normalizeAnnouncementVideoUrl(''), null);
  assert.equal(normalizeAnnouncementVideoUrl(undefined), null);
  assert.equal(normalizeAnnouncementVideoUrl(null), null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test backend/test/unit/announcementVideo.test.js`
Expected: FAIL — `announcementVideo.js` does not exist.

- [ ] **Step 3: Implement `normalizeAnnouncementVideoUrl` in `backend/src/announcementVideo.js`**

Match against these https-only patterns, in order, returning the first
match's embed form; return `null` if none match:
- `https://(www.)?youtube.com/watch?...v=<11 chars>...` → `https://www.youtube-nocookie.com/embed/<id>`
- `https://youtu.be/<11 chars>` → `https://www.youtube-nocookie.com/embed/<id>`
- `https://(www.)?vimeo.com/<digits>` → `https://player.vimeo.com/video/<id>`

The id pattern is `[A-Za-z0-9_-]{11}` for YouTube and `\d+` for Vimeo. Guard
non-string input with a `typeof value !== 'string'` check before matching.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test backend/test/unit/announcementVideo.test.js`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/announcementVideo.js backend/test/unit/announcementVideo.test.js
git commit -m "feat: add YouTube/Vimeo URL allow-list helper for announcements"
```

---

## Task 3: Admin CRUD + image upload API

**Files:**
- Create: `backend/src/announcementImages.js`
- Modify: `backend/src/db.js` (add new functions near the existing blog-post functions, e.g. after `deleteBlogPost` around line 1007)
- Modify: `backend/src/api/server.js`:
  - line 24: add `listAnnouncements, createAnnouncement, updateAnnouncement, deleteAnnouncement` to the existing `db.js` import list
  - near line 53: add `import { uploadAnnouncementImage } from '../announcementImages.js';` and `import { normalizeAnnouncementVideoUrl } from '../announcementVideo.js';`
  - near line 952 (right after the `/api/admin/indices` gating block): add the `/api/admin/announcements` gating middleware and routes
- Test: `backend/test/api/announcements.test.js`

**Interfaces:**
- Consumes: `normalizeAnnouncementVideoUrl` (Task 2). `isPlatformAdmin(user, tenant)`, `safeHttpsUrl(value)`, `checkedImageType(req)`, `NOT_AN_IMAGE_MESSAGE`, `BLOG_IMAGE_TYPES`, `wrap(fn)` — all already imported/defined in `server.js`.
- Produces (for Task 4 and the frontend tasks):
  - `db.js`: `listAnnouncements(): Promise<Row[]>`, `createAnnouncement({ title, body, imageUrls, videoUrl, startsAt, endsAt, createdBy }): Promise<Row>`, `updateAnnouncement(id, { title, body, imageUrls, videoUrl, startsAt, endsAt }): Promise<Row | null>`, `deleteAnnouncement(id): Promise<void>`, where `Row` is the raw snake_case DB row.
  - JSON wire shape (camelCase), used by both admin and public views: `{ id, title, body, imageUrls, videoUrl, startsAt, endsAt, createdAt }`.
  - Routes: `GET/POST /api/admin/announcements`, `PUT/DELETE /api/admin/announcements/:id`, `POST /api/admin/announcements/image`.

- [ ] **Step 1: Write the failing tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import '../helpers/env.js';

// Must be set before helpers/server.js's startServer() does its first
// (lazily deferred) import of src/api/server.js, which is what reads this
// into the tenancy registry's PLATFORM_ADMIN_EMAILS set.
const platformAdminEmail = `platform-admin-${crypto.randomUUID()}@test.local`;
process.env.ADMIN_EMAILS = platformAdminEmail;

import { startServer, request, registerUser } from '../helpers/server.js';
import { setUserRole } from '../../src/db.js';

const ctx = await startServer();
const { baseUrl } = ctx;
test.after(() => ctx.close());

async function platformAdmin() {
  const account = await registerUser(baseUrl, platformAdminEmail);
  await setUserRole(account.user.id, 'admin');
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test backend/test/api/announcements.test.js`
Expected: FAIL — routes/functions don't exist yet.

- [ ] **Step 3: Implement `backend/src/announcementImages.js`**

Copy `backend/src/blogImages.js`'s structure exactly (bucket existence check,
`ensureBucket`, upload-and-return-public-URL), with `BUCKET = 'announcement-images'`
and the exported function named `uploadAnnouncementImage({ mediaType, buffer })`.
Reuse `BLOG_IMAGE_TYPES`/the same `EXT_BY_MEDIA_TYPE` map rather than
redefining the media-type list.

- [ ] **Step 4: Implement the `db.js` functions**

```js
export async function listAnnouncements() { /* select * from feature_announcements order by starts_at desc */ }
export async function createAnnouncement({ title, body, imageUrls, videoUrl, startsAt, endsAt, createdBy }) { /* insert ... .select('*').single() */ }
export async function updateAnnouncement(id, { title, body, imageUrls, videoUrl, startsAt, endsAt }) { /* update ... .eq('id', id).select('*').maybeSingle() */ }
export async function deleteAnnouncement(id) { /* delete ... .eq('id', id) */ }
```

Follow `listBlogPosts`/`insertManualBlogPost`/`updateBlogPost`/`deleteBlogPost`'s
exact error-handling idiom (`if (error) throw new Error('<fnName>: ' + error.message)`),
using `supabase.from('feature_announcements')` — not `platformDb` (see Global
Constraints: these tables are per-tenant-database like `blog_posts`, not
centrally shared like `index_overrides`).

- [ ] **Step 5: Implement the routes in `server.js`**

Add right after the `/api/admin/indices` gating block:

```js
app.use('/api/admin/announcements', (req, res, next) => {
  if (!isPlatformAdmin(req.user, req.tenant)) return res.status(403).json({ error: 'الميزة دي من الموقع الأساسي بس' });
  next();
});
```

A shared `toAdminAnnouncement(row)` mapper: `{ id: row.id, title: row.title, body: row.body, imageUrls: row.image_urls, videoUrl: row.video_url, startsAt: row.starts_at, endsAt: row.ends_at, createdAt: row.created_at }`.

Validation for `POST`/`PUT` (both share one body-validating helper):
- `title`, `body`: non-empty strings after `.trim()` → 400 `'العنوان مطلوب'` / `'النص مطلوب'`.
- `startsAt`, `endsAt`: `!Number.isNaN(Date.parse(...))` and `Date.parse(startsAt) < Date.parse(endsAt)` → 400 `'تاريخ البداية لازم يكون قبل النهاية'`.
- `imageUrls`: if present, must be an array, each entry passing `safeHttpsUrl` → 400 `'رابط صورة غير صالح'`; cap at 6 entries → 400 if more.
- `videoUrl`: if present and non-empty, run through `normalizeAnnouncementVideoUrl`; if that returns `null` → 400 `'رابط الفيديو لازم يكون من يوتيوب أو فيميو'`. Store the normalized value, not the input.

`GET` returns `{ announcements: rows.map(toAdminAnnouncement) }`. `POST`
returns `201 { announcement: toAdminAnnouncement(created) }`. `PUT` returns
`200 { announcement: toAdminAnnouncement(updated) }` (404 if `updated` is
null). `DELETE` calls `deleteAnnouncement` and returns `{ ok: true }`.

`POST /api/admin/announcements/image` mirrors the existing
`/api/admin/blog-drafts/image` handler exactly (`express.raw({ type:
BLOG_IMAGE_TYPES, limit: '8mb' })`, `checkedImageType`, `NOT_AN_IMAGE_MESSAGE`),
calling `uploadAnnouncementImage` instead of `uploadBlogImage`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test backend/test/api/announcements.test.js`
Expected: PASS (6 tests)

- [ ] **Step 7: Commit**

```bash
git add backend/src/announcementImages.js backend/src/db.js backend/src/api/server.js backend/test/api/announcements.test.js
git commit -m "feat: add admin CRUD and image upload API for feature announcements"
```

---

## Task 4: Public active-announcement and dismiss API

**Files:**
- Modify: `backend/src/db.js` (add two more functions next to Task 3's)
- Modify: `backend/src/api/server.js`:
  - line 24: add `getActiveAnnouncementForUser, dismissAnnouncement` to the existing `db.js` import list (alongside Task 3's additions)
  - add two routes right after the `/api/presence` handler, since both are simple signed-in-user endpoints with no admin gating
- Modify: `backend/test/api/announcements.test.js` (append tests)

**Interfaces:**
- Consumes: Task 3's `createAnnouncement`/`deleteAnnouncement` (for test setup/teardown) and `toAdminAnnouncement`-style mapping idiom.
- Produces: `db.js`: `getActiveAnnouncementForUser(userId: string): Promise<Row | null>`, `dismissAnnouncement(userId: string, announcementId: string): Promise<void>`. Routes: `GET /api/announcements/active` → `{ announcement: { id, title, body, imageUrls, videoUrl } | null }`; `POST /api/announcements/:id/dismiss` → `{ ok: true }`.

- [ ] **Step 1: Write the failing tests**

Append to `backend/test/api/announcements.test.js`:

```js
import { createAnnouncement, deleteAnnouncement } from '../../src/db.js';

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test backend/test/api/announcements.test.js`
Expected: the five new tests FAIL (route/functions missing); the Task 3 tests still PASS.

- [ ] **Step 3: Implement the `db.js` functions**

```js
export async function getActiveAnnouncementForUser(userId) {
  // Promise.all: candidates = feature_announcements where starts_at <= now <= ends_at,
  // ordered by starts_at desc; dismissed = user_announcement_dismissals.announcement_id
  // for this userId. Return the first candidate whose id is not in the dismissed set,
  // or null.
}

export async function dismissAnnouncement(userId, announcementId) {
  // upsert { user_id: userId, announcement_id: announcementId, dismissed_at: now }
  // onConflict: 'user_id,announcement_id' — idempotent by construction.
}
```

- [ ] **Step 4: Implement the routes in `server.js`**

```js
app.get('/api/announcements/active', wrap(async (req, res) => {
  const row = await getActiveAnnouncementForUser(req.user.id);
  res.json({ announcement: row ? { id: row.id, title: row.title, body: row.body, imageUrls: row.image_urls, videoUrl: row.video_url } : null });
}));

app.post('/api/announcements/:id/dismiss', wrap(async (req, res) => {
  await dismissAnnouncement(req.user.id, req.params.id);
  res.json({ ok: true });
}));
```

No extra gating — both sit under the general `/api/*` middleware that already
requires `req.user` (401 otherwise), same as every other non-admin endpoint.

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test backend/test/api/announcements.test.js`
Expected: PASS (all 11 tests in the file)

- [ ] **Step 6: Commit**

```bash
git add backend/src/db.js backend/src/api/server.js backend/test/api/announcements.test.js
git commit -m "feat: add public active-announcement and dismiss endpoints"
```

---

## Task 5: Admin UI tab

**Files:**
- Create: `frontend/src/components/admin/announcements-tab.tsx`
- Create: `frontend/src/components/admin/announcements-tab.test.tsx`
- Modify: `frontend/src/routes/_app.admin.tsx`:
  - add `import { AnnouncementsTab } from "@/components/admin/announcements-tab";`
  - add `{isPlatformAdmin && <TabsTrigger value="announcements">تنبيهات الميزات</TabsTrigger>}` right after the "العملاء" `TabsTrigger` (line 184)
  - add the matching `{isPlatformAdmin && <TabsContent value="announcements"><AnnouncementsTab /></TabsContent>}` right after the "العملاء" `TabsContent` (line 206)

**Interfaces:**
- Consumes: `GET /api/admin/announcements` → `{ announcements: Announcement[] }`; `POST /api/admin/announcements` and `PUT /api/admin/announcements/:id` with body `{ title, body, imageUrls, videoUrl, startsAt, endsAt }`, each → `{ announcement: Announcement }`; `DELETE /api/admin/announcements/:id`; `POST /api/admin/announcements/image` (raw body) → `{ url: string }` — all from Task 3/4.
- Produces: exported `Announcement` type `{ id: string; title: string; body: string; imageUrls: string[]; videoUrl: string | null; startsAt: string; endsAt: string; createdAt: string }` and the `AnnouncementsTab` component, consumed only by `_app.admin.tsx`.

- [ ] **Step 1: Write the failing test**

```tsx
import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { AnnouncementsTab, type Announcement } from "@/components/admin/announcements-tab";

const apiMock = vi.hoisted(() => vi.fn());
const postMock = vi.hoisted(() => vi.fn());
const delMock = vi.hoisted(() => vi.fn());
const postRawMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ api: apiMock, post: postMock, del: delMock, postRaw: postRawMock }));

const row = (overrides: Partial<Announcement>): Announcement => ({
  id: "a1",
  title: "ميزة",
  body: "شرح",
  imageUrls: [],
  videoUrl: null,
  startsAt: "2026-01-01T00:00:00Z",
  endsAt: "2026-01-02T00:00:00Z",
  createdAt: "2025-12-31T00:00:00Z",
  ...overrides,
});

beforeEach(() => vi.setSystemTime(new Date("2026-01-01T12:00:00Z")));
afterEach(() => { apiMock.mockReset(); postMock.mockReset(); delMock.mockReset(); postRawMock.mockReset(); vi.useRealTimers(); });

describe("AnnouncementsTab", () => {
  it("labels each row upcoming, active or ended based on its date range", async () => {
    apiMock.mockResolvedValue({
      announcements: [
        row({ id: "upcoming", startsAt: "2026-02-01T00:00:00Z", endsAt: "2026-02-02T00:00:00Z" }),
        row({ id: "active", startsAt: "2025-12-31T00:00:00Z", endsAt: "2026-01-02T00:00:00Z" }),
        row({ id: "ended", startsAt: "2025-01-01T00:00:00Z", endsAt: "2025-01-02T00:00:00Z" }),
      ],
    });
    render(<AnnouncementsTab />);
    expect(await screen.findByText("قادم")).toBeInTheDocument();
    expect(screen.getByText("نشط")).toBeInTheDocument();
    expect(screen.getByText("انتهى")).toBeInTheDocument();
  });

  it("deletes an announcement after confirming", async () => {
    apiMock.mockResolvedValue({ announcements: [row({})] });
    delMock.mockResolvedValue({ ok: true });
    render(<AnnouncementsTab />);
    await screen.findByText("ميزة");
    fireEvent.click(screen.getByLabelText("حذف ميزة"));
    fireEvent.click(screen.getByText("نعم، احذف"));
    await waitFor(() => expect(delMock).toHaveBeenCalledWith("/api/admin/announcements/a1"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/components/admin/announcements-tab.test.tsx`
Expected: FAIL — `announcements-tab.tsx` does not exist.

- [ ] **Step 3: Implement `AnnouncementsTab` in `announcements-tab.tsx`**

Follow `blog-new-article-tab.tsx` + `_app.admin.tsx`'s `IndexPanel`/`DeleteUserButton`
conventions: `useState` for `rows: Announcement[] | null`, a `load()` that
calls `api("/api/admin/announcements")` on mount, and a form (`title` Input,
`body` Textarea, `startsAt`/`endsAt` `<Input type="date">`, a `videoUrl`
Input, and an image picker that calls `postRaw("/api/admin/announcements/image", file, file.type)`
per file and appends the returned `url` to a local `imageUrls: string[]`,
mirroring `blog-new-article-tab.tsx`'s `uploadImage`).

Submitting calls `post("/api/admin/announcements", body)` to create, or
(when editing an existing row) `api(\`/api/admin/announcements/${id}\`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })`
to update — then `load()` again and clears the form. Each row in the list
below renders a status badge:

```ts
type Status = "upcoming" | "active" | "ended";
const statusOf = (row: Announcement): Status => {
  const now = Date.now();
  if (now < Date.parse(row.startsAt)) return "upcoming";
  if (now > Date.parse(row.endsAt)) return "ended";
  return "active";
};
const STATUS_LABEL: Record<Status, string> = { upcoming: "قادم", active: "نشط", ended: "انتهى" };
```

Delete follows `DeleteUserButton`'s exact `AlertDialog` pattern (trigger
`aria-label` of `` `حذف ${row.title}` ``, confirm button text "نعم، احذف"),
calling `del(\`/api/admin/announcements/${row.id}\`)` then `load()`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run frontend/src/components/admin/announcements-tab.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Wire the tab into `_app.admin.tsx`** (the three edits listed under Files above)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/admin/announcements-tab.tsx frontend/src/components/admin/announcements-tab.test.tsx frontend/src/routes/_app.admin.tsx
git commit -m "feat: add feature-announcements admin tab"
```

---

## Task 6: Visitor-facing popup

**Files:**
- Create: `frontend/src/components/desk/feature-announcement-dialog.tsx`
- Create: `frontend/src/components/desk/feature-announcement-dialog.test.tsx`
- Modify: `frontend/src/components/desk/desk-shell.tsx`:
  - add `import { FeatureAnnouncementDialog } from "@/components/desk/feature-announcement-dialog";`
  - add `<FeatureAnnouncementDialog />` right after `<RequireInvestStyleDialog />`

**Interfaces:**
- Consumes: `GET /api/announcements/active` → `{ announcement: { id, title, body, imageUrls, videoUrl } | null }`; `POST /api/announcements/:id/dismiss` (Task 4).
- Produces: `FeatureAnnouncementDialog` component, no props, rendered unconditionally inside `DeskShell` (where `user` is already guaranteed non-null).

- [ ] **Step 1: Write the failing test**

```tsx
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { FeatureAnnouncementDialog } from "@/components/desk/feature-announcement-dialog";

const apiMock = vi.hoisted(() => vi.fn());
const postMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ api: apiMock, post: postMock }));

afterEach(() => { apiMock.mockReset(); postMock.mockReset(); });

describe("FeatureAnnouncementDialog", () => {
  it("renders nothing when there is no active announcement", async () => {
    apiMock.mockResolvedValue({ announcement: null });
    render(<FeatureAnnouncementDialog />);
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/api/announcements/active"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows the announcement and dismisses it exactly once on close", async () => {
    apiMock.mockResolvedValue({
      announcement: { id: "a1", title: "ميزة جديدة", body: "شرح الميزة\n\nفقرة تانية", imageUrls: ["https://example.com/a.png"], videoUrl: null },
    });
    postMock.mockResolvedValue({ ok: true });
    render(<FeatureAnnouncementDialog />);

    expect(await screen.findByText("ميزة جديدة")).toBeInTheDocument();
    expect(screen.getByText("شرح الميزة")).toBeInTheDocument();
    expect(screen.getByText("فقرة تانية")).toBeInTheDocument();
    expect(screen.getByRole("img")).toHaveAttribute("src", "https://example.com/a.png");

    fireEvent.click(screen.getByText("تمام"));
    await waitFor(() => expect(postMock).toHaveBeenCalledWith("/api/announcements/a1/dismiss"));
    expect(postMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/components/desk/feature-announcement-dialog.test.tsx`
Expected: FAIL — component does not exist.

- [ ] **Step 3: Implement `FeatureAnnouncementDialog`**

```tsx
type ActiveAnnouncement = {
  id: string;
  title: string;
  body: string;
  imageUrls: string[];
  videoUrl: string | null;
};

export function FeatureAnnouncementDialog() {
  const [announcement, setAnnouncement] = useState<ActiveAnnouncement | null>(null);
  const [open, setOpen] = useState(false);
  const dismissedRef = useRef(false);

  useEffect(() => {
    api<{ announcement: ActiveAnnouncement | null }>("/api/announcements/active")
      .then((result) => {
        if (result.announcement) {
          setAnnouncement(result.announcement);
          setOpen(true);
        }
      })
      .catch(() => {});
  }, []);

  const close = () => {
    setOpen(false);
    if (announcement && !dismissedRef.current) {
      dismissedRef.current = true;
      void post(`/api/announcements/${announcement.id}/dismiss`).catch(() => {});
    }
  };

  if (!announcement) return null;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) close(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{announcement.title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {announcement.body.split(/\n\s*\n/).map((paragraph, i) => (
            <p key={i} className="text-[14px] leading-relaxed">{paragraph}</p>
          ))}
          {announcement.imageUrls.length > 0 && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {announcement.imageUrls.map((url) => (
                <img key={url} src={url} alt="" className="rounded-lg border object-cover" />
              ))}
            </div>
          )}
          {announcement.videoUrl && (
            <iframe
              src={announcement.videoUrl}
              className="aspect-video w-full rounded-lg border"
              allow="autoplay; encrypted-media; picture-in-picture"
              allowFullScreen
            />
          )}
        </div>
        <Button onClick={close}>تمام</Button>
      </DialogContent>
    </Dialog>
  );
}
```

Imports: `useEffect, useRef, useState` from `"react"`; `Dialog, DialogContent,
DialogHeader, DialogTitle` from `"@/components/ui/dialog"`; `Button` from
`"@/components/ui/button"`; `api, post` from `"@/lib/api"`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run frontend/src/components/desk/feature-announcement-dialog.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Mount it in `desk-shell.tsx`** (the two edits listed under Files above)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/desk/feature-announcement-dialog.tsx frontend/src/components/desk/feature-announcement-dialog.test.tsx frontend/src/components/desk/desk-shell.tsx
git commit -m "feat: show the active feature announcement in the desk shell"
```
