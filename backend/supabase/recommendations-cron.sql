-- Daily run of the evaluate-recommendations Edge Function
-- (supabase/functions/evaluate-recommendations), which resolves open
-- recommendations against that day's session bars. See the recommendations
-- section of schema.sql for the tables.
--
-- Apply once per Supabase project (the platform database and every client
-- database that has its own users), after schema.sql and after deploying the
-- function to that project:
--
--   supabase functions deploy evaluate-recommendations --workdir backend --no-verify-jwt --project-ref <ref>
--   supabase secrets set EVALUATE_CRON_SECRET=<random string> --project-ref <ref>
--
-- (--no-verify-jwt: the function checks its own X-Cron-Secret instead, which
-- works the same whichever kind of API key the project uses) then, in that
-- project's SQL editor, store the same values in Vault (so they
-- never sit in the cron job's text) and run the rest of this file:
--
--   select vault.create_secret('https://<ref>.supabase.co', 'recommendations_project_url');
--   select vault.create_secret('<the EVALUATE_CRON_SECRET value>', 'recommendations_cron_secret');
--
-- Timing: the backend records the session's bars into recommendation_prices
-- at the 14:30 Cairo close (runDailyClose in src/api/server.js). pg_cron runs
-- in UTC and Cairo moves between UTC+2 and UTC+3, so 13:30 UTC lands at 15:30
-- or 16:30 Cairo — after the close either way. Sunday–Thursday is EGX's
-- trading week; a holiday run finds no new bars and changes nothing. A missed
-- run is harmless: every run re-reads all bars since each call was issued.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('evaluate-recommendations')
where exists (select 1 from cron.job where jobname = 'evaluate-recommendations');

select cron.schedule(
  'evaluate-recommendations',
  '30 13 * * 0-4',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'recommendations_project_url')
           || '/functions/v1/evaluate-recommendations',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Cron-Secret', (select decrypted_secret from vault.decrypted_secrets where name = 'recommendations_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);

-- To check it: select * from cron.job_run_details where jobid =
--   (select jobid from cron.job where jobname = 'evaluate-recommendations') order by start_time desc limit 5;
-- and the HTTP result: select * from net._http_response order by created desc limit 5;
