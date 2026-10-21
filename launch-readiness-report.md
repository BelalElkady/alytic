# Launch Readiness Report
Project: Alytic / EGXpert · Date: 2026-10-21 · Scope: full

## Verdict
**Not ready for paying customers** (blocker override) · Score 15 / 27 (56%), which is the "Pilot ready" band without the override.
The product is better built than the score suggests: no committed secrets, RLS locked down, admin routes gated on the server, cron secrets compared in constant time. Two things hold it back: nothing runs your tests before a deploy (the test workflow is commented out), and backups and error monitoring are unconfirmed. Personal data (emails) in server logs is the second blocker under the rubric.

## Blockers (fix before any paying customer)
1. **Backups not verifiable** · no backup script, schedule or restore note anywhere; `SECURITY-AUDIT.md:53` lists "Backups and alerting for the Supabase project and the VPS" under *Not changed* · one bad deploy or dropped table with no restore = total loss (users, portfolios, subscriptions). Treated as Critical until you confirm a restored backup (see Questions).
2. **Personal data in server logs** · `backend/src/api/server.js:1785`, `:1810`, `backend/src/api/platform.js:416`, `:442` (`[audit]` lines print user emails), `backend/src/email.js:43`, `:52` (recipient email) · emails land in journald/log files with no retention rule. Small fix, but the rubric marks it Critical.

## Scorecard
| # | Area | Score | Top gap |
|---|------|-------|---------|
| 1 | Project rules | 1/3 | Root AGENTS.md is 13 lines of issue-tracker pointers; no commands, no security rules |
| 2 | Security | 2/3 | Reset and verify tokens stored in plaintext; no server-side session revocation; no admin 2FA |
| 3 | Safety net | 1/3 | Test CI disabled; no staging; no error monitoring; backups unconfirmed |
| 4 | Workspaces and roles | N/A | Individual-investor subscription product; no team accounts by design |
| 5 | Billing | 2/3 | Manual InstaPay by decision; no receipts or invoices, no expiry reminders found |
| 6 | Onboarding | 2/3 | Tour and email verification exist; no sample data or welcome email found |
| 7 | Activation analytics | 1/3 | Only consent-gated GA/pixels; no product events, no activation metric |
| 8 | Admin and audit | 2/3 | Strong admin panel; audit trail is `console.log`, not a table |
| 9 | Arabic and RTL | 3/3 | Arabic-first, `dir="rtl"`, Arabic fonts self-hosted |
| 10 | Privacy and data rights | 1/3 | No terms page, no self-serve export or delete, emails in logs |

## Project map
- Stack: Node 20+/Express 5 backend (`backend/`, ~4,470-line `src/api/server.js`), TanStack Start + Vite frontend on bun (`frontend/`), Playwright E2E (`tests/e2e`). npm for backend/root, bun for frontend.
- Data: Supabase Postgres via service-role key from the Express server only; SQL files in `backend/supabase/` (not versioned migrations).
- Auth: custom (scrypt passwords, signed session cookie, Google sign-in, email verification via Resend). Roles: admin, marketer, user.
- Payments: no gateway. Manual InstaPay plus admin-granted subscriptions (`subscriptions` table), by decision.
- Hosting: VPS behind nginx (`deploy/nginx/`), GitHub Actions deploy over SSH (`deploy.yml`, `production` environment). Multi-site (white-label tenants, `backend/src/tenancy/`).
- Entry points: 119 route handlers in `server.js` and `platform.js`; one Supabase edge function (`evaluate-recommendations`).
- Git: 394 tracked files, no `.env` tracked (only `.env.example` files with empty values), lockfiles present.
- Review coverage: read the auth/paywall/admin middleware, all cron handlers, health, and spot-checked portfolio and announcement handlers. **About 20 of 119 handlers read line by line**; the rest were covered by route listing and pattern searches only.

## Findings by area

### 1. Project rules · 1/3
* **[High]** Root `AGENTS.md` is 13 lines and only points to the issue tracker, triage labels and domain docs; it has no run/test/deploy commands, folder conventions, security rules or no-touch areas · `AGENTS.md:1`
* **[Low]** `CONTEXT.md` (77 lines) documents the domain, and `SECURITY-AUDIT.md`/`TESTING.md` hold good detail, but none of it is a rules file an agent is told to follow.

**Fix prompt:** "Extend AGENTS.md (keep it under 80 lines) with: the stack (Express 5 in backend/, TanStack Start on bun in frontend/), commands (`npm --prefix backend test`, `bun run --cwd frontend test`, `npm run test:e2e`, `node --check` for quick syntax checks), and non-negotiable rules: every `/api` handler scopes queries by `req.user.id`, new `/api/admin` routes are closed to marketers until added to MARKETER_READS, no secrets in code, validate every input at the boundary with zod, never edit SQL that already ran in production; add a new patch file instead."

### 2. Security · 2/3
* **No Critical found.** No secrets in tracked files (pattern search for `sk_live_`, `AKIA`, private keys, `ghp_`, `AIza`, quoted secret assignments returned only test passwords such as `Passw0rd!123` in `backend/test/**`).
* No `VITE_*`/`NEXT_PUBLIC_*` variable names containing SECRET, SERVICE_ROLE or PRIVATE. Service-role key is referenced only server-side (`backend/src/supabaseClient.js`) and in admin copy text (`frontend/src/components/admin/platform-tab.tsx`).
* Authorization: global auth middleware on `/api` with an explicit public allowlist (`server.js:644-663`); admin guard on `/api/admin` requires verified email, marketers limited by an allowlist (`server.js:1150-1156`); record handlers read here take the user id from the session (`/api/portfolios/:id` → `renamePortfolio(req.user.id, id, …)`, `server.js:2849-2868`; announcement dismiss uses `req.user.id`, `server.js:826`).
* Database: schema.sql enables RLS on every public table and revokes anon/authenticated (`backend/supabase/schema.sql:869-890`). It is a manual step; see Questions.
* Cron endpoints check `X-Cron-Secret` in constant time (`server.js:496-499`, `:3309-3312`). Session cookie is `HttpOnly; SameSite=Lax` plus `Secure` in production (`backend/src/auth.js:513,521`). Rate limits on auth, email, AI, cron. Origin guard on writes.
* **[High]** Verification and reset tokens stored in plaintext (`backend/supabase/schema.sql:31`; acknowledged in `SECURITY-AUDIT.md`). A database leak exposes any unexpired link.
* **[High]** Sessions are stateless for 30 days; logout does not revoke a stolen cookie (`SECURITY-AUDIT.md`).
* **[Medium]** No two-factor for admin accounts, though one admin login controls user deletion, subscriptions and published content.
* **[Medium]** CSP full allow-list is report-only, not enforced (`frontend/src/server.ts:90`).
* **[Low]** `xlsx` installed from SheetJS CDN, invisible to `npm audit` (`backend/package.json`). Lockfiles exist; Dependabot and a weekly `security.yml` audit are configured.
* Payment webhooks: N/A, there is no payment gateway.

**Fix prompt:** "In backend/src/auth.js and schema.sql, store only a SHA-256 hash of verify_token and reset_token (compare hashes on lookup), add a `sessions_valid_after` timestamp on users that logout and password change bump and that userFromRequest checks, and add TOTP for accounts with is_admin. Update test/modules/auth.test.js, which currently reads raw tokens from the row."

### 3. Safety net · 1/3
* **[Critical, pending confirmation]** Backups: nothing in the repo (see Blockers).
* **[High]** Tests do not gate deploys. `.github/workflows/test.yml` is entirely commented out (commit `854935c "stop test ci"`), and `deploy.yml` runs lint and build only (`deploy.yml:51,56`). 65 test files exist, including `portfolio-readonly-gate`, `roles`, `auth-portfolio`, and Playwright specs for auth/desk, so the coverage is there; it just never runs automatically.
* **[High]** No error monitoring: search for Sentry, Bugsnag, Rollbar, Datadog, LogRocket found nothing in `backend/` or `frontend/`.
* **[Medium]** No staging or preview environment: no `.env.staging`, no per-branch deploy; `deploy.yml` deploys `main` to the `production` environment directly.
* **[Medium]** Schema changes are loose SQL files (`patch-*.sql`, `migrate-*.sql`) applied by hand, not versioned migrations. `supabase/config.toml` exists but no `supabase/migrations/` folder.
* **[Low]** `/api/health` exists and the deploy waits on it (`server.js:4401`, `deploy.yml:195`), but no external uptime monitor is configured in the repo. Logging is `console.*` strings, not structured.

**Fix prompt:** "Re-enable .github/workflows/test.yml (uncomment it) and make `deploy` in deploy.yml depend on a passing `backend` and `frontend` test job. Add Sentry to backend/src/api/server.js (Express error handler) and the TanStack Start entry in frontend/, without logging request bodies. Do not touch production config or secrets."

### 4. Workspaces and roles · N/A
Alytic sells subscriptions to individual investors, not to companies. Roles (user, marketer, admin) are enforced on the server. The white-label `tenancy/` layer separates client *sites* (each with its own database), not teams inside one site. Revisit if you plan team or advisor-firm accounts.

### 5. Billing · 2/3
* Subscription state lives in `subscriptions` (`user_id, plan, tier, current_period_end`, `backend/supabase/schema.sql:280`) and paid endpoints are gated on the server by `PAID_PATHS` plus `accessInfo` (`server.js:673-715`); an expired or trial-ended account gets a 402 with an InstaPay renewal message, and its own portfolio data stays readable.
* Plan changes and cancellation are admin actions (`POST/DELETE /api/admin/users/:id/subscription`, `server.js:1651,1715`).
* **[Medium]** No receipt or invoice generation found for customers, and no tax/VAT handling. Confirm obligations with an accountant.
* **[Medium]** No scheduled "your subscription ends in N days" reminder found in `backend/src` (not exhaustively searched).
* Webhooks, idempotency, past_due flow: N/A while billing is manual.

**Fix prompt:** "Add a daily job (in the existing startDailyCloseScheduler pattern, server.js) that emails subscribers 5 days and 1 day before `current_period_end` via backend/src/emailTemplates.js, with the InstaPay instructions, and records the send so it fires once. Add a downloadable receipt (PDF or HTML) after an admin activates a subscription."

### 6. Onboarding and first value · 2/3
* Free trial gated on email verification with clear messages (`server.js:683-690`); verification and reset emails go through Resend.
* A guided tour exists (`frontend/src/components/tour/tour.tsx`).
* **[Medium]** No welcome email template found and no sample portfolio or demo data for a new account.
* Not checked: empty states across all pages and signup field count.

**Fix prompt:** "Add a welcome email after verification in backend/src/emailTemplates.js, and an optional sample portfolio the tour can load and the user can delete, so the first desk view is never empty."

### 7. Activation analytics · 1/3
* Only Google Tag Manager/GA and Facebook pixel, loaded after consent (`frontend/src/lib/consent.ts:61`). Search for PostHog, Mixpanel, Amplitude found nothing.
* **[Medium]** No activation event (for example "first trade added" or "first review run") and no funnel from signup to paid. `/api/presence` tracks online users only.
* **[Medium]** Billing events (trial started, subscribed, expired) are not tracked as events; they exist only as rows.

**Fix prompt:** "Add one server-side `track(event, userId, props)` module in backend/src that writes to an `events` table (no third party needed). Record signup, email_verified, first_trade_added, first_review_run, subscription_granted and subscription_expired, then add an admin funnel view."

### 8. Admin panel and audit log · 2/3
* Full admin area: users, credits, subscriptions, roles, suspend, delete, support inbox, blog, announcements, indices, platform tenants (`server.js:1249-2075`, `platform.js`), protected on the server (`server.js:1150-1156`) with admin-only deletion rules.
* **[High]** No audit table. Role changes and suspensions are written only as `console.log("[audit] …")` (`server.js:1785,1810`); subscription grants carry `granted_by` but credits, deletions, announcements and exports leave no durable trail. Those log lines also contain emails (Blocker 2).
* **[Low]** No impersonation, so nothing to log there.

**Fix prompt:** "Create an `audit_logs` table (actor_id, action, target_id, tenant_id, details jsonb, created_at) in a new patch SQL file, add `recordAudit()` in backend/src/db.js, and call it from every /api/admin write in server.js and platform.js, replacing the console.log lines. Log user ids, not emails."

### 9. Arabic and RTL · 3/3
* `<html lang="ar" dir="rtl">` (`frontend/src/routes/__root.tsx:161`), IBM Plex Sans Arabic and Tajawal self-hosted via fontsource (`frontend/package.json:21-22`), Arabic error pages, locale-aware formatting used (29 `Intl`/`toLocale` uses).
* **[Low]** 31 physical (`ml-/mr-/pl-/pr-`) vs 22 logical class uses; harmless while the app is RTL-only, but it matters if you ever add an English UI. No i18n library; all copy is Arabic strings in components, which is fine for a single-language product.

**Fix prompt:** "Only if an English UI is planned: introduce i18next, move strings from frontend/src/routes and components into locale files, and convert ml-/mr-/pl-/pr- to ms-/me-/ps-/pe-."

### 10. Privacy and data rights · 1/3
* Privacy page exists (`frontend/src/routes/privacy.tsx`) and a consent banner gates the trackers (`frontend/src/components/consent-banner.tsx`, `consent.ts`). The privacy page itself says to request deletion (`privacy.tsx:167`).
* **[Critical per rubric]** Emails in server logs (Blocker 2).
* **[High]** No terms-of-service page: `frontend/src/routes` has only about, contact, privacy.
* **[High]** No self-serve account deletion or data export. `deleteUser` (`backend/src/db.js:841`) exists but is reachable only from the admin route (`server.js:1734`).
* **[Medium]** Consent is stored in the browser only (`consent.ts`); there is no server-side record with a timestamp.
* **[Medium]** No retention rules for logs, support messages or old data.
* Third parties receiving personal data (from code): Supabase (database), Resend (email), OpenRouter (AI prompts; portfolio screenshots go to a vision model), Google (sign-in, GTM), Facebook pixel, AdSense (CSP list), Oanor and TradingView (market data, no user data expected). Confirm obligations under Egypt's PDPL with a qualified lawyer.

**Fix prompt:** "Add POST /api/account/export (JSON of the user's portfolios, trades, log, settings) and DELETE /api/account (password re-check, calls deleteUser in backend/src/db.js, clears the session cookie), with buttons in the settings page. Add a /terms route linked from signup and the footer. Replace emails in the `[audit]` and `[email]` console lines with user ids."

## Questions for the founder
1. Backups: do you have automated daily backups of the Supabase project and the VPS, and have you restored one at least once? If "no", blocker 1 stays open.
2. Did you run the RLS section at the end of `backend/supabase/schema.sql` on the production Supabase project? The repo cannot show what production has applied.
3. Where are your Supabase project and file storage hosted (region), and do you process data of people in Egypt, Saudi Arabia or the UAE?
4. Which country is your company registered in, and will InstaPay stay your only payment method? If you sell in Saudi Arabia, ask your accountant whether ZATCA e-invoicing applies.
5. What is the one action that shows a new account got value (first trade logged? first AI review?). It should become your activation event.
6. Was `test.yml` disabled because of cost or flakiness? Knowing why tells us whether to re-enable the whole suite or only the fast unit and API tests.
7. Is there a Terms of Service somewhere outside this repo (for example a Google Doc linked in the footer)?

## Suggested order of work
1. Blockers: confirm and test a backup restore; remove emails from logs.
2. Security, safety net and privacy (areas 2, 3, 10): re-enable test CI before deploy, add error monitoring, hash tokens and add session revocation, terms page and self-serve export/delete.
3. Selling (areas 4, 5): receipts and expiry reminders (area 4 is N/A).
4. Growth (areas 6, 7, 8, 9): welcome email and sample data, activation events, `audit_logs` table.
Start every session by updating CLAUDE.md or AGENTS.md (area 1) with what you learned.

---
Generated by the SaaS Launch Readiness Check skill · Mohamed Elsherif, SaaS Transformation Partner · mohamedelsherif.com
This report reviews code only. It is not legal, tax or security certification.
