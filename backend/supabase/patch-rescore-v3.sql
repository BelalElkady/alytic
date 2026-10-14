-- Run once, by hand, in the Supabase SQL editor of each tenant, AFTER
-- schema.sql (which adds target_sessions and the guard that stamps version 3).
-- Back up first.
--
-- What it does: re-opens every call scored under an older version of the
-- rules (scoring_version 1 or 2) and stamps it 3, so the evaluator scores the
-- whole Track record again under the current rules — the way the app manages
-- a Position: two closes under the stop for the long style, part sold at the
-- target and the rest kept under a raised stop (see evaluate.js). The issue
-- fields and the stock's own move are left alone; only the outcome is cleared.
--
-- The guard trigger freezes a closed call, so it is switched off for this one
-- statement and back on before the commit.
--
-- After it: the backend's next 14:30 daily close records any session bars the
-- re-opened calls need (from the first session after the earliest open call),
-- and the evaluator run after it resolves them again. Safe to re-run: a second
-- run finds nothing under version 3.

begin;

alter table public.recommendations add column if not exists target_sessions integer;

alter table public.recommendations disable trigger recommendations_guard_row;

update public.recommendations
set status = 'open',
    closed_at = null,
    exit_price = null,
    return_pct = null,
    excess_return_pct = null,
    benchmark_excess_pct = null,
    index_excess = null,
    target_sessions = null,
    sessions_elapsed = 0,
    mark_price = null,
    mark_return_pct = null,
    mark_excess_return_pct = null,
    mark_benchmark_excess_pct = null,
    mark_index_excess = null,
    evaluated_at = null,
    scoring_version = 3
where coalesce(scoring_version, 2) < 3;

alter table public.recommendations enable trigger recommendations_guard_row;

commit;

-- To check the result:
--   -- One row, version 3:
--   select scoring_version, count(*) from recommendations group by 1;
--   -- After the next evaluator run, outcomes are back:
--   select status, count(*) from recommendations group by 1;
