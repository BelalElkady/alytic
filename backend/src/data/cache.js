/**
 * On-disk bar cache.
 *
 * EGX publishes one close per session, so re-fetching the same symbol many
 * times in a day is pure waste — and Yahoo rate-limits. Cache entries are keyed
 * by the Cairo trading date of the last bar, and are considered fresh until the
 * next session's close could plausibly exist.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// ALYTIC_BARS_DIR redirects the whole bar cache — used by the test suites to
// run every endpoint against synthetic fixtures instead of live market data.
const BARS_DIR = process.env.ALYTIC_BARS_DIR ?? path.join(ROOT, 'data', 'bars');

/** Current date in Cairo, as YYYY-MM-DD. */
export function cairoToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
}

/** Cairo wall-clock hour, used to decide whether today's close should exist yet. */
function cairoHour() {
  return +new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo', hour: '2-digit', hour12: false,
  }).format(new Date());
}

/** EGX trades Sunday-Thursday. */
export function isTradingDay(isoDate) {
  const dow = new Date(`${isoDate}T12:00:00Z`).getUTCDay(); // 0=Sun .. 6=Sat
  return dow !== 5 && dow !== 6;
}

async function ensureDir() {
  await fs.mkdir(BARS_DIR, { recursive: true });
}

const fileFor = (code) => path.join(BARS_DIR, `${code.toUpperCase()}.json`);

export async function readBars(code) {
  try {
    return JSON.parse(await fs.readFile(fileFor(code), 'utf8'));
  } catch {
    return null;
  }
}

export async function writeBars(code, payload) {
  await ensureDir();
  await fs.writeFile(fileFor(code), JSON.stringify({ ...payload, cachedAt: new Date().toISOString() }), 'utf8');
}

/**
 * Is a cached entry still good?
 *
 * The session closes at 14:30 Cairo, and Yahoo lags a little, so before 16:00
 * we don't expect today's bar and yesterday's data is fine. After that, on a
 * trading day, a cache whose last bar isn't today is stale.
 */
export function isFresh(cached) {
  if (!cached?.bars?.length) return false;
  const today = cairoToday();
  const lastBar = cached.bars[cached.bars.length - 1].date;

  if (lastBar >= today) return true;
  if (!isTradingDay(today)) return true;      // weekend — no new close is coming
  if (cairoHour() < 16) return true;          // today's close isn't published yet
  return false;
}

/** Cached bars if fresh, otherwise fetch, store and return. */
export async function getBars(code, yahooSymbol, fetcher, { range = '2y', force = false } = {}) {
  if (!force) {
    const cached = await readBars(code);
    if (isFresh(cached)) return { ...cached, fromCache: true };
  }
  const fresh = await fetcher(yahooSymbol, { range });
  await writeBars(code, { code, ...fresh });
  return { code, ...fresh, fromCache: false };
}

export { BARS_DIR };
