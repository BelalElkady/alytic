# Every place the app assumes one portfolio per User

Research for [#99](https://github.com/BelalElkady/alytic/issues/99), part of map [#98](https://github.com/BelalElkady/alytic/issues/98) (Multiple Portfolios for الحريفة subscribers, up to 3).

This is an **inventory, not a design**. Every entry was read from source at `origin/main` (`38751f3`). Line numbers refer to that commit. Vocabulary follows `CONTEXT.md`: Portfolio, Position, Investing style, Recommendation, Track record.

**Today:** each User has one `portfolios` row (`user_id` primary key) holding one `state_json` blob. Everything below reads or writes that blob by `user_id`, or keys a cache on `(user_id, style)` on the assumption that one User means one book and one style.

"Change" says what would have to key on a Portfolio instead. "Keep" means it is already per User or shared, which the product rules say is correct (quotas, Track record, shared market caches).

---

## Summary of touch points

| Group | Need a change | Verified unaffected (keep) |
|---|---|---|
| A. Backend storage / SQL | 13 | 8 tables |
| B. Backend logic / AI caches | 16 | 4 |
| C. API endpoints | 27 | 2 |
| D. Jobs (cron, edge function, emails) | 2 | 5 |
| E. Billing / quotas | 11 | 2 |
| F. Frontend (store, routes, components) | 24 | 2 |
| **Total** | **93** | |

---

## Top risks for the migration

1. **Quotas and Credits live inside the portfolio blob.** `usage`, `credits`, `imports`, `lastCashScanAt` and `lastMarketScanAt` are fields of `portfolios.state_json` (`server.js:783-826`, `1762-1798`, `2851-2858`). If the blob is split or copied into several Portfolios as it is, each Portfolio gets its own allowance and the cap is multiplied. These fields have to move to a per-User home first. Admin Credit grants also write into the blob (`server.js:1261`). `/api/reset` keeps these fields alive on purpose (`server.js:2771-2776`), which shows they were never really portfolio data.
2. **Lock atomicity across the User/Portfolio split.** A charged action today spends quota and changes the book in **one** `withPortfolio(userId)` critical section: a screenshot import bumps `usage.screenshots` and replaces positions together (`server.js:3032-3046`), and a stock review bumps `usage.recommendations` and writes `lastVerdicts` together (`server.js:3263-3270`). Once quota is per User and the book is per Portfolio, the per-user in-process queue (`portfolio.js:87-107`, keyed `tenant:userId`) has to cover both, or the check-then-spend race the lock was added to close comes back.
3. **The Investing style is client-owned and device-wide.** The working copy is one `localStorage` key, `alytic-invest-style` (`invest-style.ts:7`), shared by every tab and cleared on login. Every server endpoint takes the style as a request parameter (`?style=` / `body.style`) and trusts it. Only the daily-close snapshot (`server.js:2406`) and the admin list (`server.js:1172`) read the stored copy, `state_json.settings.investStyle`. "Auto" mode (inferred from trades on the client, `invest-style.ts:165-228`) has no server equivalent, so the daily close already falls back to `medium` for a User the desk shows as auto-inferred `trader`/`long`. That mismatch exists today, and per-Portfolio styles make it more visible.
4. **AI caches collide when two Portfolios share a style.** `portfolio_reviews` has the primary key `(user_id, report_date, style)` (`schema.sql:156`). Two Portfolios on the same style would overwrite each other's review. Each request then sees a `portfolio_hash` mismatch and pays for a fresh model call, so they ping-pong. The same applies to the per-position trailing stop `stop:STYLE:CODE` (`stopPlanner.js:134`) and `stoplive:STYLE:CODE` (`stopPlanner.js:200`) when the same stock is held in two Portfolios, which the product rules explicitly allow, and to the cash review `cash:STYLE:INDEX` (`cashAnalysis.js:266`).
5. **In-memory review jobs would join the wrong Portfolio's job.** `reviewJobKey = tenant:userId:style[:code]` (`server.js:3137-3139`). A stock review of COMI in Portfolio 2 while Portfolio 1's COMI review (same style) is still running would join it, skip the credit charge, and store Portfolio 1's verdict. `cashReviewJobKey` (`server.js:3288-3290`) also lacks the tenant prefix the other keys have. That is an existing bug.
6. **Recommendation logging dedupes per User.** The unique index is `recommendations_daily_key (user_id, ticker, action, issued_on)` (`schema.sql:605`, `db.js:1020`), and `withoutOpenDuplicates` filters by the User's open `ticker:action` (`recommendations.js:208-211`, `db.js:1025`). The same call issued for two Portfolios logs once, tagged with whichever came first. That is fine for a per-User Track record, but "tagged with the Portfolio it was issued for" will be lossy. Also, the append-only guard trigger (`schema.sql:644-656`) freezes the issue fields. If a new `portfolio_id` is added to that frozen list, an `on delete set null` FK would make **deleting a Portfolio raise**. If it isn't, backfilling it is allowed. Decide which deliberately.
7. **Users with no `portfolios` row.** The row is created lazily on first write (`db.js:220-234`); `loadPortfolio` returns an in-memory `EMPTY` for everyone else (`portfolio.js:32-34`). A migration that turns "every User's current data" into "المحفظة الرئيسية" by copying rows will miss these Users. Every tenant DB also has the CLI user `'local'` (`portfolio.js:90`, `cli.js:86`).
8. **Read-only after downgrade has no gate to reuse.** The portfolio write endpoints are deliberately outside `PAID_PATHS` (`server.js:560-569`) so a lapsed User can still manage their book. Making the extra Portfolios read-only needs a new per-Portfolio check on every mutating endpoint in group C. The daily close also has to decide whether read-only Portfolios still get snapshots (they stay visible, so probably yes).
9. **"Follow-up emails" don't exist in code.** Map #98 says follow-ups run per Portfolio and are emailed as a combined digest. The only email jobs are auth, contact and support-notification mails (`auth.js:243-267`, `server.js:336`, `server.js:681`). "Follow-up" in code is the Admin's manual WhatsApp/email checklist `user_follow_ups` (`schema.sql:298-304`), which is per User and sends nothing. The digest is new work, not a re-key.
10. **Every schema change has to land in every tenant database.** Each white-label site has its own Supabase DB (`schema.sql` header; `platform.sql:5-6`), and the daily close runs once per tenant (`server.js:2519-2532`).

---

## Where the Investing style is stored and read

| Where | File:line | Notes |
|---|---|---|
| Browser working copy | `frontend/src/lib/invest-style.ts:7` (`STYLE_STORAGE_KEY = "alytic-invest-style"`), `:96-136` | One key per device. Read by `useInvestStyle`, written by `setInvestStyle`, cleared by `clearInvestStyle`. |
| Auto mode (inferred) | `invest-style.ts:165-228` (`inferInvestStyle`, `useActiveInvestStyle(trades)`) | Inferred on the client from `pf.trades` (FIFO hold days). It is used whenever there is no manual pick. The server never infers it. |
| Server mirror | `portfolios.state_json.settings.investStyle`, written by `POST /api/settings/style` (`server.js:2753-2764`) | A mirror "so it follows the user across devices" (comment at `server.js:2748-2751`). |
| Sync local and server | `store.tsx:254-263` | Pushes a local pick up, or adopts the server pick when the device is in auto mode. |
| Forced first pick | `desk-shell.tsx:350-372` (`RequireInvestStyleDialog`) | Blocks the desk until `settings.investStyle` is set. |
| Cleared on login | `store.tsx:531-546` | So a shared device doesn't leak one User's pick to the next. |
| Server reads of the stored copy | `server.js:2406` (`snapshotForUser`, falls back to `DEFAULT_STYLE`), `server.js:1172` (admin users `chosenStyle`) | The only two places. |
| Server reads of the request param | `/api/analyze` `:1660`, `/api/scan` `:1832`, review preflight `:3182`, `/api/market-analysis` `:3381`, `/api/review/status` `:3369`, `/api/review/cash/status` `:3348` | The client sends whatever `useActiveInvestStyle` returns. |
| Style persisted elsewhere | `portfolio_reviews.style` (key), `recommendations.style` (`schema.sql:508`), `state_json.lastVerdicts[code].style` (`portfolio.js:535`), `market_reports.style`, `ai_stop_plans.style` | The last two are shared across Users per style, so keep them. |
| Admin behaviour | `scoring/behavior.js:39` (`behaviorProfile`), `:154-158` (`behaviorLines` "picked manually" vs auto) | Run on one portfolio blob. |

To key on a Portfolio, the style becomes a column or field on the Portfolio and the server resolves it from the Portfolio id instead of trusting a request param. The `localStorage` key and the login-clear logic either go away or get keyed per Portfolio. Auto inference then runs on one Portfolio's trades.

---

## A. Backend storage / SQL

| # | File:line | Keys on today | Change for per-Portfolio |
|---|---|---|---|
| A1 | `backend/supabase/schema.sql:92-97` `portfolios` | `user_id` **primary key**, one `state_json` | A Portfolio id becomes the PK, `user_id` an indexed FK, plus a name, a style and a created-at for ordering. Migrate each existing row to "المحفظة الرئيسية" (see risk 7). |
| A2 | `schema.sql:147-157` `portfolio_reviews` | PK `(user_id, report_date, style)`; `style` is overloaded with `cash:STYLE:INDEX`, `stop:STYLE:CODE`, `stoplive:STYLE:CODE` | Add the Portfolio to the key. The comment at `:141-146` is stale: it says `cash:INDEX`, the code uses `cash:STYLE:INDEX`, and `stoplive:` isn't mentioned. |
| A3 | `schema.sql:489-508` `recommendations` | `user_id`, `style`; no Portfolio | Add a nullable Portfolio reference (per the product rule). The FK's `on delete` has to fit the guard trigger (A5). |
| A4 | `schema.sql:605` `recommendations_daily_key` | unique `(user_id, ticker, action, issued_on)` | Keep per User (Track record per User), or add the Portfolio. Risk 6 has the trade-off. |
| A5 | `schema.sql:644-656` `recommendations_guard()` | Immutable issue-field list; only `user_id` may be cleared | Decide whether the Portfolio reference is an issue field. If it is, Portfolio deletion can't null it. |
| A6 | `backend/src/db.js:214-218` `getPortfolio(userId)` | `.eq('user_id')…maybeSingle()` | Take a Portfolio id, and add a list-by-User function. |
| A7 | `db.js:220-234` `putPortfolio(userId, state)` | Update by `user_id`, else insert (lazy create) | Write by Portfolio id. Creating a Portfolio becomes explicit, with the cap checked. |
| A8 | `db.js:708-713` `getAllPortfolios()` | `select user_id, state_json` | Return the Portfolio id too. Callers (daily close, admin users) iterate Portfolios. |
| A9 | `db.js:399-415` / `422-437` `get/putPortfolioReview(userId, date, style…)` | `user_id, report_date, style` | Take the Portfolio. |
| A10 | `db.js:1016-1022` `insertRecommendations` | `onConflict: user_id,ticker,action,issued_on` | Follows A4. |
| A11 | `db.js:1025-1040` `listOpenRecommendationKeys(userId)` | Open `ticker:action` per User | Follows A4. |
| A12 | `backend/src/portfolio.js:16-30` `EMPTY` blob shape | One book per User, plus undeclared User-level fields stored in the same blob: `usage`, `credits`, `imports`, `lastCashScanAt`, `lastMarketScanAt`, `lastVerdicts`, `nextAddedOrder` | Split the User-level fields out (group E). The rest becomes the Portfolio shape. |
| A13 | `portfolio.js:32-40` `loadPortfolio(userId='local')` / `savePortfolio` | `userId` | Take the Portfolio id. |

**Keep (already per User or shared):** `market_reports` (`schema.sql:103`, per day and style, shared), `ai_stop_plans` (`:120`, per stock, style and day, shared), `subscriptions` (`:226`, `tier` stays per User), `subscription_grants` (`:263`), `credits_grants` (`:282`), `user_follow_ups` (`:298`), `support_messages` (`:321`), `recommendation_prices` (`:700`). `deleteUser` (`db.js:645-657`) relies on `on delete cascade` from `users`. That still works if the Portfolio table keeps its FK to `users` with cascade.

## B. Backend logic / AI caches

| # | File:line | Keys on today | Change |
|---|---|---|---|
| B1 | `portfolio.js:87-107` `withPortfolio(userId, mutator)` | In-process queue `tenant:userId` | Queue per Portfolio for book writes, plus a per-User section for quota spends. Risk 2 covers the charged actions that do both. |
| B2 | `portfolio.js:400-406` `portfolioHash` | Positions, watchlist and cash only, no identity | Fine as a fingerprint, but it only protects a cache keyed by Portfolio. |
| B3 | `backend/src/agent/analyst.js:639-654` `getOrGenerateReview` | `getPortfolioReview(userId, asOf, style)` | Key by Portfolio (risk 4). |
| B4 | `backend/src/agent/cashAnalysis.js:262-284` `getOrGenerateCashReview` | `userId`, key `cash:${style}:${index}` | Key by Portfolio. The cash belongs to one Portfolio. |
| B5 | `backend/src/agent/stopPlanner.js:132-170` `getOrGenerateTrailingStop(userId, code…)` | `stop:${style}:${code}` under `userId` | Key by Portfolio. The same stock can sit in two Portfolios with different average cost. |
| B6 | `stopPlanner.js:198-240` `getLiveTrailingStop` | `stoplive:${style}:${code}`; in-flight Map key `${userId}:${cacheStyle}:${asOf}` (`:217`) | Same as B5, both the DB key and the in-memory key. |
| B7 | `backend/src/analyze.js:175-179`, `:385-405` `analyzeTicker({ userId })` | Passes `userId` down only to key B5/B6 | Pass the Portfolio id instead (or as well). |
| B8 | `backend/src/recommendations.js:122-165` `recommendationRow({ userId… })` | No Portfolio field | Add the Portfolio tag. |
| B9 | `recommendations.js:208-233` `withoutOpenDuplicates`, `logRecommendations(userId…)` | Per-User open-call dedupe | Take the Portfolio and decide the dedupe scope (risk 6). |
| B10 | `backend/src/api/server.js:776-777` `capitalOf(p)` | One book's capital, used for sizing everywhere | Per Portfolio (it already takes a blob). Callers must pass the right one. |
| B11 | `server.js:3132-3140` `reviewJobs`, `reviewJobKey(userId, style, code)` | `tenant:userId:style[:code]` | Add the Portfolio (risk 5). |
| B12 | `server.js:3285-3287` `cashReviewJobKey(userId, style, index)` | `userId:cash:style:index`, **no tenant** | Add the Portfolio and the tenant. |
| B13 | `server.js:2237-2276` `reconcileCorporateActions(userId)` | Loads and writes the one book | Run per Portfolio holding the stock. The shared `corporateActionResearch` Map (`:2236`) stays shared. |
| B14 | `server.js:2287-2298` `checkCorporateActionsSoon(userId…)` | Throttle Maps keyed `tenant:userId` | Per Portfolio, or per User iterating its Portfolios. |
| B15 | `server.js:2398-2465` `snapshotForUser(userId)` | One book; style from `settings.investStyle` (`:2406`) | Per Portfolio, using that Portfolio's style. |
| B16 | `backend/src/scoring/behavior.js:39-150` `behaviorProfile(portfolio)` | One blob's trades; `imports` (`:147`) means "has this account ever imported" | Per Portfolio for trades. `imports` is a User fact (see E). |

**Keep:** `corporateActions.js` itself is pure over one blob (`detectCorporateActions` `:359`, `applyCorporateActions` `:450`, `resolveCorporateAction` `:479`), so only its callers change. `rememberVerdict` / `lastVerdicts` (`portfolio.js:527-555`) stays in the Portfolio blob. `trackRecord(userId)` (`recommendations.js:441`) stays per User. The live-quote pool is per User (`data/live-quote-pool.js:126-128`, `:351`).

`backend/src/cli.js:86,162,262,273` always use `'local'`'s single book. It needs a Portfolio selector or a "first Portfolio" default.

## C. API endpoints (`backend/src/api/server.js`)

All of these resolve the book from `req.user.id` alone. Each needs a Portfolio id (path, query or header) checked against the User's ownership. The mutating ones also need the read-only-after-downgrade check (risk 8).

| # | Line | Endpoint | Notes |
|---|---|---|---|
| C1 | 2107 | `GET /api/portfolio` | Also returns the quota counters (E10) and fires `checkCorporateActionsSoon`. A Portfolio list endpoint, plus overall totals, is new. |
| C2 | 2159 | `POST /api/portfolio/trade` | Manual trades go to the active Portfolio. |
| C3 | 2186 | `POST /api/portfolio/trades/:index` | `:index` is the position in that Portfolio's trade log. |
| C4 | 2199 | `POST /api/portfolio/trades/:index/delete` | Same. |
| C5 | 2206 | `POST /api/portfolio/cash` | |
| C6 | 2300 | `POST /api/portfolio/corporate-action` | Undo/apply on one Portfolio's record. |
| C7 | 2311 | `POST /api/portfolio/levels` | |
| C8 | 2334 | `POST /api/portfolio/holding` | |
| C9 | 2372 | `POST /api/portfolio/watchlist` | The watchlist is per Portfolio. |
| C10 | 2468 | `POST /api/snapshot` | |
| C11 | 2652 | `POST /api/log/backfill` | |
| C12 | 2727 | `GET /api/log` | The calendar and charts read one log. A combined log is new. |
| C13 | 2732 | `POST /api/log/note` | |
| C14 | 2742 | `GET /api/settings` | Returns `RULES` merged with the blob's `settings`. |
| C15 | 2753 | `POST /api/settings/style` | Becomes "set this Portfolio's style". |
| C16 | 2766 | `POST /api/reset` | `scope=all` keeps the User-level fields (E8). Per-Portfolio reset versus delete needs a decision. |
| C17 | 2861 | `POST /api/portfolio/import-screenshot` | Goes to the active Portfolio, but charges the User quota (risk 2). |
| C18 | 1653 | `GET /api/analyze/:code` | Uses `portfolio.positions[code]` and capital. The same stock can be held in two Portfolios, so it needs Portfolio context. |
| C19 | 1723 | `GET /api/quotes` | With no `codes`, defaults to the one book's positions. Use all Portfolios' held codes, or the active one. |
| C20 | 1800 (+ `runScan` 1855) | `GET /api/scan` | Cash, positions and capital come from one book. The cash/market session charge is per User (E3). |
| C21 | 3193 (+ `runReview` 3067) | `POST /api/review` | Full review. No frontend caller found, only `cli.js review`. |
| C22 | 3199 | `POST /api/review/stock` | Per-Portfolio position, style and `lastVerdicts`. Charges the User's `recommendations` quota. |
| C23 | 3292 | `POST /api/review/cash` | Per-Portfolio cash. Requires the User's open cash-scan session (`withinCashScanSession`). |
| C24 | 3369 | `GET /api/review/status` | Job key (B11). |
| C25 | 3348 | `GET /api/review/cash/status` | Job key (B12). |
| C26 | 1154 | `GET /api/admin/users` | One `portfolio` and one `behavior` object per User. How an Admin sees several Portfolios is still open on #98. |
| C27 | 1246 | `POST /api/admin/users/:id/credits` | Writes Credits through `withPortfolio(userId)`. Once Credits are per User this moves (E2). |

**Keep:** `GET /api/market-analysis` (`:3374`): shared report, logged per User, no frontend caller found. `GET /api/track-record` (`:3400`): per User by product rule.

## D. Jobs (cron, edge function, emails)

| # | File:line | Keys on today | Change |
|---|---|---|---|
| D1 | `server.js:2535-2570` `runDailyClose` | `getAllPortfolios()` rows → `user_id` with positions → `reconcileCorporateActions(userId)` and `snapshotForUser(userId)` | Iterate Portfolios. Count saved/failed per Portfolio. Decide whether read-only ones get snapshots. |
| D2 | `server.js:2519-2532` `runDailyCloseForAllSites` | Per tenant | No logic change, but each tenant DB needs the migration first (risk 10). |

**Keep:** the in-process scheduler `startDailyCloseScheduler` (`server.js:2586`); `.github/workflows/daily-close-cron.yml` (only POSTs `/api/cron/daily-close`); the stop-plan warmer (`agent/stopPlanWarmer.js:33-70`, `server.js:2623-2645`), which covers the whole universe times every style and is shared; the `evaluate-recommendations` Edge Function (`backend/supabase/functions/evaluate-recommendations/index.ts:57,69,114`), which only reads and resolves `recommendations` / `recommendation_prices`, with no User or Portfolio logic; and `recommendations-cron.sql` (pg_cron trigger only).

**Emails:** none of the existing emails touch portfolio data: verification, reset, registration, already-registered (`auth.js:243-267`), contact (`server.js:336`), support notification (`server.js:681`). There is **no follow-up email job** to re-key (risk 9).

## E. Billing / quotas (stay per User by product rule, but stored per book today)

| # | File:line | Stored or keyed on today | Change |
|---|---|---|---|
| E1 | `server.js:797-811` `USAGE_KINDS`, `usageFor`, `bumpUsage` | `portfolio.usage` (month + 4 counters) in the blob | Move to a User-level store. |
| E2 | `server.js:780-794` `CREDIT_KINDS`, `creditsOf`, `addCredits` | `portfolio.credits` in the blob | Move to the User level. `credits_grants` is already per User. |
| E3 | `server.js:1757-1798` `SCAN_LAST_AT_FIELD`, `withinScanSession`, `chargeScanSession(userId…)` | `portfolio.lastCashScanAt` / `lastMarketScanAt`, charged inside `withPortfolio(userId)` | Move to the User level. The cash-scan session gates `/api/review/cash` (C23). |
| E4 | `server.js:812-826` `baseLeftFor`, `leftFor(kind, portfolio, tier)` | Read the counts from a portfolio blob | Take User-level usage. |
| E5 | `server.js:2849-2867`, `3003-3046` screenshot cap (`screenshotImportsLeft`, `imports` log) | `usage.screenshots` + `credits` + `imports` in the blob | Quota per User, positions per Portfolio, in one atomic step (risk 2). `imports` ("ever imported", read by `behavior.js:147`) is a User fact. |
| E6 | `server.js:3226-3270` recommendation charge on `/api/review/stock` | `leftFor('recommendations', portfolio)` then `bumpUsage` inside `withPortfolio(userId)` | Same split. |
| E7 | `server.js:1228-1235` admin users `usage` | Computed from the one blob | From the User-level store. |
| E8 | `server.js:2769-2776` `/api/reset` keeps `imports, credits, usage, lastCashScanAt, lastMarketScanAt` | Shows these are User data mixed into the book | Not needed once they move. |
| E9 | `backend/src/billing/plans.js:10-14` `TIERS` | Per-feature caps per tier; **no Portfolio cap** | Add the Portfolio cap (free 1, long 1, trader 3). Per-tenant `plansFor` / `/api/billing/plans` (`server.js:471-480`) exposes `TIERS` to the subscribe screen. |
| E10 | `server.js:2113-2128` `GET /api/portfolio` returns `tier`, `*Left`, `*PerMonth`, `credits` | Quota rides on the portfolio response | Move to a User-level response (or keep it duplicated on each Portfolio). The frontend reads quota from `pf` (F17-F19). |
| E11 | `server.js:560-569` `PAID_PATHS` | The paywall covers scans, reviews and imports; book writes are free on purpose | A per-Portfolio read-only gate after downgrade is new (risk 8). |

**Keep:** `accessInfo` (`server.js:101-125`): the tier resolves per User. `perUserLimiter` (`server.js:616-628`): rate limits keyed `user:id`.

## F. Frontend

| # | File:line | Assumes | Change |
|---|---|---|---|
| F1 | `frontend/src/lib/store.tsx:217` `pf` state, `:160-203` `DeskValue` | One `pf`, `rows`, `log`, `totals` per desk | Add an active Portfolio id, the Portfolio list and overall totals. |
| F2 | `store.tsx:248` `useActiveInvestStyle(pf?.trades)` | One style per User | The active Portfolio's style. |
| F3 | `store.tsx:254-263` style sync effect | `pf.settings.investStyle` and one local key | Per Portfolio, or drop it if the server becomes authoritative. |
| F4 | `store.tsx:290-310` `reload` | `/api/portfolio` → `/api/scan?codes=held&style=` → `/api/log` | Scoped to the active Portfolio, and reloaded when it changes. |
| F5 | `store.tsx:312-318` `reloadPortfolio`, `reloadLog` | Single book | Active Portfolio. |
| F6 | `store.tsx:354-388` `refreshLevels` | Rescans `rows` with the one style | Active Portfolio and its style. |
| F7 | `store.tsx:389-420` `refreshPrices` / quotes | Polls held codes of one book | Union across Portfolios if the overall view shows live values. |
| F8 | `store.tsx:531-546` `clearInvestStyle()` on login | One device-wide style | Follows F3. |
| F9 | `store.tsx:578-596` `totals` | One book's cost, value, P/L and cash | Per Portfolio, plus the overall stats view. |
| F10 | `frontend/src/lib/invest-style.ts:7, 96-136, 213-228` | One `localStorage` key, one inferred style | Per Portfolio (the "Investing style" section above). |
| F11 | `frontend/src/components/desk/desk-shell.tsx:350-372` `RequireInvestStyleDialog` | "Has this User picked a style" | "Has this Portfolio a style". The style is picked on Portfolio creation. |
| F12 | `desk-shell.tsx:471-472, 635-640` header style label | One style | Active Portfolio style, plus the switcher (per #98). |
| F13 | `desk-shell.tsx:539-540` screenshot import | Posts to the one book | To the active Portfolio. |
| F14 | `components/desk/market-analysis.tsx:131, 156, 188, 198` | Style, cash and `/api/scan` / `/api/review/cash` for the one book | Active Portfolio. |
| F15 | `components/desk/stock-detail.tsx:39, 52` | `/api/analyze/:code?style=` | Pass the Portfolio. |
| F16 | `components/desk/new-trade-dialog.tsx:94, 122-123`, `components/desk/manual-entry-dialog.tsx:129, 135, 264-265` | Trade, holding and levels writes and the trade log of the one book | Active Portfolio. |
| F17 | `routes/_app.portfolio.tsx:291-345` `useStockReview`, `:423-454` | `pf.lastVerdicts`, `pf.recommendationsLeft`, one style | `lastVerdicts` from the active Portfolio. `recommendationsLeft` is User-level. |
| F18 | `routes/_app.portfolio.tsx:685, 699, 851-858, 937` | Corporate-action records, style recommendation, holding fix | Active Portfolio. |
| F19 | `routes/_app.cash.tsx:74, 187-286` | Cash, watchlist and `cashScansLeft` from `pf`; `totals` | Active Portfolio. The scan quota is User-level. |
| F20 | `routes/_app.settings.tsx:154-169` | Style picker and `/api/reset` | Per-Portfolio style. Rename and delete with typed confirmation are new. |
| F21 | `routes/_app.settings.tsx:180-233` | Quota cards read from `pf` | User-level source (E10). |
| F22 | `routes/_app.calendar.tsx:81-102`, `routes/_app.charts.tsx:44-56` | One `log`, backfill | Active Portfolio. A combined chart is out of scope for now (#98). |
| F23 | `routes/_app.targets.tsx` (reads `rows`) | One book's rows | Active Portfolio. |
| F24 | `components/admin/users-screen.tsx:165-170, 309, 418` | `row.portfolio`, `behavior.chosenStyle`, capital per User | Open on #98 (how an Admin sees several Portfolios). |

**Keep:** `routes/_app.tsx` and the route tree have no portfolio in the URL. The active Portfolio is desk state unless the design puts it in the URL. `lib/position-sort.ts:64-84` is a device-wide sort preference and can stay global.

## Tests that encode the single-book assumption

`backend/test/modules/portfolio.test.js`, `backend/test/api/auth-portfolio.test.js`, `backend/test/api/analysis.test.js`, `frontend/src/lib/api.test.ts` (found by grepping for `putPortfolio|getPortfolio|withPortfolio|loadPortfolio|portfolio_reviews|investStyle`). Not run, per the ticket's rule.
