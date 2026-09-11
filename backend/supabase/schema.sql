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

-- The CLI/local dev account. INSERT ... ON CONFLICT DO NOTHING equivalent —
-- safe to run every time this file is applied.
insert into users (id, email, name, password_salt, password_hash, email_verified, created_at)
values ('local', 'local@alytic.local', 'Local CLI', 'local', 'local', true, now())
on conflict (id) do nothing;
