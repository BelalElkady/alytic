# WhatsApp Lifecycle Messages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The backend decides which EGXpert users get which WhatsApp lifecycle step and serves it to the n8n workflow in `automation/n8n/`. Admins configure the steps, users can opt out, and everything is tested on the backup copy and test project before production.

**Architecture:** A new `backend/src/whatsapp/` module holds three pure parts: step config, eligibility (`dueStepFor`) and rendering (`buildRequest`). Around them sits one service that touches the database and n8n. Routes are mounted from `server.js` the way `mountPlatformRoutes` is. n8n only delivers: it pulls `/due`, receives event pushes, and relays Meta events to `/events`.

**Tech Stack:** Node 20 ESM, Express 5, zod 4, supabase-js, `node:test`; `pg` (devDependency, dry-run script only); TanStack Start + React + TypeScript (frontend).

**Spec:** `docs/superpowers/specs/2026-10-23-whatsapp-lifecycle-design.md`

**Prerequisite:** PR #196 (the trial starts at email confirmation) is merged. Branch `feat/whatsapp-lifecycle` from `main` after that.

## Global Constraints

- Every user-facing string is Egyptian Arabic. Every 400 answer carries an Arabic `error`.
- New routes with a multi-field body validate with zod `safeParse`. Every handler is wrapped in `wrap()`.
- `/api/automation/whatsapp/due|result|events` join the login allowlist and require `Authorization: Bearer ${WHATSAPP_AUTOMATION_SECRET}` (compared with `safeEqual`, otherwise 401). None of them goes in `PAID_PATHS`. **The PR description calls these out as public paths.**
- Only users with a confirmed email and a phone are eligible. Also excluded: opted out, suspended, Admin, Marketer, `local`.
- Only the default tenant sends. On any other tenant, `/due` returns `{items: []}`, events are ignored, and nothing is pushed.
- Outside production (`NODE_ENV !== 'production'` **or** `SUPABASE_URL` doesn't contain `xssjwnevhbpcdmtbatiy`), only phones listed in `WHATSAPP_ALLOWED_PHONES` (comma-separated E.164) are claimed. A missing list means nothing is sent.
- Send window: `/due` returns nothing outside 10:00–21:00 Cairo time. Event pushes ignore the window.
- `/due` claims at most 50 items per call. A `queued` row older than 2 hours becomes `failed` and is never retried.
- `whatsapp_messages` is append-only except `status`, `meta_message_id`, `error`, `updated_at`. Status never moves backwards: `queued < sent < delivered < read`, and `failed` only replaces `queued` or `sent`.
- Stop words, compared after trimming and lowercasing: `إيقاف`, `ايقاف`, `stop`, `الغاء`, `إلغاء`.
- Schema changes are appended to `backend/supabase/schema.sql` with `if not exists`. SQL that already ran stays as it is.
- Don't touch `frontend/src/routeTree.gen.ts`. Commits pushed to a branch sync to Lovable, so never rewrite pushed commits.
- **Running checks:** use `node --check <file>` after every backend edit. Unit tests (`node --test backend/test/unit/<file>`) run locally because they don't touch a database. API tests use the shared test project and run **in the PR's CI**, not locally, unless the user asks. Don't run the frontend lint or build locally; CI does it.

## Review Focus

1. **A user changes their phone after a step was sent.** The next step goes to the new number, and `whatsapp_messages.phone` keeps the old one. The test goes in Task 5.
2. **A user who opted out signs a fresh Activation.** `paid_welcome` must not be pushed. The test goes in Task 6.
3. **Stop words with extra spaces or a different letter case (`" إيقاف "`, `STOP`, `Stop`).** All of them must opt out. The test goes in Task 5.
4. **Meta sends `delivered` after `read` (they can arrive out of order).** The status stays `read`. The test goes in Task 5.
5. **An Admin saves a step with `discountPct` 0, or with a `template_name` containing spaces or capitals.** 0 is accepted (the step stays valid; the Admin decides whether a 0% offer makes sense). An invalid name gets 400 with an Arabic message. The test goes in Task 7.

---

## File Structure

| File | Responsibility |
|---|---|
| `backend/src/billing/trial.js` (new) | `TRIAL_DAYS`, `trialStartOf`, `trialInfo`, `tradingDayIndex`. Moved out of `server.js` so the whatsapp module can use them |
| `backend/src/whatsapp/steps.js` (new) | Step keys, defaults, per-step params zod schemas, stop words, constants |
| `backend/src/whatsapp/eligibility.js` (new) | Pure `dueStepFor()` and `isEligible()` |
| `backend/src/whatsapp/render.js` (new) | Pure `buildRequest()`: Graph API body, rendered params, offer expiry |
| `backend/src/whatsapp/service.js` (new) | Claims, results, Meta events, event push, allowlist guard |
| `backend/src/whatsapp/routes.js` (new) | `mountWhatsappRoutes(app, { wrap })`: automation, account and admin routes |
| `backend/src/db.js` (modify) | Data functions for the three tables and the opt-out column |
| `backend/src/api/server.js` (modify) | Import trial.js; login allowlist; `MARKETER_READS`; mount routes; push hooks; `/me` and users list fields |
| `backend/supabase/schema.sql` (modify) | Spec's data model block plus RLS enable |
| `backend/scripts/whatsapp-dry-run.mjs` (new) | Stage 1: read-only report on the `backup` schema |
| `backend/scripts/seed-whatsapp-test-users.mjs` (new) | Stage 2: test-project users at each lifecycle point |
| `backend/.env.example` (modify) | `WHATSAPP_AUTOMATION_SECRET`, `N8N_WHATSAPP_WEBHOOK_URL`, `WHATSAPP_LAUNCH_AT`, `WHATSAPP_ALLOWED_PHONES` |
| `frontend/src/components/admin/whatsapp-tab.tsx` (new) | Admin "رسايل واتساب" tab |
| `frontend/src/components/admin/users-screen.tsx`, `routes/_app.admin.tsx`, `routes/_app.settings.tsx`, `components/desk/auth-screen.tsx`, `lib/store.tsx` (modify) | Badge, tab, switch, notice, store action |

---

### Task 1: Move the trial calendar into `billing/trial.js`

**Files:**
- Create: `backend/src/billing/trial.js`
- Modify: `backend/src/api/server.js` (remove `TRIAL_DAYS`, `DAY_MS` if unused elsewhere, `trialStartOf`, `trialInfo`; import them instead)
- Test: `backend/test/unit/trial.test.js`

**Interfaces:**
- Produces: `TRIAL_DAYS = 5`; `trialStartOf(user): number`; `trialInfo(user, now = Date.now()): { trialDaysTotal, trialDaysLeft, trialActive, trialEndsAt: Date }`; `tradingDayIndex(user, now = Date.now()): number`, which is 0 on the first trading slice and counts trading slices started at or before `now`, minus 1, so -1 before the first one starts. `user` may be a session user (`emailVerifiedAt`, `emailVerified`, `createdAt`) or a raw row (`email_verified_at`, …).

- [ ] **Step 1: Write the failing tests** in `backend/test/unit/trial.test.js`. Use `isTradingDay` from `src/data/cache.js` to pick dates; 2026-10-22 is a Thursday.
  - `trialInfo({ emailVerifiedAt: '2026-10-22T10:00:00+02:00' }, Date.parse('2026-10-22T12:00:00+02:00'))` gives `trialActive === true` and `trialDaysLeft === 5`.
  - Verified on Thursday: the Friday and Saturday slices don't count, so `trialEndsAt` is after `2026-10-28T10:00:00+02:00`.
  - `tradingDayIndex` is 0 on Thursday noon, still 0 on Saturday noon, and 1 on Sunday 11:00.
  - An unverified user (`emailVerified: false`, no timestamp) has `trialDaysLeft === 5` for any `now`.
- [ ] **Step 2: Run** `node --test backend/test/unit/trial.test.js`. Expected: FAIL, cannot find module `../../src/billing/trial.js`.
- [ ] **Step 3: Implement.** Move `trialStartOf`/`trialInfo` verbatim from `server.js`, adding a `now` parameter (default `Date.now()`; `trialStartOf` keeps its `Date.now()` fallback for unverified users). Add `tradingDayIndex` using the same slice walk. In `server.js` import from `../billing/trial.js` and delete the moved code, keeping the explanatory comment with the moved function.
- [ ] **Step 4: Run** the unit test (expected PASS) and `node --check backend/src/api/server.js`.
- [ ] **Step 5: Commit** `refactor(trial): move the trial calendar into billing/trial.js`.

### Task 2: Schema and data functions

**Files:**
- Modify: `backend/supabase/schema.sql` (append), `backend/src/db.js`

**Interfaces:**
- Produces, all in `db.js`. Rows are returned in snake_case like the rest of `db.js`.
  - `getWhatsappSteps(): Promise<Row[]>` · `upsertWhatsappStep({ key, enabled, templateName, params, updatedBy }): Promise<Row>`
  - `insertWhatsappMessage({ userId, step, cycleKey, phone, renderedParams, offerExpiresAt }): Promise<Row | null>`: returns `null` on a unique violation. Use the existing `mustUnlessDuplicate` pattern.
  - `setWhatsappMessageResult(id, { status, metaMessageId, error }): Promise<void>` · `setWhatsappStatusByMetaId(metaMessageId, status, error): Promise<Row | null>` (applies the "never backwards" order in SQL: `.in('status', allowedPrevious)`)
  - `failStaleWhatsappMessages(olderThanIso): Promise<number>`
  - `listWhatsappMessagesForUsers(userIds): Promise<Row[]>` · `whatsappStepCounts(sinceIso): Promise<{ step, status, count }[]>`
  - `insertWhatsappInbound({ userId, phone, text, metaMessageId }): Promise<Row | null>` · `lastAutoReplyAt(userId): Promise<string | null>` · `surveyAnswerCounts(): Promise<{ text, count }[]>`
  - `setWhatsappOptOut(userId, optedOut: boolean): Promise<void>` (calls `forgetSessionUser`) · `getUserByPhone` already exists; reuse it.
  - `listWhatsappCandidates(): Promise<Row[]>`: users with `email_verified_at` and `phone` not null and `whatsapp_opt_out_at` null, joined to their `subscriptions` row (two queries merged in JS, like `listUsersPage`).

- [ ] **Step 1: Append** the spec's data model block to `schema.sql` under a `-- WhatsApp lifecycle messages` header comment. Add an `auto_replied_at timestamptz` column to `whatsapp_inbound` (it backs `lastAutoReplyAt`), and `alter table … enable row level security` for the three tables. The comment says to run it on the test project first, then production before the deploy.
- [ ] **Step 2: Add** the functions above to `db.js`.
- [ ] **Step 3: Run** `node --check backend/src/db.js`. Expected: no output.
- [ ] **Step 4: Commit** `feat(whatsapp): schema and data access`.

### Task 3: Step config and eligibility

**Files:**
- Create: `backend/src/whatsapp/steps.js`, `backend/src/whatsapp/eligibility.js`
- Test: `backend/test/unit/whatsappEligibility.test.js`

**Interfaces:**
- Consumes: `trialInfo`, `tradingDayIndex` (Task 1).
- Produces:
  - `steps.js`: `STEP_KEYS = ['trial_welcome','trial_stoploss','trial_ending','trial_ended','paid_welcome','survey','renewal']`; `TRIAL_STEPS` (the first four, in order); `EVENT_STEPS = ['trial_welcome','paid_welcome']`; `DEFAULT_STEPS: Record<key, { enabled: false, templateName: key, templateLang: 'ar', params }>` with params `trial_ending` `{ discountPct: 20, validDays: 3, plan: 'long_yearly' }`, `trial_ended` `{ discountPct: 20, validDays: 3, plan: 'long_yearly' }`, `renewal` `{ discountPct: 20, validDays: 7, plan: 'long_yearly', whatsNew: '' }`, and the rest `{}`; `stepParamsSchema(key)` (zod: `discountPct` int 0–90, `validDays` int 1–30, `plan` one of the `PLANS` keys, `whatsNew` ≤200 chars with no `\n`); `STOP_WORDS`; `isStopWord(text): boolean` (trims, lowercases, then checks `STOP_WORDS`); `SEND_WINDOW = { startHour: 10, endHour: 21 }`; `GRACE_DAYS = 3`; `inSendWindow(now): boolean` (Cairo hour).
  - `eligibility.js`: `isEligible(user): string | null` returns a skip reason (`'no_phone' | 'unconfirmed' | 'opted_out' | 'suspended' | 'staff'`) or `null`. Also `dueStepFor({ user, subscription, sent, steps, launchAt, now }): { step, cycleKey } | { skip: string }`, where `sent` is the user's `[{ step, cycle_key }]`, `steps` is the merged config, and `launchAt` is a Date or null (null gives `{ skip: 'not_launched' }`).

- [ ] **Step 1: Write the failing tests**, one `test()` each, with fixed `now` values around Thursday 2026-10-22 and the 2026-11-0x trading days:
  - Each `isEligible` reason; an eligible user gives `null`.
  - User created before `launchAt` and `now < launchAt + 3d` gives `{ skip: 'grace' }`. User created after `launchAt` is eligible immediately.
  - Day index 2, trial active, nothing sent gives `trial_stoploss`. Day index 4 gives `trial_ending`. Trial ended 1 day ago with no subscription gives `trial_ended`. Trial ended 3 days ago gives `survey`, never `trial_ended`.
  - Late join: day index 4 with nothing sent gives `trial_ending` (not `trial_stoploss`). Day index 2 with `trial_ending` already sent gives `{ skip: 'later_step_sent' }`.
  - `trial_welcome` is never returned by `dueStepFor` past day index 0. On day 0 with nothing sent it **is** returned (the catch-up).
  - Expired (`current_period_end` 2 days ago) gives `{ step: 'renewal', cycleKey: '<that date, YYYY-MM-DD>' }`. The same with that cycle already sent gives `{ skip: 'already_sent' }`. A new lapse with a different end date gives `renewal` again.
  - Active subscriber gives `{ skip: 'active' }`. A disabled step gives `{ skip: 'disabled' }`.
- [ ] **Step 2: Run** `node --test backend/test/unit/whatsappEligibility.test.js`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** both files. Order of checks in `dueStepFor`: not launched → `isEligible` → grace → subscription state (active / expired / none) → trial steps (pick the latest due one, then the "later already sent" check) → disabled → already sent.
- [ ] **Step 4: Run** the unit test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(whatsapp): step config and eligibility rules`.

### Task 4: Rendering the Graph API body

**Files:**
- Create: `backend/src/whatsapp/render.js`
- Test: `backend/test/unit/whatsappRender.test.js`

**Interfaces:**
- Consumes: `DEFAULT_STEPS`, `PLANS` (`billing/plans.js`), `TRIAL_DAYS`.
- Produces: `buildRequest({ step, config, user, subscription, appUrl, now, existingOfferExpiresAt }): { request, renderedParams: string[], offerExpiresAt: Date | null }`. `request` is exactly the spec's Graph body; `to` is `user.phone` without the `+`.

Placeholder order (it must match the template drafts in the spec):

| step | params |
|---|---|
| trial_welcome | firstName, `TRIAL_DAYS`, `${appUrl}/portfolio` |
| trial_stoploss | firstName, `${appUrl}/portfolio` |
| trial_ending | firstName, plan label, discountPct, discounted price, offer end date, `${appUrl}/subscribe` |
| trial_ended | firstName, discountPct, offer end date, `${appUrl}/subscribe` |
| paid_welcome | firstName, plan label, period end date, `${appUrl}/portfolio` |
| survey | firstName |
| renewal | firstName, whatsNew, plan label, discountPct, discounted price, offer end date, `${appUrl}/subscribe` |

- firstName is the first word of `user.name`, or `'صديقنا'` when the name is empty.
- Plan label is `PLANS[plan].label` without the ` — سنوي` / ` — شهري` suffix.
- Discounted price is `Math.round(priceEgp * (1 - pct/100))`.
- Dates are formatted with `Intl.DateTimeFormat('ar-EG', { day: 'numeric', month: 'long', timeZone: 'Africa/Cairo' })`.
- Offer expiry is `now + validDays` days. For `trial_ended` it reuses `existingOfferExpiresAt` when that's in the future.
- Template parameters may not contain newlines or 4+ spaces (Meta's rule). Collapse whitespace in every param.

- [ ] **Step 1: Write the failing tests:** `trial_ending` for user `{ name: 'أحمد علي', phone: '+201012345678' }` with `{ discountPct: 20, validDays: 3, plan: 'long_yearly' }` gives `to === '201012345678'`, `template.name === 'trial_ending'`, params `['أحمد', 'النفس الطويل', '20', '2392', <ar-EG date>, 'https://egxpert.com/subscribe']`, and `offerExpiresAt` = now + 3 days. Empty name gives `'صديقنا'`. `trial_ended` with a future `existingOfferExpiresAt` reuses it. A `whatsNew` containing double spaces gets collapsed. `config.templateName` overrides the template name.
- [ ] **Step 2: Run** `node --test backend/test/unit/whatsappRender.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** `render.js`.
- [ ] **Step 4: Run** the unit test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(whatsapp): render template requests`.

### Task 5: Automation endpoints (`/due`, `/result`, `/events`)

**Files:**
- Create: `backend/src/whatsapp/service.js`, `backend/src/whatsapp/routes.js`
- Modify: `backend/src/api/server.js` (login allowlist adds `req.path.startsWith('/automation/whatsapp/')`; call `mountWhatsappRoutes(app, { wrap })` next to `mountPlatformRoutes`), `backend/.env.example`
- Test: `backend/test/api/whatsapp-automation.test.js`

**Interfaces:**
- Consumes: Tasks 2–4.
- Produces:
  - `service.js`: `isLiveSending(): boolean`; `phoneAllowed(phone): boolean` (always true when live, otherwise checks the allowlist); `mergedSteps(): Promise<Record<key, config>>` (DB rows over `DEFAULT_STEPS`); `claimDue(now): Promise<{ messageId, request }[]>`; `claimStep(user, step, cycleKey, now): Promise<{ messageId, request } | null>`; `recordResult({ messageId, status, metaMessageId, error })`; `handleMetaEvent(event): Promise<{ reply?: { to, text } }>`.
  - Routes: `GET /api/automation/whatsapp/due` gives `{ items }`. `POST /result` and `POST /events` use zod: result is `{ messageId: uuid, status: 'sent'|'failed', metaMessageId?: string ≤200, error?: string ≤500 }`; events is a discriminated union on `type` with the spec's two shapes (`text` ≤4096).
  - When a status reaches `delivered`, `handleMetaEvent` fills `user_follow_ups.whatsapp_at` if it's empty (reuse the existing follow-up setter in `db.js`, with `updated_by` set to `'whatsapp-bot'`).
  - Reply texts, exactly: opt-out `'تمام، مش هنبعتلك رسايل تاني. تقدر ترجّعها من الإعدادات.'`; survey answer `'شكراً، وصلنا ردك 🙏'`; any other message (at most once per user every 24h) `'أهلاً! لأي سؤال أو للاشتراك كلّمنا من الشات جوه الموقع: ${appUrl}'`. The survey branch applies when the user's latest sent step is `survey` and was sent less than 7 days ago.

- [ ] **Step 1: Write the failing API tests.** Set `WHATSAPP_AUTOMATION_SECRET`, `WHATSAPP_LAUNCH_AT` (in the past) and `WHATSAPP_ALLOWED_PHONES` in the test's env before `startServer()`. Create users with `registerUser` and set their phones with `setUserPhone`.
  - All three paths answer 401 with no or a wrong bearer, and never 401 "سجّل الدخول الأول" with the right one.
  - `/due` within the window returns a `trial_welcome` item for a fresh verified user whose phone is on the allowlist, and **nothing** for a user whose phone isn't. A second `/due` call doesn't return the same user again.
  - `/result` `sent` then `/events` `delivered` then `read` then `delivered` leaves the row `read`, and `user_follow_ups.whatsapp_at` is set.
  - `/events` message `' إيقاف '` and `'STOP'` each set `whatsapp_opt_out_at` and return the opt-out reply. The next `/due` skips that user.
  - A user whose phone changed after `trial_welcome` was sent gets `trial_stoploss` to the new number, and the old row keeps the old phone. Set the step timing by back-dating `email_verified_at` in the DB.
  - A `queued` row back-dated by 3 hours becomes `failed` on the next `/due`.
  - Out-of-window behavior is tested in the unit tests for `inSendWindow`. To avoid flaky clocks, the API test passes `?at=` only when `NODE_ENV === 'test'`; in any other environment the route ignores `at`.
- [ ] **Step 2: Run** `node --check` on the new files. API tests run in CI (see Global Constraints).
- [ ] **Step 3: Implement** `service.js` and `routes.js` and wire them into `server.js`. Add the four env vars to `.env.example` with one comment line each.
- [ ] **Step 4: Run** `node --check backend/src/whatsapp/service.js backend/src/whatsapp/routes.js backend/src/api/server.js`. Expected: no output.
- [ ] **Step 5: Commit** `feat(whatsapp): automation endpoints for n8n`.

### Task 6: Event pushes (`trial_welcome`, `paid_welcome`)

**Files:**
- Modify: `backend/src/whatsapp/service.js`, `backend/src/auth.js` (end of `verifyEmail` and `updatePhone`), `backend/src/api/server.js` (after `recordSubscriptionGrant` in `POST /api/admin/users/:id/subscription`)
- Test: `backend/test/api/whatsapp-push.test.js`

**Interfaces:**
- Produces: `pushStep(userId, step): Promise<void>`. It's fire-and-forget: callers don't `await` its outcome for their response, and errors are logged and sent to Sentry, never thrown to the user. It does nothing when `N8N_WHATSAPP_WEBHOOK_URL` is missing, the tenant isn't the default, the user isn't eligible, or the step was already claimed. `paid_welcome` is pushed only if the user has no earlier `grant` in `subscription_grants` (count ≤1 after this grant).

- [ ] **Step 1: Write the failing API tests.** Start a local `http.createServer` as the fake n8n and set `N8N_WHATSAPP_WEBHOOK_URL` to it.
  - Registering, then verifying, pushes one `trial_welcome` with the bearer header and the spec's body shape.
  - A Google-style user (verified, no phone) gets nothing until `POST /api/account/phone`, then one push. Saving the phone again doesn't push a second time.
  - An Admin activation pushes `paid_welcome`; a second activation for the same user doesn't.
  - A user who opted out gets no push on activation.
  - The fake n8n answering 500 doesn't change the verify or activation response (still 200).
- [ ] **Step 2: Implement** `pushStep` and call it from the three places with `void pushStep(...).catch(...)`.
- [ ] **Step 3: Run** `node --check` on the changed files.
- [ ] **Step 4: Commit** `feat(whatsapp): push welcome steps on confirmation and activation`.

### Task 7: User switch and admin step endpoints

**Files:**
- Modify: `backend/src/whatsapp/routes.js`, `backend/src/api/server.js` (`MARKETER_READS` gains `'GET /whatsapp/steps'`; `/api/auth/me` adds `whatsappEnabled: !user.whatsappOptOutAt`; `publicUser` in `auth.js` gains `whatsappOptOutAt`; the admin users list rows gain `whatsapp`)
- Test: `backend/test/api/whatsapp-admin.test.js`

**Interfaces:**
- Produces:
  - `PATCH /api/account/whatsapp` takes `{ enabled: boolean }` and returns `{ whatsappEnabled }`.
  - `GET /api/admin/whatsapp/steps` returns `{ steps: [{ key, enabled, templateName, templateLang, params, counts: { sent, delivered, read, failed } }], surveyAnswers: [{ text, count }], liveSending: boolean }`, with counts from the last 30 days.
  - `PUT /api/admin/whatsapp/steps/:key` takes `{ enabled, templateName, params }`, validated with zod (`templateName` `^[a-z0-9_]{1,512}$`, params via `stepParamsSchema(key)`). An unknown `key` gives 404 `'الخطوة دي مش موجودة'`. Invalid input gives 400 `'بيانات الخطوة مش صحيحة'`.
  - Each users-list row gets `whatsapp: { lastStep, lastStatus, offer: { discountPct, expiresAt } | null }`, built from one `listWhatsappMessagesForUsers` call per page.

- [ ] **Step 1: Write the failing API tests:**
  - The user switch round-trips through `/me`.
  - A Marketer can `GET` the steps but gets 403 on `PUT`.
  - An Admin `PUT` with `discountPct: 0` gives 200; `templateName: 'Trial Ending'` gives 400 with an Arabic `error`; an unknown key gives 404.
  - The users list shows the offer badge data for a user with a future `offer_expires_at`.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Run** `node --check` on the changed files.
- [ ] **Step 4: Commit** `feat(whatsapp): opt-out switch and admin step settings`.

### Task 8: Stage 1 dry-run script (backup copy, read-only)

**Files:**
- Create: `backend/scripts/whatsapp-dry-run.mjs`
- Modify: `backend/package.json` (adds `"whatsapp:dry-run": "node scripts/whatsapp-dry-run.mjs"` and the `pg` devDependency)

**Interfaces:**
- Consumes: `isEligible`, `dueStepFor`, `DEFAULT_STEPS` (with every step treated as enabled), `trialInfo`.
- CLI: `--at <ISO>` (default now) and `--launch-at <ISO>` (default `--at` minus 3 days). It reads `BACKUP_DATABASE_URL` and connects with `pg` in a `BEGIN READ ONLY` transaction, then runs `select … from backup.users` and `backup.subscriptions` (`backup.whatsapp_messages` doesn't exist there, so `sent` is empty).
- Output: a table of `step → count`, a table of `skip reason → count`, and up to 10 user **ids** per step. It never selects or prints `phone` values; select `phone is not null as has_phone` instead.

- [ ] **Step 1: Implement** the script. It exits 1 with an English message if `BACKUP_DATABASE_URL` is missing.
- [ ] **Step 2: Run** `node --check backend/scripts/whatsapp-dry-run.mjs`.
- [ ] **Step 3: Run it** (this is Stage 1 of the spec's testing): `npm --prefix backend run whatsapp:dry-run -- --at 2026-11-02T11:00:00+02:00`. Expected: the eligible total is close to 410 (the spec's count), split across `survey`, `renewal` and trial steps, with no phone numbers in the output. Paste the output into the PR.
- [ ] **Step 4: Commit** `feat(whatsapp): read-only dry run against the backup copy`.

### Task 9: Stage 2 seed script (test project, team phones)

**Files:**
- Create: `backend/scripts/seed-whatsapp-test-users.mjs`

**Interfaces:**
- CLI: `--phones +2010…,+2011…` (each must be on `WHATSAPP_ALLOWED_PHONES`, or it refuses). It refuses to run if `SUPABASE_URL` contains `xssjwnevhbpcdmtbatiy`.
- It creates one verified user per lifecycle point, cycling through the given phones: fresh confirmation, trading day 2, last trial day, trial ended yesterday, Never subscribed (ended 4 days ago), Expired (ended 2 days ago). It back-dates `email_verified_at` / `current_period_end` to match. Emails follow `testEmail('wa')` so `cleanup:test-data` removes them.
- Because phones are unique per account, one phone can only hold one user at a time. With fewer phones than points, the script seeds the first N points and prints which ones it skipped; re-running with `--from <point>` seeds the next ones after deleting the earlier users.

- [ ] **Step 1: Implement.** Then `node --check`.
- [ ] **Step 2: Commit** `feat(whatsapp): seed test-project users for the live check`.

### Task 10: Frontend: signup notice and settings switch

**Files:**
- Modify: `frontend/src/components/desk/auth-screen.tsx` (under the phone field near line 185), `frontend/src/routes/_app.settings.tsx` (new `Panel` after "بياناتك"), `frontend/src/lib/store.tsx` (`setWhatsappEnabled(enabled: boolean): Promise<void>`, next to `updatePhone`)
- Test: `frontend/src/lib/store.test.ts` (extend)

**Interfaces:**
- Consumes: `PATCH /api/account/whatsapp` and `whatsappEnabled` on the user (Task 7).
- Copy, exactly:
  - Notice: `هنبعتلك على واتساب رسايل عن حسابك وتجربتك. تقدر توقفها في أي وقت.`
  - Panel title: `رسايل واتساب`
  - Panel description: `نصايح وتنبيهات عن حسابك وتجربتك والعروض. بتوصلك على الرقم المسجّل.`
  - Switch label: `ابعتولي رسايل واتساب`

- [ ] **Step 1: Write the failing test:** `setWhatsappEnabled(false)` calls `PATCH /api/account/whatsapp` with `{ enabled: false }` and updates `user.whatsappEnabled`. Follow the existing store tests' fetch mock.
- [ ] **Step 2: Implement** the store action, the notice (`text-[12px] text-muted-foreground`, under the input) and the panel with the existing `Switch` from `@/components/ui/switch`.
- [ ] **Step 3: Commit** `feat(whatsapp): signup notice and settings switch`.

### Task 11: Frontend: admin tab and users badge

**Files:**
- Create: `frontend/src/components/admin/whatsapp-tab.tsx`
- Modify: `frontend/src/routes/_app.admin.tsx` (adds `TabsTrigger value="whatsapp"` labelled `رسايل واتساب`, shown when `isPlatformAdmin`, read-only for Marketers), `frontend/src/components/admin/users-screen.tsx` (badge next to the follow-up boxes)
- Test: `frontend/src/components/admin/whatsapp-tab.test.tsx`

**Interfaces:**
- Consumes: `GET /api/admin/whatsapp/steps` and `PUT /api/admin/whatsapp/steps/:key` (Task 7), and the `whatsapp` field on user rows.
- Step titles in Arabic: `trial_welcome` ترحيب وتفعيل · `trial_stoploss` نصيحة وقف الخسارة · `trial_ending` قرب نهاية التجربة · `trial_ended` نهاية التجربة · `paid_welcome` ترحيب بالمشترك · `survey` استبيان · `renewal` عرض التجديد.
- Badge text: `عرض ساري: خصم {pct}٪ لحد {date}` with the date in ar-EG `day month`. Last-step text: `آخر رسالة: {title} · {status}`, where status is one of `اتبعتت`, `وصلت`, `اتقرت`, `فشلت`, `مستنية`.
- A banner on the tab when `liveSending === false`: `وضع التجربة: الرسايل بتروح للأرقام المسموح بيها بس.`

- [ ] **Step 1: Write the failing test:** the tab renders the seven cards from a mocked response; Marketer mode disables every input; saving a card sends a `PUT` with the edited `discountPct`; the preview shows the filled-in text using sample values (`أحمد`, today + validDays).
- [ ] **Step 2: Implement.** Each card has: the switch, the template name input, the offer fields for its params, the preview (Arabic, with placeholders filled in and in the same order as Task 4), 30-day counts, and survey answer counts on the `survey` card.
- [ ] **Step 3: Commit** `feat(whatsapp): admin tab and users badge`.

### Task 12: n8n workflow alignment and the PR

**Files:**
- Modify: `automation/n8n/README.md` (adds the Stage 2 recipe: point the hosts at the test backend, set `WHATSAPP_ALLOWED_PHONES`, run the seed script)

- [ ] **Step 1: Check** that `automation/n8n/whatsapp-lifecycle.json` matches the final contracts: `/due` → `items[].messageId|request`; `/result` body fields; `/events` body shapes; `reply.to|text`. Fix any drift in the JSON and re-validate with the connection check from the spec commit (`node -e` parse plus node-name check).
- [ ] **Step 2: Open the PR** from `feat/whatsapp-lifecycle`. The body must cover:
  - **The public paths:** the three `/api/automation/whatsapp/*` paths, secret-protected.
  - **The schema block:** run it on the test project, then production before merging.
  - **The env vars.**
  - **The Stage 1 output** from Task 8.
  - **Stage 2:** pending, the user runs it with the team's phones.
  - **Steps ship disabled.**
- [ ] **Step 3: Commit** `docs(whatsapp): n8n stage-2 recipe`.
