# ADR 0002 — Portfolio storage, quota home, and the migration to multiple Portfolios

- **Status:** Accepted.
- **Date:** 2026-10-03
- **Resolves:** issue #100, a ticket on the #98 map ("Multiple Portfolios for الحريفة subscribers, up to 3").
- **Builds on:** #99's inventory of the 93 touch points that assume one Portfolio per User.

## Context

Today every User has at most one `portfolios` row (`user_id` primary key, one `state_json` blob holding positions, trades, cash, snapshots, notes and watchlist). Map #98 settles that a الحريفة subscriber gets up to three independent Portfolios, each with its own Investing style, cash and P/L, and that every existing User's current data becomes their first Portfolio ("المحفظة الرئيسية"). This ADR settles the storage shape, where the User-level facts that currently live inside the blob move to, how the AI caches and Recommendations gain a Portfolio reference, and how the migration runs without downtime or data loss.

## Decision

### 1. Storage shape

`portfolios` becomes one row **per Portfolio**: a generated Portfolio id as the primary key, `user_id` as an indexed foreign key, plus `name`, `style` and an ordinal for display order. Not a per-User blob holding an array. This gives the 3-cap a plain `count(*)`, gives `recommendations` and the AI-cache tables a real foreign key to point at, and lets one Portfolio be deleted without rewriting a sibling's JSON.

### 2. Quota and Credits move to `users` — `imports` does not

`usage`, `credits`, `lastCashScanAt` and `lastMarketScanAt` are User-level facts mistakenly nested in the Portfolio blob (splitting or copying them per Portfolio would multiply the allowance). They move to new columns on `users`, following this codebase's existing convention for per-user facts (`alter table users add column if not exists ...`, as already done for `last_login_ip` and `last_seen_at`) rather than a new joined table — these are small fields, and quota is read on nearly every paid-feature request.

`imports` is **not** one of them, despite the earlier research inventory grouping it with the quota fields. It is `portfolio.imports`, an array of `{importedAt, positions, source}` records — which stocks a screenshot landed in this book and when — read by `behaviorProfile(portfolio)` (`scoring/behavior.js:147`, `importedPositions: portfolio.imports.length > 0`), a function ADR 0002 itself already scopes per Portfolio. It stays on the Portfolio's `state_json`, alongside `trades`, `log` and `corporateActions`. Only the *quota counter* it sits next to in code (`usage.screenshots`, how many imports this User has left this month) is the User-level fact.

### 3. The server becomes authoritative for Investing style

Every server endpoint today trusts a client-sent `?style=` / `body.style` param; only the daily-close snapshot and the admin list read the stored mirror (`state_json.settings.investStyle`). Once style is a column on the Portfolio row, the server resolves it server-side from the Portfolio id and no longer trusts a request-supplied style. This closes the existing mismatch where a client in "auto" mode and the server's stored style can disagree.

### 4. Recommendations gain `portfolio_id` and dedupe per Portfolio

`recommendations` gains a `portfolio_id` column, not nullable (see §5), referencing `portfolios(id)`. `recommendations_daily_key`'s unique index becomes `(user_id, portfolio_id, ticker, action, issued_on)`: a buy call on the same stock held in two Portfolios with different avg cost or style is two different calls, not one deduped against the other. `portfolio_id` joins `style` in the append-only guard's list of immutable issue fields — it is never reassigned, matching the semantics every other issue field has today. The Track record stays a per-User rollup across Portfolios, unaffected by this.

AI-cache tables that are keyed per User and per style today (`portfolio_reviews`, and the `stop:`/`stoplive:`/`cash:` keys it also holds) are keyed per Portfolio instead: `portfolio_reviews`'s primary key becomes `(portfolio_id, report_date, style)`, with `user_id` kept as a denormalized column for admin/support lookups but no longer part of the key. This was already settled in principle by map #98 ("the AI review and trailing stops run per Portfolio"); this ADR just fixes the key shape.

`user_follow_ups` stays per User — map #98 already rules out a per-Portfolio follow-up digest, since no automated follow-up email exists today.

### 5. Portfolios are soft-deleted

Deleting a Portfolio (map #98: allowed unless it's the last one, with typed confirmation) sets `deleted_at` rather than removing the row. This means `recommendations.portfolio_id` and every AI-cache foreign key can stay a plain, non-nullable `references portfolios(id)` — nothing is ever nulled out, so no exception is needed in the append-only guard beyond treating `portfolio_id` as immutable. A soft-deleted Portfolio simply stops counting toward the 3-cap and drops out of the desk switcher; its history stays joinable.

### 6. Migration backfills every User, with no downtime

The existing `portfolios` table (`user_id` primary key) is renamed aside; a new `portfolios` table is created with the shape from §1, plus the new columns from §2–§5 added to their respective tables. A backfill pass creates one "المحفظة الرئيسية" Portfolio row for **every** User, including Users who never wrote a `portfolios` row under the old lazy-creation scheme (today's `getPortfolio`/`putPortfolio` create one lazily on first write) — so no User is ever at zero Portfolios, and the cap check never needs a zero-Portfolio case. Existing `recommendations` and `portfolio_reviews` rows are backfilled with that User's new (sole) Portfolio id before the new foreign keys are made `not null`. The cutover (old table drop, column backfill, FK tightening) runs as an additive migration — new columns and tables added and backfilled first, reads switched over, old shape dropped last — so no maintenance window is required. Each white-label tenant runs its own Supabase database on the same schema, so this migration is applied once per tenant, not once globally.

## Consequences

- Every write path that touched `state_json.usage`/`credits`/etc. now reads/writes `users` columns instead; every write path that touched the Portfolio blob now takes a Portfolio id, not a User id.
- `/api/portfolio` and friends need a Portfolio id (path, query or header) checked against the User's ownership, and the mutating ones need a read-only check once a Portfolio is past the User's cap after a downgrade. Both are separate tickets on map #98 (#101, #103), not resolved here.
- A stock held in two Portfolios can now get two independent, non-deduped Recommendations on the same day — expected under the per-Portfolio Investing-style and stop-loss decisions already in map #98, but a behavior change from today's one-call-per-User-per-day dedupe.
