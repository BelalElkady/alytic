-- Run once, by hand, in the Supabase SQL editor, against a tenant that
-- already has a `portfolios` table in the old (`user_id` primary key) shape.
-- Back up first. After this succeeds, `schema.sql` is safe to (re-)apply to
-- the same database.

begin;

-- User-level quota and Credits columns — must exist before backfill update below.
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

alter table portfolios rename to portfolios_legacy;

create table portfolios (
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
create index idx_portfolios_user on portfolios (user_id) where deleted_at is null;

-- Every User gets exactly one Portfolio: from their legacy row if they had
-- one, or a fresh empty book if they didn't (lazy creation under the old
-- scheme — see Review Focus).
insert into portfolios (user_id, name, style, ordinal, state_json, created_at, updated_at)
select
  u.id,
  'المحفظة الرئيسية',
  pl.state_json -> 'settings' ->> 'investStyle',
  0,
  coalesce(pl.state_json, '{}'::jsonb) - 'usage' - 'credits' - 'lastCashScanAt' - 'lastMarketScanAt',
  coalesce(pl.created_at, now()),
  coalesce(pl.updated_at, now())
from users u
left join portfolios_legacy pl on pl.user_id = u.id;

-- User-level quota/Credits, extracted from whatever legacy blob existed.
update users u set
  usage_month = pl.state_json -> 'usage' ->> 'month',
  usage_cash_scans = coalesce((pl.state_json -> 'usage' ->> 'cashScans')::int, 0),
  usage_recommendations = coalesce((pl.state_json -> 'usage' ->> 'recommendations')::int, 0),
  usage_screenshots = coalesce((pl.state_json -> 'usage' ->> 'screenshots')::int, 0),
  usage_market_analysis = coalesce((pl.state_json -> 'usage' ->> 'marketAnalysis')::int, 0),
  credits_cash_scans = coalesce((pl.state_json -> 'credits' ->> 'cashScans')::int, 0),
  credits_recommendations = coalesce((pl.state_json -> 'credits' ->> 'recommendations')::int, 0),
  credits_screenshots = coalesce((pl.state_json -> 'credits' ->> 'screenshots')::int, 0),
  credits_market_analysis = coalesce((pl.state_json -> 'credits' ->> 'marketAnalysis')::int, 0),
  last_cash_scan_at = (pl.state_json ->> 'lastCashScanAt')::timestamptz,
  last_market_scan_at = (pl.state_json ->> 'lastMarketScanAt')::timestamptz
from portfolios_legacy pl
where pl.user_id = u.id;

-- portfolio_reviews: add the column, backfill, then re-key.
alter table portfolio_reviews add column if not exists portfolio_id bigint references portfolios(id) on delete restrict;
update portfolio_reviews pr set portfolio_id = p.id from portfolios p where p.user_id = pr.user_id;
alter table portfolio_reviews alter column portfolio_id set not null;
alter table portfolio_reviews drop constraint portfolio_reviews_pkey;
alter table portfolio_reviews add primary key (portfolio_id, report_date, style);

-- recommendations: add the column, backfill, re-key, then re-key the dedupe index.
alter table recommendations add column if not exists portfolio_id bigint references portfolios(id) on delete restrict;
update recommendations r set portfolio_id = p.id from portfolios p where p.user_id = r.user_id;
alter table recommendations alter column portfolio_id set not null;
drop index if exists recommendations_daily_key;
create unique index recommendations_daily_key on recommendations (user_id, portfolio_id, ticker, action, issued_on);

commit;

-- Not run automatically: once the application has been redeployed against
-- the new shape and the verification queries below all check out, drop
-- portfolios_legacy by hand.
