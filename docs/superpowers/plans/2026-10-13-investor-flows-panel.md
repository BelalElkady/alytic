# Investor Flows Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show, on the المؤشرات page, the last closed session's net buying and selling by Egyptians, Arabs, foreigners, individuals and institutions, fetched by an AI web search after the close.

**Architecture:** A new backend module `investorFlows.js` holds the pure rules (current session, the checks, the schedule slot) and the research-and-save job, with the store and the AI request injected so it is testable without a database. Rows live in a platform-database table and are served by one new endpoint. A new frontend component renders nothing unless the endpoint returns a row for the current session.

**Tech Stack:** Node 20 ESM, Express 5, zod 4, Supabase (`platformDb`), `node:test`; React + TanStack Router, vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-13-investor-flows-panel-design.md`

## Global Constraints

- **Panel visibility:** the panel renders only when a saved row exists for the Current session; otherwise it is absent from the page, with no placeholder, no error and no older session. The API never falls back to an older row.
- **Current session:** today on a trading day at or after 14:30 Cairo; otherwise the most recent trading day before today.
- **Schedule:** first attempt 15:30 Cairo on trading days, then hourly, last attempt 20:30 (window `[15:30, 21:30)`); separate from the daily close; once a row exists for the date, later attempts do nothing.
- **Research request:** `webSearch: { engine: 'auto', max_results: 5, max_uses: 4 }`, `feature: 'investor_flows'`, `schemaName: 'investor_flows'`; the model returns `found: false` rather than guessing.
- **Checks (all must pass, else nothing is saved):** found and a source URL; `sessionDate` equals the fetched date; all three nationality totals present; nets sum to about zero (absolute sum at most 2 % of the largest absolute net) across the three nationality totals, across the two type totals when both present, and across the six cells when all six present; each total agrees with the sum of its cells within the same tolerance.
- **Storage:** table `investor_flows(session_date date primary key, groups_json jsonb not null, source_url text not null, fetched_at timestamptz not null default now())` in the platform database; rows are kept.
- **Endpoint:** `GET /api/indices/investor-flows`, any signed-in User, not a paid path; responds `{ flows: { sessionDate, groups, sourceUrl, fetchedAt } }` or `{ flows: null }`.
- **Cron route:** `POST /api/cron/investor-flows`, gated by `X-Cron-Secret` against `INVESTOR_FLOWS_CRON_SECRET`; `force: true` replaces an existing row.
- **Copy (Arabic):** panel title "تعاملات المستثمرين"; net buy "صافي شراء" in green (`text-up`), net sell "صافي بيع" in red (`text-down`); groups مصريين / عرب / أجانب and أفراد / مؤسسات; a line saying the figures come from market news after the close, with the source link.
- **Out of scope:** history chart, intraday figures, admin editing screen.
- **Working rules:** do the work on a new branch off `main` (the repo is on `main`). The owner's standing preference is that nothing runs the test suites or builds to self-verify — the tests below are written, not run; verify backend files with `node --check <file>` and re-read frontend files. Commit only if the owner has asked for commits; otherwise leave changes staged. `frontend/` syncs to Lovable: never rewrite pushed history.

## Review Focus

1. A model-supplied `sourceUrl` with a non-http(s) scheme (`javascript:`) must be rejected by the checks and never rendered as a link.
2. A group returned twice (same nationality and type) is ambiguous; reject it rather than pick one.
3. Article rounding: nets off by under 2 % of the largest net pass, 4 % fails.
4. The session boundary at exactly 14:30 Cairo, and Friday, Saturday and holidays, all resolve to the right session.
5. Re-running for a date that already has a row must not spend an AI call; `force` must.
6. The cron route's `date` must be a past-or-today trading day in `YYYY-MM-DD`.

---

### Task 1: Pure rules — current session, schedule slot, checks

**Files:**
- Create: `backend/src/investorFlows.js`
- Test: `backend/test/unit/investorFlows.test.js`

**Interfaces:**
- Consumes: `cairoDateOf`, `isTradingDay`, `previousTradingDay` from `backend/src/data/cache.js`.
- Produces (all exported from `backend/src/investorFlows.js`):
  - `currentSession(moment?: Date): string` — `YYYY-MM-DD`.
  - `fetchSlot(moment?: Date): { date: string, slot: number } | null` — slot is 0–5.
  - `InvestorFlowsSchema` — zod object, shape below.
  - `validateFlows(result, { date }): { ok: true, groups: Group[], sourceUrl: string } | { ok: false, reason: string }`.
  - Reason codes: `not_found`, `no_source`, `bad_source_url`, `wrong_date`, `missing_nationality`, `duplicate_group`, `nets_do_not_balance`, `total_mismatch`.
  - `Group = { nationality: 'egyptian'|'arab'|'foreign'|'all', type: 'individual'|'institution'|'all', netEgp: number, sharePct: number|null, buyEgp: number|null, sellEgp: number|null }`.
  - `InvestorFlowsSchema` = `{ found: boolean, sessionDate: string|null, sourceUrl: string|null, groups: Group[] }`.

- [ ] **Step 1: Write the failing tests** in `backend/test/unit/investorFlows.test.js` (first import `'../helpers/env.js'` like the other unit tests). Use this fixture, in EGP, where every net sums to zero:
  - Nationality totals (`type: 'all'`): egyptian +120e6, arab −30e6, foreign −90e6.
  - Type totals (`nationality: 'all'`): individual −10e6, institution +10e6.
  - Cells (nationality/type): egyptian/individual +70e6, egyptian/institution +50e6, arab/individual −20e6, arab/institution −10e6, foreign/individual −60e6, foreign/institution −30e6.
  - Wrapper: `{ found: true, sessionDate: '2026-10-11', sourceUrl: 'https://example.com/wrap', groups }`.

  Tests (names are the spec):
  - `a clean result passes` → `validateFlows(clean, { date: '2026-10-11' })` is `{ ok: true }` and returns the same number of groups.
  - `found false is rejected as not_found`.
  - `a missing source is no_source; a javascript: url is bad_source_url; an ftp: url is bad_source_url`.
  - `a different session date is wrong_date`.
  - `a missing foreign total is missing_nationality`.
  - `a flipped arab sign is nets_do_not_balance` (arab +30e6: 120+30−90 = 60, 50 % of 120).
  - `rounding noise passes, a 4 % gap fails` — only the three nationality totals present: foreign −89e6 passes (1e6 off, 0.8 %); foreign −85e6 fails with `nets_do_not_balance` (5e6 off, 4.2 %).
  - `the same group twice is duplicate_group`.
  - `a total that disagrees with its cells is total_mismatch` — only the egyptian total plus its two cells present, cells 150e6 + 50e6 against the 120e6 total, with the arab and foreign totals set to −60e6 each so the nationality nets still balance.
  - `currentSession`, with moments built from UTC strings (Cairo is UTC+3 in October; confirm each date's trading status against `backend/src/config/holidays.js` and shift to an ordinary week if a holiday intrudes): Sunday 2026-10-11 `11:29Z` (14:29 Cairo) → `'2026-10-08'`; `11:30Z` (14:30) → `'2026-10-11'`; Friday 2026-10-09 any time → `'2026-10-08'`; Saturday 2026-10-10 → `'2026-10-08'`; Thursday 2026-10-08 `15:00Z` (18:00 Cairo) → `'2026-10-08'`.
  - `fetchSlot`: Sunday 2026-10-11 `12:29Z` (15:29 Cairo) → `null`; `12:30Z` (15:30) → `{ date: '2026-10-11', slot: 0 }`; `17:45Z` (20:45) → slot 5; `18:30Z` (21:30) → `null`; Friday 16:00 Cairo → `null`.

- [ ] **Step 2: Verify the file parses** — `node --check backend/test/unit/investorFlows.test.js`. (Per the working rules, the tests are not run.)

- [ ] **Step 3: Implement** `currentSession`, `fetchSlot`, `InvestorFlowsSchema` and `validateFlows` in `backend/src/investorFlows.js`.
  - `currentSession`: Cairo date of `moment`; if it is a trading day and the Cairo wall clock is `>= 14:30`, return it, else `previousTradingDay` of it. Read the wall clock the way `egxSessionOpen` in `data/cache.js` does (Intl `en-GB`, `Africa/Cairo`).
  - `fetchSlot`: `null` unless today is a trading day and the Cairo clock is in `[15:30, 21:30)`; otherwise `{ date: today, slot: floor((minutes − 15:30) / 60) }`.
  - `validateFlows` runs the checks in this order: `not_found` → `no_source` → `bad_source_url` (must parse with `new URL` and be `http:` or `https:`) → `wrong_date` → `duplicate_group` → `missing_nationality` → nationality/type/cell balance (`nets_do_not_balance`) → total-vs-cells (`total_mismatch`). Tolerance helper: `abs(sum) <= 0.02 * max(abs(value))`.
  - Comment the file header with what the module is and that figures come from web research, so every number passes these checks before it is stored.

- [ ] **Step 4: Verify** — `node --check backend/src/investorFlows.js`.

- [ ] **Step 5: Commit** (only if asked) — `git add backend/src/investorFlows.js backend/test/unit/investorFlows.test.js` · `feat: investor flows rules — current session, schedule slot, checks`.

---

### Task 2: Storage — table and db helpers

**Files:**
- Modify: `backend/supabase/schema.sql` (next to `index_overrides`, ~line 391)
- Modify: `backend/supabase/platform.sql` (header comment, line 10–13: add `investor_flows` to the list of platform-held market data tables)
- Modify: `backend/src/db.js` (after `getAllIndexOverrides`, ~line 966)

**Interfaces:**
- Consumes: `platformDb`, `must` already in `db.js`.
- Produces:
  - `getInvestorFlows(sessionDate: string): Promise<{ sessionDate: string, groups: Group[], sourceUrl: string, fetchedAt: string } | null>`
  - `saveInvestorFlows({ sessionDate, groups, sourceUrl }): Promise<void>` — upsert on `session_date`.

- [ ] **Step 1: Add the table** to `schema.sql` using the exact DDL in Global Constraints (`create table if not exists`, safe to re-run), with a comment saying it is platform-held market data like `index_overrides`.

- [ ] **Step 2: Add the helpers** to `db.js`, written like `getIndexOverride` / `setIndexOverride` (`maybeSingle`, throw `getInvestorFlows: <message>`, `must(..., 'saveInvestorFlows')`; map `session_date`/`groups_json`/`source_url`/`fetched_at` to the camelCase shape above; on save set `fetched_at` to now).

- [ ] **Step 3: Verify** — `node --check backend/src/db.js`.

- [ ] **Step 4: Owner step** — the table must exist in the platform Supabase project before the job or endpoint can work. Tell the owner to run the new `create table` statement from `schema.sql` in the platform database's SQL editor. Do not run it from here.

- [ ] **Step 5: Commit** (only if asked) — `feat: investor_flows table and db helpers`.

---

### Task 3: Research and save job

**Files:**
- Modify: `backend/src/investorFlows.js`
- Test: `backend/test/unit/investorFlows.test.js`

**Interfaces:**
- Consumes: `InvestorFlowsSchema`, `validateFlows` (Task 1); the injected `request` has the signature of `requestStructuredOR` in `backend/src/agent/clientOpenRouter.js` (`{ schema, schemaName, maxTokens, system, messages, webSearch, feature }` → `{ data }`); the injected `store` is `{ get(date), save(row) }` matching Task 2's `getInvestorFlows` / `saveInvestorFlows`.
- Produces:
  - `researchInvestorFlows(date: string, { request }): Promise<object | null>` — null when `request` is missing or the call throws (log a `console.warn('[investor-flows] research failed:', err.message)`).
  - `fetchAndSaveInvestorFlows({ date, request, store, force = false }): Promise<{ status: 'saved' | 'exists' | 'not_found' | 'rejected' | 'error', reason?: string }>`.

- [ ] **Step 1: Write the failing tests** (same file; fake `request` and `store` with call counters; reuse the clean fixture, with `date` `'2026-10-11'`):
  - `saves a valid result once` → request called once, `store.save` called once with `{ sessionDate: '2026-10-11', groups, sourceUrl }`, status `'saved'`.
  - `an existing row costs no AI call` → `store.get` returns a row, status `'exists'`, request not called.
  - `force replaces an existing row` → same store state with `force: true`, request called, `store.save` called, status `'saved'`.
  - `an invalid result is rejected and not saved` → flipped arab sign: status `'rejected'`, `reason: 'nets_do_not_balance'`, `store.save` not called.
  - `found false is not_found` and `a throwing request is error`, neither saves.

- [ ] **Step 2: Verify the file parses** — `node --check backend/test/unit/investorFlows.test.js`.

- [ ] **Step 3: Implement** both functions in `backend/src/investorFlows.js`, modelled on `researchCorporateAction` in `backend/src/corporateActions.js`:
  - `researchInvestorFlows` sends the Global Constraints request settings. The prompt names `date`, asks for each group's net buying or selling in EGP for that exact EGX session, lists the Arabic phrasings the wraps use (صافي شراء / صافي بيع, تعاملات المصريين والعرب والأجانب, الأفراد والمؤسسات) and good sources (egx.com.eg, mubasher.info, argaam.com, enterprise.press), says to convert millions to full EGP and to use a negative `netEgp` for net selling, to use `'all'` for a total on one axis, and to return `found: false` when the figures for that exact date are not stated.
  - `fetchAndSaveInvestorFlows`: unless `force`, return `'exists'` when `store.get(date)` has a row; research; null → `'error'`; validate; `not_found` → `'not_found'`; any other failure → `'rejected'` with the reason and a `console.warn('[investor-flows] rejected for <date>: <reason>')`; else `store.save` and `'saved'`.

- [ ] **Step 4: Verify** — `node --check backend/src/investorFlows.js`.

- [ ] **Step 5: Commit** (only if asked) — `feat: investor flows research and save job`.

---

### Task 4: Server wiring — endpoint, cron route, scheduler

**Files:**
- Modify: `backend/src/api/server.js`
- Modify: `backend/.env.example` (line ~109)
- Modify: `backend/scripts/security-check.mjs` (lines 185 and 317)
- Test: `backend/test/api/investor-flows.test.js`

**Interfaces:**
- Consumes: `currentSession`, `fetchSlot`, `fetchAndSaveInvestorFlows` (Tasks 1, 3); `getInvestorFlows`, `saveInvestorFlows` (Task 2); `requestStructuredOR`, `aiAvailable` (already imported in `server.js`); `cronLimiter`, `safeEqual`, `wrap`, `isTradingDay`, `cairoToday` (already in `server.js`).
- Produces: the HTTP routes in Global Constraints; `startInvestorFlowsScheduler()` called at startup.

- [ ] **Step 1: Write the failing API tests** in `backend/test/api/investor-flows.test.js`, following `analysis.test.js` (start server in `before`, `registerUser`, `request`):
  - `GET /api/indices/investor-flows requires sign-in` → 401 without a cookie.
  - `GET /api/indices/investor-flows never serves an older session` → 200 with a cookie; `res.body` has a `flows` key; it is either `null` or has `sessionDate === currentSession()` and a `groups` array and an `https` `sourceUrl`.
  - `POST /api/cron/investor-flows refuses a request with no secret` → 403.

- [ ] **Step 2: Verify the file parses** — `node --check backend/test/api/investor-flows.test.js`.

- [ ] **Step 3: Add the endpoint** in `server.js` directly after `/api/indices/performance`: reads `getInvestorFlows(currentSession())`, responds per Global Constraints. No paid-path change is needed (`/indices/...` is not in `PAID_PATHS`); it must not be added to the unauthenticated allowlist at ~line 541.

- [ ] **Step 4: Add the cron route** next to `/api/cron/daily-close`: `cronLimiter`, `safeEqual(req.get('X-Cron-Secret'), process.env.INVESTOR_FLOWS_CRON_SECRET)` else 403, and add `'/cron/investor-flows'` to the unauthenticated allowlist (~line 554–556) the same way the other three cron routes are. Body `{ force?: boolean, date?: string }`: `date` defaults to `currentSession()`, must match `^\d{4}-\d{2}-\d{2}$`, be a trading day and not after `cairoToday()`, else 400. Calls `fetchAndSaveInvestorFlows({ date, request: requestStructuredOR, store: { get: getInvestorFlows, save: saveInvestorFlows }, force })` and returns its result as JSON. Do not loop over tenants: the table is platform-held, one search serves every site.

- [ ] **Step 5: Add `startInvestorFlowsScheduler()`** after `startStopPlanScheduler`, using the same 30 s `setInterval` and in-memory slot guard (`${date}:${slot}`; clear the guard on a thrown error so the next tick retries). Each tick: `if (!aiAvailable()) return`; `const due = fetchSlot()`; return if null or the slot already ran; run `fetchAndSaveInvestorFlows` and log `[investor-flows]` plus the result JSON. Call it in the `isDirectRun` block beside the other two schedulers. Write the doc comment in the style of the neighbouring ones, noting it is deliberately separate from the daily close.

- [ ] **Step 6: Secrets** — add `# INVESTOR_FLOWS_CRON_SECRET=` under the other three in `.env.example`; add `'INVESTOR_FLOWS_CRON_SECRET'` to the `cron` list in `security-check.mjs` (line 185) and `'/cron/investor-flows'` to the probe list (line 317), so the security check covers the new route.

- [ ] **Step 7: Verify** — `node --check backend/src/api/server.js` and `node --check backend/scripts/security-check.mjs`.

- [ ] **Step 8: Commit** (only if asked) — `feat: investor flows endpoint, cron route and scheduler`.

---

### Task 5: Frontend panel and glossary

**Files:**
- Create: `frontend/src/components/desk/investor-flows.tsx`
- Test: `frontend/src/components/desk/investor-flows.test.tsx`
- Modify: `frontend/src/routes/_app.indices.tsx` (render between the cards grid and `<MarketHeatmap />`, ~line 103–105)
- Modify: `CONTEXT.md` (new **Investor flows** term under "Investing")

**Interfaces:**
- Consumes: `GET /api/indices/investor-flows` (Task 4); `api` from `@/lib/api`, `Panel` from `@/components/desk/state-blocks`, `compact`, `pct`, `tone` from `@/lib/format`.
- Produces: `InvestorFlows` (default-less named export, no props); `groupLabel(nationality, type): string`; `type FlowGroup`, `type InvestorFlowsData`.

- [ ] **Step 1: Write the failing tests** in `investor-flows.test.tsx`, mocking the API with `vi.mock("@/lib/api", () => ({ api: apiMock }))` as `feature-announcement-dialog.test.tsx` does:
  - `renders nothing when flows is null` → `apiMock` resolves `{ flows: null }`; after it settles, the container is empty.
  - `renders nothing when the request fails` → `apiMock` rejects; container empty (no error text).
  - `shows net buy in green and net sell in red` → a flows payload with egyptian +120e6 and foreign −90e6: "صافي شراء" and "صافي بيع" are present, the buy row has class `text-up`, the sell row `text-down`.
  - `links the source only for an http(s) url` → `https://example.com/wrap` renders an `<a>` with that `href` and `rel` containing `noopener`; `javascript:alert(1)` renders no `<a>`.
  - `groupLabel` → `('egyptian','all')` is `مصريين`, `('all','institution')` is `مؤسسات`, `('arab','individual')` is `عرب — أفراد`.

- [ ] **Step 2: Implement `InvestorFlows`** — fetches on mount, holds `data | null`, returns `null` while loading, on error and when `flows` is null. When present it renders a `Panel` titled "تعاملات المستثمرين" with: the session date and the "from market news after the close" line with the source link (only for `http:`/`https:` URLs); nationality rows (`type: 'all'`), type rows (`nationality: 'all'`), then the six-cell breakdown only when present. Each row shows `groupLabel`, the net via `compact` with `tone`, "صافي شراء"/"صافي بيع", the share with `pct` when `sharePct` is not null, and gross buy/sell via `compact` only when both are not null. Use the `up`/`down` tokens, no new colours.

- [ ] **Step 3: Wire it into the page** — import and render `<InvestorFlows />` between the cards grid and `<MarketHeatmap />` in `_app.indices.tsx`; no other change to the page.

- [ ] **Step 4: Glossary** — add to `CONTEXT.md`, matching the file's format (bold term, definition, `_Avoid_`): **Investor flows** — one closed session's net buying or selling per investor group, taken from the market-wrap news after the close and shown only when it passed the app's checks for the current session. Labelled "تعاملات المستثمرين". _Avoid_: Order flow, fund flows.

- [ ] **Step 5: Verify** — re-read the new component and the edited route for type and import errors; no build or test run per the working rules.

- [ ] **Step 6: Commit** (only if asked) — `feat: investor flows panel on the indices page`.

---

## Self-review

- **Spec coverage:** visibility rule → Global Constraints, Tasks 4 (endpoint never falls back) and 5 (renders nothing); schedule → Tasks 1 (`fetchSlot`) and 4; research → Task 3; checks → Task 1; storage → Task 2; endpoint and cron route → Task 4; panel contents and copy → Task 5; glossary → Task 5. Testing section of the spec → tests in Tasks 1, 3, 4, 5 (the API test checks the endpoint's session rule rather than writing to the shared database).
- **Type consistency:** `Group`, `currentSession`, `fetchSlot`, `validateFlows`, `fetchAndSaveInvestorFlows`, `getInvestorFlows`, `saveInvestorFlows` are named identically across tasks; reason codes are defined once in Task 1.
- **Additions beyond the spec, for the owner's attention:** the cron route accepts an optional `date` for backfill (spec said "for backfill" but didn't name the parameter); the source URL must be http(s) (Review Focus 1); duplicate groups are rejected (Review Focus 2); the new secret is added to the security check.
