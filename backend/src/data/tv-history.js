/**
 * Daily OHLCV from TradingView's chart feed.
 *
 * This is the fallback for the ~62 EGX companies Yahoo does not carry at all —
 * QNBE, TAQA Arabia, Suez Cement, ENPPI, Ezz Dekheila, Misr Life Insurance and
 * others, several of them large. Yahoo returns nothing for their tickers, and
 * the ISIN symbols it does list carry a single quote with no series, so
 * indicators were impossible for roughly a quarter of the market.
 *
 * It speaks the websocket protocol behind TradingView's own charts. Two
 * consequences worth being explicit about:
 *   - It is undocumented and unsupported. Treat every call as failure-prone and
 *     keep Yahoo as the primary source where Yahoo actually works.
 *   - Requests are serialised with a delay between symbols. Hammering a public
 *     endpoint that exists for someone's web client is both rude and the
 *     fastest way to get blocked.
 *
 * Bars come back in the same shape as `yahoo.js` so callers cannot tell the
 * difference.
 */

const WS_URL = 'wss://data.tradingview.com/socket.io/websocket?from=chart%2F';
const ORIGIN = 'https://www.tradingview.com';

const frame = (obj) => {
  const s = JSON.stringify(obj);
  return `~m~${s.length}~m~${s}`;
};
const sessionId = (prefix) => prefix + Math.random().toString(36).slice(2, 14);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Cairo-local ISO date for a unix-seconds timestamp. */
const toCairoDate = (unix) =>
  new Date(unix * 1000).toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });

/**
 * Fetch daily bars for one EGX symbol.
 * @param {string} code - plain ticker, e.g. 'QNBE'
 * @param {object} [opts]
 * @param {number} [opts.bars=1500] - how many daily bars to request
 * @returns {Promise<{symbol:string,currency:string,bars:Array}>}
 */
export function fetchDailyTV(code, { bars = 1500, timeoutMs = 20000 } = {}) {
  return fetchSeriesTV(code, { resolution: '1D', bars, timeoutMs });
}

/**
 * Fetch bars of any timeframe for one EGX symbol — the shared core behind
 * fetchDailyTV, and what the chart's "today" / "1 week" views use.
 * @param {string} code - plain ticker, e.g. 'QNBE'
 * @param {object} opts
 * @param {string} opts.resolution - TradingView timeframe: '1D', or minutes as a string ('5', '15', '60')
 * @param {number} opts.bars - how many bars to request
 * @returns {Promise<{symbol:string,currency:string,bars:Array}>} for an intraday
 *   resolution every bar is kept; for '1D' a repeated session is collapsed.
 */
export function fetchSeriesTV(code, { resolution, bars, timeoutMs = 20000 }) {
  const symbol = `EGX:${String(code).toUpperCase().replace(/^EGX:/, '')}`;
  const intraday = resolution !== '1D';

  return new Promise((resolve, reject) => {
    let ws;
    try {
      ws = new WebSocket(WS_URL, { headers: { Origin: ORIGIN } });
    } catch (err) {
      return reject(new Error(`TradingView connect failed: ${err.message}`));
    }

    const chart = sessionId('cs_');
    let settled = false;

    const done = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch { /* already closing */ }
      err ? reject(err) : resolve(value);
    };
    const timer = setTimeout(() => done(new Error(`TradingView timeout for ${symbol}`)), timeoutMs);

    ws.onopen = () => {
      ws.send(frame({ m: 'set_auth_token', p: ['unauthorized_user_token'] }));
      ws.send(frame({ m: 'chart_create_session', p: [chart, ''] }));
      ws.send(frame({ m: 'resolve_symbol', p: [chart, 'sym_1', `={"symbol":"${symbol}","adjustment":"splits"}`] }));
      ws.send(frame({ m: 'create_series', p: [chart, 's1', 's1', 'sym_1', resolution, bars, ''] }));
    };

    ws.onmessage = (event) => {
      const data = typeof event.data === 'string' ? event.data : String(event.data);

      // Heartbeats must be echoed back verbatim or the server drops the socket.
      const beat = data.match(/~m~\d+~m~(~h~\d+)/);
      if (beat) {
        ws.send(`~m~${beat[1].length}~m~${beat[1]}`);
        return;
      }

      for (const match of data.matchAll(/~m~\d+~m~(\{.*?\})(?=~m~|$)/g)) {
        let msg;
        try { msg = JSON.parse(match[1]); } catch { continue; }

        if (msg.m === 'symbol_error' || msg.m === 'series_error' || msg.m === 'critical_error') {
          return done(new Error(`TradingView ${msg.m} for ${symbol}`));
        }

        if (msg.m === 'timescale_update') {
          const series = msg.p?.[1]?.s1?.s;
          if (!series?.length) continue;

          const out = [];
          for (const point of series) {
            // v = [time, open, high, low, close, volume]
            const [t, o, h, l, c, v] = point.v ?? [];
            if (![t, o, h, l, c].every(Number.isFinite)) continue;
            out.push({
              date: toCairoDate(t),
              t,
              o: +o,
              h: +Math.max(h, o, c),
              l: +Math.min(l, o, c),
              c: +c,
              v: Number.isFinite(v) ? Math.round(v) : 0,
            });
          }

          out.sort((a, b) => a.t - b.t);

          // Collapse any repeated session, keeping the later print. Intraday
          // bars share a date by design, so they are all kept.
          const deduped = [];
          for (const bar of out) {
            if (!intraday && deduped.length && deduped.at(-1).date === bar.date) deduped[deduped.length - 1] = bar;
            else deduped.push(bar);
          }

          if (!deduped.length) return done(new Error(`TradingView returned no usable bars for ${symbol}`));
          return done(null, { symbol, currency: 'EGP', longName: null, source: 'tradingview', bars: deduped });
        }
      }
    };

    ws.onerror = () => done(new Error(`TradingView socket error for ${symbol}`));
    ws.onclose = () => done(new Error(`TradingView closed before returning data for ${symbol}`));
  });
}

/**
 * Sequential fetch for several symbols. Deliberately not parallel — see the
 * note at the top of this file about being a good citizen on a public endpoint.
 */
export async function fetchDailyTVMany(codes, { bars = 1500, delayMs = 600, onProgress } = {}) {
  const data = new Map();
  const errors = new Map();

  for (const [i, code] of codes.entries()) {
    try {
      data.set(code, await fetchDailyTV(code, { bars }));
    } catch (err) {
      errors.set(code, err.message);
    }
    onProgress?.(i + 1, codes.length, code);
    if (i < codes.length - 1) await sleep(delayMs);
  }
  return { data, errors };
}

/**
 * Fetch current last-trade quotes for several EGX symbols in one session.
 * Some requested codes may never get a quote back (delisted, illiquid, or
 * simply not covered by TradingView's EGX feed even though EGX itself lists
 * them) — that would otherwise pin every call to the full `timeoutMs`
 * waiting for a symbol that's never coming, so we also finish early once
 * `idleMs` passes with no new quote arriving.
 */
export function fetchLatestQuotes(codes, { timeoutMs = 15000, idleMs = 2000 } = {}) {
  const wanted = [...new Set(codes.map((code) => String(code).toUpperCase().replace(/^EGX:/, '')))].filter(Boolean);
  if (!wanted.length) return Promise.resolve(new Map());

  return new Promise((resolve) => {
    let ws;
    const quotes = new Map();
    let settled = false;
    let idleTimer;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(idleTimer);
      try { ws?.close(); } catch { /* already closed */ }
      resolve(quotes);
    };
    const timer = setTimeout(finish, timeoutMs);
    const resetIdleTimer = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(finish, idleMs);
    };

    try {
      ws = new WebSocket(WS_URL, { headers: { Origin: ORIGIN } });
    } catch {
      finish();
      return;
    }

    ws.onopen = () => {
      const session = sessionId('qs_');
      ws.send(frame({ m: 'set_auth_token', p: ['unauthorized_user_token'] }));
      ws.send(frame({ m: 'quote_create_session', p: [session, ''] }));
      ws.send(frame({ m: 'quote_set_fields', p: [session, 'lp', 'ch', 'chp', 'lp_time', 'short_name', 'description'] }));
      for (const code of wanted) ws.send(frame({ m: 'quote_add_symbols', p: [session, `EGX:${code}`] }));
    };

    ws.onmessage = (event) => {
      const data = typeof event.data === 'string' ? event.data : String(event.data);
      const beat = data.match(/~m~\d+~m~(~h~\d+)/);
      if (beat) {
        ws.send(`~m~${beat[1].length}~m~${beat[1]}`);
        return;
      }
      for (const match of data.matchAll(/~m~\d+~m~(\{.*?\})(?=~m~|$)/g)) {
        let message;
        try { message = JSON.parse(match[1]); } catch { continue; }
        if (message.m !== 'qsd') continue;
        const value = message.p?.[1]?.v;
        const code = String(message.p?.[1]?.n ?? '').replace(/^EGX:/, '');
        if (code && Number.isFinite(value?.lp)) {
          quotes.set(code, { price: value.lp, change: value.ch ?? null, changePct: value.chp ?? null, time: value.lp_time ?? null });
          resetIdleTimer();
        }
        if (quotes.size >= wanted.length) finish();
      }
    };
    ws.onerror = finish;
    ws.onclose = () => { if (!settled) finish(); };
  });
}
