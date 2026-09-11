/**
 * Yahoo chart-API client for EGX daily bars.
 *
 * Two hard-won rules encoded here, both verified against live EGX responses:
 *
 *  1. NEVER trust `meta.regularMarketPrice`. For EGX symbols Yahoo merges the
 *     equity with same-named mutual funds — COMI.CA reports `regularMarketPrice:
 *     81.2` and `instrumentType: MUTUALFUND` while the actual close in the same
 *     payload is 142.00. Only `indicators.quote[0]` is trustworthy.
 *
 *  2. The most recent timestamp is routinely present with all-null OHLCV (the
 *     session is open, or hasn't started). Those rows must be dropped, not
 *     forward-filled, or every indicator inherits a phantom bar.
 */

const HOSTS = ['https://query2.finance.yahoo.com', 'https://query1.finance.yahoo.com'];
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/** Cairo-local ISO date (YYYY-MM-DD) for a unix-seconds timestamp. */
function toCairoDate(unixSeconds) {
  return new Date(unixSeconds * 1000).toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
}

async function fetchJson(url, { timeoutMs = 20000, retries = 2 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: ac.signal });
      const body = await res.json();
      if (!res.ok && !body?.chart) throw new Error(`HTTP ${res.status}`);
      return body;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

/**
 * Daily OHLCV bars, oldest first, with incomplete rows removed.
 * @returns {Promise<{symbol:string,currency:string,bars:Array<{date:string,t:number,o:number,h:number,l:number,c:number,v:number}>}>}
 */
export async function fetchDaily(yahooSymbol, { range = '2y' } = {}) {
  let body, lastErr;
  for (const host of HOSTS) {
    try {
      body = await fetchJson(`${host}/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?range=${range}&interval=1d`);
      if (body?.chart?.result?.[0]) break;
      lastErr = new Error(body?.chart?.error?.description ?? 'empty result');
    } catch (err) {
      lastErr = err;
    }
  }

  const result = body?.chart?.result?.[0];
  if (!result) throw new Error(`no data for ${yahooSymbol}: ${lastErr?.message ?? 'unknown'}`);

  const ts = result.timestamp ?? [];
  const q = result.indicators?.quote?.[0] ?? {};
  const bars = [];

  for (let i = 0; i < ts.length; i++) {
    const c = q.close?.[i];
    // Rule 2: a bar with no close is not a bar. Volume may legitimately be 0
    // on a thin EGX session, so it is defaulted rather than used as a filter.
    if (c == null || !Number.isFinite(c)) continue;
    const o = q.open?.[i] ?? c;
    const h = q.high?.[i] ?? c;
    const l = q.low?.[i] ?? c;
    if (![o, h, l].every(Number.isFinite)) continue;
    bars.push({
      date: toCairoDate(ts[i]),
      t: ts[i],
      o: +o,
      h: +Math.max(h, o, c),
      l: +Math.min(l, o, c),
      c: +c,
      v: Number.isFinite(q.volume?.[i]) ? q.volume[i] : 0,
    });
  }

  // Yahoo occasionally repeats the latest session across two timestamps.
  const deduped = [];
  for (const bar of bars) {
    if (deduped.length && deduped[deduped.length - 1].date === bar.date) deduped[deduped.length - 1] = bar;
    else deduped.push(bar);
  }

  if (!deduped.length) throw new Error(`no usable bars for ${yahooSymbol}`);

  return {
    symbol: yahooSymbol,
    currency: result.meta?.currency ?? 'EGP',
    longName: result.meta?.longName ?? result.meta?.shortName ?? null,
    bars: deduped,
  };
}

/**
 * Daily bars for an EGX ticker, from whichever source can actually serve it.
 *
 * Yahoo is tried first — it has the deepest history where it has any (up to 5
 * years vs TradingView's ~1500 bars) and needs no websocket. But it carries
 * nothing at all for roughly 62 EGX companies, several of them large (QNBE,
 * TAQA Arabia, Suez Cement, ENPPI). For those, and for symbols where Yahoo
 * serves a dead series, TradingView's chart feed is the fallback. A handful of
 * real EGX listings (e.g. AIHC) sit outside TradingView's EGX coverage too —
 * Mubasher's scraped stock-page CSV is the last resort for those.
 *
 * @param {string} code - plain ticker, e.g. 'QNBE'
 * @param {object} [opts]
 * @param {string} [opts.yahooSymbol] - override, e.g. an ISIN-based symbol
 * @param {number} [opts.minBars=60] - below this, Yahoo is treated as a miss
 */
export async function fetchDailyAuto(code, { range = '2y', yahooSymbol = null, minBars = 60, source = null } = {}) {
  const symbol = yahooSymbol ?? `${String(code).toUpperCase()}.CA`;

  // The universe records which feed actually serves each stock, so a known
  // TradingView-only name skips the Yahoo round-trip entirely — across a
  // 234-stock scan that is 39 pointless requests and several seconds saved.
  if (source !== 'tradingview') {
    try {
      const result = await fetchDaily(symbol, { range });
      if (result.bars.length >= minBars) return { ...result, source: 'yahoo' };
    } catch {
      // fall through to the fallback
    }
  }

  const { fetchDailyTV } = await import('./tv-history.js');
  try {
    return await fetchDailyTV(code);
  } catch (tvErr) {
    const { fetchDailyMubasher } = await import('./mubasher.js');
    try {
      return await fetchDailyMubasher(code);
    } catch (mbErr) {
      throw new Error(`${tvErr.message}; mubasher: ${mbErr.message}`);
    }
  }
}

/** Fetch many symbols with bounded concurrency; failures are reported, never thrown. */
export async function fetchDailyMany(symbols, { range = '2y', concurrency = 4, onProgress } = {}) {
  const out = new Map();
  const errors = new Map();
  const queue = [...symbols];

  async function worker() {
    while (queue.length) {
      const sym = queue.shift();
      try {
        out.set(sym, await fetchDaily(sym, { range }));
      } catch (err) {
        errors.set(sym, err.message);
      }
      onProgress?.(symbols.length - queue.length, symbols.length, sym);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, symbols.length) }, worker));
  return { data: out, errors };
}

/** EGX30 spot. Yahoo serves `^CASE30` as a single quote — it has no usable history. */
export async function fetchEgx30Spot() {
  try {
    const body = await fetchJson(`${HOSTS[0]}/v8/finance/chart/%5ECASE30?range=1d&interval=1d`);
    const meta = body?.chart?.result?.[0]?.meta;
    if (!meta?.regularMarketPrice) return null;
    return {
      value: meta.regularMarketPrice,
      changePct: meta.regularMarketChangePercent ?? null,
      asOf: meta.regularMarketTime ? toCairoDate(meta.regularMarketTime) : null,
    };
  } catch {
    return null;
  }
}
