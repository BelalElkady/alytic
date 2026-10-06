/**
 * Watches the EGX listing for stocks that have appeared or gone since the
 * universe was built.
 *
 * The universe (config/universe.generated.json) is a snapshot: built once
 * from the listing, never re-checked, so a stock listed afterwards simply
 * doesn't exist for the app. This compares it against two directories:
 *
 *  - TradingView's EGX screener — the same list already pulled for
 *    fundamentals. The main detector.
 *  - Mubasher's company directory — a second one, for a stock TradingView
 *    doesn't carry. Only its rows with a recent trade count (see
 *    fetchMubasherListing for why the raw list can't be trusted), and the
 *    production server can't reach Mubasher, so there it is read from the
 *    copy the collector uploads (scripts/sync-mubasher-bars.mjs).
 *
 * and reports:
 *
 *  - added:   on either directory, but in neither the universe nor the list
 *             the build rejected (too little history, not really trading) —
 *             each with which price feeds carry it and how many sessions of
 *             history exist, since those decide whether it can be analysed
 *             yet. A stub an admin's index upload registered (see
 *             addCustomStocks) counts too, flagged `stub: true` — it can
 *             already be used, but still lacks the build's vetting
 *             (sector, shariah screening, a verified identity).
 *  - removed: in the built universe, with no session for
 *             REMOVED_AFTER_SESSIONS trading days — or gone from every
 *             directory with no recent session on record to show it trades.
 *
 * Report only. Admitting a stock is still the build's job (scripts/
 * build-universe.js), which makes every entry prove itself against real
 * price data — a ticker attached to the wrong company is the worst failure
 * this project can have.
 */

import { UNIVERSE, UNIVERSE_META } from './config/universe.js';
import { cachedScreener } from './data/tradingview.js';
import { fetchDaily } from './data/yahoo.js';
import { fetchMubasherListing, readMubasherListing } from './data/mubasher.js';
import { readBars, cairoToday, MIN_USABLE_BARS } from './data/cache.js';
import { fetchDailyTV } from './data/tv-history.js';
import { tradingDaysBetween } from './data/quality.js';

/** A missing session or two is a suspension or a thin stock, not a delisting. */
export const REMOVED_AFTER_SESSIONS = 10;

/** A cache older than this says nothing about whether the stock still trades — nobody has asked the source since. */
const CACHE_TRUSTED_FOR_MS = 3 * 24 * 60 * 60 * 1000;

/** An uploaded Mubasher directory older than this is left out rather than trusted. */
const MUBASHER_LISTING_TRUSTED_FOR_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * @param {object} input
 * @param {Array<{code:string,name:string}>} input.tradingview - the screener's current stocks
 * @param {Array<{code:string,name:string,lastSession:string}>|null} input.mubasher - its directory, or null when unavailable
 * @param {Array<{code:string,en?:string,ar?:string,custom?:boolean}>} input.universe
 * @param {Array<{code:string}>} input.rejected - what the build looked at and turned down
 * @param {(code:string) => {lastSession:string,cachedAt:string}|null} input.historyOf
 * @param {string} input.today - Cairo date, YYYY-MM-DD
 * @param {number} [input.now] - epoch ms
 */
export function universeChanges({ tradingview, mubasher = null, universe, rejected, historyOf, today, now = Date.now() }) {
  // A custom entry (registered from an index CSV, see addCustomStocks) is a
  // stub — no sector, no shariah screening, identity unverified. It stays
  // "known" to the app (an index can reference it) but not to this report,
  // so it keeps showing up as unfinished business until a real build gives
  // it the same proof every other entry has.
  const customByCode = new Map(universe.filter((s) => s.custom).map((s) => [s.code, s]));
  const known = new Set([...universe.filter((s) => !s.custom).map((s) => s.code), ...rejected.map((s) => s.code)]);
  const onTradingView = new Map(tradingview.map((s) => [s.code, s]));
  // Mubasher keeps companies that stopped trading years ago: only one that
  // has traded lately is "listed" for this purpose.
  const onMubasher = new Map(
    (mubasher ?? [])
      .filter((s) => tradingDaysBetween(s.lastSession, today) < REMOVED_AFTER_SESSIONS)
      .map((s) => [s.code, s]),
  );

  const added = [...new Set([...onTradingView.keys(), ...onMubasher.keys(), ...customByCode.keys()])]
    .filter((code) => !known.has(code))
    .sort()
    .map((code) => ({
      code,
      name: onTradingView.get(code)?.name ?? onMubasher.get(code)?.name ?? customByCode.get(code)?.en ?? code,
      sources: { tradingview: onTradingView.has(code), mubasher: mubasher ? onMubasher.has(code) : null },
      // Already usable in the app (an index upload registered it), just
      // missing the real build's vetting — not a brand-new, untouched stock.
      stub: customByCode.has(code),
    }));

  const removed = [];
  // A stock an admin added by hand was never on a directory to begin with.
  for (const stock of universe.filter((s) => !s.custom)) {
    const history = historyOf(stock.code);
    const lastSession = history?.lastSession ?? null;
    const name = stock.en ?? stock.ar ?? stock.code;
    const trusted = history && now - Date.parse(history.cachedAt) < CACHE_TRUSTED_FOR_MS;
    const sessionsSince = trusted ? tradingDaysBetween(lastSession, today) : null;
    // Still trading is the stronger evidence: no directory carries every EGX
    // stock (FCMD trades daily and isn't on the screener), so being absent
    // only counts when there's no recent session to contradict it.
    if (sessionsSince != null && sessionsSince < REMOVED_AFTER_SESSIONS) continue;
    if (!onTradingView.has(stock.code) && !onMubasher.has(stock.code)) {
      removed.push({ code: stock.code, name, reason: 'unlisted', lastSession, sessionsSince });
    } else if (sessionsSince != null) {
      removed.push({ code: stock.code, name, reason: 'no-sessions', lastSession, sessionsSince });
    }
  }
  removed.sort((a, b) => a.code.localeCompare(b.code));

  return { added, removed };
}

/**
 * Mubasher's directory: asked directly where that works (a developer's
 * machine), otherwise the collector's uploaded copy if it's recent enough.
 */
async function mubasherListing() {
  try {
    return { stocks: await fetchMubasherListing(), fetchedAt: new Date().toISOString(), via: 'live' };
  } catch {
    const saved = await readMubasherListing();
    if (!saved?.stocks?.length || Date.now() - Date.parse(saved.fetchedAt) > MUBASHER_LISTING_TRUSTED_FOR_MS) return null;
    return { stocks: saved.stocks, fetchedAt: saved.fetchedAt, via: 'upload' };
  }
}

// A new stock's price history doesn't change within a day, and the admin
// panel re-asks on every open.
const historyAnswers = new Map(); // code -> { at, value }
const HISTORY_ANSWER_TTL_MS = 24 * 60 * 60 * 1000;
/** Beyond this many new stocks something else is wrong (a feed changed shape) — don't fire requests per row. */
const HISTORY_CHECK_LIMIT = 25;

/**
 * How much price history exists for a stock that isn't in the universe yet,
 * and whether Yahoo is one of the feeds carrying it. Yahoo first, as the
 * fetch chain does (data/yahoo.js); TradingView's chart feed when Yahoo has
 * nothing and the screener lists the stock. A feed that answers with nothing
 * counts as no sessions — a registered listing that hasn't started trading.
 */
async function newStockHistory(code, onTradingView) {
  const cached = historyAnswers.get(code);
  if (cached && Date.now() - cached.at < HISTORY_ANSWER_TTL_MS) return cached.value;
  let bars = [];
  let yahoo = false;
  try {
    bars = (await fetchDaily(`${code}.CA`, { range: '2y' })).bars;
    yahoo = bars.length > 0;
  } catch {
    // not on Yahoo
  }
  if (!bars.length && onTradingView) {
    try {
      bars = (await fetchDailyTV(code)).bars;
    } catch {
      // listed on the screener, but no chart series behind it
    }
  }
  const value = { yahoo, sessions: bars.length, lastSession: bars.at(-1)?.date ?? null };
  historyAnswers.set(code, { at: Date.now(), value });
  return value;
}

/** The live report for this server: directories now, universe as loaded, history from the bar cache. */
export async function currentUniverseChanges() {
  const [tradingview, mubasher] = await Promise.all([cachedScreener(), mubasherListing()]);
  const history = new Map();
  for (const stock of UNIVERSE) {
    const cached = await readBars(stock.code);
    if (cached?.bars?.length) history.set(stock.code, { lastSession: cached.bars.at(-1).date, cachedAt: cached.cachedAt });
  }
  const changes = universeChanges({
    tradingview,
    mubasher: mubasher?.stocks ?? null,
    universe: UNIVERSE,
    rejected: UNIVERSE_META.rejected,
    historyOf: (code) => history.get(code) ?? null,
    today: cairoToday(),
  });
  const checkHistory = changes.added.length <= HISTORY_CHECK_LIMIT;
  const added = await Promise.all(
    changes.added.map(async (stock) => {
      const found = checkHistory ? await newStockHistory(stock.code, stock.sources.tradingview) : null;
      return {
        ...stock,
        sources: { ...stock.sources, yahoo: found ? found.yahoo : null },
        // null when not checked. The analysis needs minSessions of them — see checkQuality.
        sessions: found ? found.sessions : null,
        lastSession: found?.lastSession ?? null,
      };
    }),
  );
  return {
    added,
    removed: changes.removed,
    checkedAt: new Date().toISOString(),
    universeBuiltAt: UNIVERSE_META.generatedAt,
    tradingviewCount: tradingview.length,
    // null when Mubasher can't be reached and no recent upload exists.
    mubasher: mubasher && { count: mubasher.stocks.length, fetchedAt: mubasher.fetchedAt, via: mubasher.via },
    universeCount: UNIVERSE.length,
    removedAfterSessions: REMOVED_AFTER_SESSIONS,
    minSessions: MIN_USABLE_BARS,
  };
}
