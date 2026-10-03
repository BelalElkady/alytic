-- Run once, by hand, in the Supabase SQL editor, against a tenant that
-- already ran the FIRST version of migrate-multi-portfolio.sql — the one that
-- made recommendations.portfolio_id `not null ... on delete restrict` and
-- portfolio_reviews.portfolio_id `on delete restrict`. Back up first. A
-- tenant migrated with the current migrate-multi-portfolio.sql, or created
-- fresh from schema.sql, doesn't need this. Safe to re-run: every step either
-- no-ops or drops and recreates the same thing.
--
-- What it fixes: recommendations rows can't be deleted (the guard trigger),
-- so a restrict foreign key from them to portfolios made every Portfolio with
-- a single logged call — and, through `portfolios.user_id ... on delete
-- cascade`, its User — undeletable: the admin panel's DELETE
-- /api/admin/users/:id rolled back on the FK violation. After this:
--   - recommendations.portfolio_id is nullable, `on delete set null` (the
--     same treatment user_id already had), and the guard lets it be cleared
--     but never reassigned;
--   - portfolio_reviews.portfolio_id is `on delete cascade` (a pure cache);
--   - every new users row gets its Portfolio from a trigger, in the same
--     statement, and any User left without one is given one now.
--
-- The foreign keys are found by what they are (a foreign key on the
-- portfolio_id column of each table), not by a guessed name, and the script
-- stops with an error — rolling everything back — unless it finds exactly
-- one on each table.

begin;

-- 1. recommendations.portfolio_id: nullable.
alter table public.recommendations alter column portfolio_id drop not null;

-- 2. Drop the existing portfolio_id foreign keys on both tables, whatever
--    they are called.
do $$
declare
  c record;
  found_recommendations integer := 0;
  found_reviews integer := 0;
begin
  for c in
    select tc.table_name, tc.constraint_name
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on kcu.constraint_schema = tc.constraint_schema
     and kcu.constraint_name = tc.constraint_name
     and kcu.table_name = tc.table_name
    where tc.constraint_type = 'FOREIGN KEY'
      and tc.table_schema = 'public'
      and tc.table_name in ('recommendations', 'portfolio_reviews')
      and kcu.column_name = 'portfolio_id'
  loop
    if c.table_name = 'recommendations' then
      found_recommendations := found_recommendations + 1;
    else
      found_reviews := found_reviews + 1;
    end if;
    raise notice 'dropping foreign key %.%', c.table_name, c.constraint_name;
    execute format('alter table public.%I drop constraint %I', c.table_name, c.constraint_name);
  end loop;

  if found_recommendations <> 1 or found_reviews <> 1 then
    raise exception 'expected exactly one portfolio_id foreign key on each table, found % on recommendations and % on portfolio_reviews — nothing has been changed',
      found_recommendations, found_reviews;
  end if;
end $$;

-- 3. Recreate them with the new delete rules.
alter table public.recommendations
  add constraint recommendations_portfolio_id_fkey
  foreign key (portfolio_id) references public.portfolios(id) on delete set null;
alter table public.portfolio_reviews
  add constraint portfolio_reviews_portfolio_id_fkey
  foreign key (portfolio_id) references public.portfolios(id) on delete cascade;

-- 4. The guard: portfolio_id leaves the frozen issue fields and gets the same
--    clear-but-never-reassign rule as user_id. Identical to schema.sql's.
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

-- 5. Every new User gets their Portfolio inside the insert itself. Identical
--    to schema.sql's.
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

-- 6. Heal any User the old two-step signup left without a Portfolio (the
--    users insert landed, the portfolios insert didn't). A no-op if there are
--    none.
insert into portfolios (user_id, name, ordinal)
select u.id, 'المحفظة الرئيسية', 0
from users u
where not exists (select 1 from portfolios p where p.user_id = u.id);

commit;

-- To check the result:
--   -- Both rows: delete_rule SET NULL for recommendations, CASCADE for portfolio_reviews.
--   select tc.table_name, tc.constraint_name, rc.delete_rule
--   from information_schema.table_constraints tc
--   join information_schema.key_column_usage kcu
--     on kcu.constraint_schema = tc.constraint_schema and kcu.constraint_name = tc.constraint_name
--   join information_schema.referential_constraints rc
--     on rc.constraint_schema = tc.constraint_schema and rc.constraint_name = tc.constraint_name
--   where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public'
--     and tc.table_name in ('recommendations', 'portfolio_reviews') and kcu.column_name = 'portfolio_id';
--   -- YES:
--   select is_nullable from information_schema.columns
--   where table_schema = 'public' and table_name = 'recommendations' and column_name = 'portfolio_id';
--   -- 0:
--   select count(*) from users u where not exists (select 1 from portfolios p where p.user_id = u.id);
