-- Alytic schema for Supabase (Postgres).
--
-- Run this once in the Supabase project's SQL editor (or via `supabase db
-- push` / psql against the project's connection string) before starting the
-- backend. Mirrors the tables previously created in src/db.js for SQLite —
-- see that file's git history for the original schema and rationale.
--
-- All JSON blobs are jsonb (the app used to store/parse JSON text by hand;
-- the Supabase client hands back already-parsed objects for jsonb columns).
-- Booleans are real booleans instead of SQLite's 0/1 integers.

create table if not exists users (
  id text primary key,
  email text not null unique,
  name text not null default '',
  phone text,
  password_salt text not null,
  password_hash text not null,
  google_id text,
  email_verified boolean not null default false,
  verification_token text,
  verification_token_expires timestamptz,
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);

-- Safe to re-run against an already-applied schema (e.g. this column was
-- added after the tables first went live).
alter table users add column if not exists phone text;
alter table users add column if not exists reset_token text;
alter table users add column if not exists reset_token_expires timestamptz;
-- Marketer: read-only access to the admin users table, nothing else. See
-- app.use('/api/admin') in src/api/server.js. Apply to every client database.
alter table users add column if not exists is_marketer boolean not null default false;

-- An admin-suspended account: blocked from the app regardless of trial or
-- subscription state, shown `suspension_message` instead (a WhatsApp button
-- to management, same as the paywall) — see setUserSuspended in src/db.js.
alter table users add column if not exists is_suspended boolean not null default false;
alter table users add column if not exists suspension_message text;

-- One free trial per person. email_canonical collapses the spellings that
-- reach one mailbox (Gmail dots, +tags, googlemail.com) — the same rule as
-- canonicalEmail() in src/emailIdentity.js, keep the two in step. Phone is
-- unique too (already stored normalized as 01xxxxxxxxx).
--
-- BEFORE running this section on a database that already has users, check
-- that neither unique index below will be refused, and merge or clear any
-- rows these turn up:
--   select phone, count(*) from users where phone is not null group by phone having count(*) > 1;
--   select email_canonical, count(*) from users group by email_canonical having count(*) > 1;
--     (run the second one after the backfill update below)
alter table users add column if not exists email_canonical text;

update users set email_canonical = (
  select case
    when t.d in ('gmail.com', 'googlemail.com') then replace(t.l, '.', '') || '@gmail.com'
    else t.l || '@' || t.d
  end
  from (
    select coalesce(nullif(split_part(s.lp, '+', 1), ''), s.lp) as l, s.d
    from (
      select regexp_replace(lower(users.email), '@[^@]*$', '') as lp,
             substring(lower(users.email) from '@([^@]*)$') as d
    ) s
  ) t
)
where email_canonical is null;

-- Phones are stored in E.164 (+201012345678) so a number from any country has
-- exactly one spelling — see normalizePhone() in src/phone.js. Numbers saved
-- before that were Egyptian national format (01012345678); this rewrites them
-- in place (one-to-one, so it cannot create a duplicate) and is a no-op on a
-- re-run.
update users set phone = '+2' || phone where phone ~ '^01[0125][0-9]{8}$';

create unique index if not exists idx_users_email_canonical on users(email_canonical) where email_canonical is not null;
create unique index if not exists idx_users_phone on users(phone) where phone is not null;

-- Where an account came from: the address it signed up from, and the one it
-- last logged in from. For spotting several accounts behind one connection.
-- Text rather than inet so IPv4, IPv6 and anything odd a proxy hands over are
-- all stored as-is. Accounts that existed before this column stay null.
alter table users add column if not exists signup_ip text;
alter table users add column if not exists last_login_ip text;

-- Last time a browser tab of this account reported in (the site pings
-- POST /api/presence about once a minute while a tab is visible). Unlike
-- last_login_at, which only moves at sign-in, this is what "online now" in
-- the admin panel counts.
alter table users add column if not exists last_seen_at timestamptz;

-- User-level quota and Credits tracking, per feature.
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

create unique index if not exists idx_users_google_id on users(google_id) where google_id is not null;
create index if not exists idx_users_verification_token on users(verification_token) where verification_token is not null;
create index if not exists idx_users_reset_token on users(reset_token) where reset_token is not null;

-- A new tenant's portfolios table is created directly in the shape below.
-- An existing tenant that already has a portfolios table (with user_id as
-- primary key) must run migrate-multi-portfolio.sql once, by hand, before
-- this block is next applied to that database.
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

-- Every User has a Portfolio from the moment they exist: this trigger adds it
-- inside the same statement that inserts the users row, so a signup can never
-- leave an account with none (primaryPortfolioIdFor throws for such a User,
-- and nothing lazily creates one anymore). Covers every way a users row gets
-- inserted — signup, Google sign-in, the 'local' seed below. The name matches
-- migrate-multi-portfolio.sql's, so a new account and a migrated one look the
-- same. An `insert ... on conflict do nothing` that hits the conflict inserts
-- no row and fires nothing — see the 'local' Portfolio seed further down.
create or replace function users_create_primary_portfolio() returns trigger
language plpgsql as $$
begin
  insert into portfolios (user_id, name, ordinal) values (new.id, 'المحفظة الرئيسية', 0);
  return null;
end $$;

drop trigger if exists users_create_primary_portfolio on users;
create trigger users_create_primary_portfolio
  after insert on users
  for each row execute function users_create_primary_portfolio();

-- One AI-generated market report per (trading day, investor style), shared by
-- every user rather than regenerated per request. See
-- src/agent/marketAnalysis.js — the deep scan runs once and everyone reads
-- the same row.
create table if not exists market_reports (
  report_date text not null,
  style text not null,
  report_json jsonb not null,
  model text,
  usage_json jsonb,
  generated_at timestamptz not null default now(),
  primary key (report_date, style)
);

-- One AI-determined stop-loss per (stock, investor style, trading day),
-- shared by every user — same sharing rationale as market_reports. This is
-- the entry-plan stop a fresh buy today would use; see
-- src/agent/stopPlanner.js's getOrGenerateStopPlan and src/analyze.js. Each
-- open position's own trailing stop is a separate, per-user concern and
-- lives in portfolio_reviews below instead (it needs the position's average
-- cost and running high, which no other user shares).
create table if not exists ai_stop_plans (
  code text not null,
  style text not null,
  report_date text not null,
  stop numeric not null,
  basis text,
  model text,
  usage_json jsonb,
  generated_at timestamptz not null default now(),
  primary key (code, style, report_date)
);

-- One AI-generated personalized review per (portfolio, trading day, investor
-- style), keyed additionally by a hash of the inputs that actually change its
-- content (positions, watchlist, cash). Unlike market_reports this can't be
-- shared across users, but repeated requests from the same portfolio on the same
-- day with an unchanged portfolio are still served from here instead of
-- paying for another model call. A changed portfolio_hash — a trade, a
-- watchlist edit, a cash change — naturally busts the cache on lookup. See
-- src/api/server.js's /api/review.
--
-- `style` is free text, not a strict enum, so it also holds other per-portfolio
-- daily caches that don't deserve their own table — e.g. a cash review keys
-- on `cash:INDEX`, and an open position's AI-determined trailing stop (see
-- stopPlanner.js's getOrGenerateTrailingStop) keys on `stop:STYLE:CODE`,
-- portfolio_hash there covering only that one position (avgCost, shares,
-- existing stop) rather than the whole book.
--
-- A pure cache, not a record: a deleted Portfolio's reviews go with it
-- (`on delete cascade`), so deleting a User — whose Portfolios cascade —
-- is never blocked here.
create table if not exists portfolio_reviews (
  portfolio_id bigint not null references portfolios(id) on delete cascade,
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

-- The one-per-Cairo-day "تحليل الكاش" limit this table tracked was dropped
-- (the scan is pure technical scoring, no per-call cost to guard). What
-- replaced it — first a trial-lifetime cap, now a per-tier monthly one, see
-- TIERS in src/billing/plans.js and usageFor() in src/api/server.js — lives
-- in portfolio.usage instead, since it needs no cross-device row — a
-- leftover `cash_scan_usage` table from that era may still exist in
-- already-migrated databases; it's simply unused now.

-- One row per AI call across every feature (portfolio review, market
-- research/reframe, fundamentals, blog discovery/article/review) — the
-- single place to answer "where did the OpenRouter bill actually go" without
-- reading each feature's own storage table by hand. Written best-effort and
-- fire-and-forget by requestStructuredOR() in src/agent/clientOpenRouter.js:
-- a logging failure here must never break the AI call it's describing.
-- usage_json is exactly what OpenRouter returned for that call (cost,
-- prompt/completion tokens) — note it excludes the web_search plugin's own
-- charge, which is billed separately and not reflected in any usage object
-- this app has observed. model is whichever one actually served the request
-- (the last entry tried in a fallback chain — see MODEL_CHAIN), not
-- necessarily what was configured first.
create table if not exists ai_spend (
  id bigint generated always as identity primary key,
  feature text not null,
  model text,
  usage_json jsonb,
  created_at timestamptz not null default now()
);
create index if not exists ai_spend_feature_created_idx on ai_spend (feature, created_at);

-- One researched fundamentals lookup per ticker, reused across every user for
-- up to MAX_AGE_DAYS (see src/agent/fundamentals.js) instead of re-paying for
-- web search per request. Previously a local JSON file under
-- backend/data/fundamentals/ — moved here because a VPS deploy that doesn't
-- persist that directory silently re-pays for research a Supabase row would
-- have survived, and because a local file also can't be shared across
-- multiple app instances.
create table if not exists fundamentals_cache (
  code text primary key,
  data_json jsonb not null,
  fetched_at timestamptz not null default now()
);

-- How many oanor calls this billing period has used, and whether subscribers
-- have rolled back to TradingView for the rest of it (see
-- src/data/live-quote-pool.js and docs/adr/0001). Kept here, not in memory,
-- so a redeploy mid-period doesn't reset the count and overspend the quota.
-- One row per period, keyed by its first day. Platform-wide: every site
-- shares the one oanor key.
create table if not exists oanor_usage (
  period_start date primary key,
  calls integer not null default 0,
  quota integer,
  rollback_reason text check (rollback_reason in ('count', 'oanor')),
  exhausted_at timestamptz,
  updated_at timestamptz not null default now()
);

-- A user's paid access. There is no payment gateway: the user sends the fee
-- over InstaPay and an admin activates the account from the admin panel, so
-- this row is written by a human action, never by a callback. One row per
-- user — the app sells one product with two period lengths, not stacked
-- add-ons — re-dated on every renewal. No row means "never subscribed", in
-- which case access depends only on the free-trial window off
-- users.created_at. current_period_end is the single source of truth for
-- whether paid access is live right now; see accessInfo() in
-- src/api/server.js. Expiry needs no job to enforce it: the date simply
-- stops being in the future.
create table if not exists subscriptions (
  user_id text primary key references users(id) on delete cascade,
  plan text not null check (plan in ('long_monthly', 'long_yearly', 'trader_monthly', 'trader_yearly', 'custom')),
  tier text not null default 'trader' check (tier in ('long', 'trader')),
  started_at timestamptz not null default now(),
  current_period_end timestamptz not null,
  granted_by text references users(id),
  note text,
  updated_at timestamptz not null default now()
);

-- Migration to the 3-tier product (free trial / نفس طويل / حريفة — see
-- TIERS/PLANS in src/billing/plans.js) for a database created before this
-- change. Each paid tier is sold monthly and yearly, so `plan` moved from
-- the old 2-SKU set ('monthly'/'yearly') to 4 SKU keys, and `tier` was added
-- to say which feature caps apply. Existing subscribers are backfilled to
-- 'trader' (the top tier) so running this migration never silently shrinks
-- anyone's already-paid-for access. No-op on a fresh install, which already
-- created the table above in its final shape.
alter table subscriptions add column if not exists tier text;
update subscriptions set tier = 'trader' where tier is null;
alter table subscriptions alter column tier set default 'trader';
alter table subscriptions alter column tier set not null;
alter table subscriptions drop constraint if exists subscriptions_tier_check;
alter table subscriptions add constraint subscriptions_tier_check check (tier in ('long', 'trader'));

update subscriptions set plan = 'trader_monthly' where plan = 'monthly';
update subscriptions set plan = 'trader_yearly' where plan = 'yearly';
alter table subscriptions drop constraint if exists subscriptions_plan_check;
alter table subscriptions add constraint subscriptions_plan_check
  check (plan in ('long_monthly', 'long_yearly', 'trader_monthly', 'trader_yearly', 'custom'));

-- Append-only record of every activation, extension and revocation an admin
-- performed: who did it, what it cost, and the InstaPay reference the user
-- sent. The subscriptions row above only holds the current state, so this is
-- the only place a disputed payment ("I paid on the 3rd") can be checked
-- against, and the only way to see that a period was cut short by hand.
create table if not exists subscription_grants (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references users(id) on delete cascade,
  plan text not null,
  period_end timestamptz,
  amount_egp numeric,
  reference text,
  note text,
  action text not null default 'grant' check (action in ('grant', 'revoke')),
  granted_by text references users(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_subscription_grants_user on subscription_grants (user_id, created_at desc);

-- Append-only record of every Credits change an admin made by hand — the
-- same rationale as subscription_grants above, extended to Credits packs
-- bought over InstaPay. One row per POST /api/admin/users/:id/credits call;
-- deltas holds every credit kind changed in that call, e.g.
-- {"cashScans": 20, "recommendations": 0, "screenshots": 0, "marketAnalysis": 0}.
create table if not exists credits_grants (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references users(id) on delete cascade,
  deltas jsonb not null,
  reference text,
  note text,
  granted_by text references users(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_credits_grants_user on credits_grants (user_id, created_at desc);

-- The admin's own follow-up checklist in the users table: whether someone on
-- the team has already reached this user on WhatsApp and/or by email (e.g.
-- about an ending trial). One row per user, a null timestamp meaning "not yet".
-- updated_by is a plain id, not a reference, so deleting the admin who ticked
-- a box never has to touch this table.
create table if not exists user_follow_ups (
  user_id text primary key references users(id) on delete cascade,
  whatsapp_at timestamptz,
  email_at timestamptz,
  updated_by text,
  updated_at timestamptz not null default now()
);

-- The in-app support chat. One thread per user (there is nothing to key a
-- second conversation on), so a "thread" is just every row sharing a user_id
-- read in created_at order. This is the subscription path as well as support:
-- users ask to subscribe here and an admin answers with the transfer details,
-- which is why /api/support is never behind the paywall — a lapsed account
-- has to be able to reach us to renew.
--
-- read_at is per message and set by whichever side did NOT write it, on
-- opening the thread: unread-for-the-user is admin messages with a null
-- read_at, and vice versa.
-- image_path (nullable) is an object path in the private "support-attachments"
-- storage bucket, not a URL — the API signs a short-lived URL from it on read
-- so an attachment (e.g. an InstaPay receipt screenshot) is never a
-- public/guessable link. body stays not null but can be '' for an image-only
-- message.
create table if not exists support_messages (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references users(id) on delete cascade,
  sender text not null check (sender in ('user', 'admin')),
  body text not null,
  image_path text,
  sent_by text references users(id),
  read_at timestamptz,
  created_at timestamptz not null default now()
);
alter table support_messages add column if not exists image_path text;
create index if not exists idx_support_messages_user on support_messages (user_id, created_at);

-- Admin-uploaded replacements for the built-in index membership lists in
-- src/config/indices.js. Absence of a row means "use the built-in default" —
-- see codesForIndex() there, which checks here first.
create table if not exists index_overrides (
  index_name text primary key,
  tickers_json jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text
);

-- One closed session's net buying/selling by investor group (Egyptians, Arabs,
-- foreigners, individuals, institutions), researched from the day's market
-- news after the close. Platform-held market data like index_overrides: one
-- row per session serves every site. A row exists only if it passed the
-- checks in src/investorFlows.js; the indices page shows the current
-- session's row, or no panel at all.
create table if not exists investor_flows (
  session_date date primary key,
  groups_json jsonb not null,
  source_url text not null,
  fetched_at timestamptz not null default now()
);

-- Stocks an admin's index CSV upload named that weren't already in the
-- generated config/universe.js. See config/universe.js's registerCustomStocks
-- — these get merged into the live UNIVERSE/ALL_CODES/lookup() in memory at
-- server startup and immediately on upload, so they're analyzable and
-- tradeable like any built-in stock. No verified price-feed provenance the
-- way generated entries have (see that file's header) — sector/shariah are
-- unknown and the Yahoo symbol is a best-guess "<CODE>.CA".
create table if not exists custom_stocks (
  code text primary key,
  name text not null,
  added_at timestamptz not null default now(),
  added_by text
);

-- Auto-generated blog posts (Egyptian market news + technical analysis),
-- written once a day in a batch of 10 by src/agent/blogGenerator.js and held
-- as drafts until an admin approves them — see /api/admin/blog-drafts in
-- server.js. (post_date, batch_index) mirrors market_reports' (report_date,
-- style) key: one generation attempt per article slot per day, so a retried
-- cron run doesn't spend twice.
create table if not exists blog_posts (
  id uuid primary key default gen_random_uuid(),
  post_date text not null,
  batch_index int not null,
  slug text not null unique,
  primary_keyword text not null,
  secondary_keywords text[] not null default '{}',
  title text not null,
  meta_title text not null,
  meta_description text not null,
  dek text,
  content_json jsonb not null,
  tags text[] not null default '{}',
  sources_json jsonb,
  image_json jsonb,
  status text not null default 'draft'
    check (status in ('draft', 'approved', 'rejected', 'published')),
  generation_model text,
  generation_usage_json jsonb,
  review_model text,
  review_json jsonb,
  approved_by text references users(id),
  approved_at timestamptz,
  published_at timestamptz,
  generated_at timestamptz not null default now(),
  unique (post_date, batch_index)
);
create index if not exists idx_blog_posts_status on blog_posts (status, published_at desc);

-- Migration from the old twice-a-day (post_date, slot) shape to ten
-- articles/day keyed by (post_date, batch_index). Guarded on the presence of
-- the old `slot` column so this is a no-op — and references nothing that no
-- longer exists — on a fresh install that already created the table above in
-- its final shape.
do $$
begin
  if exists (select 1 from information_schema.columns where table_name = 'blog_posts' and column_name = 'slot') then
    execute 'alter table blog_posts add column if not exists batch_index int';
    execute $sql$update blog_posts set batch_index = case slot when 'morning' then 1 when 'evening' then 2 end where batch_index is null$sql$;
    execute 'alter table blog_posts alter column batch_index set not null';
    execute 'alter table blog_posts drop constraint if exists blog_posts_slot_check';
    execute 'alter table blog_posts drop constraint if exists blog_posts_post_date_slot_key';
    execute 'alter table blog_posts drop column slot';
  end if;
end $$;

alter table blog_posts add column if not exists primary_keyword text;
update blog_posts set primary_keyword = coalesce(primary_keyword, tags[1], 'البورصة المصرية') where primary_keyword is null;
alter table blog_posts alter column primary_keyword set not null;

alter table blog_posts add column if not exists secondary_keywords text[] not null default '{}';

alter table blog_posts add column if not exists meta_description text;
update blog_posts set meta_description = coalesce(meta_description, left(dek, 160), left(title, 160)) where meta_description is null;
alter table blog_posts alter column meta_description set not null;

alter table blog_posts add column if not exists meta_title text;
update blog_posts set meta_title = coalesce(meta_title, title) where meta_title is null;
alter table blog_posts alter column meta_title set not null;

alter table blog_posts add column if not exists image_json jsonb;

-- The model's image_json is only a text spec (concept/alt/caption) — it can't
-- produce an actual photo. These columns hold the real stock photo fetched
-- for that spec via src/agent/stockImage.js (Unsplash), null if the search
-- found nothing or UNSPLASH_ACCESS_KEY isn't set.
alter table blog_posts add column if not exists image_url text;
alter table blog_posts add column if not exists image_thumb_url text;
alter table blog_posts add column if not exists image_source_url text;
alter table blog_posts add column if not exists image_credit_name text;
alter table blog_posts add column if not exists image_credit_url text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'blog_posts_post_date_batch_index_key') then
    alter table blog_posts add constraint blog_posts_post_date_batch_index_key unique (post_date, batch_index);
  end if;
end $$;

-- One discoverTopics() call's worth of keyword/news-angle pairs per day —
-- generated once and reused across the several cron runs (spaced ~2 hours
-- apart, one article each) that fill in that day's batch_index slots, so
-- discovery isn't re-run (and re-paid for) on every single-article run. See
-- getOrGenerateNextBlogArticle in src/agent/blogGenerator.js.
create table if not exists blog_daily_topics (
  post_date text primary key,
  topics_json jsonb not null,
  model text,
  generated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Recommendation track record.
--
-- Every buy/hold/sell/reduce call the app hands a User is written here at the
-- moment it is issued (see src/recommendations.js), then resolved once a day
-- by the evaluate-recommendations Edge Function (supabase/functions/, run by
-- pg_cron — see supabase/recommendations-cron.sql) against the session bars in
-- recommendation_prices. The track-record page reads nothing else.
--
-- The record is only worth anything if it can't be edited after the fact, so
-- the guard trigger below — not the app — enforces it, for every role
-- including service_role (which bypasses RLS but not triggers):
--   - issue fields (ticker, action, prices, horizon, EGX30 level, model,
--     issue time) never change after insert;
--   - the outcome fields change only while the row is still open, and once
--     it is closed they are final; the stock-move fields (below) keep going
--     to the horizon's end and are final from then;
--   - rows can't be deleted or truncated. A deleted account's rows stay, with
--     user_id and portfolio_id set to null (the only issue-field changes
--     allowed: either may be cleared, neither may be reassigned).
-- RLS is enabled with no policies by the lock-down block at the end of this
-- file, like every other table here: anon/authenticated can't reach it at all.
--
-- horizon_days counts EGX trading sessions, not calendar days — the engine's
-- target horizons are in sessions, and so is the evaluator's clock.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'recommendation_action') then
    create type recommendation_action as enum ('buy', 'hold', 'sell', 'reduce');
  end if;
  if not exists (select 1 from pg_type where typname = 'recommendation_status') then
    create type recommendation_status as enum ('open', 'hit_target', 'hit_stop', 'expired');
  end if;
end $$;

create table if not exists recommendations (
  id bigint generated always as identity primary key,
  user_id text references users(id) on delete set null,
  -- Nullable and `on delete set null`, exactly like user_id: rows can't be
  -- deleted (see the guard below), so a restrict here would make the
  -- Portfolio — and through it the User — undeletable once it had a single
  -- call. Every call is logged with its Portfolio; null only means that
  -- Portfolio was deleted since.
  portfolio_id bigint references portfolios(id) on delete set null,
  ticker text not null,
  action recommendation_action not null,
  ref_price numeric not null check (ref_price > 0),
  target_price numeric check (target_price > 0),
  stop_price numeric check (stop_price > 0),
  horizon_days integer not null check (horizon_days between 1 and 500),
  egx30_at_issue numeric check (egx30_at_issue > 0),
  model_version text not null,
  issued_at timestamptz not null default now(),
  -- The Cairo trading date of issued_at, set by the guard trigger. Evaluation
  -- starts with the first session after it, and it keys the one-call-per-day
  -- dedupe below.
  issued_on date not null default ((now() at time zone 'Africa/Cairo')::date),
  -- Where the call came from (portfolio_review, stock_review, market_report,
  -- cash_review) and the investing style it was made for. Issue fields too.
  source text not null,
  style text,

  status recommendation_status not null default 'open',
  closed_at timestamptz,
  exit_price numeric,
  return_pct numeric,
  excess_return_pct numeric,

  -- Running figures the evaluator refreshes while the call is open (and
  -- freezes at close): sessions since issue, last close, and the return and
  -- excess return marked to it.
  sessions_elapsed integer not null default 0,
  mark_price numeric,
  mark_return_pct numeric,
  mark_excess_return_pct numeric,
  evaluated_at timestamptz,

  constraint recommendations_closed_consistent check (
    (status = 'open' and closed_at is null and exit_price is null and return_pct is null)
    or (status <> 'open' and closed_at is not null and exit_price is not null and return_pct is not null)
  ),
  -- A target sits on the profitable side of the reference price and a stop
  -- on the losing side: above/below for buy and hold, the reverse for sell
  -- and reduce (which are scored as short calls).
  constraint recommendations_levels_sided check (
    case when action in ('buy', 'hold')
      then (target_price is null or target_price > ref_price) and (stop_price is null or stop_price < ref_price)
      else (target_price is null or target_price < ref_price) and (stop_price is null or stop_price > ref_price)
    end
  )
);

-- Benchmarks beyond EGX30. Each call is also measured against its own index,
-- chosen at issue from the stock's membership: EGX30 for an EGX30 member,
-- EGX70 (EWI) for an EGX70 member, EGX100 (EWI) for a stock in neither —
-- EGX30 alone would credit or blame a small-cap call for being small-cap.
-- And against each of the four indices in turn (EGX30, EGX70, EGX33 — the
-- Shariah index — and EGX100), so the page can compare the whole record to
-- any one of them.
--   indices_at_issue  all four levels at issue, {"EGX30": …, "EGX70": …,
--                     "EGX33": …, "EGX100": …}; one the feed didn't return
--                     is left out.
--   index_excess      the call's excess return over each index, same keys
--                     (mark_index_excess: the running figures while open).
--   benchmark_excess_pct  the excess over the call's own benchmark.
-- egx30_at_issue / excess_return_pct stay the EGX30 figures. Calls logged
-- before these columns existed have them null.
alter table recommendations add column if not exists benchmark text;
alter table recommendations add column if not exists indices_at_issue jsonb;
alter table recommendations add column if not exists benchmark_excess_pct numeric;
alter table recommendations add column if not exists index_excess jsonb;
alter table recommendations add column if not exists mark_benchmark_excess_pct numeric;
alter table recommendations add column if not exists mark_index_excess jsonb;
-- An earlier draft of this section had EGX33-only columns; index_excess replaced them.
alter table recommendations drop column if exists egx33_excess_pct;
alter table recommendations drop column if exists mark_egx33_excess_pct;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'recommendations_benchmark_check') then
    alter table recommendations add constraint recommendations_benchmark_check
      check (benchmark is null or benchmark in ('EGX30', 'EGX70', 'EGX100'));
  end if;
end $$;

-- The scoring rules a call was resolved under. 1 = the original rules (an
-- intraday touch of the stop closed a call, a hold carried a stop, a split
-- could read as a crash); 2 = the current ones (a stop needs a close under it,
-- a hold is judged at its horizon, prices are rebased across corporate
-- actions). New calls are stamped 2 by the guard trigger below. The page's
-- figures cover version 2 only; version 1 calls stay listed, tagged.
-- Safe to re-run: only rows with no version yet are touched. Calls already
-- closed when this first runs were resolved by the old rules; calls still open
-- are scored by the current evaluator from here on.
alter table recommendations add column if not exists scoring_version smallint;
update recommendations set scoring_version = 1 where scoring_version is null and status <> 'open';
update recommendations set scoring_version = 2 where scoring_version is null;

-- What actually happened to the stock, apart from how the call was scored:
-- its close at the end of the call's horizon (the session numbered
-- horizon_days after issue), whatever the target or stop did on the way.
-- A buy that exited at its target is still followed to the horizon's end, so
-- the page can say "EGXpert said sell at 55, the stock went to 60".
--   stock_move_price     that close (while the horizon runs: the latest close)
--   stock_move_pct       its % change from ref_price
--   stock_move_sessions  sessions counted so far
--   stock_move_final     true once the horizon's last session is in; from
--                        then on these four are frozen like the outcome.
-- Unlike the outcome fields they keep updating after the call itself closes,
-- until the horizon ends.
alter table recommendations add column if not exists stock_move_price numeric;
alter table recommendations add column if not exists stock_move_pct numeric;
alter table recommendations add column if not exists stock_move_sessions integer not null default 0;
alter table recommendations add column if not exists stock_move_final boolean not null default false;
create index if not exists recommendations_tracking_idx on recommendations (ticker, issued_on) where stock_move_final = false;

-- One call per (User, portfolio, stock, action, day): the same review read twice, or a
-- cached market report served on every page view, logs once.
create unique index if not exists recommendations_daily_key on recommendations (user_id, portfolio_id, ticker, action, issued_on);
create index if not exists recommendations_open_idx on recommendations (ticker, issued_on) where status = 'open';
create index if not exists recommendations_user_idx on recommendations (user_id, issued_at desc);
create index if not exists recommendations_issued_idx on recommendations (issued_at desc);

create or replace function recommendations_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'recommendations are append-only: row % cannot be deleted', old.id;
  end if;

  if tg_op = 'INSERT' then
    -- Stamped here, not trusted from the caller, so nothing can be backdated
    -- or inserted already resolved.
    new.issued_at := now();
    new.issued_on := (now() at time zone 'Africa/Cairo')::date;
    new.status := 'open';
    new.closed_at := null;
    new.exit_price := null;
    new.return_pct := null;
    new.excess_return_pct := null;
    new.sessions_elapsed := 0;
    new.mark_price := null;
    new.mark_return_pct := null;
    new.mark_excess_return_pct := null;
    new.benchmark_excess_pct := null;
    new.index_excess := null;
    new.mark_benchmark_excess_pct := null;
    new.mark_index_excess := null;
    new.stock_move_price := null;
    new.stock_move_pct := null;
    new.stock_move_sessions := 0;
    new.stock_move_final := false;
    new.evaluated_at := null;
    new.scoring_version := 2;
    return new;
  end if;

  -- UPDATE
  if (new.id, new.ticker, new.action, new.ref_price, new.target_price, new.stop_price, new.horizon_days,
      new.egx30_at_issue, new.model_version, new.issued_at, new.issued_on, new.source, new.style,
      new.benchmark, new.indices_at_issue)
     is distinct from
     (old.id, old.ticker, old.action, old.ref_price, old.target_price, old.stop_price, old.horizon_days,
      old.egx30_at_issue, old.model_version, old.issued_at, old.issued_on, old.source, old.style,
      old.benchmark, old.indices_at_issue) then
    raise exception 'recommendation %: issue fields are immutable', old.id;
  end if;
  -- user_id and portfolio_id may only go to null (their `on delete set null`
  -- when the User or Portfolio is deleted), never to a different owner.
  if new.user_id is distinct from old.user_id and new.user_id is not null then
    raise exception 'recommendation %: user_id can only be cleared, not reassigned', old.id;
  end if;
  if new.portfolio_id is distinct from old.portfolio_id and new.portfolio_id is not null then
    raise exception 'recommendation %: portfolio_id can only be cleared, not reassigned', old.id;
  end if;
  if old.status <> 'open'
     and (new.status, new.closed_at, new.exit_price, new.return_pct, new.excess_return_pct, new.sessions_elapsed,
          new.mark_price, new.mark_return_pct, new.mark_excess_return_pct, new.evaluated_at,
          new.benchmark_excess_pct, new.index_excess, new.mark_benchmark_excess_pct, new.mark_index_excess)
         is distinct from
         (old.status, old.closed_at, old.exit_price, old.return_pct, old.excess_return_pct, old.sessions_elapsed,
          old.mark_price, old.mark_return_pct, old.mark_excess_return_pct, old.evaluated_at,
          old.benchmark_excess_pct, old.index_excess, old.mark_benchmark_excess_pct, old.mark_index_excess) then
    raise exception 'recommendation % is already closed (%) and final', old.id, old.status;
  end if;
  if old.stock_move_final
     and (new.stock_move_price, new.stock_move_pct, new.stock_move_sessions, new.stock_move_final)
         is distinct from
         (old.stock_move_price, old.stock_move_pct, old.stock_move_sessions, old.stock_move_final) then
    raise exception 'recommendation %: the stock''s move over its horizon is already final', old.id;
  end if;
  return new;
end $$;

drop trigger if exists recommendations_guard_row on recommendations;
create trigger recommendations_guard_row
  before insert or update or delete on recommendations
  for each row execute function recommendations_guard();

create or replace function recommendations_no_truncate() returns trigger
language plpgsql as $$
begin
  raise exception 'recommendations are append-only: truncate is not allowed';
end $$;

drop trigger if exists recommendations_guard_truncate on recommendations;
create trigger recommendations_guard_truncate
  before truncate on recommendations
  for each statement execute function recommendations_no_truncate();

-- Daily session bars for every stock with an open recommendation, plus the
-- four benchmark indices under the tickers 'EGX30', 'EGX70', 'EGX33' and
-- 'EGX100' (TradingView's EGX30, EGX70EWI, SHARIAH, EGX100EWI), each from the
-- first session after the earliest open call that needs it. Written by the backend's 14:30 daily-close run (see
-- recordRecommendationPrices in src/recommendations.js) — the market feeds
-- this app uses (Yahoo, TradingView's websocket) live in the backend, so the
-- Edge Function reads prices from here rather than scraping them itself.
-- A re-run overwrites the same bars, which also heals a missed day.
create table if not exists recommendation_prices (
  ticker text not null,
  session_date date not null,
  open numeric,
  high numeric not null,
  low numeric not null,
  close numeric not null,
  updated_at timestamptz not null default now(),
  primary key (ticker, session_date)
);

-- The CLI/local dev account. INSERT ... ON CONFLICT DO NOTHING equivalent —
-- safe to run every time this file is applied.
insert into users (id, email, name, password_salt, password_hash, email_verified, created_at)
values ('local', 'local@alytic.local', 'Local CLI', 'local', 'local', true, now())
on conflict (id) do nothing;

-- Matching Portfolio for the local dev account. On a fresh tenant the insert
-- above fires users_create_primary_portfolio and this is a no-op; when 'local'
-- already existed, the insert above hit its conflict, inserted nothing and so
-- fired no trigger — this is what still guarantees the row then, so
-- primaryPortfolioIdFor('local') doesn't throw.
insert into portfolios (user_id, name, ordinal)
select 'local', 'المحفظة الرئيسية', 0
where not exists (select 1 from portfolios where user_id = 'local');

-- A time-boxed "what's new" popup the main site's admin publishes for signed-in
-- users. Each tenant runs this same schema in its own database (see
-- tenancy/registry.js), but these two tables are only ever read/written
-- through isPlatformAdmin-gated routes, so a client tenant's copy stays
-- empty — see docs/superpowers/specs/2026-10-03-feature-announcement-popup-design.md.
create table if not exists feature_announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  image_urls jsonb not null default '[]'::jsonb,
  video_url text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_at timestamptz not null default now(),
  created_by text references users(id)
);
create index if not exists idx_feature_announcements_active_window
  on feature_announcements (starts_at, ends_at);

-- Per-account, so a dismissal survives across devices/browsers.
create table if not exists user_announcement_dismissals (
  user_id text not null references users(id) on delete cascade,
  announcement_id uuid not null references feature_announcements(id) on delete cascade,
  dismissed_at timestamptz not null default now(),
  primary key (user_id, announcement_id)
);

-- Optional call-to-action button and audience targeting. `audiences` holds
-- renewal-status segments (see announcementAudience.js); an empty array means
-- everyone.
alter table feature_announcements add column if not exists cta_label text;
alter table feature_announcements add column if not exists cta_url text;
alter table feature_announcements add column if not exists audiences jsonb not null default '[]'::jsonb;

-- ---------------------------------------------------------------------------
-- Lock the tables away from Supabase's public API.
--
-- Every table above lives in the `public` schema, which Supabase exposes over
-- PostgREST (https://<project>.supabase.co/rest/v1/...). Without row level
-- security, anyone holding the project's *anon* key can read and write those
-- tables directly, bypassing this app entirely — including users.password_hash,
-- session-adjacent tokens and every user's portfolio. The anon key is public by
-- design (it ships in any Supabase-backed frontend and shows up in network
-- logs), so it must never be enough to reach this data.
--
-- The backend connects with the service_role key, which bypasses RLS, so
-- enabling RLS with no policies denies the anon/authenticated roles everything
-- and changes nothing for the app. The revokes are a second, independent layer.
-- Both are idempotent; re-running this file is safe.
--
-- If anything else ever reads these tables with the anon key, it will stop
-- working — add an explicit, narrow policy for it rather than turning RLS off.
do $$
declare
  t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;

  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on all tables in schema public from anon;
    revoke all on all sequences in schema public from anon;
    alter default privileges in schema public revoke all on tables from anon;
    alter default privileges in schema public revoke all on sequences from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on all tables in schema public from authenticated;
    revoke all on all sequences in schema public from authenticated;
    alter default privileges in schema public revoke all on tables from authenticated;
    alter default privileges in schema public revoke all on sequences from authenticated;
  end if;
end $$;

-- To check the result (every row should show rowsecurity = true):
--   select tablename, rowsecurity from pg_tables where schemaname = 'public' order by 1;
