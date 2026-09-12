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

-- One AI-generated personalized review per (user, trading day, investor
-- style), keyed additionally by a hash of the inputs that actually change its
-- content (positions, watchlist, cash). Unlike market_reports this can't be
-- shared across users, but repeated requests from the same user on the same
-- day with an unchanged portfolio are still served from here instead of
-- paying for another model call. A changed portfolio_hash — a trade, a
-- watchlist edit, a cash change — naturally busts the cache on lookup. See
-- src/api/server.js's /api/review.
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

-- Tracks the one "تحليل الكاش" (cash-allocation scan) a user is allowed per
-- Cairo calendar day — see /api/scan's focus=cash handling in
-- src/api/server.js. usage_date is a plain YYYY-MM-DD string (cairoToday()),
-- not a timestamp, so "today" means the same thing here as everywhere else in
-- the app that keys by trading day.
create table if not exists cash_scan_usage (
  user_id text not null references users(id) on delete cascade,
  usage_date text not null,
  used_at timestamptz not null default now(),
  primary key (user_id, usage_date)
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
  plan text not null check (plan in ('monthly', 'yearly', 'custom')),
  started_at timestamptz not null default now(),
  current_period_end timestamptz not null,
  granted_by text references users(id),
  note text,
  updated_at timestamptz not null default now()
);

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

alter table blog_posts add column if not exists image_json jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'blog_posts_post_date_batch_index_key') then
    alter table blog_posts add constraint blog_posts_post_date_batch_index_key unique (post_date, batch_index);
  end if;
end $$;

-- The CLI/local dev account. INSERT ... ON CONFLICT DO NOTHING equivalent —
-- safe to run every time this file is applied.
insert into users (id, email, name, password_salt, password_hash, email_verified, created_at)
values ('local', 'local@alytic.local', 'Local CLI', 'local', 'local', true, now())
on conflict (id) do nothing;
