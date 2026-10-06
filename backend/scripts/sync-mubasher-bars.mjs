#!/usr/bin/env node
/**
 * Refreshes the price history of the stocks only Mubasher carries and uploads
 * it to the production server.
 *
 * Mubasher is the third source in the fallback chain (data/yahoo.js), for
 * stocks neither Yahoo nor TradingView serves — but it refuses the production
 * server's address, so there the chain falls through to a source with about a
 * month of sessions. Run this from a machine Mubasher does serve (after the
 * session's close is published, 16:00 Cairo) and the server gets Mubasher's
 * full series without ever contacting it.
 *
 *   node scripts/sync-mubasher-bars.mjs                  refresh, then upload
 *   node scripts/sync-mubasher-bars.mjs --codes FCMD,AIHC   these stocks only
 *   node scripts/sync-mubasher-bars.mjs --dry-run        refresh, don't upload
 *
 * Which stocks: every one whose cached history on this machine came from
 * Mubasher or the source behind it — i.e. neither Yahoo nor
 * TradingView could serve it. Upload target, in backend/.env:
 *   ALYTIC_BARS_SYNC_TARGET=user@host:/opt/alytic/backend/data/bars/
 *   ALYTIC_BARS_SYNC_KEY=C:/Users/you/.ssh/key      (optional — else ssh's default)
 */

import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import '../src/loadEnv.js';
import { BARS_DIR, readBars, writeBars } from '../src/data/cache.js';
import { fetchDailyMubasher } from '../src/data/mubasher.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const codesArg = args[args.indexOf('--codes') + 1];
const requested = args.includes('--codes') && codesArg ? codesArg.split(',').map((c) => c.trim().toUpperCase()).filter(Boolean) : null;

// The cache records which source last served each stock: one that fell past
// Yahoo and TradingView was served by Mubasher, or by the source behind it.
const PAST_YAHOO_AND_TRADINGVIEW = new Set(['mubasher', 'stockanalysis']);

// Read off the cache folder, not the universe list: a stock an admin added
// by hand (AIHC) is in the cache without being in the built-in universe.
async function mubasherOnlyCodes() {
  const codes = [];
  for (const file of (await fs.readdir(BARS_DIR)).filter((name) => name.endsWith('.json')).sort()) {
    const code = file.slice(0, -'.json'.length);
    if (PAST_YAHOO_AND_TRADINGVIEW.has((await readBars(code))?.source)) codes.push(code);
  }
  return codes;
}

const codes = requested ?? (await mubasherOnlyCodes());
if (!codes.length) {
  console.log('No Mubasher-only stocks to refresh.');
  process.exit(0);
}

const refreshed = [];
for (const code of codes) {
  try {
    const fresh = await fetchDailyMubasher(code);
    await writeBars(code, { code, ...fresh });
    refreshed.push(code);
    console.log(`${code}: ${fresh.bars.length} sessions, last ${fresh.bars.at(-1).date}`);
  } catch (err) {
    console.error(`${code}: failed — ${err.message}`);
  }
  // One stock at a time with a pause: this is someone's public page, not an API.
  await new Promise((resolve) => setTimeout(resolve, 1500));
}

const target = process.env.ALYTIC_BARS_SYNC_TARGET;
if (dryRun || !refreshed.length) process.exit(refreshed.length ? 0 : 1);
if (!target) {
  console.error('Refreshed locally, not uploaded: set ALYTIC_BARS_SYNC_TARGET in backend/.env.');
  process.exit(1);
}

const key = process.env.ALYTIC_BARS_SYNC_KEY;
const files = refreshed.map((code) => path.join(BARS_DIR, `${code}.json`));
const upload = spawnSync('scp', ['-o', 'BatchMode=yes', ...(key ? ['-i', key] : []), ...files, target], { stdio: 'inherit' });
if (upload.status !== 0) {
  console.error('Upload failed — the files above are refreshed on this machine only.');
  process.exit(1);
}
console.log(`Uploaded ${refreshed.length} file(s) to ${target}`);
