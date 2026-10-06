/**
 * Watches the EGX listing for stocks that have appeared or gone since the
 * universe was built.
 *
 * The universe (config/universe.generated.json) is a snapshot: built once
 * from the listing, never re-checked, so a stock listed afterwards simply
 * doesn't exist for the app. This compares it against TradingView's EGX
 * screener — the same list already pulled for fundamentals — and reports:
 *
 *  - added:   on the screener, but in neither the universe nor the list the
 *             build rejected (too little history, not really trading), nor
 *             added by an admin since.
 *  - removed: in the built universe, with no session for
 *             REMOVED_AFTER_SESSIONS trading days — or gone from the screener
 *             with no recent session on record to show it still trades.
 *
 * Report only. Admitting a stock is still the build's job (scripts/
 * build-universe.js), which makes every entry prove itself against real
 * price data — a ticker attached to the wrong company is the worst failure
 * this project can have.
 */

import { UNIVERSE, UNIVERSE_META } from './config/universe.js';
import { cachedScreener } from './data/tradingview.js';
import { readBars, cairoToday } from './data/cache.js';
import { tradingDaysBetween } from './data/quality.js';

/** A missing session or two is a suspension or a thin stock, not a delisting. */
export const REMOVED_AFTER_SESSIONS = 10;

/** A cache older than this says nothing about whether the stock still trades — nobody has asked the source since. */
const CACHE_TRUSTED_FOR_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * @param {object} input
 * @param {Array<{code:string,name:string}>} input.listed - the screener's current stocks
 * @param {Array<{code:string,en?:string,ar?:string,custom?:boolean}>} input.universe
 * @param {Array<{code:string}>} input.rejected - what the build looked at and turned down
 * @param {(code:string) => {lastSession:string,cachedAt:string}|null} input.historyOf
 * @param {string} input.today - Cairo date, YYYY-MM-DD
 * @param {number} [input.now] - epoch ms
 */
export function universeChanges({ listed, universe, rejected, historyOf, today, now = Date.now() }) {
  const known = new Set([...universe.map((s) => s.code), ...rejected.map((s) => s.code)]);
  const onScreener = new Set(listed.map((s) => s.code));

  const added = listed
    .filter((s) => !known.has(s.code))
    .map((s) => ({ code: s.code, name: s.name ?? s.code }))
    .sort((a, b) => a.code.localeCompare(b.code));

  const removed = [];
  // A stock an admin added by hand was never on the screener to begin with.
  for (const stock of universe.filter((s) => !s.custom)) {
    const history = historyOf(stock.code);
    const lastSession = history?.lastSession ?? null;
    const name = stock.en ?? stock.ar ?? stock.code;
    const trusted = history && now - Date.parse(history.cachedAt) < CACHE_TRUSTED_FOR_MS;
    const sessionsSince = trusted ? tradingDaysBetween(lastSession, today) : null;
    // Still trading is the stronger evidence: the screener doesn't carry
    // every EGX stock (FCMD trades daily and isn't on it), so being absent
    // from it only counts when there's no recent session to contradict it.
    if (sessionsSince != null && sessionsSince < REMOVED_AFTER_SESSIONS) continue;
    if (!onScreener.has(stock.code)) {
      removed.push({ code: stock.code, name, reason: 'unlisted', lastSession, sessionsSince });
    } else if (sessionsSince != null) {
      removed.push({ code: stock.code, name, reason: 'no-sessions', lastSession, sessionsSince });
    }
  }
  removed.sort((a, b) => a.code.localeCompare(b.code));

  return { added, removed };
}

/** The live report for this server: screener now, universe as loaded, history from the bar cache. */
export async function currentUniverseChanges() {
  const listed = await cachedScreener();
  const history = new Map();
  for (const stock of UNIVERSE) {
    const cached = await readBars(stock.code);
    if (cached?.bars?.length) history.set(stock.code, { lastSession: cached.bars.at(-1).date, cachedAt: cached.cachedAt });
  }
  const changes = universeChanges({
    listed,
    universe: UNIVERSE,
    rejected: UNIVERSE_META.rejected,
    historyOf: (code) => history.get(code) ?? null,
    today: cairoToday(),
  });
  return {
    ...changes,
    checkedAt: new Date().toISOString(),
    universeBuiltAt: UNIVERSE_META.generatedAt,
    listedCount: listed.length,
    universeCount: UNIVERSE.length,
    removedAfterSessions: REMOVED_AFTER_SESSIONS,
  };
}
