#!/usr/bin/env node
/**
 * Deletes every user (and, via `on delete cascade`, their portfolio) that a
 * test suite seeded into the real Supabase project.
 *
 * There's no throwaway database for tests to run against — see TESTING.md's
 * "Isolation model" — so `uniqueEmail()` (backend/test/helpers/server.js) and
 * the E2E fixtures (tests/e2e/*.ts) both register real rows there, keyed by
 * an email ending in `@test.local`. Nothing else in the schema uses that
 * domain, so it's a safe, exact match for "seeded by a test run".
 *
 *   node scripts/cleanup-test-data.js
 */
import 'dotenv/config';
import { supabase } from '../src/supabaseClient.js';

const { data, error } = await supabase.from('users').delete().ilike('email', '%@test.local').select('id');
if (error) throw new Error(`cleanup-test-data: ${error.message}`);

console.log(`[cleanup-test-data] deleted ${data.length} test user(s)`);
