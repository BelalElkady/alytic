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

create unique index if not exists idx_users_google_id on users(google_id) where google_id is not null;
create index if not exists idx_users_verification_token on users(verification_token) where verification_token is not null;
create index if not exists idx_users_reset_token on users(reset_token) where reset_token is not null;

create table if not exists portfolios (
  user_id text primary key references users(id) on delete cascade,
  state_json jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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

-- One AI-generated personalized review per (user, trading day, investor
-- style), keyed additionally by a hash of the inputs that actually change its
-- content (positions, watchlist, cash). Unlike market_reports this can't be
-- shared across users, but repeated requests from the same user on the same
-- day with an unchanged portfolio are still served from here instead of
-- paying for another model call. A changed portfolio_hash — a trade, a
-- watchlist edit, a cash change — naturally busts the cache on lookup. See
-- src/api/server.js's /api/review.
--
-- `style` is free text, not a strict enum, so it also holds other per-user
-- daily caches that don't deserve their own table — e.g. a cash review keys
-- on `cash:INDEX`, and an open position's AI-determined trailing stop (see
-- stopPlanner.js's getOrGenerateTrailingStop) keys on `stop:STYLE:CODE`,
-- portfolio_hash there covering only that one position (avgCost, shares,
-- existing stop) rather than the whole book.
create table if not exists portfolio_reviews (
  user_id text not null references users(id) on delete cascade,
  report_date text not null,
  style text not null,
  portfolio_hash text not null,
  review_json jsonb not null,
  model text,
  usage_json jsonb,
  generated_at timestamptz not null default now(),
  primary key (user_id, report_date, style)
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

-- The CLI/local dev account. INSERT ... ON CONFLICT DO NOTHING equivalent —
-- safe to run every time this file is applied.
insert into users (id, email, name, password_salt, password_hash, email_verified, created_at)
values ('local', 'local@alytic.local', 'Local CLI', 'local', 'local', true, now())
on conflict (id) do nothing;
