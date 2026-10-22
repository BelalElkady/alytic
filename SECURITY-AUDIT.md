# Security audit — EGXpert / Alytic

Scope: the Express API (`backend/`), the TanStack Start frontend and its `/api/public` proxy (`frontend/`), the Supabase schema, the nginx config and the GitHub workflows.
Method: full read of the API, auth, billing gates, upload paths, proxy and deploy files, plus a secret scan of the working tree and all 236 commits (no secrets found).

## Findings and status

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | High | Paywall bypass by letter case. Express matched `/api/SCAN` to the scan handler, but the paywall compared paths case-sensitively, so expired or free accounts could reach paid and AI endpoints. | Fixed: case-sensitive routing |
| 2 | High | Unvalidated ticker in analyze, fundamentals, quotes and scan. It reached a cache file path (`../` traversal), a TradingView message, and AI prompts and cache keys. Arbitrary tickers also meant unbounded upstream calls and model spend. | Fixed: known tickers only, capped lists, cache key validated |
| 3 | High | Account pre-hijack through Google sign-in. Someone could register a victim's address with their own password, and when the victim later used Google the account was linked with the attacker's password still valid. | Fixed: password wiped when linking an unverified account; `email_verified` required from Google |
| 4 | High | Admin without a confirmed mailbox. Addresses in `ADMIN_EMAILS` (which falls back to a hard-coded default) became admin at signup, and login never required verification. | Fixed: admin routes require a verified email |
| 5 | High | Supabase tables had no row level security, so anyone holding the project's anon key could read the tables directly, including password hashes. | **SQL added, you must run it** |
| 6 | Medium | No security headers anywhere (framing, sniffing, referrer, HSTS). | Fixed in API, frontend and nginx |
| 7 | Medium | Internal error text (table names, upstream URLs) was returned to clients on 500s, from the history route and from review jobs. | Fixed: only the app's own Arabic messages pass through |
| 8 | Medium | Login: no per-account throttle, a timing difference revealed which emails exist, passwords were unbounded (scrypt CPU) and a non-string password caused a 500. | Fixed |
| 9 | Medium | Mail bombing: forgot-password, resend-verification and "already registered" mails could be aimed at one inbox from many addresses. | Fixed: one mail per recipient per 2 minutes |
| 10 | Medium | No rate limit on authenticated, expensive endpoints, and `force=1` bypassed every cache. | Fixed: per-IP flood limit and per-user limits on scan, analysis and AI |
| 11 | Medium | Cron endpoints were reachable through the public proxy, and their secrets were compared with `!==`. | Fixed: blocked in proxy and nginx, constant-time compare |
| 12 | Medium | Cross-site writes were guarded only by the SameSite cookie. | Fixed: Origin guard on every write |
| 13 | Medium | Any client could send `x-lovable-preview: 1` and make the proxy re-issue the session cookie as `SameSite=None`. | Fixed: opt-in via `ALLOW_LOVABLE_PREVIEW=1` |
| 14 | Medium | Uploads trusted the Content-Type header. | Fixed: image bytes are checked (JPEG, PNG, WebP) |
| 15 | Low | Unbounded numbers and notes in trades, cash, watchlist and log notes. | Fixed: bounds and type checks |
| 16 | Low | Blog image and credit URLs were passed through unchecked. | Fixed: only https URLs are served |
| 17 | Low | `www` redirect trusted the Host header (open redirect). Static serving and `X-Powered-By` were on. A malformed cookie caused a 500. | Fixed |

## Steps that need you

1. **Run the new last section of `backend/supabase/schema.sql`** in the Supabase SQL editor. It enables RLS on every table and revokes the anon and authenticated roles. The backend uses the service-role key, which bypasses RLS, so the app is unaffected. Verify with the query at the bottom of that section.
2. **Confirm production `.env`** has: `SESSION_SECRET` (32+ random characters), `ADMIN_EMAILS`, `FRONTEND_URL` or `APP_URL` (https), the three `*_CRON_SECRET` values (each different), and `RESEND_API_KEY`. The server prints a `[security]` warning at boot for anything weak.
3. **nginx:** copy `deploy/nginx/egxpert-limits.conf` to `/etc/nginx/conf.d/`, merge the new blocks from `deploy/nginx/egxpert.conf` into the certbot-modified site file, then `nginx -t && systemctl reload nginx`.
4. **Deploy, then probe the live site:** `cd backend && node scripts/security-check.mjs https://egxpert.com`. Add `--active` to also confirm the login rate limit trips (it rate-limits your own address for about 15 minutes).
5. In GitHub → Settings → Code security, enable Dependabot alerts and security updates and secret scanning. The new `security.yml` and `dependabot.yml` do the rest.

## Behavior changes to expect

- Requests for a ticker that is not in the universe now get 404 instead of a 422 analysis.
- Ten wrong passwords on one account lock logins for it for 15 minutes, from any address. Password reset still works. This can be abused to lock someone out briefly.
- A second password-reset or verification request within 2 minutes for the same address is ignored.
- Passwords are limited to 128 characters.
- The Lovable editor preview (an iframe) is blocked by `frame-ancestors 'self'`, and its cookie trick is off unless `ALLOW_LOVABLE_PREVIEW=1`.
- The Content-Security-Policy enforces only the safe directives. The full source allow-list is sent as report-only so it can be tuned against Google sign-in, Tag Manager and AdSense before being enforced.

## Not changed, worth doing next

- **Server-side session revocation.** Sessions are stateless for 30 days. A password change invalidates them, but logout does not revoke a stolen cookie. A `sessions_valid_after` column on `users` would fix it.
- **Two-factor authentication for admin accounts**, since one admin login controls billing, user deletion and published content.
- **Pin the third-party deploy actions** (`appleboy/scp-action`, `appleboy/ssh-action`) to commit SHAs. They hold the server SSH key. Dependabot will now propose updates.
- **Promote the report-only CSP** to enforced once the browser console is clean.
- **`xlsx` is installed from SheetJS's CDN** (0.20.3, the patched release). `npm audit` cannot see it, so check for new releases by hand.
- **Backups and alerting** for the Supabase project and the VPS.

## Running the checks

```
cd backend
npm run security:check                              # repo, source guards, configuration
node scripts/security-check.mjs https://egxpert.com # + live probe (headers, TLS, access control, CORS, errors, exposed files)
npm run security:audit                              # npm audit for production dependencies
node --test test/unit/security.test.js              # unit tests for the new helpers
```

The new tests, including the auth ones added to `test/modules/auth.test.js`, were only syntax-checked, not run.
