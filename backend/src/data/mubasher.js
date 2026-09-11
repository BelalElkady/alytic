/**
 * Mubasher.info daily bars — last-resort fallback for EGX tickers with no
 * usable series on either Yahoo or TradingView. AIHC (Arabia Investments
 * Holding) is the case that motivated this: a real, currently-traded EGX
 * listing that TradingView's EGX feed simply doesn't carry.
 *
 * Undocumented and HTML-scraped, not a real API: each stock page embeds a
 * per-ticker historical-data CSV URL (a hash, not derivable from the ticker),
 * so this fetches the page first to find it, then fetches that CSV. Treat
 * every call as failure-prone, same caveat as tv-history.js, and keep this
 * strictly behind Yahoo and TradingView in the fallback chain.
 *
 * Bars come back in the same shape as yahoo.js/tv-history.js so callers
 * cannot tell the difference.
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const pageUrl = (code) => `https://english.mubasher.info/markets/EGX/stocks/${encodeURIComponent(code)}/`;

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

/**
 * Daily OHLCV bars for one EGX ticker, scraped from Mubasher's public stock page.
 * @param {string} code - plain ticker, e.g. 'AIHC'
 * @returns {Promise<{symbol:string,currency:string,longName:string|null,source:'mubasher',bars:Array}>}
 */
export async function fetchDailyMubasher(code) {
  const symbol = String(code).toUpperCase().replace(/^EGX:/, '');
  const page = await fetchText(pageUrl(symbol));

  const csvMatch = page.match(/historical-data-url="([^"]+)"/);
  if (!csvMatch) throw new Error(`Mubasher: no historical data URL for ${symbol}`);

  const titleMatch = page.match(/<title>([^<]*?)(?:\s*-\s*Mubasher Info)?<\/title>/i);
  const longName = titleMatch ? titleMatch[1].trim() : null;

  const csv = await fetchText(csvMatch[1]);
  const bars = [];
  for (const line of csv.split('\n')) {
    const cols = line.trim().split(',');
    if (cols.length < 6) continue;
    const date = cols[0].slice(0, 10);
    const [o, h, l, c, v] = cols.slice(1, 6).map(Number);
    // Pre-listing rows are all-zero placeholders, not real sessions.
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

  if (!deduped.length) throw new Error(`Mubasher: no usable bars for ${symbol}`);

  return { symbol, currency: 'EGP', longName, source: 'mubasher', bars: deduped };
}
