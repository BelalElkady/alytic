/**
 * StockAnalysis.com daily bars — fallback behind Mubasher for EGX tickers no
 * other source can serve. Mubasher carries AIHC but its Cloudflare rules
 * answer 403 to the production VPS; StockAnalysis serves the same series to
 * that same IP.
 *
 * Undocumented and HTML-scraped, not a real API: the history page embeds its
 * table as a JS object literal (`{a:.813,c:.813,h:.848,l:.813,o:.83,t:"2026-09-13",v:71726428,ch:-2.05}`),
 * roughly the last six months of sessions — enough for the 60-bar quality
 * gate, not for a 200-day average. Treat every call as failure-prone, same
 * caveat as mubasher.js, and keep this last in the fallback chain.
 *
 * Bars come back in the same shape as yahoo.js/tv-history.js/mubasher.js so
 * callers cannot tell the difference.
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const historyUrl = (code) => `https://stockanalysis.com/quote/egx/${encodeURIComponent(code.toLowerCase())}/history/`;

async function fetchText(url, { timeoutMs = 20000, retries = 1 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: ac.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await new Promise((r) => setTimeout(r, 500));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

/** Parses one embedded `{k:v,...}` bar literal; values are numbers or quoted strings. */
function parseRow(literal) {
  const row = {};
  for (const [, key, str, num] of literal.matchAll(/(\w+):(?:"([^"]*)"|(-?[\d.]+(?:e[+-]?\d+)?))/gi)) {
    row[key] = str ?? Number(num);
  }
  return row;
}

/**
 * Daily OHLCV bars for one EGX ticker, scraped from StockAnalysis's history page.
 * @param {string} code - plain ticker, e.g. 'AIHC'
 * @returns {Promise<{symbol:string,currency:string,longName:string|null,source:'stockanalysis',bars:Array}>}
 */
export async function fetchDailyStockAnalysis(code) {
  const symbol = String(code).toUpperCase().replace(/^EGX:/, '');
  const page = await fetchText(historyUrl(symbol));

  const titleMatch = page.match(/<title>([^<(]*?)\s*\(EGX:/i);
  const longName = titleMatch ? titleMatch[1].trim() : null;

  const bars = [];
  for (const [literal] of page.matchAll(/\{[^{}]*\bt:"\d{4}-\d{2}-\d{2}"[^{}]*\}/g)) {
    const { t: date, o, h, l, c, v } = parseRow(literal);
    if (![o, h, l, c].every(Number.isFinite) || (o === 0 && h === 0 && l === 0 && c === 0)) continue;
    const t = Math.floor(new Date(`${date}T00:00:00Z`).getTime() / 1000);
    if (!Number.isFinite(t)) continue;
    bars.push({ date, t, o, h: Math.max(h, o, c), l: Math.min(l, o, c), c, v: Number.isFinite(v) ? Math.round(v) : 0 });
  }

  bars.sort((a, b) => a.t - b.t);
  const deduped = [];
  for (const bar of bars) {
    if (deduped.length && deduped[deduped.length - 1].date === bar.date) deduped[deduped.length - 1] = bar;
    else deduped.push(bar);
  }

  if (!deduped.length) throw new Error(`StockAnalysis: no usable bars for ${symbol}`);

  return { symbol, currency: 'EGP', longName, source: 'stockanalysis', bars: deduped };
}
