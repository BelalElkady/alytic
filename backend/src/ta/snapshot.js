/**
 * Builds the structured technical snapshot for one ticker.
 *
 * This is the object the AI analyst reasons over. Everything in it is computed
 * arithmetically — the model is never asked to calculate an indicator, only to
 * weigh signals that already disagree with each other. Keeping that boundary
 * sharp is what makes the output reproducible: the same bars always yield the
 * same snapshot, and only the narrative layer varies.
 */

import {
  sma, ema, rsi, macd, atr, closeAtr, bollinger, stochastic, adx, obv, roc,
  donchian, relativeVolume, linregSlopePct, historicalVolatility, maxDrawdown,
  last, at,
} from './indicators.js';
import { buildLevels, findPivots } from './levels.js';

const r2 = (x) => (x == null ? null : +x.toFixed(2));
const r1 = (x) => (x == null ? null : +x.toFixed(1));

/** Percent return over `n` sessions. */
function periodReturn(closes, n) {
  if (closes.length <= n) return null;
  const from = closes[closes.length - 1 - n];
  return from ? +(((closes[closes.length - 1] - from) / from) * 100).toFixed(2) : null;
}

/**
 * Trend classification from the moving-average stack, ADX and regression slope.
 * Returns a label plus a -100..100 score so it can feed the numeric scorer.
 */
function classifyTrend({ price, ma20, ma50, ma200, adxVal, plusDI, minusDI, slope20, slope50 }) {
  let score = 0;

  if (ma20 != null && ma50 != null && ma200 != null) {
    if (price > ma20 && ma20 > ma50 && ma50 > ma200) score += 40;      // full bullish stack
    else if (price < ma20 && ma20 < ma50 && ma50 < ma200) score -= 40; // full bearish stack
    else {
      if (price > ma50) score += 12;
      else score -= 12;
      if (ma50 > ma200) score += 10;
      else score -= 10;
    }
  } else if (ma20 != null && ma50 != null) {
    score += price > ma20 && ma20 > ma50 ? 25 : price < ma20 && ma20 < ma50 ? -25 : 0;
  }

  if (adxVal != null && plusDI != null && minusDI != null) {
    // ADX is direction-blind; DI spread supplies the sign.
    const strength = Math.min(adxVal, 45) / 45;
    score += (plusDI > minusDI ? 1 : -1) * strength * 30;
  }

  if (slope20 != null) score += Math.max(-15, Math.min(15, slope20 * 20));
  if (slope50 != null) score += Math.max(-15, Math.min(15, slope50 * 30));

  score = Math.max(-100, Math.min(100, score));

  const label =
    score >= 55 ? 'صاعد قوي'
    : score >= 20 ? 'صاعد'
    : score > -20 ? 'عرضي'
    : score > -55 ? 'هابط'
    : 'هابط قوي';

  const labelEn =
    score >= 55 ? 'strong_uptrend'
    : score >= 20 ? 'uptrend'
    : score > -20 ? 'sideways'
    : score > -55 ? 'downtrend'
    : 'strong_downtrend';

  return { score: Math.round(score), label, labelEn };
}

/**
 * RSI divergence against the last two swing points. Bullish divergence = price
 * made a lower low while RSI made a higher low (selling losing force).
 */
function detectDivergence(bars, rsiArr, lookback = 5) {
  const { highs, lows } = findPivots(bars, lookback);
  const recent = (arr) => arr.filter((p) => p.index >= bars.length - 90).slice(-2);

  const twoLows = recent(lows);
  if (twoLows.length === 2) {
    const [a, b] = twoLows;
    const ra = rsiArr[a.index];
    const rb = rsiArr[b.index];
    if (ra != null && rb != null && b.price < a.price && rb > ra + 2) {
      return { type: 'bullish', detail: `قاع أدنى في السعر (${r2(a.price)} ← ${r2(b.price)}) مع قاع أعلى في RSI (${r1(ra)} ← ${r1(rb)})` };
    }
  }

  const twoHighs = recent(highs);
  if (twoHighs.length === 2) {
    const [a, b] = twoHighs;
    const ra = rsiArr[a.index];
    const rb = rsiArr[b.index];
    if (ra != null && rb != null && b.price > a.price && rb < ra - 2) {
      return { type: 'bearish', detail: `قمة أعلى في السعر (${r2(a.price)} ← ${r2(b.price)}) مع قمة أقل في RSI (${r1(ra)} ← ${r1(rb)})` };
    }
  }

  return { type: 'none', detail: null };
}

/** Was there a Donchian breakout in the last `within` sessions, and did volume confirm it? */
function detectBreakout(bars, donchianUpper, donchianLower, relVol, within = 5) {
  for (let k = 0; k < within && k < bars.length; k++) {
    const i = bars.length - 1 - k;
    // Compare against the channel as it stood *before* this bar, otherwise the
    // bar's own high defines the level it is supposedly breaking.
    const prevUpper = donchianUpper[i - 1];
    const prevLower = donchianLower[i - 1];
    if (prevUpper != null && bars[i].c > prevUpper) {
      return { direction: 'up', barsAgo: k, level: r2(prevUpper), volumeConfirmed: (relVol[i] ?? 0) >= 1.3 };
    }
    if (prevLower != null && bars[i].c < prevLower) {
      return { direction: 'down', barsAgo: k, level: r2(prevLower), volumeConfirmed: (relVol[i] ?? 0) >= 1.3 };
    }
  }
  return null;
}

export function buildSnapshot(bars, meta = {}) {
  if (!Array.isArray(bars) || bars.length < 60) {
    throw new Error(`need at least 60 bars, got ${bars?.length ?? 0}`);
  }

  const closes = bars.map((b) => b.c);
  const price = closes[closes.length - 1];
  const prevClose = closes[closes.length - 2];

  const ma20 = sma(closes, 20);
  const ma50 = sma(closes, 50);
  const ma200 = closes.length >= 200 ? sma(closes, 200) : new Array(closes.length).fill(null);
  const ema9 = ema(closes, 9);
  const ema21 = ema(closes, 21);

  const rsi14 = rsi(closes, 14);
  const macdVals = macd(closes);
  const atr14 = atr(bars, 14);
  const closeAtr14 = closeAtr(bars, 14);
  const bb = bollinger(closes, 20, 2);
  const stoch = stochastic(bars, 14, 3);
  const adxVals = adx(bars, 14);
  const obvVals = obv(bars);
  const dc = donchian(bars, 20);
  const relVol = relativeVolume(bars, 20);
  const slope20 = linregSlopePct(closes, 20);
  const slope50 = linregSlopePct(closes, 50);
  const hv = historicalVolatility(closes, 20);

  const atrNow = last(atr14);
  const atrPct = atrNow && price ? (atrNow / price) * 100 : null;
  const closeAtrNow = last(closeAtr14);

  const window52w = bars.slice(-252);
  const high52 = Math.max(...window52w.map((b) => b.h));
  const low52 = Math.min(...window52w.map((b) => b.l));

  const trend = classifyTrend({
    price,
    ma20: last(ma20),
    ma50: last(ma50),
    ma200: last(ma200),
    adxVal: last(adxVals.adx),
    plusDI: last(adxVals.plusDI),
    minusDI: last(adxVals.minusDI),
    slope20: last(slope20),
    slope50: last(slope50),
  });

  // OBV trend over the last 20 sessions tells us whether volume is backing price.
  const obvSlope = linregSlopePct(obvVals.map((v) => v + 1e9), 20); // offset keeps the ratio finite near zero
  const macdHistNow = last(macdVals.hist);
  const macdHistPrev = at(macdVals.hist, 1);

  return {
    meta: {
      code: meta.code ?? null,
      name: meta.ar ?? meta.name ?? null,
      nameEn: meta.en ?? null,
      sector: meta.sector ?? null,
      shariah: meta.shariah ?? null,
      asOf: bars[bars.length - 1].date,
      barsAnalyzed: bars.length,
    },

    price: {
      close: r2(price),
      changePct: prevClose ? r2(((price - prevClose) / prevClose) * 100) : null,
      open: r2(bars[bars.length - 1].o),
      high: r2(bars[bars.length - 1].h),
      low: r2(bars[bars.length - 1].l),
      volume: bars[bars.length - 1].v,
      high52w: r2(high52),
      low52w: r2(low52),
      pctFrom52wHigh: r2(((price - high52) / high52) * 100),
      pctFrom52wLow: r2(((price - low52) / low52) * 100),
    },

    returns: {
      d1: periodReturn(closes, 1),
      w1: periodReturn(closes, 5),
      m1: periodReturn(closes, 21),
      m3: periodReturn(closes, 63),
      m6: periodReturn(closes, 126),
      y1: periodReturn(closes, 252),
      maxDrawdown: r2(maxDrawdown(closes.slice(-252))),
    },

    trend,

    movingAverages: {
      ema9: r2(last(ema9)),
      ema21: r2(last(ema21)),
      sma20: r2(last(ma20)),
      sma50: r2(last(ma50)),
      sma200: r2(last(ma200)),
      priceVsSma20Pct: last(ma20) ? r2(((price - last(ma20)) / last(ma20)) * 100) : null,
      priceVsSma50Pct: last(ma50) ? r2(((price - last(ma50)) / last(ma50)) * 100) : null,
      priceVsSma200Pct: last(ma200) ? r2(((price - last(ma200)) / last(ma200)) * 100) : null,
      goldenCross: last(ma50) != null && last(ma200) != null ? last(ma50) > last(ma200) : null,
    },

    momentum: {
      rsi14: r1(last(rsi14)),
      rsiState:
        last(rsi14) == null ? null
        : last(rsi14) >= 70 ? 'تشبع شرائي'
        : last(rsi14) <= 30 ? 'تشبع بيعي'
        : last(rsi14) >= 55 ? 'زخم إيجابي'
        : last(rsi14) <= 45 ? 'زخم سلبي'
        : 'محايد',
      macd: r2(last(macdVals.line)),
      macdSignal: r2(last(macdVals.signal)),
      macdHistogram: r2(macdHistNow),
      macdCross:
        macdHistNow == null || macdHistPrev == null ? null
        : macdHistPrev <= 0 && macdHistNow > 0 ? 'bullish_cross'
        : macdHistPrev >= 0 && macdHistNow < 0 ? 'bearish_cross'
        : macdHistNow > 0 ? 'bullish' : 'bearish',
      stochK: r1(last(stoch.k)),
      stochD: r1(last(stoch.d)),
      roc20: r2(last(roc(closes, 20))),
      divergence: detectDivergence(bars, rsi14),
    },

    strength: {
      adx: r1(last(adxVals.adx)),
      plusDI: r1(last(adxVals.plusDI)),
      minusDI: r1(last(adxVals.minusDI)),
      trendQuality:
        last(adxVals.adx) == null ? null
        : last(adxVals.adx) >= 25 ? 'اتجاه واضح'
        : last(adxVals.adx) >= 20 ? 'اتجاه ناشئ'
        : 'بدون اتجاه (نطاق عرضي)',
    },

    volatility: {
      atr14: r2(atrNow),
      atrPct: r2(atrPct),
      closeAtr14: r2(closeAtrNow),
      closeAtrPct: r2(closeAtrNow && price ? (closeAtrNow / price) * 100 : null),
      annualizedVolPct: r1(last(hv)),
      bollingerUpper: r2(last(bb.upper)),
      bollingerMid: r2(last(bb.mid)),
      bollingerLower: r2(last(bb.lower)),
      bandwidthPct: r2(last(bb.bandwidth)),
      percentB: r2(last(bb.pctB)),
      squeeze: (() => {
        // A squeeze is bandwidth in the bottom quintile of its own last 6 months.
        const recent = bb.bandwidth.slice(-126).filter((v) => v != null);
        const nowBw = last(bb.bandwidth);
        if (recent.length < 40 || nowBw == null) return null;
        const sorted = [...recent].sort((a, b) => a - b);
        return nowBw <= sorted[Math.floor(sorted.length * 0.2)];
      })(),
    },

    volume: {
      last: bars[bars.length - 1].v,
      avg20: Math.round(bars.slice(-20).reduce((a, b) => a + b.v, 0) / 20),
      relativeVolume: r2(last(relVol)),
      obvTrend:
        last(obvSlope) == null ? null
        : last(obvSlope) > 0.02 ? 'تجميع'
        : last(obvSlope) < -0.02 ? 'تصريف'
        : 'محايد',
      // Liquidity gate: thin names cannot absorb a normal position size.
      avgTurnoverEgp: Math.round(bars.slice(-20).reduce((a, b) => a + b.v * b.c, 0) / 20),
    },

    levels: buildLevels(bars),

    breakout: detectBreakout(bars, dc.upper, dc.lower, relVol),
  };
}
