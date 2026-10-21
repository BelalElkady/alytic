-- Run once, by hand, in the Supabase SQL editor of each tenant, AFTER the
-- backend that logs a hold's stop is deployed and the evaluate-recommendations
-- Edge Function is redeployed. Back up first.
--
-- What it does: the guard trigger stamps new calls scoring_version 4 instead
-- of 3. From version 4 a hold carries the position's own stop (the "close
-- under X = full exit" the app gives with every hold) and the evaluator
-- closes it there on a session close — hit_stop, a loss — instead of booking
-- the whole fall to the horizon. Calls already logged keep version 3 and are
-- scored as before: some older open holds still carry a stop from the first
-- version of the rules, and those stay ignored.
--
-- Nothing is re-opened or rescored. Safe to re-run.

begin;

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
    new.target_sessions := null;
    new.scoring_version := 4;
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
          new.benchmark_excess_pct, new.index_excess, new.mark_benchmark_excess_pct, new.mark_index_excess,
          new.target_sessions, new.scoring_version)
         is distinct from
         (old.status, old.closed_at, old.exit_price, old.return_pct, old.excess_return_pct, old.sessions_elapsed,
          old.mark_price, old.mark_return_pct, old.mark_excess_return_pct, old.evaluated_at,
          old.benchmark_excess_pct, old.index_excess, old.mark_benchmark_excess_pct, old.mark_index_excess,
          old.target_sessions, old.scoring_version) then
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

commit;

-- To check the result, the day after the next review:
--   select scoring_version, action, count(*), count(stop_price) with_stop
--   from recommendations where issued_on >= current_date - 1 group by 1, 2;
