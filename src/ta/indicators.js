/**
 * Technical indicators.
 *
 * Every function returns an array the same length as its input, with `null`
 * through the warm-up window, so results stay index-aligned with the bar series
 * and can be zipped together without offset bookkeeping.
 *
 * Wilder's smoothing (RSI, ATR, ADX) is implemented as Wilder defined it —
 * seeded with a simple average of the first `period` values, then
 * `prev + (x - prev) / period`. This is NOT the same as an EMA with
 * `2/(period+1)`; using the EMA form makes RSI read several points off, which
 * matters when a rule triggers at 70.
 */

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

/** Last non-null element of an indicator array. */
export function last(arr) {
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return arr[i];
  return null;
}

/** Element `n` bars back from the end (0 = last). */
export function at(arr, n = 0) {
  return arr[arr.length - 1 - n] ?? null;
}

export function sma(values, period) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    if (!isNum(values[i])) return out;
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(values, period) {
  const out = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i];
  let prev = seed / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = (values[i] - prev) * k + prev;
    out[i] = prev;
  }
  return out;
}

/** Wilder's smoothing — the basis of RSI/ATR/ADX. */
export function wilder(values, period) {
  const out = new Array(values.length).fill(null);
  if (values.length < period) return out;
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i];
  let prev = seed / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = prev + (values[i] - prev) / period;
    out[i] = prev;
  }
  return out;
}

export function rsi(closes, period = 14) {
  const out = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;

  const gains = [];
  const losses = [];
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gains.push(Math.max(d, 0));
    losses.push(Math.max(-d, 0));
  }

  const ag = wilder(gains, period);
  const al = wilder(losses, period);
  for (let i = 0; i < gains.length; i++) {
    if (ag[i] == null || al[i] == null) continue;
    // A period of pure gains has zero average loss — RSI is 100 by definition,
    // not NaN from the division.
    out[i + 1] = al[i] === 0 ? 100 : 100 - 100 / (1 + ag[i] / al[i]);
  }
  return out;
}

export function macd(closes, fast = 12, slow = 26, signalPeriod = 9) {
  const ef = ema(closes, fast);
  const es = ema(closes, slow);
  const line = closes.map((_, i) => (ef[i] != null && es[i] != null ? ef[i] - es[i] : null));

  const firstIdx = line.findIndex((v) => v != null);
  const signal = new Array(closes.length).fill(null);
  const hist = new Array(closes.length).fill(null);

  if (firstIdx !== -1) {
    const compact = line.slice(firstIdx);
    const sig = ema(compact, signalPeriod);
    for (let i = 0; i < sig.length; i++) {
      if (sig[i] == null) continue;
      signal[firstIdx + i] = sig[i];
      hist[firstIdx + i] = line[firstIdx + i] - sig[i];
    }
  }
  return { line, signal, hist };
}

export function trueRange(bars) {
  return bars.map((b, i) => {
    if (i === 0) return b.h - b.l;
    const pc = bars[i - 1].c;
    return Math.max(b.h - b.l, Math.abs(b.h - pc), Math.abs(b.l - pc));
  });
}

export function atr(bars, period = 14) {
  return wilder(trueRange(bars), period);
}

export function bollinger(closes, period = 20, mult = 2) {
  const mid = sma(closes, period);
  const upper = new Array(closes.length).fill(null);
  const lower = new Array(closes.length).fill(null);
  const bandwidth = new Array(closes.length).fill(null);
  const pctB = new Array(closes.length).fill(null);

  for (let i = period - 1; i < closes.length; i++) {
    if (mid[i] == null) continue;
    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) variance += (closes[j] - mid[i]) ** 2;
    const sd = Math.sqrt(variance / period);
    upper[i] = mid[i] + mult * sd;
    lower[i] = mid[i] - mult * sd;
    bandwidth[i] = mid[i] === 0 ? null : ((upper[i] - lower[i]) / mid[i]) * 100;
    const span = upper[i] - lower[i];
    pctB[i] = span === 0 ? 0.5 : (closes[i] - lower[i]) / span;
  }
  return { upper, mid, lower, bandwidth, pctB };
}

export function stochastic(bars, kPeriod = 14, dPeriod = 3) {
  const k = new Array(bars.length).fill(null);
  for (let i = kPeriod - 1; i < bars.length; i++) {
    let hh = -Infinity;
    let ll = Infinity;
    for (let j = i - kPeriod + 1; j <= i; j++) {
      hh = Math.max(hh, bars[j].h);
      ll = Math.min(ll, bars[j].l);
    }
    k[i] = hh === ll ? 50 : ((bars[i].c - ll) / (hh - ll)) * 100;
  }
  const compactStart = k.findIndex((v) => v != null);
  const d = new Array(bars.length).fill(null);
  if (compactStart !== -1) {
    const smoothed = sma(k.slice(compactStart), dPeriod);
    for (let i = 0; i < smoothed.length; i++) if (smoothed[i] != null) d[compactStart + i] = smoothed[i];
  }
  return { k, d };
}

/** Average Directional Index with the +DI / -DI pair. */
export function adx(bars, period = 14) {
  const n = bars.length;
  const empty = () => new Array(n).fill(null);
  if (n < period * 2) return { adx: empty(), plusDI: empty(), minusDI: empty() };

  const tr = [];
  const plusDM = [];
  const minusDM = [];
  for (let i = 1; i < n; i++) {
    const up = bars[i].h - bars[i - 1].h;
    const down = bars[i - 1].l - bars[i].l;
    plusDM.push(up > down && up > 0 ? up : 0);
    minusDM.push(down > up && down > 0 ? down : 0);
    const pc = bars[i - 1].c;
    tr.push(Math.max(bars[i].h - bars[i].l, Math.abs(bars[i].h - pc), Math.abs(bars[i].l - pc)));
  }

  const strS = wilder(tr, period);
  const plusS = wilder(plusDM, period);
  const minusS = wilder(minusDM, period);

  const plusDI = empty();
  const minusDI = empty();
  const dx = [];
  for (let i = 0; i < tr.length; i++) {
    if (strS[i] == null || strS[i] === 0) {
      dx.push(null);
      continue;
    }
    const p = (plusS[i] / strS[i]) * 100;
    const m = (minusS[i] / strS[i]) * 100;
    plusDI[i + 1] = p;
    minusDI[i + 1] = m;
    dx.push(p + m === 0 ? 0 : (Math.abs(p - m) / (p + m)) * 100);
  }

  const dxStart = dx.findIndex((v) => v != null);
  const adxArr = empty();
  if (dxStart !== -1) {
    const smoothed = wilder(dx.slice(dxStart).filter((v) => v != null), period);
    for (let i = 0; i < smoothed.length; i++) {
      if (smoothed[i] != null) adxArr[dxStart + i + 1] = smoothed[i];
    }
  }
  return { adx: adxArr, plusDI, minusDI };
}

/** On-balance volume. Flat closes contribute nothing, per Granville. */
export function obv(bars) {
  const out = new Array(bars.length).fill(null);
  let acc = 0;
  out[0] = 0;
  for (let i = 1; i < bars.length; i++) {
    if (bars[i].c > bars[i - 1].c) acc += bars[i].v;
    else if (bars[i].c < bars[i - 1].c) acc -= bars[i].v;
    out[i] = acc;
  }
  return out;
}

export function roc(values, period) {
  return values.map((v, i) => {
    if (i < period) return null;
    const base = values[i - period];
    return base === 0 ? null : ((v - base) / base) * 100;
  });
}

export function donchian(bars, period = 20) {
  const upper = new Array(bars.length).fill(null);
  const lower = new Array(bars.length).fill(null);
  for (let i = period - 1; i < bars.length; i++) {
    let hh = -Infinity;
    let ll = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      hh = Math.max(hh, bars[j].h);
      ll = Math.min(ll, bars[j].l);
    }
    upper[i] = hh;
    lower[i] = ll;
  }
  return { upper, lower };
}

/** Volume relative to its own `period` average — 1.0 means an average session. */
export function relativeVolume(bars, period = 20) {
  const vols = bars.map((b) => b.v);
  const avg = sma(vols, period);
  return vols.map((v, i) => (avg[i] ? v / avg[i] : null));
}

/**
 * Slope of a least-squares fit over the trailing `period`, expressed as
 * percent-per-bar so it is comparable across stocks at any price level.
 */
export function linregSlopePct(values, period = 20) {
  const out = new Array(values.length).fill(null);
  const xMean = (period - 1) / 2;
  let sxx = 0;
  for (let i = 0; i < period; i++) sxx += (i - xMean) ** 2;

  for (let i = period - 1; i < values.length; i++) {
    let yMean = 0;
    for (let j = 0; j < period; j++) yMean += values[i - period + 1 + j];
    yMean /= period;
    if (yMean === 0) continue;
    let sxy = 0;
    for (let j = 0; j < period; j++) sxy += (j - xMean) * (values[i - period + 1 + j] - yMean);
    out[i] = ((sxy / sxx) / yMean) * 100;
  }
  return out;
}

/** Annualised volatility from daily log returns (EGX trades ~248 sessions/yr). */
export function historicalVolatility(closes, period = 20, sessionsPerYear = 248) {
  const out = new Array(closes.length).fill(null);
  const rets = [null];
  for (let i = 1; i < closes.length; i++) rets.push(Math.log(closes[i] / closes[i - 1]));

  for (let i = period; i < closes.length; i++) {
    const win = rets.slice(i - period + 1, i + 1);
    const mean = win.reduce((a, b) => a + b, 0) / period;
    const variance = win.reduce((a, b) => a + (b - mean) ** 2, 0) / (period - 1);
    out[i] = Math.sqrt(variance * sessionsPerYear) * 100;
  }
  return out;
}

/** Max drawdown over the whole series, as a negative percent. */
export function maxDrawdown(closes) {
  let peak = -Infinity;
  let worst = 0;
  for (const c of closes) {
    peak = Math.max(peak, c);
    worst = Math.min(worst, (c - peak) / peak);
  }
  return worst * 100;
}
