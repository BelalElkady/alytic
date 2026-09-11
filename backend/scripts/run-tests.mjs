#!/usr/bin/env node
/**
 * Runs `node --test` over the given glob(s), then always deletes the test
 * data those tests seeded into the real Supabase project (cleanup-test-data.js)
 * — including on failure, so a broken assertion doesn't leave leftover rows
 * behind. Exits with the test run's own status, not the cleanup's.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const patterns = process.argv.slice(2);

const testRun = spawnSync('node', ['--test', ...patterns], { stdio: 'inherit', shell: process.platform === 'win32' });

const cleanup = spawnSync('node', [path.join(here, 'cleanup-test-data.js')], { stdio: 'inherit' });
if (cleanup.status !== 0) console.error('[run-tests] cleanup-test-data.js failed; test data may remain in Supabase');

process.exit(testRun.status ?? 1);
