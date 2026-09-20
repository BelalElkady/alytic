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
import { EGX_HOLIDAYS } from '../config/holidays.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// ALYTIC_BARS_DIR redirects the whole bar cache — used by the test suites to
// run every endpoint against synthetic fixtures instead of live market data.
const BARS_DIR = process.env.ALYTIC_BARS_DIR ?? path.join(ROOT, 'data', 'bars');

const cairoDateFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' });

/** Cairo calendar date of a moment (Date or epoch ms), as YYYY-MM-DD. */
export function cairoDateOf(moment) {
  return cairoDateFormat.format(moment);
}

/** Current date in Cairo, as YYYY-MM-DD. */
export function cairoToday() {
  return cairoDateOf(new Date());
}

/** Cairo wall-clock hour, used to decide whether today's close should exist yet. */
export function cairoHour() {
  return +new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo', hour: '2-digit', hour12: false,
  }).format(new Date());
}

/** EGX trades Sunday-Thursday, except bank holidays (see config/holidays.js). */
export function isTradingDay(isoDate) {
  const dow = new Date(`${isoDate}T12:00:00Z`).getUTCDay(); // 0=Sun .. 6=Sat
  return dow !== 5 && dow !== 6 && !EGX_HOLIDAYS.has(isoDate);
}

async function ensureDir() {
  await fs.mkdir(BARS_DIR, { recursive: true });
}

// The ticker becomes part of a file path. Every ticker this app knows is 2-10
// letters/digits, so anything else (a "../" from a URL parameter, a path
// separator, a NUL byte) is refused outright rather than sanitized — readBars
// treats the throw as a cache miss, writeBars surfaces it.
const SAFE_CACHE_KEY = /^[A-Z0-9]{1,16}$/;
function fileFor(code) {
  const key = String(code).toUpperCase();
  if (!SAFE_CACHE_KEY.test(key)) throw new Error('invalid ticker for a cache file');
  return path.join(BARS_DIR, `${key}.json`);
}

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
 * The latest session whose close should already be published. The session
 * closes at 14:30 Cairo and Yahoo lags a little, so no new bar is expected
 * before 16:00: until then (and on weekends and holidays) it is the last
 * trading day before today, and from 16:00 on a trading day it is today.
 * Calendar-only — it knows weekends and the hand-kept holiday list, not
 * surprise closures.
 */
export function expectedLastSession() {
  const today = cairoToday();
  if (isTradingDay(today) && cairoHour() >= 16) return today;
  const day = new Date(`${today}T12:00:00Z`);
  do {
    day.setUTCDate(day.getUTCDate() - 1);
  } while (!isTradingDay(day.toISOString().slice(0, 10)));
  return day.toISOString().slice(0, 10);
}

/**
 * How long a cache that is behind the calendar is trusted before the source is
 * asked again. Yahoo can trail EGX by several sessions, and re-downloading a
 * series that comes back unchanged is what made a market scan (~200 series)
 * take tens of seconds every time it was opened.
 */
const RECHECK_AFTER_MS = 60 * 60 * 1000;

/**
 * Is a cached entry still good? Yes if it already holds the latest session
 * that should exist, or if the source was asked less than an hour ago and had
 * nothing newer (a lagging feed, not a stale cache). This used to answer "yes"
 * whenever today's own close couldn't exist yet (before 16:00, or on a
 * weekend) however old the cache was, so a cache left untouched for a week
 * kept being served as current — and then failed the staleness gate as if the
 * stock were suspended. The age check keeps that case refetching: a week-old
 * cache is far past the hour.
 */
export function isFresh(cached) {
  if (!cached?.bars?.length) return false;
  if (cached.bars[cached.bars.length - 1].date >= expectedLastSession()) return true;
  const age = Date.now() - Date.parse(cached.cachedAt);
  return age >= 0 && age < RECHECK_AFTER_MS;
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
