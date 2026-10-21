-- Empties every table in the TEST project's public schema at the end of a CI
-- run (.github/workflows/test.yml, step "Delete all test data"), so nothing a
-- test wrote outlives the run. The workflow applies schema.sql and
-- platform.sql right after this in the same transaction, which restores the
-- one seeded row (the 'local' dev account) and the current structure.
--
-- NEVER run this against production: the workflow refuses any connection
-- string that is not the test project's before it gets here.
--
-- recommendations is append-only by design (recommendations_guard_truncate
-- blocks TRUNCATE), so that guard is switched off for this transaction only.
do $$
declare
  t record;
  guarded boolean := to_regclass('public.recommendations') is not null;
begin
  if guarded then
    alter table public.recommendations disable trigger recommendations_guard_truncate;
  end if;
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('truncate table public.%I restart identity cascade', t.tablename);
  end loop;
  if guarded then
    alter table public.recommendations enable trigger recommendations_guard_truncate;
  end if;
end $$;
