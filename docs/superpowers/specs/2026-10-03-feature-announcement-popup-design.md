# Feature announcement popup — design spec

**Date:** 2026-10-03
**Status:** approved for planning

## Purpose

Let the admin announce a new feature to signed-in users: a popup that appears
when a user opens the app, with a title, an explanation, screenshots and an
optional embedded video. The admin controls the content and the active date
range from the admin panel. Each user sees it at most once — dismissing
(closing) it hides it permanently for that account.

## Scope decisions (from brainstorming)

- **Duration = active date range.** The admin sets `starts_at`/`ends_at`; the
  popup shows to anyone who opens the site while "now" falls in that range and
  who hasn't dismissed it yet. There is no separate auto-close timer.
- **Logged-in app only.** Shown inside the desk shell after sign-in, not on
  the public marketing pages.
- **Images + external video link.** Admin uploads screenshots (same pattern
  as the blog's feature image) and may paste a YouTube/Vimeo URL. No raw
  video file upload/hosting.
- **One active announcement at a time.** No queue — the active row is
  whichever has `now()` inside its range (latest `starts_at` wins on overlap).
- **Dismissal is per-account, server-side**, so it survives across devices.
- **Main site only, for now.** Each white-label tenant runs the same schema
  in its own separate Supabase project (see `backend/src/tenancy/registry.js`)
  — there is no mechanism today to push one piece of content into every
  tenant's database. Rather than build that, this feature is gated the same
  way `canEditIndices`/`isPlatformAdmin` already gate "shared" admin features:
  usable only when `tenant.isDefault` is true. The tables still go into the
  shared `schema.sql` (applied to every tenant DB, like `blog_posts`), but a
  client tenant's copy simply stays empty and unreachable through the UI.

## Data model

Add to `backend/supabase/schema.sql`, following the file's existing
conventions (`create table if not exists`, `alter table ... add column if not
exists` for any later change):

```sql
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

create table if not exists user_announcement_dismissals (
  user_id text not null references users(id) on delete cascade,
  announcement_id uuid not null references feature_announcements(id) on delete cascade,
  dismissed_at timestamptz not null default now(),
  primary key (user_id, announcement_id)
);
```

`body` is plain text (paragraphs separated by a blank line) — not HTML and
not the blog's rich-text/block format. A feature popup doesn't need headings
or tables, and plain text sidesteps any HTML-sanitization/XSS surface for
content that gets rendered to every signed-in user. The admin form is a
`<textarea>`; the popup renders it by splitting on blank lines into `<p>`
tags.

`image_urls` is a JSON array of public URLs from the upload endpoint below
(same shape of data as `blog_posts.image_url`, just plural).

`video_url`, when present, must already be a normalized embeddable URL by the
time it's stored (validated server-side, see below) — the frontend never
builds an iframe src from unvalidated input.

## Backend API (`backend/src/api/server.js`)

### Admin (platform-admin only)

Gated the same way `/api/platform/*` is: `isPlatformAdmin(req.user,
req.tenant)`, i.e. `tenant.isDefault && user.isAdmin && user.emailVerified &&
isPlatformAdminEmail(user.email)`.

- `GET /api/admin/announcements` — list all (history + upcoming + active),
  newest `starts_at` first.
- `POST /api/admin/announcements` — create. Body: `{ title, body, imageUrls,
  videoUrl, startsAt, endsAt }`. Validates: `title`/`body` non-empty,
  `startsAt < endsAt`, `imageUrls` is an array of URLs already returned by
  the image-upload endpoint, `videoUrl` (if present) matches the YouTube/
  Vimeo allow-list below.
- `PUT /api/admin/announcements/:id` — update, same validation.
- `DELETE /api/admin/announcements/:id` — delete (cascades its dismissal
  rows).
- `POST /api/admin/announcements/image` — raw image body upload, mirrors
  `POST /api/admin/blog-drafts/image` exactly (same `express.raw` size/type
  handling), backed by a new `backend/src/announcementImages.js` module
  copied from `blogImages.js` with its own bucket (`announcement-images`).

### Signed-in users (any tenant)

- `GET /api/announcements/active` — returns `{ announcement: {...} | null
  }`. Query: the `feature_announcements` row with `starts_at <= now() <=
  ends_at`, excluding any row already dismissed by `req.user.id`, ordered by
  `starts_at desc`, limit 1. Requires a signed-in user (same auth middleware
  as the rest of `/api/*`), no admin/tenant gating — a client tenant's table
  is just empty, so this naturally returns `null` there.
- `POST /api/announcements/:id/dismiss` — upserts a row into
  `user_announcement_dismissals` for `req.user.id`. Idempotent (upsert on the
  composite primary key), so a duplicate call (e.g. a retried request) is
  harmless.

### Video URL validation

A small helper (co-located with the admin route, or in `security.js` next to
`safeHttpsUrl`): accepts a `youtube.com`/`youtu.be`/`vimeo.com` watch URL,
rejects everything else, and returns the normalized **embed** URL to store
(e.g. `https://www.youtube.com/watch?v=XXXX` →
`https://www.youtube-nocookie.com/embed/XXXX`; `https://vimeo.com/XXXX` →
`https://player.vimeo.com/video/XXXX`). Storing the embed form means the
frontend only ever puts a known-good, already-validated string into an
iframe `src` — never user input at render time.

## Admin UI

New tab **"تنبيهات الميزات"** in `frontend/src/routes/_app.admin.tsx`, added
next to "العملاء" and under the same `isPlatformAdmin` condition:

```tsx
{isPlatformAdmin && <TabsTrigger value="announcements">تنبيهات الميزات</TabsTrigger>}
...
{isPlatformAdmin && (
  <TabsContent value="announcements">
    <AnnouncementsTab />
  </TabsContent>
)}
```

New `frontend/src/components/admin/announcements-tab.tsx`, following
`blog-new-article-tab.tsx`'s shape:

- A create/edit form: title (`Input`), body (`Textarea`), image upload
  (reuses the blog's upload-then-preview-then-remove pattern, calling
  `postRaw("/api/admin/announcements/image", file, file.type)`, allowing more
  than one image), video URL (`Input`, client-side sanity check before
  submit — the real validation is server-side), start/end date pickers (same
  `<Input type="date">` pattern already used in `SubscriptionCell`).
- A list below the form (reusing `Panel`/`Badge` from `state-blocks.tsx`)
  showing every announcement with a status badge (upcoming / active /
  ended), and edit/delete actions per row (`AlertDialog` confirmation for
  delete, matching `DeleteUserButton`).

## Visitor-facing popup

New `frontend/src/components/desk/feature-announcement-dialog.tsx`, mounted
in `desk-shell.tsx` alongside `<ChatWidget />` (same "always-present widget"
position), rendered only once `useDesk().user` is non-null.

- On mount, calls `GET /api/announcements/active` once.
- If `announcement` is non-null, opens a `Dialog`:
  - Title.
  - Body, rendered as paragraphs (split on blank lines).
  - Images, if any, in a simple grid/stack (`<img>` tags, same object-fit
    pattern as the blog's feature image).
  - Video, if present, as an `<iframe>` whose `src` is exactly the stored
    (already-validated) embed URL, nothing else interpolated in.
  - A close affordance (×, and a "تمام" button). Closing — by any of the
    `Dialog`'s own close paths, including backdrop click/Escape — fires
    `POST /api/announcements/:id/dismiss` once (guarded so it can't double-
    fire) and the dialog does not reopen for the rest of the session even if
    the component remounts.
- A failed fetch is swallowed (best-effort, like `useOnlineNow`) — the popup
  just doesn't show rather than breaking the page.

## Error handling

- Admin form: Arabic validation errors inline, `toast.error` on request
  failure — same conventions as every other admin tab.
- Public endpoints: a failed `GET /api/announcements/active` never blocks or
  errors the app shell; it's purely additive.
- Image upload reuses the blog endpoint's exact type/size checks (8 MB,
  jpeg/png/webp, magic-byte verified via `checkedImageType`), so no new
  attack surface there.

## Testing plan

- Backend: unit tests for the active-announcement query (date-range edge
  cases: not yet started, already ended, already dismissed, exactly at the
  boundary) and for the video-URL allow-list/normalization helper.
- Frontend: component test for `FeatureAnnouncementDialog` (renders when an
  announcement is returned, stays hidden when `null`, calls dismiss exactly
  once on close) — mirroring the existing `live-prices-tab.test.tsx`/
  `rich-text-editor.test.tsx` style already in `components/admin`.
- Manual: create an announcement in the admin tab with an active date range,
  confirm it appears for a signed-in test user, confirm closing it hides it
  on reload and on a second browser/session for the same account.
