/**
 * The market scan, run on a schedule and shared by every User.
 *
 * For a stock the User doesn't hold, nothing in a scan's analysis depends on
 * the User: the engine reads the stock's bars, the stop plan is already shared
 * per (stock, style, day), and the position-sized numbers are rebuilt from the
 * User's own capital afterwards (see runScan in api/server.js). Only the
 * Investing style and the Shariah filter change the answer — together, a
 * "variant" here.
 *
 * So the whole universe is analysed once per variant on a schedule
 * (startMarketScanScheduler in api/server.js) and every scan reads that:
 *
 * - during the session, every 30 minutes, with each fresh buy planned at the
 *   live price (planAtLive in analyze.js) so entries follow the market;
 * - after the close, until a run carries that session's final close;
 * - never on a non-trading day — the last run stands until the next session.
 *
 * A variant with nothing stored yet (a fresh process, or a style the schedule
 * hasn't met) is built once on demand. In-process by design: the schedulers
 * already live in this always-on process, and a restart costs one cold build.
 *
 * The prices a scan displays are separate and fresher: latestQuotesShared
 * below, at most QUOTE_TTL_MS old.
 */

import { analyzeMany } from './analyze.js';
import { egxSessionOpen } from './data/cache.js';
import { fetchLatestQuotes } from './data/tv-history.js';
import { fetchFundamentals } from './data/tradingview.js';
import { ALL_CODES } from './config/universe.js';
import { STYLE_KEYS, rulesForStyle } from './config/styles.js';
import RULES from './config/rules.js';

/** Stand-in capital: runScan resizes every non-held row from the User's own. */
const SHARED_CAPITAL = 1_000_000;

/** How old a live quote shown on a scan can be. */
const QUOTE_TTL_MS = 30 * 1000;

/**
 * The rules a scan runs under — the one place the Investing style and the
 * Shariah filter are turned into rule numbers, for runScan and the schedule alike.
 * @param {string} [style] - a STYLE_KEYS key, or none for the base rules
 * @param {boolean} shariahOnly - the Portfolio's setting (on unless turned off)
 */
export function scanRules(style, shariahOnly) {
  const rules = style ? rulesForStyle(RULES, style) : RULES;
  if (shariahOnly) return rules;
  return { ...rules, shariah: { ...rules.shariah, excludeNonCompliant: false } };
}

const variantKey = (style, shariahOnly) => `${style ?? ''}|${shariahOnly ? 1 : 0}`;
const parseVariant = (key) => {
  const [style, shariah] = key.split('|');
  return { style: style || undefined, shariahOnly: shariah === '1' };
};
/** Built on every scheduled run, whether or not anyone has asked yet. */
const SCHEDULED_VARIANTS = STYLE_KEYS.flatMap((style) => [true, false].map((shariahOnly) => variantKey(style, shariahOnly)));

/** variantKey -> { builtAt, asOf, live, byCode: Map<CODE, result>, errors: Map<CODE, error> } */
const scans = new Map();
/** variantKey -> Promise of the build in progress, so nothing builds a variant twice at once. */
const building = new Map();

const latestAsOf = (results) => results.reduce((max, r) => (r.asOf && r.asOf > max ? r.asOf : max), '') || null;

function analyzeVariant(codes, { style, shariahOnly }, { quotes, fundamentals, force = false }) {
  return analyzeMany(codes, {
    capital: SHARED_CAPITAL,
    // AI-backed (see agent/stopPlanner.js) — kept low so a cold build doesn't
    // fire dozens of simultaneous OpenRouter requests at once.
    concurrency: 3,
    rules: scanRules(style, shariahOnly),
    style,
    fundamentals,
    force,
    // Quotes only while the session is open; otherwise an empty map keeps
    // every plan on the last close.
    liveQuotes: quotes ?? new Map(),
    planAtLive: Boolean(quotes),
  });
}

function buildVariant(key, context) {
  if (building.has(key)) return building.get(key);
  const task = (async () => {
    const { results, errors } = await analyzeVariant(ALL_CODES, parseVariant(key), context);
    const scan = {
      builtAt: new Date().toISOString(),
      asOf: latestAsOf(results),
      live: Boolean(context.quotes),
      byCode: new Map(results.map((r) => [String(r.code).toUpperCase(), r])),
      errors: new Map(errors.map((e) => [String(e.code).toUpperCase(), e])),
    };
    scans.set(key, scan);
    return scan;
  })();
  building.set(key, task);
  return task.finally(() => building.delete(key));
}

/** What every variant of one run shares: the universe's quotes (in session) and fundamentals. */
async function runContext(live) {
  const [quotes, fundamentals] = await Promise.all([
    live ? fetchLatestQuotes(ALL_CODES).catch(() => new Map()) : null,
    fetchFundamentals(),
  ]);
  return { quotes, fundamentals };
}

/**
 * One scheduled run: rebuilds every scheduled variant, plus any other one a
 * scan has asked for, one after another so a run never multiplies the load.
 * A variant that fails keeps its previous run.
 * @param {{ live: boolean }} opts - true while the session is open
 * @returns {Promise<{ live: boolean, asOf: string|null, built: number, failed: number }>}
 */
export async function refreshMarketScans({ live }) {
  const context = await runContext(live);
  const keys = [...new Set([...SCHEDULED_VARIANTS, ...scans.keys()])];
  let asOf = null;
  let failed = 0;
  for (const key of keys) {
    try {
      const scan = await buildVariant(key, context);
      if (scan.asOf && (!asOf || scan.asOf < asOf)) asOf = scan.asOf;
    } catch (err) {
      failed++;
      console.error(`[market-scan] ${key} failed:`, err.message);
    }
  }
  // The oldest variant's close: the run only "has" a session once all do.
  return { live, asOf, built: keys.length - failed, failed };
}

/** The caller (runScan) rewrites plan.sizing, so each caller gets its own plan object. */
const forCaller = (result) => ({ ...result, plan: { ...result.plan } });

/**
 * The scheduled analysis of these (non-held) stocks for this variant — the
 * same `{ results, errors }` shape analyzeMany returns.
 *
 * @param {string[]} codes
 * @param {object} opts
 * @param {string} [opts.style]
 * @param {boolean} opts.shariahOnly
 * @param {boolean} [opts.force] - skip the stored run and analyse now, re-fetching bars
 */
export async function sharedAnalyses(codes, { style, shariahOnly, force = false }) {
  const key = variantKey(style, shariahOnly);
  if (force) {
    const context = await runContext(egxSessionOpen());
    return analyzeVariant(codes, { style, shariahOnly }, { ...context, force: true });
  }

  const scan = scans.get(key) ?? (await (building.get(key) ?? buildVariant(key, await runContext(egxSessionOpen()))));
  const results = [];
  const errors = [];
  const missing = [];
  for (const code of codes) {
    const upper = String(code).toUpperCase();
    const result = scan.byCode.get(upper);
    if (result) results.push(forCaller(result));
    else if (scan.errors.has(upper)) errors.push(scan.errors.get(upper));
    else missing.push(code);
  }

  // A stock the run didn't cover (added to the universe since): analysed now,
  // the same way, and kept with the run until the next one replaces it.
  if (missing.length) {
    const extra = await analyzeVariant(missing, { style, shariahOnly }, await runContext(scan.live && egxSessionOpen()));
    for (const r of extra.results) {
      scan.byCode.set(String(r.code).toUpperCase(), r);
      results.push(forCaller(r));
    }
    for (const e of extra.errors) {
      scan.errors.set(String(e.code).toUpperCase(), e);
      errors.push(e);
    }
  }

  results.sort((a, b) => b.technical.score - a.technical.score);
  return { results, errors, builtAt: scan.builtAt };
}

/** CODE -> { at, quote } — `quote` is null for a code the feed had nothing for. */
const quotes = new Map();
/** CODE -> Promise<Map> of the fetch that is bringing it in. */
const quotesPending = new Map();

/**
 * fetchLatestQuotes() shared across scans for QUOTE_TTL_MS. Each uncached fetch
 * is a fresh websocket session that waits for every symbol (or the idle
 * timeout), which was a fixed cost on every scan whatever else was cached.
 * A code the feed never quotes is remembered as such for the same window, so
 * it can't pin each scan to the idle timeout.
 */
export async function latestQuotesShared(codes) {
  const wanted = [...new Set(codes.map((code) => String(code).toUpperCase()))];
  const now = Date.now();
  const out = new Map();
  const missing = [];
  const waiting = [];
  for (const code of wanted) {
    const hit = quotes.get(code);
    if (hit && now - hit.at < QUOTE_TTL_MS) {
      if (hit.quote) out.set(code, hit.quote);
      continue;
    }
    const inFlight = quotesPending.get(code);
    if (inFlight) waiting.push(inFlight);
    else missing.push(code);
  }

  if (missing.length) {
    const fetched = fetchLatestQuotes(missing)
      .catch(() => new Map())
      .then((map) => {
        const at = Date.now();
        for (const code of missing) quotes.set(code, { at, quote: map.get(code) ?? null });
        return map;
      })
      .finally(() => {
        for (const code of missing) quotesPending.delete(code);
      });
    for (const code of missing) quotesPending.set(code, fetched);
    waiting.push(fetched);
  }

  for (const map of await Promise.all(waiting)) {
    for (const code of wanted) {
      const quote = map.get(code);
      if (quote) out.set(code, quote);
    }
  }
  return out;
}
