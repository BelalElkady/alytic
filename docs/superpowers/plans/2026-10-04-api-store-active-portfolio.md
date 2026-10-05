# API & Store: Addressing the Active Portfolio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every portfolio-touching request a way to name *which* Portfolio it means — a client-owned `X-Portfolio-Id` header, falling back to the User's primary Portfolio when absent — and add the `GET /api/portfolios` aggregate endpoint the future desk switcher (#102) will read from. After this plan, a User could in principle hold more than one Portfolio and address either one correctly; this plan does **not** add any way to create a second one (that's #102/#103's job) or change the desk UI at all.

**Architecture:** `backend/src/portfolio.js`'s `loadPortfolio`/`savePortfolio`/`withPortfolio`/`withPortfolioAndUsage` currently resolve a User's *primary* Portfolio internally (Plan 1's bridge, so #100 shipped with zero call-site churn). This plan removes that internal resolution and makes every one of those functions take an explicit `portfolioId` instead — `withUserUsage` is untouched, since quota stays per-User. A new request-scoped resolver in `server.js`, `portfolioIdFromRequest(req)`, reads the header, validates the id actually belongs to `req.user.id` (never trusts a foreign id), and falls back to `primaryPortfolioIdFor(req.user.id)` when the header is absent or invalid — this one function is both the addressing mechanism and the entire backward-compatibility story for an old cached frontend bundle. Every existing portfolio-touching endpoint calls it once and threads the result through. The frontend gains the matching `activePortfolioId` (persisted in `localStorage`, per device) and attaches it as the header on every request; no new UI.

**Tech Stack:** Node.js/Express backend, Supabase/Postgres, `node:test` against the real (shared) Supabase project; TanStack Start/React frontend, Vitest.

**Spec:** [Ticket #101](https://github.com/BelalElkady/alytic/issues/101) (closed, decision recorded), resolving part of map #98. Builds on Plan 1 (`docs/superpowers/plans/2026-10-03-portfolio-storage-migration.md`, merged as PR #108) and its spec, ADR 0002.

## Global Constraints

- **No multi-Portfolio creation in this plan.** Every User still has exactly one live Portfolio throughout — there is still no endpoint to create a second one. Tests and reasoning may assume this, same as Plan 1, *except* where a test needs to simulate a second Portfolio to prove addressing works (insert one directly via `supabase`, the same technique Plan 1's Task 5 used — there is still no higher-level API for it).
- **A header naming a Portfolio the requester doesn't own must never be honored.** Validate ownership (`getPortfolioById(id).userId === req.user.id`) before trusting a header value; an invalid, foreign, or malformed header falls back to the primary Portfolio exactly like an absent one — it does not error, and it does not leak whether the id exists for someone else.
- **No live quote fetch for `GET /api/portfolios`.** Each non-active Portfolio's value/P&L in the aggregate response comes from that Portfolio's own last daily-close snapshot (`state_json.log`'s most recent entry: `total`, `pl`, `cash` — already computed and stored by `recordSnapshot`), never a fresh live-price computation. A Portfolio with no snapshot yet (brand new) falls back to a zero-P&L, cost-basis valuation.
- **`withUserUsage` is unchanged.** Quota/Credits stay per-User; this plan touches it nowhere.
- **The per-user lock stays per-user, not per-(user, Portfolio).** `withPortfolio`/`withPortfolioAndUsage` gain a `portfolioId` parameter for *which Portfolio to read/write*, but the lock they queue on (`withUserLock`, keyed by `userId`) is untouched — see Plan 1's Task 6 for why (a quota spend and a book write for the same User must still mutually exclude, regardless of which Portfolio is written).
- **Don't run tests/builds to self-verify beyond what each task specifies** — `node --check` is fine for a quick syntax pass; follow each task's actual Step list for what to run and when.

## Review Focus

- **An old cached frontend bundle that never sends the header** must keep working exactly as today — this is the single most load-bearing behavior in the plan, since it's the whole rollout story. Covered by a dedicated test in Task 3.
- **A forged/foreign `X-Portfolio-Id` header** (naming a real Portfolio id that belongs to a different User) must silently fall back to primary, not operate on someone else's book and not leak a 403/404 that would confirm the id exists. Covered in Task 3.
- **`GET /api/portfolios`'s non-active-card valuation** must use the stored snapshot, not a live quote — a test asserting this doesn't trigger the live-quote path is in Task 4's scope, not just a code comment.
- **Every one of the ~30 existing call sites into `loadPortfolio`/`savePortfolio`/`withPortfolio`/`withPortfolioAndUsage`** must be updated — a missed one is a silent `TypeError` (the function's new required parameter would be `undefined`) at request time for that one endpoint, not a loud startup failure. Task 4's own full-suite run (Step 4) is what catches a miss; a careful pass through the exact line list in Task 4's Files block, one at a time, is what prevents one in the first place.
- **`cli.js`'s six direct callers** (no HTTP request, no header) need their own primary-Portfolio resolution — the same one-line pattern Plan 1's Task 7 already established for `analyzeTicker`'s `portfolioId`.

---

## File Structure

- **Modify:** `backend/src/portfolio.js` — `loadPortfolio`, `savePortfolio`, `withPortfolio`, `withPortfolioAndUsage` gain an explicit `portfolioId` parameter; internal `primaryPortfolioIdFor` resolution removed.
- **Modify:** `backend/src/db.js` — new `listPortfoliosForUser(userId)`.
- **Modify:** `backend/src/api/server.js` — new `portfolioIdFromRequest(req)` resolver; new `GET /api/portfolios` endpoint; every existing portfolio-touching endpoint (~30 call sites) resolves and threads `portfolioId`.
- **Modify:** `backend/src/cli.js` — its six direct callers resolve the primary Portfolio id themselves first.
- **Modify:** `frontend/src/lib/api.ts` — attaches `X-Portfolio-Id` from `localStorage` to every `api()`/`post()`/`postForm()`/`postRaw()` call.
- **Modify:** `frontend/src/lib/store.tsx` — `DeskValue` gains `portfolios` (summary list), `activePortfolioId`, and a `switchPortfolio(id)` function; `reload()` re-runs on switch, mirroring the existing style-change effect.
- **Test:** `backend/test/modules/portfolio.test.js`, `backend/test/modules/portfolio-storage.test.js`, `backend/test/api/auth-portfolio.test.js`, `backend/test/api/analysis.test.js` (existing — must keep passing), `backend/test/api/portfolios.test.js` (new, for Task 3), `frontend/src/lib/api.test.ts` (new, for Task 5 — `frontend/src/lib/store.test.ts` already exists but only tests the unrelated pure helper `applyQuote`; not extended by this plan).

---

### Task 1: `db.js` — list a User's Portfolios

**Files:**
- Modify: `backend/src/db.js` (near `getPortfolioById`/`primaryPortfolioIdFor`, around line 227-260)
- Test: `backend/test/modules/portfolio-storage.test.js` (existing — add to it)

**Interfaces:**
- Produces: `listPortfoliosForUser(userId): Promise<{id, userId, name, style, ordinal, state}[]>` — every non-soft-deleted Portfolio for this User (`deleted_at is null`), ordered by `ordinal` ascending. Same per-row shape as `getPortfolioById`'s single-row return (`id`, `userId`, `name`, `style`, `ordinal`, `state`), just a list.

- [ ] **Step 1: Write the failing test**

```js
test('listPortfoliosForUser returns every live Portfolio, ordered by ordinal', async () => {
  const email = uniqueEmail();
  await register({ email, phone: uniquePhone(), password: 'x'.repeat(8) });
  const user = await getUserByEmail(email);
  const primaryId = await primaryPortfolioIdFor(user.id);
  // No higher-level "create a second Portfolio" API exists yet (Global
  // Constraints) — insert one directly, same technique Plan 1's Task 5 used.
  const { data: second } = await supabase.from('portfolios').insert({ user_id: user.id, name: 'محفظة ثانية', ordinal: 1 }).select('id').single();

  const rows = await listPortfoliosForUser(user.id);
  assert.deepEqual(rows.map((r) => r.id), [primaryId, second.id]);
  assert.equal(rows[0].name, 'المحفظة الرئيسية');
  assert.equal(rows[1].name, 'محفظة ثانية');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test backend/test/modules/portfolio-storage.test.js`
Expected: FAIL — `listPortfoliosForUser is not a function`

- [ ] **Step 3: Implement `listPortfoliosForUser`** in `backend/src/db.js`, matching `getPortfolioById`'s existing row-mapping style (same field names: `id`, `userId` from `user_id`, `name`, `style`, `ordinal`, `state` from `state_json`).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test backend/test/modules/portfolio-storage.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/db.js backend/test/modules/portfolio-storage.test.js
git commit -m "feat(db): list a User's live Portfolios"
```

---

### Task 2: `portfolio.js` — explicit `portfolioId`, no more internal resolution

**Files:**
- Modify: `backend/src/portfolio.js:38-49,134-176` (`loadPortfolio`, `savePortfolio`, `withPortfolio`, `withPortfolioAndUsage`)
- Test: `backend/test/modules/portfolio.test.js` (existing — must keep passing with *updated* call sites, since the signature is changing; this is the one exception in this plan to "don't touch existing tests," because the function contract itself changes)

**Interfaces:**
- Consumes: `primaryPortfolioIdFor`, `getPortfolioById`, `putPortfolioById` (unchanged, from Plan 1).
- Produces:
  - `loadPortfolio(portfolioId)` — **signature changed**: takes a Portfolio id directly, no `userId`, no internal `primaryPortfolioIdFor` call, no default.
  - `savePortfolio(p, portfolioId)` — same change.
  - `withPortfolio(userId, portfolioId, mutator)` — **gains `portfolioId`** as its new second parameter (inserted before `mutator`); still locks on `userId` via the existing `withUserLock`/`writeQueues` (Global Constraints — this is not a new lock dimension).
  - `withPortfolioAndUsage(userId, portfolioId, mutator)` — same insertion.
  - `withUserUsage(userId, mutator)` — **unchanged**, not touched by this task.

- [ ] **Step 1: Read `backend/test/modules/portfolio.test.js:172-192`** (`withPortfolio serialises concurrent writes`) to see its current calls — it currently calls `withPortfolio(userId, mutator)` and `loadPortfolio(userId)` with no portfolioId, since it predates this plan.

- [ ] **Step 2: Update that test's call sites** to resolve a `portfolioId` first (`const portfolioId = await primaryPortfolioIdFor(userId);`, the same pattern used throughout this codebase since Plan 1's Task 7) and pass it through: `withPortfolio(userId, portfolioId, mutator)`, `loadPortfolio(portfolioId)`. The test's *assertions* (what it proves about concurrency) do not change — only the call arguments do.

- [ ] **Step 3: Run the test to confirm it now fails for the right reason**

Run: `node --test backend/test/modules/portfolio.test.js`
Expected: FAIL — `withPortfolio`/`loadPortfolio` still have their old signatures; the test now calls them with the new arity, which is wrong until Step 4.

- [ ] **Step 4: Implement the signature changes** in `backend/src/portfolio.js` — remove the `primaryPortfolioIdFor` call from inside `loadPortfolio`/`savePortfolio` (they now just call `getPortfolioById(portfolioId)`/`putPortfolioById(portfolioId, state)` directly), thread the new `portfolioId` parameter through `withPortfolio`/`withPortfolioAndUsage`'s bodies to their own internal `loadPortfolio`/`savePortfolio` calls.

- [ ] **Step 5: Run the test again to verify it passes**

Run: `node --test backend/test/modules/portfolio.test.js`
Expected: PASS — same concurrency guarantee, now exercised through the new signature.

- [ ] **Step 6: Commit**

```bash
git add backend/src/portfolio.js backend/test/modules/portfolio.test.js
git commit -m "refactor(portfolio): take an explicit portfolioId instead of resolving primary internally"
```

---

### Task 3: `server.js` — the request resolver and `GET /api/portfolios`

**Files:**
- Modify: `backend/src/api/server.js` (new code, near the existing `GET /api/portfolio` handler around line 2213)
- Test: `backend/test/api/portfolios.test.js` (new)

**Interfaces:**
- Consumes: `getPortfolioById`, `primaryPortfolioIdFor` (Plan 1), `listPortfoliosForUser` (Task 1).
- Produces:
  - `portfolioIdFromRequest(req): Promise<number>` — reads `req.headers['x-portfolio-id']`; if present, numeric, and `getPortfolioById(id)` returns a row with `.userId === req.user.id` and no `deletedAt`, returns that id; otherwise (absent, malformed, foreign, or soft-deleted) returns `primaryPortfolioIdFor(req.user.id)`. Never throws, never 403s — silent fallback is the whole point (Global Constraints).
  - `GET /api/portfolios` — `{ portfolios: [{id, name, style, value, pl, cash, positionCount, active}], activePortfolioId }`. `value`/`pl`/`cash` come from each Portfolio's own `state.log`'s most recent entry (`total`, `pl`, `cash` fields — see Global Constraints); a Portfolio with an empty `log` reports `value: cash` (from its own `state.cash`), `pl: 0`. `positionCount` is `Object.keys(state.positions).length`. `active` is `true` for whichever Portfolio `portfolioIdFromRequest(req)` resolved to for this very request.

- [ ] **Step 1: Write the failing tests**

```js
test('a request with no X-Portfolio-Id header falls back to the primary Portfolio', async () => {
  const { cookie } = await registerUser(baseUrl);
  const res = await request(baseUrl, 'GET', '/api/portfolio', { cookie }); // no header
  assert.equal(res.status, 200, res.text);
});

test('a header naming a Portfolio owned by a different User falls back to primary, not an error', async () => {
  const other = await registerUser(baseUrl);
  const otherPortfolioId = await primaryPortfolioIdFor(other.user.id); // test-only import from db.js
  const { cookie } = await registerUser(baseUrl);
  const res = await request(baseUrl, 'GET', '/api/portfolio', { cookie, headers: { 'x-portfolio-id': String(otherPortfolioId) } });
  assert.equal(res.status, 200, res.text); // not 403/404 — silently falls back
});

test('GET /api/portfolios values a non-active Portfolio from its last-saved snapshot, never a live quote', async () => {
  const { cookie, user } = await registerUser(baseUrl);
  const primaryId = await primaryPortfolioIdFor(user.id);
  // No higher-level "create a second Portfolio" API exists yet — insert one
  // directly (Task 1's technique), with a fabricated log entry standing in
  // for a real daily close, so this test can assert on a known number
  // without needing live price data or a running daily-close job.
  const { data: second } = await supabase.from('portfolios').insert({
    user_id: user.id, name: 'محفظة ثانية', ordinal: 1,
    state_json: { cash: 1000, positions: {}, log: { '2026-01-01': { total: 5000, pl: 250, cash: 1000 } } },
  }).select('id').single();

  const res = await request(baseUrl, 'GET', '/api/portfolios', { cookie });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.portfolios.length, 2);
  const active = res.body.portfolios.find((p) => p.id === primaryId);
  const inactive = res.body.portfolios.find((p) => p.id === second.id);
  assert.equal(active.active, true);
  assert.equal(inactive.active, false);
  // The fabricated log entry's numbers, verbatim — proves this came from the
  // stored snapshot, not a live-quote computation (there are no live quotes
  // for an empty positions map to even price).
  assert.equal(inactive.value, 5000);
  assert.equal(inactive.pl, 250);
  assert.equal(inactive.cash, 1000);
  assert.equal(res.body.activePortfolioId, primaryId);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test backend/test/api/portfolios.test.js`
Expected: FAIL — `GET /api/portfolios` doesn't exist yet (404); the other two likely already pass today (no header is already today's only path) — if so, that's fine, they're guard-rails for Step 3, not strictly RED/GREEN for this step.

- [ ] **Step 3: Implement `portfolioIdFromRequest` and `GET /api/portfolios`** in `backend/src/api/server.js`, per the Interfaces block above.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test backend/test/api/portfolios.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/api/server.js backend/test/api/portfolios.test.js
git commit -m "feat(api): resolve the active Portfolio from a header; add GET /api/portfolios"
```

---

### Task 4: `server.js` — thread `portfolioId` through every existing endpoint

**Files:**
- Modify: `backend/src/api/server.js` — every one of these call sites (grep-verified against this plan's base commit; re-grep if line numbers have drifted):
  - `loadPortfolio(...)` callers: :1760, :1826, :1905, :2214 (the existing `GET /api/portfolio`, which now also calls `portfolioIdFromRequest`), :2345, :2579, :2761, :2836, :2851, :3138, :3190, :3322, :3424
  - `withPortfolio(...)` callers: :2273, :2300, :2307, :2316, :2381, :2412, :2426, :2457, :2492, :2507, :2781, :2846, :2866, :2877
  - `withPortfolioAndUsage(...)` callers: :3112, :3144, :3383
  - (The two `withUserUsage(...)` callers at :1362 and :1896 are **not** touched — quota stays per-User, Global Constraints.)
- Modify: `backend/src/cli.js:87,164,265,267,276,281` — its six direct `loadPortfolio()`/`savePortfolio()` callers (no request, no header).
- Test: `backend/test/api/auth-portfolio.test.js`, `backend/test/api/analysis.test.js` (existing — must keep passing, since this is the task that could silently break any one of them)

**Interfaces:**
- Consumes: `portfolioIdFromRequest` (Task 3), the Task 2 signatures.
- Produces: no new exports — every listed call site now does `const portfolioId = await portfolioIdFromRequest(req);` once near the top of its handler (reusing one resolve per request, even when a handler has multiple `loadPortfolio`/`withPortfolio` calls — resolve once, pass the same value to all of them in that handler), then passes `portfolioId` as the new argument Task 2's signatures expect. `cli.js`'s six callers instead do `const portfolioId = await primaryPortfolioIdFor('local');` once per command (mirroring the exact pattern Plan 1's Task 7 already used there for `analyzeTicker`).

- [ ] **Step 1: Rewire every `loadPortfolio`/`withPortfolio`/`withPortfolioAndUsage` call site listed above** in `server.js`, resolving `portfolioId` once per handler and passing it through. For a handler that already has `req.user.id` and now also needs `portfolioId`, resolve both once at the top, in the same style this file already uses for `userId`.

- [ ] **Step 2: Rewire `cli.js`'s six call sites**, each resolving its own `portfolioId` via `primaryPortfolioIdFor('local')` before calling `loadPortfolio`/`savePortfolio`.

- [ ] **Step 3: Run `node --check` on both files** to catch any syntax slip before running tests.

Run: `node --check backend/src/api/server.js && node --check backend/src/cli.js`
Expected: no output (success)

- [ ] **Step 4: Run the full backend suite**

Run: `npm test` (in `backend/`)
Expected: every test passes except the plan's documented pre-existing exceptions (check the Plan 1 Test Baseline section in `docs/superpowers/plans/2026-10-03-portfolio-storage-migration.md` for exactly which ones those are, since nothing in this plan changes that baseline). A *new* failing test beyond that baseline is this task's regression — find which call site was missed or given the wrong `portfolioId` and fix it before proceeding.

- [ ] **Step 5: Commit**

```bash
git add backend/src/api/server.js backend/src/cli.js
git commit -m "feat(api): thread portfolioId through every portfolio-touching endpoint"
```

---

### Task 5: Frontend — attach the header, extend the store

**Files:**
- Modify: `frontend/src/lib/api.ts` (the `request` function around line 28-38, next to the existing `isLovablePreview()` helper it already merges into the same headers object)
- Modify: `frontend/src/lib/store.tsx` (`DeskValue` type, `DeskProvider`, around line 150-320)
- Test: `frontend/src/lib/api.test.ts` (new — this codebase's only existing frontend-store-adjacent test, `frontend/src/lib/store.test.ts`, tests a single pure helper, `applyQuote`, with plain Vitest assertions and no React rendering or `fetch` mocking at all; there is no precedent anywhere in this codebase for rendering `DeskProvider` or mocking `fetch` to test it, and establishing one is bigger than this task — see the Interfaces block below for how this task stays inside the existing pattern instead)

**Interfaces:**
- Produces:
  - `api.ts`: a new plain, exported helper, `activePortfolioHeader(): Record<string, string>`, written the same way the existing (unexported) `isLovablePreview()` is — reads `localStorage.getItem('alytic-active-portfolio')` (key matching the `alytic-invest-style` convention in `invest-style.ts`), wrapped in try/catch so a blocked/unavailable `localStorage` degrades to `{}` rather than throwing, and returns `{ 'x-portfolio-id': value }` when a value is stored, `{}` otherwise. `request()`'s existing headers spread (`{ ...(isLovablePreview() ? {...} : {}), ...activePortfolioHeader(), ...init?.headers }`) merges it in exactly where `isLovablePreview()`'s result already sits — **this one function is the entire task's testable surface**, following the `applyQuote` precedent: a pure function, exported, tested directly with no rendering.
  - `store.tsx`'s `DeskValue` gains: `portfolios: Array<{id: number, name: string, style: string | null, value: number, pl: number, cash: number, positionCount: number, active: boolean}>` (the `GET /api/portfolios` list from Task 3, verbatim — refreshed alongside `pf` in `reload()`), `activePortfolioId: number | null`, `switchPortfolio: (id: number) => void` (writes `id` to `localStorage` under the same `alytic-active-portfolio` key `activePortfolioHeader()` reads, sets `activePortfolioId` state, calls `reload()` — same shape as the existing style-sync effect in this file). This part is thin wiring with no independent pure logic to extract, consistent with the rest of `DeskProvider`'s untested setters (e.g. `setManualOpen`) — Task 6's full suite run, not a new unit test, is this part's verification; if a future UI task (#102) needs more confidence here, it gets it then, against real rendered behavior.

- [ ] **Step 1: Write the failing test** (for `activePortfolioHeader` only, per the Interfaces block)

```ts
import { describe, expect, it, beforeEach } from "vitest";
import { activePortfolioHeader } from "./api";

describe("activePortfolioHeader", () => {
  beforeEach(() => localStorage.clear());

  it("returns the stored id as a header when one is set", () => {
    localStorage.setItem("alytic-active-portfolio", "42");
    expect(activePortfolioHeader()).toEqual({ "x-portfolio-id": "42" });
  });

  it("returns no header when nothing is stored", () => {
    expect(activePortfolioHeader()).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --cwd frontend test` (confirm the exact script against `frontend/package.json`'s `test` entry)
Expected: FAIL — `activePortfolioHeader` doesn't exist yet.

- [ ] **Step 3: Implement `activePortfolioHeader` in `api.ts`** and merge it into `request()`'s headers, per the Interfaces block. Then implement `store.tsx`'s `portfolios`/`activePortfolioId`/`switchPortfolio` additions (no test for this part, per the Interfaces block's reasoning).

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --cwd frontend test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/lib/store.tsx frontend/src/lib/api.test.ts
git commit -m "feat(store): attach the active Portfolio header; hold the Portfolio list and switch function"
```

---

### Task 6: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full backend suite**

Run: `npm test` (in `backend/`)
Expected: same invariant as Task 4 Step 4 — matches Plan 1's documented baseline exactly, nothing new failing.

- [ ] **Step 2: Run the full frontend suite**

Run: `bun run --cwd frontend test` (or the project's existing command)
Expected: all passing, including Task 5's new test.

- [ ] **Step 3: Commit** (only if Step 1 or 2 needed a fix-up; otherwise this task has no commit of its own)

## Out of scope (deferred to later plans on map #98)

- Any UI for creating, renaming, or deleting a second Portfolio, or a switcher to display them — #102.
- The 3-Portfolio cap and read-only-after-downgrade enforcement — #103.
- Server-authoritative Investing style enforcement (removing trust in a client-sent `?style=` param) — mentioned in Plan 1 as deferred here, but on review this plan's scope is strictly the *addressing* mechanism (#101's literal decision); style enforcement touches the same ~8 endpoints for a different reason and is cleaner as its own follow-up once this plan's header-resolution pattern is in place to build on. Flagged here, not solved.
