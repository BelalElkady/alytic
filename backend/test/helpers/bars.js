/**
 * Deterministic bar fixtures.
 *
 * Everything here is synthetic and seeded: the same call yields byte-identical
 * bars on every run and every machine, so tests can assert exact numbers the
 * engine computes. Dates are real EGX trading days (Sun-Thu) ending at the most
 * recent session, which keeps the data-quality gate's staleness checks happy.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { TEST_BARS_DIR } from './env.js';
import { isTradingDay, cairoToday } from '../../src/data/cache.js';

/** Cairo-local ISO date for a JS date. */
export const isoDay = (date) => date.toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });

/**
 * The last `count` EGX trading sessions as ISO dates, oldest first, ending at
 * the most recent session on or before today (Cairo). `endOffsetSessions`
 * walks that end further back — used to fabricate stale series.
 */
export function tradingDates(count, endOffsetSessions = 0) {
  const dates = [];
  let cursor = new Date(`${cairoToday()}T12:00:00Z`);
  let collected = 0;
  let skipped = 0;
  while (collected < count + endOffsetSessions) {
    const iso = cursor.toISOString().slice(0, 10);
    if (isTradingDay(iso)) {
      if (skipped < endOffsetSessions) skipped++;
      else dates.unshift(iso);
      collected++;
    }
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return dates;
}

/** Tiny deterministic PRNG so fixtures never depend on Math.random. */
export function prng(seed = 42) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Synthetic daily OHLCV series with drift. Daily moves stay far below the
 * quality gate's 45% gap threshold and volumes stay well above the dead-volume
 * floor, so the default shape passes `checkQuality`.
 */
export function synthBars({
  sessions = 260,
  start = 100,
  driftPct = 0.08,
  volPct = 0.6,
  seed = 42,
  volume = 80_000,
  dates = null,
} = {}) {
  const rand = prng(seed);
  const days = dates ?? tradingDates(sessions);
  const bars = [];
  let close = start;
  for (let i = 0; i < days.length; i++) {
    const o = close;
    const noise = (rand() - 0.5) * 2 * (volPct / 100);
    close = Math.max(0.5, close * (1 + driftPct / 100 + noise));
    const wiggleUp = 1 + (0.1 + rand() * 0.4) * (volPct / 100);
    const wiggleDown = 1 - (0.1 + rand() * 0.4) * (volPct / 100);
    const h = Math.max(o, close) * wiggleUp;
    const l = Math.min(o, close) * wiggleDown;
    bars.push({
      date: days[i],
      o: +o.toFixed(2),
      h: +h.toFixed(2),
      l: +l.toFixed(2),
      c: +close.toFixed(2),
      v: Math.round(volume * (0.7 + rand() * 0.6)),
    });
  }
  return bars;
}

/** The ORAS failure mode: N identical sessions at one price, healthy volumes. */
export function frozenBars({ sessions = 80, price = 71.05, volume = 80_000, dates = null } = {}) {
  const days = dates ?? tradingDates(sessions);
  return days.map((date) => ({ date, o: price, h: price, l: price, c: price, v: volume }));
}

export function staleBars(options = {}) {
  // Ends ~10 sessions back — past maxStaleSessions (5), so fatally stale.
  return synthBars({ ...options, dates: tradingDates(options.sessions ?? 120, 10) });
}

export function thinHistoryBars(options = {}) {
  return synthBars({ sessions: 50, ...options });
}

export function lowVolumeBars(options = {}) {
  return synthBars({ volume: 10, ...options });
}

export function halfDeadVolumeBars(options = {}) {
  const bars = synthBars({ ...options, volume: 50_000 });
  return bars.map((b, i) => (i % 2 === 0 ? { ...b, v: 0 } : b));
}

export function choppyBars({ sessions = 120, start = 100, seed = 7, volume = 80_000, dates = null } = {}) {
  // Zero-drift noise: trends nowhere, high path length → low efficiency ratio.
  return synthBars({ sessions, start, driftPct: 0, volPct: 1.2, seed, volume, dates });
}

export function downtrendBars(options = {}) {
  return synthBars({ driftPct: -0.15, ...options });
}

export function breakoutBars({ sessions = 140, base = 100, breakoutTo = 115, volume = 80_000, dates = null } = {}) {
  // 100 sessions ranging in [96, 104], then a gap up to `breakoutTo` that holds.
  const days = dates ?? tradingDates(sessions);
  const rand = prng(7);
  const bars = [];
  for (let i = 0; i < days.length; i++) {
    let close;
    if (i < days.length - 12) close = base * (1 + (rand() - 0.5) * 0.06);
    else close = breakoutTo * (1 + (rand() - 0.5) * 0.008);
    const o = i === 0 ? base : bars[i - 1].c;
    const h = Math.max(o, close) * 1.01;
    const l = Math.min(o, close) * 0.99;
    bars.push({ date: days[i], o: +o.toFixed(2), h: +h.toFixed(2), l: +l.toFixed(2), c: +close.toFixed(2), v: volume });
  }
  return bars;
}

/** Write a fixture into the test bar cache, exactly as the app caches them. */
export async function writeBars(code, bars) {
  await fs.mkdir(TEST_BARS_DIR, { recursive: true });
  const payload = { code: code.toUpperCase(), symbol: `EGX:${code.toUpperCase()}`, currency: 'EGP', bars };
  await fs.writeFile(path.join(TEST_BARS_DIR, `${code.toUpperCase()}.json`), JSON.stringify(payload), 'utf8');
  return payload;
}

export async function removeBars(code) {
  await fs.rm(path.join(TEST_BARS_DIR, `${code.toUpperCase()}.json`), { force: true });
}