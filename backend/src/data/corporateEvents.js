/**
 * The stock-level side of corporate actions (see ../corporateActions.js):
 * which EGX stocks changed share basis, when, by what factor, and the raw
 * close on the last old-basis session. Market data, not a User's — shared by
 * every account and site, and kept next to the bar cache.
 *
 * The analysis reads it to put a stock's bars on the new basis on the very
 * day of the event, before the feed has adjusted them (and for good if it
 * never does), so the stop, the targets and the day's change aren't measured
 * across the jump.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { BARS_DIR } from './cache.js';

const FILE = path.join(BARS_DIR, '_corporate-events.json');
const MAX_PER_CODE = 10;

let loaded = null; // code -> event[], newest last

async function load() {
  if (loaded) return loaded;
  try {
    loaded = new Map(Object.entries(JSON.parse(await fs.readFile(FILE, 'utf8'))));
  } catch {
    loaded = new Map();
  }
  return loaded;
}

let writing = Promise.resolve();
function persist() {
  writing = writing
    .catch(() => {})
    .then(async () => {
      await fs.mkdir(BARS_DIR, { recursive: true });
      await fs.writeFile(FILE, JSON.stringify(Object.fromEntries(loaded)), 'utf8');
    })
    .catch((err) => console.warn('[corporate-events] save failed:', err.message));
  return writing;
}

/** A stock's recorded events, oldest first. */
export async function eventsFor(code) {
  return (await load()).get(String(code).toUpperCase()) ?? [];
}

/** The most recent event for a stock, or null. */
export async function latestEventFor(code) {
  return (await eventsFor(code)).at(-1) ?? null;
}

/**
 * Record (or improve) an event. One per (code, lastBefore): a confirmed
 * factor replaces a suspected one, never the other way round.
 * @param {{code:string, lastBefore:string, rawBefore:number, factor:number, status:'suspected'|'confirmed', kind?:string|null, summary?:string|null}} event
 * @returns {Promise<object>} the event as stored
 */
export async function recordEvent(event) {
  const map = await load();
  const code = String(event.code).toUpperCase();
  const list = map.get(code) ?? [];
  const existing = list.find((e) => e.lastBefore === event.lastBefore);
  if (existing && existing.status === 'confirmed' && event.status !== 'confirmed') return existing;
  const next = { ...existing, ...event, code, updatedAt: new Date().toISOString(), detectedAt: existing?.detectedAt ?? new Date().toISOString() };
  const others = list.filter((e) => e !== existing);
  map.set(code, [...others, next].sort((a, b) => a.lastBefore.localeCompare(b.lastBefore)).slice(-MAX_PER_CODE));
  await persist();
  return next;
}

/** Test hook: forget what was loaded so the file is read again. */
export function _resetForTests() {
  loaded = null;
}
