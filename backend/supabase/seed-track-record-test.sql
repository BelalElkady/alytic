-- Fake track-record data for a TEST Supabase project — never production.
--
-- The recommendations table is append-only on purpose: its guard trigger
-- stamps every row with the current time and refuses deletes, so real calls
-- can't be backdated or erased. To show a populated track-record page before
-- any real call has matured, this script switches that trigger off, inserts
-- ~60 backdated calls (with outcomes, marks and benchmark figures), and
-- switches it back on. Anything written this way is invented, which is why
-- it must only ever run against a throwaway project.
--
-- Safety: it refuses to run if the table already holds any call that isn't
-- seed data, so it can't mix fake calls into a real record.
--
-- Use:
--   1. Create a separate Supabase project and run schema.sql in it.
--   2. Point backend/.env's SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY at it,
--      restart the backend, and sign up on the local site.
--   3. Put that sign-up email in seed_email below, then run this whole file
--      in the test project's SQL Editor. About half the calls become yours
--      (for «توصياتي فقط»), the rest belong to no one.
--   4. Refresh /track-record.
-- Re-running replaces the previous seed. The block at the end of the file
-- removes it.

do $$
declare
  seed_email constant text := 'you@example.com';  -- ← your sign-up email on the test site
  seed_user text;
  tickers constant text[] := array['COMI','ABUK','SWDY','HDBK','MFPC','EGAL','HELI','ETEL','TMGH','PHDC','ORAS','FWRY','JUFO','AMOC','CIEB'];
  benchmarks constant text[] := array['EGX30','EGX30','EGX30','EGX70','EGX30','EGX70','EGX70','EGX30','EGX30','EGX30','EGX30','EGX30','EGX70','EGX30','EGX30'];
  n_calls constant int := 60;
  i int;
  t int;
  v_ticker text;
  v_bench text;
  v_action recommendation_action;
  v_status recommendation_status;
  v_issued date;
  v_ref numeric;
  v_target numeric;
  v_stop numeric;
  v_horizon int;
  v_sessions int;
  v_exit numeric;
  v_ret numeric;
  v_dir int;
  moves jsonb;
  excess jsonb;
  k text;
  roll double precision;
begin
  if exists (select 1 from recommendations where source <> 'seed') then
    raise exception 'recommendations already holds real calls — this looks like a real project. Seed only a throwaway test project.';
  end if;

  select id into seed_user from users where email = seed_email;
  if seed_user is not null then
    update users set email_verified = true where id = seed_user;
  else
    raise notice 'No user with email % — every seeded call will belong to no one («توصياتي فقط» stays empty).', seed_email;
  end if;

  perform setseed(0.42);

  alter table recommendations disable trigger recommendations_guard_row;
  alter table recommendations disable trigger recommendations_guard_truncate;
  delete from recommendations where source = 'seed';

  for i in 0 .. n_calls - 1 loop
    t := (i % array_length(tickers, 1)) + 1;
    v_ticker := tickers[t];
    v_bench := benchmarks[t];

    -- Spread over the last ~150 days, oldest first.
    v_issued := current_date - (150 - floor(i * 2.5))::int;

    roll := random();
    v_action := case when roll < 0.62 then 'buy' when roll < 0.78 then 'sell' when roll < 0.9 then 'reduce' else 'hold' end;
    v_dir := case when v_action in ('buy', 'hold') then 1 else -1 end;

    v_ref := round((10 + random() * 140)::numeric, 2);
    v_horizon := (array[10, 20, 20, 40, 60])[1 + floor(random() * 5)::int];
    if v_dir = 1 then
      v_target := round(v_ref * (1.06 + random() * 0.08)::numeric, 2);
      v_stop := round(v_ref * (0.93 + random() * 0.03)::numeric, 2);
    else
      v_target := null;
      v_stop := null;
    end if;

    -- Outcome. Sessions are turned into calendar days at 5 trading days a
    -- week; a call whose outcome would land today or later is still open.
    roll := random();
    if v_dir = 1 and roll < 0.45 then
      v_status := 'hit_target';
      v_sessions := 2 + floor(random() * least(v_horizon - 1, 18))::int;
      v_exit := v_target;
    elsif v_dir = 1 and roll < 0.68 then
      v_status := 'hit_stop';
      v_sessions := 1 + floor(random() * least(v_horizon - 1, 12))::int;
      v_exit := v_stop;
    else
      v_status := 'expired';
      v_sessions := v_horizon;
      v_exit := round(v_ref * (1 + v_dir * (random() * 0.12 - 0.045))::numeric, 2);
    end if;
    v_ret := round((v_dir * (v_exit / v_ref - 1) * 100)::numeric, 2);

    if v_issued + (v_sessions * 7 / 5 + 1) >= current_date then
      v_status := 'open';
      v_sessions := greatest(1, least(v_horizon - 1, (current_date - v_issued) * 5 / 7));
      v_exit := null;
      v_ret := round((v_dir * (random() * 8 - 3))::numeric, 2);
    end if;

    -- Each index's move over the call's span, then the excess over it.
    moves := jsonb_build_object(
      'EGX30', round((random() * 6 - 2)::numeric, 2),
      'EGX70', round((random() * 7 - 2.5)::numeric, 2),
      'EGX33', round((random() * 6 - 2)::numeric, 2),
      'EGX100', round((random() * 6.5 - 2.2)::numeric, 2)
    );
    excess := '{}'::jsonb;
    for k in select jsonb_object_keys(moves) loop
      excess := excess || jsonb_build_object(k, round(v_ret - v_dir * (moves ->> k)::numeric, 2));
    end loop;

    insert into recommendations (
      user_id, ticker, action, ref_price, target_price, stop_price, horizon_days,
      egx30_at_issue, model_version, issued_at, issued_on, source, style,
      benchmark, indices_at_issue,
      status, closed_at, exit_price, return_pct, excess_return_pct, benchmark_excess_pct, index_excess,
      sessions_elapsed, mark_price, mark_return_pct, mark_excess_return_pct, mark_benchmark_excess_pct, mark_index_excess,
      evaluated_at
    ) values (
      case when i % 2 = 0 then seed_user else null end,
      v_ticker, v_action, v_ref, v_target, v_stop, v_horizon,
      30000 + i * 25, 'seed', v_issued + time '11:00', v_issued, 'seed', 'medium',
      v_bench, jsonb_build_object('EGX30', 30000 + i * 25, 'EGX70', 9500 + i * 10, 'EGX33', 4100 + i * 3, 'EGX100', 13000 + i * 12),
      v_status,
      case when v_status = 'open' then null else v_issued + (v_sessions * 7 / 5 + 1) + time '12:30' end,
      case when v_status = 'open' then null else v_exit end,
      case when v_status = 'open' then null else v_ret end,
      case when v_status = 'open' then null else (excess ->> 'EGX30')::numeric end,
      case when v_status = 'open' then null else (excess ->> v_bench)::numeric end,
      case when v_status = 'open' then null else excess end,
      v_sessions,
      case when v_status = 'open' then round(v_ref * (1 + v_dir * v_ret / 100), 2) else v_exit end,
      v_ret,
      (excess ->> 'EGX30')::numeric,
      (excess ->> v_bench)::numeric,
      excess,
      now()
    );
  end loop;

  alter table recommendations enable trigger recommendations_guard_row;
  alter table recommendations enable trigger recommendations_guard_truncate;

  raise notice 'Seeded % calls.', n_calls;
end $$;

-- Check: select status, count(*) from recommendations where source = 'seed' group by 1;

-- To remove the seed later, run just this block:
-- do $$
-- begin
--   alter table recommendations disable trigger recommendations_guard_row;
--   delete from recommendations where source = 'seed';
--   alter table recommendations enable trigger recommendations_guard_row;
-- end $$;
