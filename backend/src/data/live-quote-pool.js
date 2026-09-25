/**
 * The price source behind the desk ticker and a scan's held-position pricing:
 * oanor for subscribers, the free TradingView scrape for everyone else, and
 * TradingView again whenever oanor can't answer. The design, and the numbers
 * below, come from docs/adr/0001-live-prices-for-subscribers-via-oanor.md.
 *
 * This file only holds the logic; every dependency (the two feeds, the clock,
 * the market-hours check, where the quota count is stored, how the admin is
 * alerted) is passed in, so it runs in tests without Supabase or the network.
 * live-quotes.js builds the one real instance.
 */

import { OANOR_CLIENT_READY, OANOR_MAX_CODES_PER_CALL, OanorError } from './oanor.js';

const DEFAULTS = {
  /** A cached oanor quote serves every subscriber for this long — just under the 20s desk poll. */
  cacheTtlMs: 15_000,
  /** Codes that miss the cache are gathered this long, then fetched together. */
  coalesceMs: 250,
  /** Longest an oanor call may take before its codes fall back to TradingView. */
  timeoutMs: 4_000,
  /** How long a rate limit, 5xx or timeout keeps everyone on TradingView. */
  breakerMs: 60_000,
  /** Our own count stops calling oanor at this share of OANOR_MONTHLY_QUOTA. */
  quotaStopRatio: 0.95,
};

/**
 * The first day (YYYY-MM-DD, UTC) of the billing period `moment` falls in,
 * and the first day of the next one. A period starts on `billingDay` of each
 * month; billingDay is capped at 28 so every month has one.
 */
export function billingPeriod(moment, billingDay = 1) {
  const day = Math.min(Math.max(Math.trunc(billingDay) || 1, 1), 28);
  const date = new Date(moment);
  const year = date.getUTCFullYear();
  let month = date.getUTCMonth();
  if (date.getUTCDate() < day) month -= 1;
  const start = new Date(Date.UTC(year, month, day));
  const next = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, day));
  const iso = (d) => d.toISOString().slice(0, 10);
  return { start: iso(start), next: iso(next) };
}

const listEnv = (value) => String(value ?? '').split(',').map((s) => s.trim()).filter(Boolean);

/** The pool's config from OANOR_* variables (documented in live-quotes.js). */
export function liveQuotesConfigFromEnv(env = process.env, clientReady = OANOR_CLIENT_READY) {
  const requested = env.OANOR_ENABLED === '1';
  const apiKey = env.OANOR_API_KEY?.trim() || null;
  const quota = Number(env.OANOR_MONTHLY_QUOTA);
  const userIds = listEnv(env.OANOR_USER_IDS);
  return {
    requested,
    enabled: requested && Boolean(apiKey) && clientReady,
    apiKey,
    userIds: userIds.length ? new Set(userIds) : null,
    monthlyQuota: Number.isFinite(quota) && quota > 0 ? quota : null,
    billingDay: Number.parseInt(env.OANOR_BILLING_DAY ?? '1', 10) || 1,
    compare: env.OANOR_COMPARE === '1',
  };
}

const normalizeCodes = (codes) =>
  [...new Set((codes ?? []).map((code) => String(code).toUpperCase().replace(/^EGX:/, '').trim()))].filter(Boolean);

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new OanorError(`oanor timed out after ${ms}ms`, { kind: 'transient' })), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * @param {object} deps
 * @param {object} deps.config  { enabled, userIds: Set|null, monthlyQuota: number|null, billingDay, compare }
 * @param {(codes: string[]) => Promise<Map>} deps.fetchOanor  at most 20 codes; throws OanorError
 * @param {(codes: string[]) => Promise<Map>} deps.fetchTv
 * @param {() => boolean} deps.sessionOpen  is EGX trading right now
 * @param {{ load(periodStart): Promise<object|null>, save(periodStart, state): Promise<void> }} deps.usageStore
 * @param {(details: object) => Promise<void>} [deps.onRollback]  alerts the admin once per period
 */
export function createLiveQuotePool({
  config,
  fetchOanor,
  fetchTv,
  sessionOpen,
  usageStore,
  onRollback = async () => {},
  now = () => Date.now(),
  log = console,
  ...overrides
}) {
  const opts = { ...DEFAULTS, ...overrides };
  const cache = new Map(); // code -> { quote, at }
  const inflight = new Map(); // code -> promise of the batch fetching it
  let queued = new Set();
  let batchPromise = null;
  let breakerUntil = 0;
  let usage = null; // { periodStart, next, calls, rolledBack, exhaustedAt, reason, quota, alerted, alertedAt }
  let usageLoading = null;
  const stats = { oanorCalls: 0, oanorCodes: 0, cacheHits: 0, fromOanor: 0, fellBack: 0, rollbacks: 0, breakerOpens: 0 };

  const stopAt = () => (config.monthlyQuota ? Math.floor(config.monthlyQuota * opts.quotaStopRatio) : Infinity);

  function eligible({ subscribed, userId }) {
    if (!config.enabled) return false;
    // While the allowlist is set, it alone decides — it's how the owner (an
    // exempt admin, never "subscribed") tries oanor before anyone else.
    if (config.userIds) return userId != null && config.userIds.has(String(userId));
    return Boolean(subscribed);
  }

  async function loadUsage() {
    const period = billingPeriod(now(), config.billingDay);
    let stored = null;
    try {
      stored = await usageStore.load(period.start);
    } catch (err) {
      log.error('[oanor] reading the quota count failed; starting this period from 0:', err.message);
    }
    const state = {
      periodStart: period.start,
      next: period.next,
      calls: stored?.calls ?? 0,
      rolledBack: Boolean(stored?.exhaustedAt),
      exhaustedAt: stored?.exhaustedAt ?? null,
      alertedAt: stored?.alertedAt ?? null,
      reason: stored?.reason ?? null,
      quota: stored?.quota ?? null,
      alerted: Boolean(stored?.alertedAt),
    };
    // Raising OANOR_MONTHLY_QUOTA after an upgrade lifts the rollback right
    // away instead of waiting out the period.
    if (state.rolledBack && config.monthlyQuota && state.quota && config.monthlyQuota > state.quota) {
      state.rolledBack = false;
      state.reason = null;
      state.alerted = false;
      state.exhaustedAt = null;
      state.alertedAt = null;
    }
    return state;
  }

  /** The current period's usage, reloaded when a new period starts (which is what resets it). */
  async function currentUsage() {
    const { start } = billingPeriod(now(), config.billingDay);
    if (usage?.periodStart === start) return usage;
    usageLoading ??= loadUsage().then((state) => {
      usage = state;
      usageLoading = null;
      return state;
    });
    return usageLoading;
  }

  function saveUsage() {
    const state = usage;
    if (!state) return;
    usageStore
      .save(state.periodStart, {
        calls: state.calls,
        quota: state.quota ?? config.monthlyQuota ?? null,
        reason: state.reason,
        exhaustedAt: state.rolledBack ? state.exhaustedAt : null,
        alertedAt: state.alerted ? state.alertedAt : null,
      })
      .catch((err) => log.error('[oanor] saving the quota count failed:', err.message));
  }

  function rollBack(reason) {
    if (!usage || usage.rolledBack) return;
    usage.rolledBack = true;
    usage.exhaustedAt = new Date(now()).toISOString();
    usage.reason = reason;
    usage.quota = config.monthlyQuota ?? null;
    stats.rollbacks += 1;
    const details = {
      reason,
      callsUsed: usage.calls,
      quota: config.monthlyQuota ?? null,
      periodStart: usage.periodStart,
      resetsOn: usage.next,
    };
    log.error(
      `[oanor] quota ${reason === 'count' ? 'nearly used up by our count' : 'exhausted per oanor'}` +
        ` (${details.callsUsed}/${details.quota ?? '?'} calls); subscribers are on TradingView until ${details.resetsOn}`,
    );
    if (!usage.alerted) {
      usage.alerted = true;
      usage.alertedAt = new Date(now()).toISOString();
      onRollback(details).catch((err) => log.error('[oanor] quota alert failed:', err.message));
    }
    saveUsage();
  }

  function openBreaker(err) {
    const wasClosed = now() >= breakerUntil;
    breakerUntil = now() + opts.breakerMs;
    if (wasClosed) {
      stats.breakerOpens += 1;
      log.warn(`[oanor] ${err?.message ?? err}; subscribers are on TradingView for ${opts.breakerMs / 1000}s`);
    }
  }

  function compareWithTv(fetched) {
    const codes = [...fetched.keys()];
    fetchTv(codes)
      .then((tv) => {
        const gaps = codes
          .filter((code) => tv.get(code)?.price > 0)
          .map((code) => `${code}:${((fetched.get(code).price / tv.get(code).price - 1) * 100).toFixed(2)}%`);
        if (gaps.length) log.info(`[oanor] gap vs TradingView ${gaps.join(' ')}`);
      })
      .catch(() => {});
  }

  async function callChunk(chunk) {
    stats.oanorCalls += 1;
    stats.oanorCodes += chunk.length;
    try {
      const quotes = await withTimeout(fetchOanor(chunk), opts.timeoutMs);
      const fetched = new Map();
      for (const [code, quote] of quotes ?? []) {
        if (!(quote?.price > 0)) continue;
        const clean = {
          price: quote.price,
          change: quote.change ?? null,
          changePct: quote.changePct ?? null,
          // oanor has no per-quote timestamp; don't invent one from the request time.
          time: null,
        };
        cache.set(String(code).toUpperCase(), { quote: clean, at: now() });
        fetched.set(String(code).toUpperCase(), clean);
      }
      if (config.compare && fetched.size) compareWithTv(fetched);
    } catch (err) {
      if (err?.kind === 'quota') rollBack('oanor');
      else openBreaker(err);
    }
  }

  async function runBatch(codes) {
    const state = await currentUsage();
    const allowed = [];
    for (let i = 0; i < codes.length; i += OANOR_MAX_CODES_PER_CALL) {
      if (state.rolledBack || now() < breakerUntil) break;
      if (state.calls + 1 > stopAt()) {
        rollBack('count');
        break;
      }
      // Counted before the call goes out, so parallel chunks can't overshoot the stop.
      state.calls += 1;
      allowed.push(codes.slice(i, i + OANOR_MAX_CODES_PER_CALL));
    }
    if (!allowed.length) return;
    await Promise.all(allowed.map(callChunk));
    saveUsage();
  }

  function enqueue(code) {
    queued.add(code);
    if (!batchPromise) {
      batchPromise = new Promise((resolve) => {
        setTimeout(async () => {
          const batch = [...queued];
          queued = new Set();
          batchPromise = null; // codes arriving from here on start the next batch
          try {
            await runBatch(batch);
          } catch (err) {
            log.error('[oanor] batch failed:', err.message);
          } finally {
            for (const c of batch) inflight.delete(c);
            resolve();
          }
        }, opts.coalesceMs);
      });
    }
    inflight.set(code, batchPromise);
    return batchPromise;
  }

  const fresh = (code) => {
    const hit = cache.get(code);
    return hit && now() - hit.at < opts.cacheTtlMs ? hit.quote : null;
  };

  /** Whatever oanor can give for these codes right now; never throws. */
  async function fromOanor(codes) {
    const result = new Map();
    if (now() < breakerUntil) return result;
    const state = await currentUsage();
    if (state.rolledBack) return result;

    const missing = [];
    for (const code of codes) {
      const quote = fresh(code);
      if (quote) {
        stats.cacheHits += 1;
        result.set(code, quote);
      } else {
        missing.push(code);
      }
    }
    if (missing.length) {
      await Promise.all(missing.map((code) => inflight.get(code) ?? enqueue(code)));
      for (const code of missing) {
        const quote = fresh(code);
        if (quote) result.set(code, quote);
      }
    }
    return result;
  }

  /**
   * Latest quotes for `codes`, as Map<code, { price, change, changePct, time }> —
   * the same shape fetchLatestQuotes returns. Subscribers (or, during the
   * allowlist stage, allowlisted accounts) get oanor during the EGX session;
   * any code oanor doesn't answer for comes from TradingView in the same call,
   * silently. Everyone else, and everyone outside the session, gets TradingView
   * exactly as before — including its errors, which callers already handle.
   */
  async function fetchLiveQuotes(codes, { subscribed = false, userId = null } = {}) {
    const wanted = normalizeCodes(codes);
    if (!wanted.length) return new Map();
    if (!eligible({ subscribed, userId }) || !sessionOpen()) return fetchTv(wanted);

    const quotes = await fromOanor(wanted);
    stats.fromOanor += quotes.size;
    const rest = wanted.filter((code) => !quotes.has(code));
    if (rest.length) {
      stats.fellBack += rest.length;
      const tv = await fetchTv(rest).catch(() => new Map());
      for (const [code, quote] of tv) quotes.set(code, quote);
    }
    return quotes;
  }

  return {
    fetchLiveQuotes,
    /** Counters since start, for the rollout's measurements. */
    stats: () => ({ ...stats, callsThisPeriod: usage?.calls ?? null, rolledBack: usage?.rolledBack ?? false }),
  };
}
