/**
 * Price history for the stock detail chart, at six zoom levels.
 *
 * The analysis path caches only two years of daily bars on disk (see
 * data/cache.js) and its indicators are tuned to that window, so this asks the
 * feed for its own data and keeps it in memory instead of touching that cache.
 *
 *   1m / 6m / 1y  daily closes, sliced from one five-year daily fetch
 *   5y            one close per week (~260 points) — a chart that wide doesn't
 *                 need every session, and it keeps payload and drawing cheap
 *   1w / 1d       intraday bars (15 min / 5 min), TradingView only: it is the
 *                 one feed here that serves them. Kept for a few minutes,
 *                 since they move all session.
 */

import { fetchDailyAuto } from './yahoo.js';
import { fetchSeriesTV } from './tv-history.js';
import { cairoToday } from './cache.js';
import { lookup, toYahoo } from '../config/universe.js';

const RANGES = {
  '1d': { kind: 'intraday', resolution: '5', bars: 120 },
  '1w': { kind: 'intraday', resolution: '15', bars: 250, days: 7 },
  '1m': { kind: 'daily', months: 1 },
  '6m': { kind: 'daily', months: 6 },
  '1y': { kind: 'daily', months: 12 },
  '5y': { kind: 'weekly' },
};
export const HISTORY_RANGES = Object.keys(RANGES);

const INTRADAY_TTL_MS = 5 * 60 * 1000;

const memo = new Map(); // key -> { at, day, value }
const inflight = new Map(); // key -> pending load, so concurrent opens share one request

/** Cached value while `isFresh(entry)`, else `load()` — concurrent callers for one key share the load. */
function memoized(key, isFresh, load) {
  const hit = memo.get(key);
  if (hit && isFresh(hit)) return Promise.resolve(hit.value);
  if (inflight.has(key)) return inflight.get(key);

  const pending = load()
    .then((value) => {
      memo.set(key, { at: Date.now(), day: cairoToday(), value });
      return value;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, pending);
  return pending;
}

const sameDay = (entry) => entry.day === cairoToday();
const recent = (entry) => Date.now() - entry.at < INTRADAY_TTL_MS;

// 1970-01-01 was a Thursday, so day 3 is the first Sunday — EGX's week opens on Sunday.
const weekOf = (isoDate) => Math.floor((Date.parse(`${isoDate}T00:00:00Z`) / 86_400_000 - 3) / 7);

const roundPrice = (price) => Math.round(price * 1000) / 1000;

/** The last close of each trading week, oldest first. */
export function weeklyCloses(bars) {
  const points = [];
  for (const bar of bars) {
    const point = { d: bar.date, c: roundPrice(bar.c) };
    if (points.length && weekOf(points[points.length - 1].d) === weekOf(bar.date)) points[points.length - 1] = point;
    else points.push(point);
  }
  return points;
}

/** An ISO date moved back by whole years / months / days — a string, since ISO dates order correctly as text. */
function shiftBack(isoDate, { years = 0, months = 0, days = 0 }) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCFullYear(date.getUTCFullYear() - years);
  date.setUTCMonth(date.getUTCMonth() - months);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

/** Cairo wall-clock time of a unix-seconds timestamp, as `YYYY-MM-DDTHH:mm`. */
const cairoStamp = (unixSeconds) =>
  new Date(unixSeconds * 1000).toLocaleString('sv-SE', { timeZone: 'Africa/Cairo' }).slice(0, 16).replace(' ', 'T');

/** Five years of daily bars, fetched once per stock per Cairo day and kept as the two shapes the charts draw. */
function dailyStore(code) {
  return memoized(`${code}:daily`, sameDay, async () => {
    const meta = lookup(code);
    const data = await fetchDailyAuto(code, { range: '5y', yahooSymbol: toYahoo(code), source: meta?.source });
    const to = data.bars[data.bars.length - 1].date;
    // Some feeds return more than asked for (TradingView serves ~6 years).
    const bars = data.bars.filter((bar) => bar.date >= shiftBack(to, { years: 5 }));
    const yearAgo = shiftBack(to, { years: 1 });
    return {
      currency: data.currency ?? 'EGP',
      to,
      weekly: weeklyCloses(bars),
      daily: bars.filter((bar) => bar.date >= yearAgo).map((bar) => ({ d: bar.date, c: roundPrice(bar.c) })),
    };
  });
}

async function loadIntraday(code, range) {
  const spec = RANGES[range];
  // "Today" is measured against yesterday's close, like the % beside the price;
  // the daily store may be unavailable, in which case the chart just has no baseline.
  const [series, store] = await Promise.all([
    fetchSeriesTV(code, { resolution: spec.resolution, bars: spec.bars }),
    range === '1d' ? dailyStore(code).catch(() => null) : null,
  ]);

  // The latest session, not the calendar day: on a weekend or before the open
  // "today" would otherwise be empty.
  const latest = series.bars[series.bars.length - 1].date;
  const bars = range === '1d'
    ? series.bars.filter((bar) => bar.date === latest)
    : series.bars.filter((bar) => bar.date > shiftBack(latest, { days: spec.days }));
  const points = bars.map((bar) => ({ d: cairoStamp(bar.t), c: roundPrice(bar.c) }));

  const base = store?.daily.findLast((point) => point.d < latest)?.c ?? null;
  return { kind: 'intraday', currency: 'EGP', from: points[0].d, to: points[points.length - 1].d, base, points };
}

/**
 * @param {string} code
 * @param {'1d'|'1w'|'1m'|'6m'|'1y'|'5y'} range
 * @returns {Promise<{code:string,range:string,kind:'intraday'|'daily'|'weekly',currency:string,from:string,to:string,base:number|null,points:Array<{d:string,c:number}>}>}
 *   `d` is an ISO date, or `YYYY-MM-DDTHH:mm` (Cairo time) for intraday. `base`
 *   is the previous close, for the one-day view only.
 */
export async function getPriceHistory(code, range = '5y') {
  const spec = RANGES[range];
  if (!spec) throw new Error(`unknown range: ${range}`);
  const key = code.toUpperCase();

  if (spec.kind === 'intraday') {
    const result = await memoized(`${key}:${range}`, recent, () => loadIntraday(key, range));
    return { code: key, range, ...result };
  }

  const store = await dailyStore(key);
  if (spec.kind === 'weekly') {
    const points = store.weekly;
    return { code: key, range, kind: 'weekly', currency: store.currency, from: points[0].d, to: store.to, base: null, points };
  }
  const cutoff = shiftBack(store.to, { months: spec.months });
  const points = store.daily.filter((point) => point.d >= cutoff);
  return { code: key, range, kind: 'daily', currency: store.currency, from: points[0].d, to: store.to, base: null, points };
}
