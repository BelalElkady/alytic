#!/usr/bin/env node
/**
 * Deletes every user (and, via `on delete cascade`, their portfolio) that a
 * test suite seeded into the test Supabase project.
 *
 * The test project is shared, not reset per run — see TESTING.md's
 * "Isolation model" — so `uniqueEmail()` (backend/test/helpers/server.js) and
 * the E2E fixtures (tests/e2e/*.ts) both register real rows there, keyed by
 * an email ending in `@test.local`. Nothing else in the schema uses that
 * domain, so it's a safe, exact match for "seeded by a test run".
 *
 * Always targets the test project (TEST_SUPABASE_*), never production.
 *
 *   node scripts/cleanup-test-data.js
 */
import { useTestDatabase } from '../test/helpers/test-database.js';

// Before supabaseClient.js loads: it reads SUPABASE_URL at import time.
useTestDatabase();
const { supabase } = await import('../src/supabaseClient.js');

const { data, error } = await supabase.from('users').delete().ilike('email', '%@test.local').select('id');
if (error) throw new Error(`cleanup-test-data: ${error.message}`);

console.log(`[cleanup-test-data] deleted ${data.length} test user(s)`);
