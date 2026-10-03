# Portfolio Storage & Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the one-`portfolios`-row-per-User storage (`user_id` primary key, one `state_json` blob) with one row per Portfolio, move the User-level quota/Credit counters off that blob onto `users`, and migrate every tenant database — all with **zero observable behavior change**. After this plan, the app still looks and behaves exactly as a single-Portfolio app; it is just backed by the schema multi-Portfolio support needs.

**Architecture:** `portfolios` becomes `(id, user_id, name, style, ordinal, state_json, deleted_at)`; `recommendations` and `portfolio_reviews` gain a non-nullable `portfolio_id`; quota/Credits move to new `users` columns. `portfolio.js`'s existing `userId`-keyed functions (`loadPortfolio`, `savePortfolio`, `withPortfolio`) keep their exact call signatures by resolving "this User's one Portfolio" internally — so no caller outside `db.js`/`portfolio.js`/the quota helpers in `server.js` changes in this plan. A second one-time SQL script backfills existing tenant databases; `schema.sql` is updated so a brand-new tenant gets the target shape directly.

**Tech Stack:** Node.js, Supabase/Postgres, `node:test` against a real (shared, per-test-user-isolated) Supabase project — see `backend/test/helpers/env.js`.

**Spec:** [ADR 0002](https://github.com/BelalElkady/alytic/blob/wayfinder/adr-0002-portfolio-storage/docs/adr/0002-portfolio-storage-and-migration.md), resolving issue #100 on map #98.

## Test Baseline

Before any task in this plan, the full suite was run (`npm test` in `backend/`) to get a true baseline, not a guess from file headers:

- **383 pass, 1 skip, 1 pre-existing fail — none caused by this plan.**
- `backend/test/modules/analyze.test.js`'s "an open position gets live P&L, trailing-stop logic and triggers" is now `{ skip }`ped (fixed in this baseline pass, not a task): it calls `analyzeTicker` directly with a `position`, which reaches `getOrGenerateTrailingStop` → `requestStructuredOR`, which throws *before any network call* when `OPENROUTER_API_KEY` is blank (`clientOpenRouter.js:98` — the test harness blanks it for every file, by design, so no test can ever send a real request to OpenRouter). This is the one test in the whole suite that needs a real key; it was already broken on `main` (its own header admits as much) and is unrelated to Portfolio storage.
- `backend/test/unit/lastVerdict.test.js` was failing at import time (missing the required `import '../helpers/env.js';` as its first import, so `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` were never loaded). Fixed in this baseline pass, not a task — a one-line, pre-existing, unrelated bug.
- `backend/test/api/analysis.test.js`'s "the cash plan sizes candidates against the sector the book is already in" **still fails** — a plain assertion mismatch (`false !== true`) in cash-plan sizing logic, nothing to do with AI/OpenRouter and nothing this plan's tasks touch. **Every "run the full suite" step below expects this one failure and no others** — if a different test fails, that is this plan's regression; if this one and only this one fails, that is the known baseline.

## Global Constraints

- **Zero behavior change.** Every existing endpoint, test, and admin-panel view must behave identically after this plan. Multi-Portfolio behavior (creating a second Portfolio, the `X-Portfolio-Id` header, the tier cap) is explicitly **out of scope** — later plans (#101, #102, #103).
- **`imports` stays on the Portfolio.** Per the corrected ADR 0002 §2: `portfolio.imports` (an array of `{importedAt, positions, source}`) is per-Portfolio behavioral history, not a User-level quota fact. Do not move it.
- **`style` column exists but is not yet consulted.** Add the `style` column to `portfolios` and backfill it from `state_json.settings.investStyle`, but do not change any endpoint's behavior around style — "the server becomes authoritative for style" (ADR 0002 §3) is enforcement work that belongs to #101, once a request can name which Portfolio it means.
- **One Portfolio per User, still.** No task in this plan adds a way to create a second Portfolio. `getAllPortfolios()` and every quota/cap helper can therefore assume exactly one Portfolio per User throughout this plan.
- **Migration is a one-time, by-hand SQL script per tenant**, matching this repo's existing convention (`schema.sql` is "run once in the Supabase project's SQL editor"; see also `recommendations-cron.sql`, `seed-track-record-test.sql` as precedent for separate one-off files). It is not run by CI or by application code.
- **The per-user write lock closes the quota+book race** (see Task 6) — `withPortfolio`, `withUserUsage`, and `withPortfolioAndUsage` must share one lock queue keyed by `userId`, not three independent queues, or the TOCTOU race the lock exists to close comes back.

## Review Focus

- **A User with no `portfolios` row today** (lazily created on first write) must still get exactly one Portfolio after migration — the backfill must `left join` from `users`, not iterate the old `portfolios` table alone. Covered in Task 1 / Task 8.
- **Existing `recommendations` and `portfolio_reviews` rows** must have `portfolio_id` backfilled *before* the column is made `not null`, or the migration fails outright on any tenant with existing data. Covered in Task 1.
- **The append-only guard trigger** must treat `portfolio_id` as frozen on UPDATE, exactly like every other issue field — an update that nulls or changes it must raise, the same way changing `style` already does. Covered in Task 1 / Task 5.
- **The CLI/dev account `'local'`** (used by `backend/src/cli.js` and as `withPortfolio`'s default `userId`) must resolve a primary Portfolio id like any other User — it has a `users` row (recreated by `schema.sql` on every run) so the same backfill covers it, but Task 1 Step 8's verification must check it explicitly.
- **`recommendations_daily_key`'s unique index** is recreated under the *same name* with a *different* column list (`user_id, ticker, action, issued_on` → `user_id, portfolio_id, ticker, action, issued_on`). `create unique index if not exists` is a no-op if an index of that name already exists — the migration script must `drop index` first, or the old (wrong) index silently survives. Covered in Task 1.

---

## File Structure

- **Modify:** `backend/supabase/schema.sql` — target shape for a brand-new tenant (`portfolios`, `users`, `portfolio_reviews`, `recommendations`, `recommendations_guard()`, `recommendations_daily_key`).
- **Create:** `backend/supabase/migrate-multi-portfolio.sql` — one-time, by-hand migration for an existing tenant database.
- **Modify:** `backend/src/db.js` — Portfolio CRUD by id, User-usage CRUD, re-keyed `portfolio_reviews` functions, `recommendations` functions gain `portfolio_id`.
- **Modify:** `backend/src/portfolio.js` — `loadPortfolio`/`savePortfolio`/`withPortfolio` resolve the primary Portfolio id internally; new `withUserUsage`/`withPortfolioAndUsage` lock primitives.
- **Modify:** `backend/src/recommendations.js` — `recommendationRow`/`logRecommendations` gain a `portfolioId` parameter.
- **Modify:** `backend/src/agent/analyst.js`, `backend/src/agent/cashAnalysis.js`, `backend/src/agent/stopPlanner.js` — pass `portfolioId` instead of `userId` to `getPortfolioReview`/`putPortfolioReview`.
- **Modify:** `backend/src/api/server.js` — quota/Credit helpers (`usageFor`, `bumpUsage`, `creditsOf`, `addCredits`, `baseLeftFor`, `leftFor`, `withinScanSession`/`chargeScanSession`) read/write the new User-usage store instead of the portfolio blob; the two combined charge call sites (screenshot import, stock review) and the admin Credits grant switch locks accordingly; every `analyzeTicker`/`analyzeMany`/`getOrGenerateReview`/`getOrGenerateCashReview` call site resolves and passes `portfolioId` instead of `userId`.
- **Modify:** `backend/src/analyze.js`, `backend/src/cli.js` — `analyzeTicker`'s `userId` option renamed `portfolioId`, and its one caller in `cli.js`.
- **Test:** `backend/test/modules/portfolio.test.js` (existing — must keep passing unchanged), `backend/test/modules/portfolio-storage.test.js` (new, for Tasks 2–5).

---

### Task 1: Schema — target shape and the one-time migration

**Files:**
- Modify: `backend/supabase/schema.sql`
- Create: `backend/supabase/migrate-multi-portfolio.sql`

**Interfaces:**
- Produces: the `portfolios` table shape `(id bigint pk, user_id text, name text, style text, ordinal integer, state_json jsonb, deleted_at timestamptz, created_at, updated_at)`; `portfolio_reviews` primary key `(portfolio_id, report_date, style)`; `recommendations.portfolio_id` (not null, frozen by the guard trigger); `users` columns `usage_month, usage_cash_scans, usage_recommendations, usage_screenshots, usage_market_analysis, credits_cash_scans, credits_recommendations, credits_screenshots, credits_market_analysis, last_cash_scan_at, last_market_scan_at`.

- [ ] **Step 1: Replace the `portfolios` table block in `schema.sql`**

```sql
create table if not exists portfolios (
  id bigint generated always as identity primary key,
  user_id text not null references users(id) on delete cascade,
  name text not null,
  style text,
  ordinal integer not null default 0,
  state_json jsonb not null default '{}'::jsonb,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_portfolios_user on portfolios (user_id) where deleted_at is null;
```

A comment above the block should note: this `create table if not exists` only creates the *new* shape for a tenant that has never had a `portfolios` table. An existing tenant's old-shape table is migrated by `migrate-multi-portfolio.sql`, run once, by hand, before this block is next applied there.

- [ ] **Step 2: Add the `users` quota/Credit columns, after the existing `alter table users` block**

```sql
alter table users add column if not exists usage_month text;
alter table users add column if not exists usage_cash_scans integer not null default 0;
alter table users add column if not exists usage_recommendations integer not null default 0;
alter table users add column if not exists usage_screenshots integer not null default 0;
alter table users add column if not exists usage_market_analysis integer not null default 0;
alter table users add column if not exists credits_cash_scans integer not null default 0;
alter table users add column if not exists credits_recommendations integer not null default 0;
alter table users add column if not exists credits_screenshots integer not null default 0;
alter table users add column if not exists credits_market_analysis integer not null default 0;
alter table users add column if not exists last_cash_scan_at timestamptz;
alter table users add column if not exists last_market_scan_at timestamptz;
```

These are safe to re-run (`if not exists`, all with safe defaults) on an existing tenant directly — unlike `portfolios`, no rename-and-recreate is needed here.

- [ ] **Step 3: Change the `portfolio_reviews` table block to the new key**

```sql
create table if not exists portfolio_reviews (
  portfolio_id bigint not null references portfolios(id) on delete restrict,
  user_id text not null references users(id) on delete cascade,
  report_date text not null,
  style text not null,
  portfolio_hash text not null,
  review_json jsonb not null,
  model text,
  usage_json jsonb,
  generated_at timestamptz not null default now(),
  primary key (portfolio_id, report_date, style)
);
```

(`on delete restrict`, not `cascade`: Portfolios are soft-deleted per ADR 0002 §5, so this FK action never actually fires — it documents that a hard delete here would be a bug, not a supported path.)

- [ ] **Step 4: Add `portfolio_id` to `recommendations`, update the guard trigger, update the dedupe index**

In the `recommendations` table block, add (directly in the `create table` body, since a brand-new tenant has no legacy rows to backfill):

```sql
  portfolio_id bigint not null references portfolios(id) on delete restrict,
```

In `recommendations_guard()`'s `UPDATE` branch, add `new.portfolio_id`/`old.portfolio_id` to the frozen-tuple comparison, alongside the existing `style` field:

```sql
  if (new.id, new.ticker, new.action, new.ref_price, new.target_price, new.stop_price, new.horizon_days,
      new.egx30_at_issue, new.model_version, new.issued_at, new.issued_on, new.source, new.style,
      new.benchmark, new.indices_at_issue, new.portfolio_id)
     is distinct from
     (old.id, old.ticker, old.action, old.ref_price, old.target_price, old.stop_price, old.horizon_days,
      old.egx30_at_issue, old.model_version, old.issued_at, old.issued_on, old.source, old.style,
      old.benchmark, old.indices_at_issue, old.portfolio_id) then
    raise exception 'recommendation %: issue fields are immutable', old.id;
  end if;
```

Change `recommendations_daily_key`'s definition:

```sql
create unique index if not exists recommendations_daily_key on recommendations (user_id, portfolio_id, ticker, action, issued_on);
```

- [ ] **Step 5: Write `backend/supabase/migrate-multi-portfolio.sql`** — the one-time script for a tenant that already has data. Header comment: "Run once, by hand, in the Supabase SQL editor, against a tenant that already has a `portfolios` table in the old (`user_id` primary key) shape. Back up first. After this succeeds, `schema.sql` is safe to (re-)apply to the same database."

```sql
begin;

alter table portfolios rename to portfolios_legacy;

create table portfolios (
  id bigint generated always as identity primary key,
  user_id text not null references users(id) on delete cascade,
  name text not null,
  style text,
  ordinal integer not null default 0,
  state_json jsonb not null default '{}'::jsonb,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_portfolios_user on portfolios (user_id) where deleted_at is null;

-- Every User gets exactly one Portfolio: from their legacy row if they had
-- one, or a fresh empty book if they didn't (lazy creation under the old
-- scheme — see Review Focus).
insert into portfolios (user_id, name, style, ordinal, state_json, created_at, updated_at)
select
  u.id,
  'المحفظة الرئيسية',
  pl.state_json -> 'settings' ->> 'investStyle',
  0,
  coalesce(pl.state_json, '{}'::jsonb) - 'usage' - 'credits' - 'lastCashScanAt' - 'lastMarketScanAt',
  coalesce(pl.created_at, now()),
  coalesce(pl.updated_at, now())
from users u
left join portfolios_legacy pl on pl.user_id = u.id;

-- User-level quota/Credits, extracted from whatever legacy blob existed.
update users u set
  usage_month = pl.state_json -> 'usage' ->> 'month',
  usage_cash_scans = coalesce((pl.state_json -> 'usage' ->> 'cashScans')::int, 0),
  usage_recommendations = coalesce((pl.state_json -> 'usage' ->> 'recommendations')::int, 0),
  usage_screenshots = coalesce((pl.state_json -> 'usage' ->> 'screenshots')::int, 0),
  usage_market_analysis = coalesce((pl.state_json -> 'usage' ->> 'marketAnalysis')::int, 0),
  credits_cash_scans = coalesce((pl.state_json -> 'credits' ->> 'cashScans')::int, 0),
  credits_recommendations = coalesce((pl.state_json -> 'credits' ->> 'recommendations')::int, 0),
  credits_screenshots = coalesce((pl.state_json -> 'credits' ->> 'screenshots')::int, 0),
  credits_market_analysis = coalesce((pl.state_json -> 'credits' ->> 'marketAnalysis')::int, 0),
  last_cash_scan_at = (pl.state_json ->> 'lastCashScanAt')::timestamptz,
  last_market_scan_at = (pl.state_json ->> 'lastMarketScanAt')::timestamptz
from portfolios_legacy pl
where pl.user_id = u.id;

-- portfolio_reviews: add the column, backfill, then re-key.
alter table portfolio_reviews add column if not exists portfolio_id bigint references portfolios(id) on delete restrict;
update portfolio_reviews pr set portfolio_id = p.id from portfolios p where p.user_id = pr.user_id;
alter table portfolio_reviews alter column portfolio_id set not null;
alter table portfolio_reviews drop constraint portfolio_reviews_pkey;
alter table portfolio_reviews add primary key (portfolio_id, report_date, style);

-- recommendations: add the column, backfill, re-key, then re-key the dedupe index.
alter table recommendations add column if not exists portfolio_id bigint references portfolios(id) on delete restrict;
update recommendations r set portfolio_id = p.id from portfolios p where p.user_id = r.user_id;
alter table recommendations alter column portfolio_id set not null;
drop index if exists recommendations_daily_key;
create unique index recommendations_daily_key on recommendations (user_id, portfolio_id, ticker, action, issued_on);

commit;

-- Not run automatically: once the application has been redeployed against
-- the new shape and the verification queries below all check out, drop
-- portfolios_legacy by hand.
```

- [ ] **Step 6: Commit**

```bash
git add backend/supabase/schema.sql backend/supabase/migrate-multi-portfolio.sql
git commit -m "feat(schema): Portfolio becomes a first-class row, quota moves to users"
```

- [ ] **Step 7: Apply `migrate-multi-portfolio.sql` to the dev/test Supabase project now** — the one `backend/.env`'s `SUPABASE_URL` points at, the same one every task's tests run against (`backend/test/helpers/env.js`). Back it up first (Supabase dashboard → Database → Backups, or `pg_dump`). Tasks 2–7's tests cannot pass before this step runs — they query the new shape.

- [ ] **Step 8: Run the verification queries below, confirming each listed result** — right after applying, so a bad migration is caught here, not six tasks later.

```sql
-- Every user has exactly one, non-deleted Portfolio.
select count(*) from users u
where (select count(*) from portfolios p where p.user_id = u.id and p.deleted_at is null) <> 1;
-- expected: 0

-- No recommendation or review row is missing its portfolio_id (both tables
-- are typically near-empty on a dev/test project, but the check costs
-- nothing and catches a backfill-order mistake immediately).
select count(*) from recommendations where portfolio_id is null;   -- expected: 0
select count(*) from portfolio_reviews where portfolio_id is null; -- expected: 0

-- The 'local' CLI account resolved a Portfolio too.
select count(*) from portfolios where user_id = 'local'; -- expected: 1

-- The dedupe index now includes portfolio_id.
select indexdef from pg_indexes where indexname = 'recommendations_daily_key';
-- expected: ...(user_id, portfolio_id, ticker, action, issued_on)
```

---

### Task 2: `db.js` — Portfolio CRUD by id

**Files:**
- Modify: `backend/src/db.js:214-234` (replaces `getPortfolio`/`putPortfolio`), `backend/src/db.js:708-712` (`getAllPortfolios`)
- Test: `backend/test/modules/portfolio-storage.test.js` (new)

**Interfaces:**
- Consumes: nothing new (reuses `supabase` client already imported in `db.js`).
- Produces:
  - `getPortfolioById(portfolioId): Promise<{id, userId, name, style, ordinal, state: object}|null>`
  - `putPortfolioById(portfolioId, state): Promise<void>`
  - `primaryPortfolioIdFor(userId): Promise<number>` — the lowest-`ordinal`, non-deleted Portfolio id for this User. Throws if none exists (should not happen post-migration; Task 8 verifies this).
  - `getAllPortfolios(): Promise<{id, user_id, state_json}[]>` — same raw-row shape as today (its two callers, the admin users list and the daily close, already read `row.user_id`/`row.state_json` and are not touched by this plan), with `id` added to the `select`. Still one row per User (Global Constraints: at most one Portfolio exists per User until a later plan).

- [ ] **Step 1: Write the failing test**

```js
test('primaryPortfolioIdFor resolves the migrated Portfolio for a freshly-registered user', async () => {
  // register() returns nothing by design — read the created row back by email.
  const email = uniqueEmail();
  await register({ email, phone: uniquePhone(), password: 'x'.repeat(8) });
  const user = await getUserByEmail(email);
  // A freshly-registered user has no portfolios row yet under the old scheme —
  // after migration every user has exactly one. This test only passes once
  // Task 1's migration has run against the test database.
  const id = await primaryPortfolioIdFor(user.id);
  assert.equal(typeof id, 'number');
  const loaded = await getPortfolioById(id);
  assert.equal(loaded.userId, user.id);
  assert.equal(loaded.name, 'المحفظة الرئيسية');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test backend/test/modules/portfolio-storage.test.js`
Expected: FAIL — `primaryPortfolioIdFor is not a function`

- [ ] **Step 3: Implement `getPortfolioById`, `putPortfolioById`, `primaryPortfolioIdFor`, update `getAllPortfolios`** in `backend/src/db.js`

`primaryPortfolioIdFor` queries `portfolios` for the given `user_id`, `deleted_at is null`, ordered by `ordinal` ascending, `limit 1`, selecting only `id`. `getPortfolioById`/`putPortfolioById` mirror the existing `getPortfolio`/`putPortfolio` shape (select/update-or-insert) but key on `id` instead of `user_id`, and `putPortfolioById` also bumps `updated_at`. `getAllPortfolios` adds `id` to its `select`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test backend/test/modules/portfolio-storage.test.js`
Expected: PASS (only after Task 1 Step 7 has applied the migration to the test database)

- [ ] **Step 5: Commit**

```bash
git add backend/src/db.js backend/test/modules/portfolio-storage.test.js
git commit -m "feat(db): Portfolio CRUD by id"
```

---

### Task 3: `db.js` — User-usage CRUD

**Files:**
- Modify: `backend/src/db.js`
- Test: `backend/test/modules/portfolio-storage.test.js`

**Interfaces:**
- Produces:
  - `getUserUsage(userId): Promise<{month: string, cashScans: number, recommendations: number, screenshots: number, marketAnalysis: number, credits: {cashScans, recommendations, screenshots, marketAnalysis}, lastCashScanAt: string|null, lastMarketScanAt: string|null}>` — reads the new `users` columns. **Performs the month-rollover check that the old `usageFor(portfolio)` did** (`backend/src/api/server.js:803-806`, being retired — see Task 7): if the stored `usage_month` is not `cairoToday().slice(0,7)`, the four `usage*` counters come back zeroed (unpersisted — nothing is written until something actually bumps a counter), with `month` set to the *current* month in the returned object either way. `credits`/`lastCashScanAt`/`lastMarketScanAt` are never month-scoped and always pass through unchanged. `cashScans`/`recommendations`/`screenshots`/`marketAnalysis` are never null (default 0); `credits.*` likewise.
  - `putUserUsage(userId, usage): Promise<void>` — `usage` is the same shape; writes every column, including whatever `month` the caller passed (callers always pass `getUserUsage`'s own current-month output back, per `bumpUsage`'s contract in Task 7).

- [ ] **Step 1: Write the failing test**

```js
test('getUserUsage defaults a fresh user to zero, and putUserUsage round-trips', async () => {
  // register() returns nothing by design — read the created row back by email.
  const email = uniqueEmail();
  await register({ email, phone: uniquePhone(), password: 'x'.repeat(8) });
  const user = await getUserByEmail(email);
  const zero = await getUserUsage(user.id);
  assert.equal(zero.screenshots, 0);
  assert.equal(zero.credits.recommendations, 0);
  await putUserUsage(user.id, { ...zero, screenshots: 2, credits: { ...zero.credits, recommendations: 5 } });
  const after = await getUserUsage(user.id);
  assert.equal(after.screenshots, 2);
  assert.equal(after.credits.recommendations, 5);
});

test('getUserUsage rolls the four usage counters over on a stale stored month, but never credits', async () => {
  const email = uniqueEmail();
  await register({ email, phone: uniquePhone(), password: 'x'.repeat(8) });
  const user = await getUserByEmail(email);
  const current = await getUserUsage(user.id);
  await putUserUsage(user.id, { ...current, month: '2000-01', screenshots: 9, credits: { ...current.credits, recommendations: 3 } });
  const rolled = await getUserUsage(user.id);
  assert.equal(rolled.month, current.month); // the CURRENT month, not the stale '2000-01'
  assert.equal(rolled.screenshots, 0); // zeroed — stale month
  assert.equal(rolled.credits.recommendations, 3); // credits are never month-scoped
});
```

- [ ] **Step 2: Run both tests to verify they fail**

Run: `node --test backend/test/modules/portfolio-storage.test.js`
Expected: FAIL — `getUserUsage is not a function`

- [ ] **Step 3: Implement `getUserUsage`/`putUserUsage` in `backend/src/db.js`**, reading/writing the eleven `users` columns from Task 1 Step 2, mapping `usage_cash_scans` ↔ `cashScans` etc. `getUserUsage` performs the month-rollover check per its Interfaces-block description above.

- [ ] **Step 4: Run both tests to verify they pass**

Run: `node --test backend/test/modules/portfolio-storage.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/db.js backend/test/modules/portfolio-storage.test.js
git commit -m "feat(db): User-level usage/Credits CRUD"
```

---

### Task 4: `db.js` — re-key `portfolio_reviews` to `portfolio_id`

**Files:**
- Modify: `backend/src/db.js:399-437` (`getPortfolioReview`, `putPortfolioReview`)
- Test: `backend/test/modules/portfolio-storage.test.js`

**Interfaces:**
- Consumes: `primaryPortfolioIdFor` (Task 2) in the test, to get a real Portfolio id.
- Produces: `getPortfolioReview(portfolioId, reportDate, style)`, `putPortfolioReview(portfolioId, reportDate, style, portfolioHash, review, model, usage)` — same return/parameter shapes as today, `userId` parameter renamed `portfolioId`, and `putPortfolioReview` additionally looks up and writes that Portfolio's `user_id` into the row's `user_id` column (denormalized, per ADR 0002 §4).

- [ ] **Step 1: Write the failing test**

```js
test('putPortfolioReview/getPortfolioReview round-trip by portfolio id', async () => {
  // register() returns nothing by design — read the created row back by email.
  const email = uniqueEmail();
  await register({ email, phone: uniquePhone(), password: 'x'.repeat(8) });
  const user = await getUserByEmail(email);
  const portfolioId = await primaryPortfolioIdFor(user.id);
  await putPortfolioReview(portfolioId, '2026-10-03', 'medium', 'hash1', { verdict: 'hold' }, 'model-x', null);
  const got = await getPortfolioReview(portfolioId, '2026-10-03', 'medium');
  assert.equal(got.portfolioHash, 'hash1');
  assert.equal(got.verdict, 'hold');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test backend/test/modules/portfolio-storage.test.js`
Expected: FAIL (queries `.eq('user_id', portfolioId)` against the old key — no match, or a type error once the column is gone)

- [ ] **Step 3: Update `getPortfolioReview`/`putPortfolioReview`** to query/upsert on `portfolio_id` (and, in `putPortfolioReview`, resolve and write `user_id` alongside it via a small join or a second lookup — reuse `getPortfolioById` from Task 2 to get the owning `userId`). Update the `upsert`'s `onConflict` to `'portfolio_id,report_date,style'`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test backend/test/modules/portfolio-storage.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/db.js backend/test/modules/portfolio-storage.test.js
git commit -m "feat(db): re-key portfolio_reviews to portfolio_id"
```

---

### Task 5: Recommendations gain `portfolio_id`

**Files:**
- Modify: `backend/src/db.js:1014-1038` (`insertRecommendations`, `listOpenRecommendationKeys`)
- Modify: `backend/src/recommendations.js:120-212` (`recommendationRow`, `withoutOpenDuplicates`, `logRecommendations`)
- Test: `backend/test/modules/portfolio-storage.test.js`

**Interfaces:**
- Consumes: `primaryPortfolioIdFor` (Task 2).
- Produces:
  - `listOpenRecommendationKeys(portfolioId)` — renamed parameter; scopes the open-call lookup to one Portfolio (per ADR 0002 §4's per-Portfolio dedupe decision).
  - `insertRecommendations(rows)` — unchanged signature; `rows` must now include `portfolio_id`, and the `onConflict` target becomes `'user_id,portfolio_id,ticker,action,issued_on'`.
  - `recommendationRow({ userId, portfolioId, code, action, levels, style, source, model, indices, benchmark })` — gains `portfolioId`, sets it on the returned row.
  - `logRecommendations(userId, portfolioId, items, { source, style, model })` — gains `portfolioId`, passed through to `recommendationRow` and to `listOpenRecommendationKeys`.

- [ ] **Step 1: Write the failing test**

```js
test('logRecommendations tags rows with the given portfolio and dedupes within it', async () => {
  // register() returns nothing by design — read the created row back by email.
  const email = uniqueEmail();
  await register({ email, phone: uniquePhone(), password: 'x'.repeat(8) });
  const user = await getUserByEmail(email);
  const portfolioId = await primaryPortfolioIdFor(user.id);
  await logRecommendations(user.id, portfolioId, [{ code: 'COMI', action: 'buy', levels: { refPrice: 10, target: 12, stop: 9 } }], { source: 'test', style: 'medium', model: 'test' });
  const keys = await listOpenRecommendationKeys(portfolioId);
  assert.ok(keys.includes('COMI:buy'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test backend/test/modules/portfolio-storage.test.js`
Expected: FAIL — `logRecommendations` called with the wrong arity, or the insert violates `recommendations.portfolio_id not null`

- [ ] **Step 3: Implement the signature changes** in `recommendations.js` and `db.js` per the Interfaces block above. `withoutOpenDuplicates(rows, openKeys)` itself is unchanged — only its caller (`logRecommendations`) now scopes `openKeys` by Portfolio.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test backend/test/modules/portfolio-storage.test.js`
Expected: PASS

- [ ] **Step 5: Update the three agent callers** — `backend/src/agent/analyst.js:639` (`getOrGenerateReview`'s `opts.userId` → `opts.portfolioId`, passed to `getPortfolioReview`/`putPortfolioReview`), `backend/src/agent/cashAnalysis.js:262` (`getOrGenerateCashReview`'s `opts.userId` → `opts.portfolioId`), `backend/src/agent/stopPlanner.js:132,198` (`getOrGenerateTrailingStop`/`getLiveTrailingStop`'s `userId` parameter → `portfolioId`). Each caller resolves the id via `primaryPortfolioIdFor` at its own call site in `server.js` (Task 7) — these three files only rename the parameter they already thread through.

- [ ] **Step 6: Write a failing test for the guard trigger's new frozen field** — no existing test covers `recommendations_guard()`'s immutability at all (checked: `grep -rl "recommendations_guard" backend/test` finds nothing), and Task 1 Step 4 added `portfolio_id` to its frozen tuple, so this is the first test of that trigger behavior, not just of this field.

```js
test('recommendations_guard refuses to change portfolio_id on an existing row, like every other issue field', async () => {
  // register() returns nothing by design — read the created row back by email.
  const email = uniqueEmail();
  await register({ email, phone: uniquePhone(), password: 'x'.repeat(8) });
  const user = await getUserByEmail(email);
  const portfolioId = await primaryPortfolioIdFor(user.id);
  await logRecommendations(user.id, portfolioId, [{ code: 'COMI', action: 'buy', levels: { refPrice: 10, target: 12, stop: 9 } }], { source: 'test', style: 'medium', model: 'test' });
  const [{ id }] = await listRecommendations({ userId: user.id }); // existing db.js helper, returns full rows
  const { error } = await supabase.from('recommendations').update({ portfolio_id: portfolioId + 1 }).eq('id', id);
  assert.match(error?.message ?? '', /issue fields are immutable/);
});
```

- [ ] **Step 7: Run it to verify it fails for the right reason first**

Run: `node --test backend/test/modules/portfolio-storage.test.js`
Expected: against the *pre-migration* schema this errors on a missing column, not the guard; run it only after Task 1 Step 7 has applied the migration — note that dependency in the test file alongside Task 2 Step 1's test.

- [ ] **Step 8: Run it again post-migration to verify it passes**

Run: `node --test backend/test/modules/portfolio-storage.test.js`
Expected: PASS — the `update` rejects with the guard's exception.

- [ ] **Step 9: Commit**

```bash
git add backend/src/db.js backend/src/recommendations.js backend/src/agent/analyst.js backend/src/agent/cashAnalysis.js backend/src/agent/stopPlanner.js backend/test/modules/portfolio-storage.test.js
git commit -m "feat: Recommendations and AI review caches key on portfolio_id"
```

---

### Task 6: `portfolio.js` — preserve call signatures, add the shared-lock primitives

**Files:**
- Modify: `backend/src/portfolio.js:31-105` (`loadPortfolio`, `savePortfolio`, `withPortfolio`)
- Test: `backend/test/modules/portfolio.test.js:172-192` (existing — must keep passing unchanged, proving zero behavior change)

**Interfaces:**
- Consumes: `primaryPortfolioIdFor`, `getPortfolioById`, `putPortfolioById` (Task 2); `getUserUsage`, `putUserUsage` (Task 3).
- Produces:
  - `loadPortfolio(userId='local')` — **signature unchanged**; internally resolves `primaryPortfolioIdFor(userId)` then `getPortfolioById`.
  - `savePortfolio(p, userId='local')` — **signature unchanged**; internally resolves the id then `putPortfolioById`.
  - `withPortfolio(userId, mutator)` — **signature unchanged**; same lock behavior as today, operating on the resolved primary Portfolio.
  - `withUserUsage(userId, mutator: (usage) => usage): Promise<usage>` — new. Loads via `getUserUsage`, calls `mutator`, saves via `putUserUsage`, through the **same** per-`userId` queue `withPortfolio` uses.
  - `withPortfolioAndUsage(userId, mutator: ({usage, portfolio}) => {usage, portfolio}): Promise<{usage, portfolio}>` — new. Loads both, calls `mutator` once, saves both, through the same queue. For the two call sites (Task 7) that must spend quota and write the book atomically.

- [ ] **Step 1: Confirm the existing regression test still describes the required behavior**

Read `backend/test/modules/portfolio.test.js:172-192` (`withPortfolio serialises concurrent writes`). No new test is written for this task — this existing test *is* the test: it must pass, unmodified, proving `withPortfolio(userId, mutator)` still behaves exactly as before.

- [ ] **Step 2: Run it against the current (pre-Task-6) code to confirm it currently passes**

Run: `node --test backend/test/modules/portfolio.test.js`
Expected: PASS (baseline, before this task's changes)

- [ ] **Step 3: Implement the signature-preserving refactor and the two new lock functions** in `backend/src/portfolio.js`. Keep the existing `writeQueues` map (keyed by `` `${tenant}:${userId}` ``) and route all three functions' critical sections through it, so they mutually exclude each other for the same User. Resolve the Global Constraints decision: there is one lock per User, not one per User plus one per Portfolio — a `withPortfolio` call and a `withUserUsage` call for the same User must queue behind each other.

- [ ] **Step 4: Run the existing test again to verify it still passes, unmodified**

Run: `node --test backend/test/modules/portfolio.test.js`
Expected: PASS — same assertions, same file, now running against the new implementation.

- [ ] **Step 5: Commit**

```bash
git add backend/src/portfolio.js
git commit -m "refactor(portfolio): resolve primary Portfolio id internally; add withUserUsage/withPortfolioAndUsage"
```

---

### Task 7: `server.js` — quota/Credit helpers and their call sites

**Files:**
- Modify: `backend/src/api/server.js` — `creditsOf`/`addCredits` (:780-792), `usageFor`/`bumpUsage`/`baseLeftFor`/`leftFor` (:797-826), `withinScanSession`/`chargeScanSession` (:1773-1798), the screenshot-import charge (:3032-3046), the stock-review charge (:~3226-3270), the admin Credits grant (:1246-1281), `GET /api/portfolio` (:2107-2128), `GET /api/admin/users` (:1154-1172, the `chosenStyle`/usage read — **leave the style read alone**, only touch usage), `/api/reset` (:2766-2776), the five `userId`-passing call sites into `analyzeTicker`/`analyzeMany` (:1674, :1875, :2408, :3097, :3245), the two agent-wrapper call sites `getOrGenerateReview` (:3107) and `getOrGenerateCashReview` (:3317), and all five `logRecommendations` call sites (:3086, :3116, :3276, :3336, :3387 — Task 5 Step 5 inserts `portfolioId` as `logRecommendations`'s new second positional argument, so every one of these breaks silently, by argument-shift not by error, if left unchanged).
- Modify: `backend/src/analyze.js` — `analyzeTicker`'s `opts.userId` (its doc comment already says its only use is "to key that position's own AI trailing-stop cache" — exactly the parameter `getOrGenerateTrailingStop`/`getLiveTrailingStop` renamed to `portfolioId` in Task 5 Step 5), and the one internal call site (:385, :403) passing it through.
- Modify: `backend/src/cli.js:90` — its one `analyzeTicker(code, { ..., userId: 'local' })` call site.

**Interfaces:**
- Consumes: `withUserUsage`, `withPortfolioAndUsage` (Task 6); `getUserUsage`/`putUserUsage`, `primaryPortfolioIdFor` (Task 3, Task 2); `getOrGenerateReview`/`getOrGenerateCashReview`/`getOrGenerateTrailingStop`/`getLiveTrailingStop` now taking `portfolioId` (Task 5 Step 5).
- Produces: `bumpUsage(usage, kind)`, `creditsOf(usage)`, `addCredits(usage, deltas)`, `baseLeftFor(kind, usage, tier)`, `leftFor(kind, usage, tier)` — same names, same return shapes, now taking a **User-usage record** (Task 3's `getUserUsage` shape) instead of a portfolio object. `withinScanSession(usage, kind)`, `chargeScanSession(userId, usage, kind, tier)` likewise. `analyzeTicker(code, { ...capital, rules, style, portfolioId })` — `userId` renamed. **`usageFor` is retired**: it only ever did the month-rollover check (`server.js:803-806`), which Task 3's `getUserUsage` now does itself — every former `usageFor(portfolio)` call becomes a direct `usage` parameter (already current-month-correct) passed in by the caller. `bumpUsage(usage, kind)` reads `usage[kind]` directly (no inner `usageFor` call); `baseLeftFor(kind, usage, tier)` likewise.

- [ ] **Step 1: Write the failing test** (API-level, exercising the existing screenshot quota behavior end-to-end)

```js
test('GET /api/portfolio reports the same screenshotImportsLeft after a charge as before this refactor', async () => {
  const { user, cookie } = await registerAndLogin();
  const before = await apiGet('/api/portfolio', cookie);
  assert.equal(before.screenshotImportsLeft, TIERS.free.screenshots);
  // ... perform one screenshot import (existing test helper) ...
  const after = await apiGet('/api/portfolio', cookie);
  assert.equal(after.screenshotImportsLeft, TIERS.free.screenshots - 1);
});
```

(This augments the existing suite in `backend/test/api/analysis.test.js` or `auth-portfolio.test.js` — place it next to whichever file already drives a screenshot import, reusing that file's existing helpers rather than inventing new ones.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test backend/test/api/analysis.test.js`
Expected: FAIL once Step 3 below changes the helpers' parameter shape without yet updating call sites — or PASS-then-regress if done in the wrong order. Do Step 3 as one atomic change across every call site listed above, then re-run.

- [ ] **Step 3: Rewire every helper and call site** per the Interfaces block. Delete `usageFor` (`server.js:803-806`) entirely — its two callers (`bumpUsage`, `baseLeftFor`) stop calling it, per the Interfaces block, so keeping it around would be dead code. In particular:
  - Screenshot-import charge (both branches, :3032 and :3032-3046-equivalent merge path): replace `withPortfolio(req.user.id, (portfolio) => {...bumpUsage...})` with `withPortfolioAndUsage(req.user.id, ({usage, portfolio}) => ({ usage: ...bumpUsage(usage,'screenshots')..., portfolio: ...unchanged book mutation... }))`.
  - Stock-review charge: same pattern — the quota bump and the `lastVerdicts` write become one `withPortfolioAndUsage` call.
  - `chargeScanSession`: no book write at all (confirmed — it only ever touches `usage`/`lastCashScanAt`/`lastMarketScanAt`) — becomes `withUserUsage(userId, (usage) => {...})`, dropping its `portfolio` parameter entirely; its two call sites (`/api/scan`'s cash-scan cap, `/api/review/cash`'s session check) stop passing a loaded portfolio for this purpose.
  - Admin Credits grant (:1246): `withPortfolio(userId, ...)` → `withUserUsage(userId, ...)`.
  - `GET /api/portfolio`: load `p` (the book) and `usage` (via `getUserUsage`) separately; pass `usage` to `screenshotImportsLeft`/`cashScansLeft`/`leftFor`/`creditsOf` instead of `p`.
  - `/api/reset`: the comment "`scope=all` keeps the User-level fields alive on purpose" now means: don't touch the `users` usage columns at all, regardless of `scope` — remove the field-preservation logic from the portfolio-reset path entirely, since those fields no longer live there.
  - `GET /api/admin/users` (:1228-1235, the `usage` figure only — leave `chosenStyle`'s blob read untouched per Global Constraints): read via `getAllUsers()`'s existing row data plus a batched usage read, not `getAllPortfolios()`.

- [ ] **Step 4: Rename `analyzeTicker`'s `opts.userId` to `opts.portfolioId`** in `backend/src/analyze.js` (its one internal use, at the `getOrGenerateTrailingStop`/`getLiveTrailingStop` call around :385-403, already expects `portfolioId` after Task 5 Step 5). Then, at each of its five callers in `server.js` (:1674, :1875, :2408, :3097, :3245) and its one caller in `cli.js:90`, resolve `const portfolioId = await primaryPortfolioIdFor(userId);` once alongside the existing `loadPortfolio(userId)`/`req.user.id` in that handler, and pass `portfolioId` instead of `userId` into the options object. Do the same at the two agent-wrapper call sites, `getOrGenerateReview(...,  { portfolioId, rules, style, force })` (:3107) and `getOrGenerateCashReview(portfolio, { portfolioId, ... })` (:3317) — both handlers already have `req.user.id` in scope, so this is the same one-line resolve, reused.

- [ ] **Step 5: Insert `portfolioId` into all five `logRecommendations` call sites** (`logRecommendations(userId, portfolioId, items, {...})`, per Task 5 Step 5's new signature). Three of these sit in handlers Step 4 already resolved a `portfolioId` in — reuse that same variable, don't re-resolve: the market-report-fallback and portfolio-review calls (:3086, :3116, in the handler that calls `getOrGenerateReview` at :3107), and the cash-review call (:3336, in the handler that calls `getOrGenerateCashReview` at :3317). The stock-review call (:3276) is in the handler whose `analyzeMany` call (:3245) Step 4 already resolved a `portfolioId` for — reuse it. The market-analysis call (:3387, inside `GET /api/market-analysis`) has no existing `portfolioId` in scope — add `const portfolioId = await primaryPortfolioIdFor(req.user.id);` right before it.

- [ ] **Step 6: Run test to verify it passes**

Run: `node --test backend/test/api/analysis.test.js`
Expected: PASS

- [ ] **Step 7: Run the full existing backend suite to confirm no regression**

Run: `npm test` (in `backend/`; runs `node --test "test/**/*.test.js"` then cleans up test data)
Expected: every pre-existing test passes, plus every new test Tasks 2–7 added, with exactly the one known pre-existing exception from the Test Baseline (`analysis.test.js`'s cash-plan sizing) still failing and no other. A *different* failing test is this task's regression; a higher pass count than the baseline's 383 is expected (Tasks 2–7's new tests), not a red flag.

- [ ] **Step 8: Commit**

```bash
git add backend/src/api/server.js backend/src/analyze.js backend/src/cli.js backend/test/api/analysis.test.js
git commit -m "feat(api): quota/Credits read from the User, not the Portfolio blob; thread portfolioId through analyze/review"
```

---

### Task 8: Final confirmation, then roll out to every other tenant

**Files:** none (operational task; Task 1 Steps 7–8 already did the dev/test project)

**Interfaces:** none produced; this task confirms Tasks 1–7 together and extends the migration beyond the one project they were built against.

- [ ] **Step 1: Re-run the full backend test suite once more, against everything Tasks 1–7 produced together**

Run: `npm test` (in `backend/`)
Expected: same invariant as Task 7 Step 6 — every test passes except the one known pre-existing baseline failure (`analysis.test.js`'s cash-plan sizing).

- [ ] **Step 2: Apply `schema.sql`'s updated blocks to the dev/test database** and confirm no error — they should all be no-ops now (table and columns already exist in the target shape). This is the check that `schema.sql` alone is safe to run again later without needing `migrate-multi-portfolio.sql` a second time.

- [ ] **Step 3: For every *other* tenant database this backend serves** (check `tenants` in the platform database, per `backend/src/tenancy/registry.js` — there may be only the default one today): back it up, apply `migrate-multi-portfolio.sql`, re-run Task 1 Step 8's verification queries against it, then apply `schema.sql`.

- [ ] **Step 4: Once every tenant's verification queries check out, drop `portfolios_legacy` by hand on each one** — not scripted (Task 1 Step 5's migration deliberately leaves this manual, as a last chance to recover from a bad backfill).

- [ ] **Step 5: Commit** (if any fix-up was needed during verification; otherwise this task has no commit of its own)

---

## Out of scope (deferred to later plans on map #98)

- `X-Portfolio-Id` header, `GET /api/portfolios` aggregate endpoint, `store.tsx` multi-Portfolio shape — #101.
- Enforcing server-authoritative style (removing `?style=` trust) at each of the ~8 affected endpoints — #101, now that the `style` column exists (Task 1).
- The desk switcher/overview UI — #102.
- The 3-Portfolio cap and read-only-after-downgrade middleware — #103.
- The daily-close job (`runDailyClose`) iterating every Portfolio instead of one book per User, and `reconcileCorporateActions`/`checkCorporateActionsSoon`'s per-Portfolio throttle maps — not resolved by any ticket on map #98 yet. Flagged here, not solved: raise it before #101/#103 ship, since the job silently stays correct only because this plan guarantees exactly one Portfolio per User.
