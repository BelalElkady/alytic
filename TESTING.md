# Testing Alytic/EGXpert

Three independent layers, each with its own runner. All suites are hermetic —
no API key, no live market data, no shared state — so they pass on any machine
at any time of day.

```
npm test          # runs all three layers in order (stops at first failure)
```

| Layer    | Runner              | Location                  | Command                             |
| -------- | ------------------- | ------------------------- | ----------------------------------- |
| Backend  | `node:test`         | `backend/test/`           | `npm --prefix backend test`         |
| Frontend | Vitest + jsdom      | `frontend/src/**/*.test.*`| `bun run --cwd frontend test`       |
| E2E      | Playwright          | `tests/e2e/`              | `npx playwright test`               |

---

## Backend — `node:test`

```
cd backend
npm test            # everything
npm run test:unit   # engine math only
npm run test:api    # HTTP integration only
npm run test:watch  # watch mode
```

The suite is split the way the codebase is split:

- **`test/unit/`** — the deterministic engine, hand-computed values included:
  indicators (`indicators.test.js` — Wilder smoothing, RSI bounds, MACD/EMA
  warm-up positions, Bollinger σ math…), support/resistance clustering
  (`levels.test.js`), the data-quality gate (`quality.test.js` — the ORAS
  frozen-series failure mode among them), stop/sizing/risk arithmetic
  (`risk.test.js`), targets and Efficiency-Ratio ETAs (`targets.test.js`),
  and the composite score (`technical.test.js`).
- **`test/modules/`** — `auth` (register/login/verify-email, tampered session
  tokens), `portfolio` (average-cost math, the **withPortfolio
  serialisation regression**: 15 concurrent writes must all land), and
  `analyzeTicker` end-to-end on fixtures — the "same bars → same numbers"
  reproducibility contract, byte for byte.
- **`test/api/`** — the real Express app over real HTTP (ephemeral port):
  auth flows, auth middleware, the whole portfolio lifecycle, settings,
  reset, daily log, snapshot, backfill, AI endpoints degrading to 503,
  `422` on a frozen series, and scan cash-allocation planning.

### Isolation model

Every test file runs in its own process and gets:

- the **test Supabase project** (`qfxuejkbnrdszycqxvdx`, `public` schema),
  never production — `helpers/env.js` (must be the first import in every test
  file) calls `helpers/test-database.js`, which takes `TEST_SUPABASE_URL` and
  `TEST_SUPABASE_SERVICE_ROLE_KEY` from the environment or `backend/.env`,
  refuses to start if either points at production (`xssjwnevhbpcdmtbatiy`),
  and overrides `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` with them. It is
  *not* a throwaway database — it's a shared cloud Postgres — so isolation
  instead comes from every test registering its own randomly generated user
  (`uniqueEmail()` in `helpers/server.js`) rather than from a fresh database
  per run;
- a **fixture bar cache** — `ALYTIC_BARS_DIR` redirects `src/data/cache.js`,
  and `helpers/bars.js` writes deterministic seeded OHLCV series (plus the
  corrupt variants the quality gate rejects: frozen, stale, thin, dead
  volume) dated on real EGX trading days;
- **no AI or email key** — `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY` and
  `RESEND_API_KEY` are set to empty (not `??=`, so neither the shell nor
  `backend/.env` can supply a real one), so `aiAvailable()` is false, the AI
  endpoints take their 503 path, and no test spends AI credits or sends mail;
- a live quote feed that degrades gracefully — fundamentals/quotes return
  empty when TradingView is unreachable, which the app already treats as
  normal.

Two tiny testability seams were added for this (production behaviour
unchanged): `ALYTIC_BARS_DIR` in `src/data/cache.js`, and `src/api/server.js`
only binding port 3000 when executed directly (imported modules can listen on
their own ephemeral port).

Because those seeded users are real rows in the shared test project, `npm test`
and `npm run test:api` run through `scripts/run-tests.mjs`, which always
cleans up afterwards via `scripts/cleanup-test-data.js` (`portfolios`
cascades on delete) — pass or fail, and regardless of the test run's own exit
code.

Two runs can share the project at the same moment (a pull request and a merge
to `main`), so cleanup never deletes another run's accounts. Each run gets a
`TEST_RUN_ID` (set by `run-tests.mjs`, and by `playwright.config.ts` for E2E)
that every test email carries (`testEmail()` in `helpers/test-database.js`);
cleanup removes that run's accounts plus any `@test.local` account older than
a day. Run by hand, `npm run cleanup:test-data` removes every `@test.local`
account.

## Frontend — Vitest

```
cd frontend
bun run test            # once
bun run test:watch      # watch
bun run test:coverage   # with coverage
```

- **Pure helpers** — `format` (the `—` em-dash contract for missing values),
  `targets` (the mid/long target-collapse rules, both directions),
  `invest-style` (all three styles' thresholds and the re-derived
  recommendation severity order), `error-capture` (cause-chain expansion and
  the console.error capture the SSR error page relies on).
- **API client** — mocked `fetch`: Arabic error surfacing, status codes,
  network-failure → status 0, JSON `post`/`postForm` bodies.
- **Components** — `state-blocks` render tests via Testing Library.

Config: `vitest.config.ts` (standalone — the app's `vite.config.ts` is the
Lovable/TanStack build config), jsdom environment, `test/setup.ts` for
jest-dom and jsdom polyfills.

## E2E — Playwright

```
npx playwright test             # from the repo root
npx playwright test --headed    # watch it run
npx playwright show-report tests/e2e/report
```

`playwright.config.ts` boots the **real stack**:

- backend on `:3111` via `tests/e2e/backend-server.mjs` — the test Supabase
  project (same `helpers/test-database.js`), fixture bars pre-seeded for
  `ABUK`/`SWDY`, no AI or email key;
- frontend on `:8181` (`bun run dev`) with `ALYTIC_API_URL` pointing at that
  backend, so the `/api/public` proxy is exercised exactly as in production.

The specs drive the Arabic UI like a user: landing/pricing pages, registration
and login (including the duplicate-email and wrong-password errors), recording
trades, the portfolio view, cash + favorites, saving the daily close into the
calendar, the manual-entry correction dialog, and state persistence across a
logout/login cycle.

Two things worth knowing:

1. **Hydration** — the app is SSR'd; `tests/e2e/helpers.ts` has a `goto()`
   helper that waits for hydration before clicking, otherwise form submits
   fall through to native GETs.
2. **Ports** — `E2E_BACKEND_PORT` / `E2E_FRONTEND_PORT` override the defaults
   (3111/8181) if those are taken.
3. **Cleanup** — like the backend suite, specs register real `@test.local`
   users in the shared test project. `playwright.config.ts`'s
   `globalTeardown` (`tests/e2e/global-teardown.mjs`) deletes them after every
   run by shelling out to the backend's `cleanup-test-data.js`.

## CI

`.github/workflows/test.yml` runs on every pull request, by hand, and as the
first job of `deploy.yml`: the deploy only starts when it passes.

- **frontend** (vitest) needs no database and runs in parallel.
- **database** does everything that touches the test project, in order:
  apply `backend/supabase/schema.sql` and `platform.sql` (both idempotent, so
  the project always matches the commit under test), the backend suite, then
  E2E, uploading the Playwright report on failure. Only one such job runs at a
  time across all branches and the deploy (concurrency group
  `test-database`): re-applying the schema locks tables, and a second run's
  queries would time out behind it. GitHub keeps one run waiting per group and
  cancels it if a third arrives; rerun it if that happens.

For now the deploy gate is backend and frontend only: `deploy.yml` passes
`e2e: false` until the Playwright specs are brought up to date with the
current UI (#182). Pull requests still run E2E.

No AI or email secret is passed to it. It needs these repository secrets:
`BACKUP_DATABASE_URL` (session pooler string of the test project, shared with
the backup job) and `TEST_SUPABASE_SERVICE_ROLE_KEY`.

### Running locally

Add to `backend/.env` (Supabase dashboard of the test project, Project
Settings, API keys):

```
TEST_SUPABASE_URL=https://qfxuejkbnrdszycqxvdx.supabase.co
TEST_SUPABASE_SERVICE_ROLE_KEY=...
```

The existing `SUPABASE_URL` in that file (production) is ignored by the tests.
The first CI run creates the tables; to do it by hand, run `schema.sql` then
`platform.sql` in the test project's SQL editor.
