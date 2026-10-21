#!/usr/bin/env node
/**
 * Deletes the users (and, via `on delete cascade`, their portfolios) that a
 * test run seeded into the test Supabase project.
 *
 * The test project is shared, not reset per run — see TESTING.md's
 * "Isolation model" — so `uniqueEmail()` (backend/test/helpers/server.js) and
 * the E2E fixtures (tests/e2e/*.ts) both register real rows there, with an
 * email ending in `@test.local` that carries the run's TEST_RUN_ID.
 *
 * With TEST_RUN_ID set (scripts/run-tests.mjs and playwright.config.ts set
 * it) this removes only that run's accounts, so a run that is still going
 * keeps its own, plus any `@test.local` account older than a day, which a
 * crashed run left behind. Run by hand without TEST_RUN_ID, it removes every
 * `@test.local` account.
 *
 * Always targets the test project (TEST_SUPABASE_*), never production.
 *
 *   node scripts/cleanup-test-data.js
 */
import { useTestDatabase } from '../test/helpers/test-database.js';

// Before supabaseClient.js loads: it reads SUPABASE_URL at import time.
useTestDatabase();
const { supabase } = await import('../src/supabaseClient.js');

const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
const runId = process.env.TEST_RUN_ID;

async function remove(describe, query) {
  const { data, error } = await query.select('id');
  if (error) throw new Error(`cleanup-test-data (${describe}): ${error.message}`);
  console.log(`[cleanup-test-data] deleted ${data.length} ${describe}`);
}

// Uploaded files (announcement, blog and support images, brand assets) have
// no owner row to cascade from. The test project holds nothing but test
// data, so every bucket is emptied.
async function emptyStorage() {
  const { data: buckets, error } = await supabase.storage.listBuckets();
  if (error) throw new Error(`cleanup-test-data (list buckets): ${error.message}`);
  for (const bucket of buckets) {
    const { error: emptyError } = await supabase.storage.emptyBucket(bucket.id);
    if (emptyError) throw new Error(`cleanup-test-data (empty ${bucket.id}): ${emptyError.message}`);
  }
  console.log(`[cleanup-test-data] emptied ${buckets.length} storage bucket(s)`);
}

await emptyStorage();

if (!runId) {
  await remove('test user(s)', supabase.from('users').delete().ilike('email', '%@test.local'));
} else {
  if (!/^[a-z0-9]+$/i.test(runId)) throw new Error(`cleanup-test-data: unexpected TEST_RUN_ID "${runId}"`);
  await remove(`test user(s) from run ${runId}`, supabase.from('users').delete().ilike('email', `%-${runId}-%@test.local`));
  await remove(
    'stale test user(s) older than a day',
    supabase.from('users').delete().ilike('email', '%@test.local').lt('created_at', new Date(Date.now() - STALE_AFTER_MS).toISOString()),
  );
}
