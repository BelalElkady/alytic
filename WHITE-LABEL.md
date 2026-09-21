# White-label sites

One backend and one frontend serve several branded sites. Each client has:

- **their own domain**, e.g. `app.clientx.com`
- **their own look**: name, logo, colors, favicon, analytics IDs and social links
- **their own database**: a separate Supabase project with the same `schema.sql`, holding only their users, portfolios, subscriptions, support chat and blog
- **their own business settings**: prices, InstaPay account, sender email and admin emails

You run everything from the main site (egxpert.com). The code, deploys, the backend and the list of clients are all yours. A client's admins manage their own users from `/admin` on their own domain. They never see the other clients or the platform settings.

## How a request finds its site

```
browser → nginx (Host: app.clientx.com) → frontend :8080
        → /api/public proxy sets X-Forwarded-Host: app.clientx.com
        → backend :3000 → tenant middleware → tenants registry (platform DB)
        → every DB call in that request goes to clientx's Supabase project
```

- The backend reads the host, finds the tenant in `tenant_domains`, and runs the rest of the request inside that tenant's context (`src/tenancy/context.js`). The `supabase` object that `db.js` uses forwards each call to that tenant's database, so the feature code stays unchanged.
- **Shared by every site** (stored in the platform DB, AI cost paid once): market reports, AI stop plans, fundamentals, index lists and custom stocks. `ai_spend` records which tenant made each call.
- **Per site** (stored in the tenant's DB): users, portfolios, reviews, subscriptions, grants, support messages and blog posts.
- A session cookie is tied to the site that issued it and is rejected on any other site.
- An unknown host gets a 404. A suspended site gets a 503.

## One-time setup

1. Run `backend/supabase/platform.sql` in the **platform** Supabase project (the one in `backend/.env`).
2. Add to `backend/.env`:
   ```
   TENANT_SECRETS_KEY=<openssl rand -hex 32>
   # optional: who can open the clients tab (default: ADMIN_EMAILS)
   PLATFORM_ADMIN_EMAILS=belal.elkady4@gmail.com
   ```
   Back up `TENANT_SECRETS_KEY`. Clients' database keys are stored encrypted with it; if you lose it, you have to re-enter every client's key.
3. Deploy. Nothing changes for egxpert.com until you add the first client.

## Adding a client

1. **Database:** create a new Supabase project for the client and run `backend/supabase/schema.sql` in it. Do not run `platform.sql` there. Copy the project URL and its `service_role` key.
2. **DNS:** the client adds an A record for `app.clientx.com` (and `www.`) that points to the VPS.
3. **Register the client:** on egxpert.com go to Admin → **العملاء** → **عميل جديد**, then fill in:
   - `id`: short and permanent, e.g. `clientx`
   - domains: `app.clientx.com`
   - Supabase URL and service_role key. These are checked on save; the save is rejected if the database can't be reached or `schema.sql` is missing.
   - `brand`: name, tagline, `logoUrl`, `faviconUrl`, `colors` (CSS variables such as `primary` and `info`, in oklch or hex), `darkColors`, `emailColor` (hex), `analytics`, `social`
   - `config`: `adminEmails` (the client's staff, who become admins when they sign up), `marketerEmails` (become read-only marketers: the users table only), `contactEmail`, `supportNotifyEmail`, `instapay`, `prices` (by plan key), `emailFrom`, `features.blog`
4. **nginx + HTTPS:** follow the steps at the top of `deploy/nginx/tenant.conf.example`.
5. **Email sender:** to send as `no-reply@clientx.com`, verify that domain in Resend first. Until then, leave `emailFrom` empty. Mail then goes out as "Client X <your platform address>".
6. **Google sign-in:** either add `https://app.clientx.com` to the Authorized JavaScript origins of your existing OAuth client, or create a separate client for them and set `config.googleClientId`.

## Running it

- **Suspend or resume:** use the button in the edit dialog. Their users see a "service paused" message, and their data stays as it is.
- **Usage:** "اعرض" in the clients table shows users, active subscriptions and AI cost for the last 30 days.
- **Background jobs:** the daily close runs for every active site. The blog cron writes an article only for sites with `features.blog: true`, and each article is a paid AI run.
- **Roles:** every site has admins, marketers (read-only view of the users table) and regular users. An admin changes anyone's role from the role selector under each user's email in the users table; a role can also be given at signup by email (`adminEmails` / `marketerEmails`). You can't change your own role, and on the main site the platform owner's account (`PLATFORM_ADMIN_EMAILS`) can only be changed on the server with `scripts/make-admin.mjs`. Roles need the `is_marketer` column, so run `schema.sql` (or `alter table users add column if not exists is_marketer boolean not null default false;`) in every client database.
- **Index lists and custom stocks** can only be edited from the main site, because every site uses them.
- **Schema changes:** when `schema.sql` changes, apply it to **every** client database as well as the platform one.

## What is still the same for everyone

- The feature set, tiers and their caps (`TIERS` in `backend/src/billing/plans.js`). Only prices differ per site.
- The About, Privacy and How-to-use copy. The text is shared and only the site name is swapped in. A client who needs different legal text still needs those pages made configurable.
- One OpenRouter key and one Resend account (yours), with costs tracked per tenant through `ai_spend.tenant_id`.
