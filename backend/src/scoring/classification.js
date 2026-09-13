/**
 * Investment vs. speculation classification.
 *
 * Two independent 0-100 scores computed entirely by this module from data
 * `analyzeTicker` already produced (snapshot, technical, fundamentals) — no
 * network call, no AI call, no randomness. The same analysis object always
 * yields the same scores, same as every other number in this engine (see
 * analyze.js's own header comment). The AI layer may explain these numbers;
 * it never computes or overrides them — see prompts/system.js.
 *
 * Methodology, weights and worked examples are documented in
 * CLASSIFICATION.md at the repo root. In short:
 *   - Each raw metric is normalized to 0-100 by one of scoring/normalize.js's
 *     functions, then metrics are combined into named buckets, then buckets
 *     into the two final scores — every combination is a weightedAverage(),
 *     which drops a missing metric/bucket instead of scoring it as 0.
 *   - `classify()` is a pure function of the two scores against the
 *     configured thresholds — exported separately so classification
 *     boundaries can be unit-tested without building a full analysis.
 */

import { normalizeHigher, normalizeLower, normalizeTarget, weightedAverage, clamp } from './normalize.js';
import {
  CLASSIFICATION_THRESHOLDS,
  CLASSIFICATION_TYPES,
  INVESTMENT_WEIGHTS,
  SPECULATION_WEIGHTS,
  NORMALIZATION_ANCHORS as ANCH,
  CONFIDENCE_WEIGHTS,
  FUNDAMENTALS_STALE_DAYS,
} from '../config/classification.js';

const r1 = (x) => (x == null ? null : +x.toFixed(1));
const round = (x) => (x == null ? null : Math.round(x));

/** Net margin from the screener's trailing net income / revenue — real, not a growth figure. */
function netMarginPct(f) {
  if (!f || f.netIncomeEgp == null || !f.revenueEgp) return null;
  return (f.netIncomeEgp / f.revenueEgp) * 100;
}

/** A percentile from data/tradingview.js, inverted when a *lower* raw value is the better one. */
function pctScore(fundamentals, field, { invert = false } = {}) {
  const p = fundamentals?.percentiles?.[field];
  if (p == null) return null;
  return invert ? 100 - p : p;
}

const FINANCIAL_SECTORS = new Set(['banks', 'financials']);

// ---------------------------------------------------------------------------
// Investment-score metrics
// ---------------------------------------------------------------------------

/**
 * Declarative metric list — each entry says where its raw value comes from,
 * which bucket it belongs to, how to turn the raw value into a 0-100 score,
 * and how to phrase a human reason from it. Adding, re-weighting or removing
 * a metric is a one-entry change here rather than a new branch of scoring
 * code, and `reasons` (req #8) falls out of the same list for free — nothing
 * can appear as a reason that wasn't an actual metric used in the score.
 */
const INVESTMENT_METRICS = [
  {
    key: 'peRatio', bucket: 'valuation', weight: 1.2,
    value: (a) => a.fundamentals?.peRatio,
    // Negative earnings make P/E meaningless (worse than meaningless — it
    // reads as a very low, "cheap" multiple). Skip it rather than reward a
    // loss-making company for its own loss; the loss itself already lands in
    // `profitability` via net margin.
    score: (v, a) => (v == null || v <= 0 ? null : pctScore(a.fundamentals, 'peRatio', { invert: true }) ?? normalizeLower(v, ANCH.peRatio.min, ANCH.peRatio.max)),
    reason: (v, s) => {
      if (v == null) return null;
      if (v <= 0) return { tone: 'risk', text: 'الشركة خسرانة — مكرر الربحية غير قابل للتطبيق' };
      return { tone: s >= 60 ? 'positive' : s <= 30 ? 'negative' : 'neutral', text: `مكرر ربحية ${v}${s != null ? ` (أفضل من ${round(s)}% من سوق EGX)` : ''}` };
    },
  },
  {
    key: 'priceToBook', bucket: 'valuation', weight: 1,
    value: (a) => a.fundamentals?.priceToBook,
    // A negative book value makes the multiple meaningless the same way a
    // negative P/E does — skip rather than score a nonsensical negative ratio.
    score: (v, a) => (v == null || v <= 0 ? null : pctScore(a.fundamentals, 'priceToBook', { invert: true }) ?? normalizeLower(v, ANCH.priceToBook.min, ANCH.priceToBook.max)),
    reason: (v, s) => {
      if (v == null) return null;
      if (v <= 0) return { tone: 'risk', text: 'قيمة دفترية سالبة — مكرر القيمة الدفترية غير قابل للتطبيق' };
      return { tone: s >= 60 ? 'positive' : s <= 30 ? 'negative' : 'neutral', text: `السعر ${v}× القيمة الدفترية` };
    },
  },
  {
    key: 'returnOnEquity', bucket: 'profitability', weight: 1.5,
    value: (a) => a.fundamentals?.returnOnEquityPct,
    score: (v, a) => (v == null ? null : pctScore(a.fundamentals, 'returnOnEquityPct') ?? normalizeHigher(v, ANCH.returnOnEquityPct.min, ANCH.returnOnEquityPct.max)),
    reason: (v, s) => (v == null ? null : { tone: v >= 18 ? 'positive' : v < 8 ? 'negative' : 'neutral', text: `عائد على حقوق الملكية ${v}%` }),
  },
  {
    key: 'netMargin', bucket: 'profitability', weight: 1,
    value: (a) => netMarginPct(a.fundamentals),
    score: (v) => (v == null ? null : normalizeHigher(v, ANCH.netMarginPct.min, ANCH.netMarginPct.max)),
    reason: (v, s) => (v == null ? null : { tone: v >= 15 ? 'positive' : v < 0 ? 'negative' : 'neutral', text: `هامش ربح صافي ${r1(v)}%` }),
  },
  {
    key: 'debtToEquity', bucket: 'financialHealth', weight: 1.3,
    // A bank's balance sheet (deposits as "liabilities") makes debt/equity an
    // apples-to-oranges number against a normal company — sector-aware
    // exclusion rather than scoring it as if it were one.
    value: (a) => (FINANCIAL_SECTORS.has(a.sector) ? null : a.fundamentals?.debtToEquity),
    score: (v, a) => (v == null ? null : pctScore(a.fundamentals, 'debtToEquity', { invert: true }) ?? normalizeLower(v, ANCH.debtToEquity.min, ANCH.debtToEquity.max)),
    reason: (v, s) => (v == null ? null : { tone: s >= 60 ? 'positive' : s <= 30 ? 'negative' : 'neutral', text: `مديونية ${v}× حقوق الملكية` }),
  },
  {
    key: 'currentRatio', bucket: 'financialHealth', weight: 1,
    // Same sector exclusion as debt/equity: a bank's "current ratio" is not
    // the liquidity signal it is for an industrial or consumer company.
    value: (a) => (FINANCIAL_SECTORS.has(a.sector) ? null : a.fundamentals?.currentRatio),
    score: (v) => (v == null ? null : normalizeTarget(v, ANCH.currentRatio)),
    reason: (v, s) => (v == null ? null : { tone: s >= 60 ? 'positive' : s <= 30 ? 'negative' : 'neutral', text: `نسبة التداول ${v}` }),
  },
  {
    key: 'dividendYield', bucket: 'dividendQuality', weight: 1,
    value: (a) => a.fundamentals?.dividendYieldPct,
    // A stock that pays nothing isn't "missing" this metric — it genuinely
    // scores low on dividend quality, just not at 0 (many good growth
    // businesses reasonably pay nothing).
    score: (v, a) => (v == null ? null : v <= 0 ? 25 : (pctScore(a.fundamentals, 'dividendYieldPct') ?? normalizeHigher(v, ANCH.dividendYieldPct.min, ANCH.dividendYieldPct.max))),
    reason: (v, s) => (v == null || v <= 0 ? null : { tone: v >= 6 ? 'positive' : 'neutral', text: `عائد توزيعات ${v}%` }),
  },
  {
    key: 'priceVsSma200', bucket: 'priceTrend', weight: 1,
    value: (a) => a.snapshot.movingAverages.priceVsSma200Pct,
    score: (v) => (v == null ? null : normalizeHigher(v, ANCH.priceVsSma200Pct.min, ANCH.priceVsSma200Pct.max)),
    reason: (v) => (v == null ? null : { tone: v > 0 ? 'positive' : 'negative', text: `السعر ${v > 0 ? 'فوق' : 'تحت'} متوسط 200 يوم بـ ${Math.abs(v)}%` }),
  },
  {
    key: 'trendQuality', bucket: 'priceTrend', weight: 0.8,
    value: (a) => a.snapshot.trend.score,
    score: (v) => (v == null ? null : normalizeHigher(v, ANCH.trendScore.min, ANCH.trendScore.max)),
    reason: (v, s, a) => (v == null ? null : { tone: v > 20 ? 'positive' : v < -20 ? 'negative' : 'neutral', text: `اتجاه ${a.snapshot.trend.label}` }),
  },
  {
    key: 'longReturn', bucket: 'priceTrend', weight: 0.6,
    value: (a) => a.snapshot.returns.y1,
    score: (v) => (v == null ? null : normalizeHigher(v, ANCH.longReturnPct.min, ANCH.longReturnPct.max)),
    reason: (v) => (v == null ? null : { tone: v > 15 ? 'positive' : v < -15 ? 'negative' : 'neutral', text: `عائد آخر سنة ${v > 0 ? '+' : ''}${v}%` }),
  },
  {
    key: 'lowVolatility', bucket: 'stability', weight: 1,
    value: (a) => a.snapshot.volatility.annualizedVolPct,
    score: (v) => (v == null ? null : normalizeLower(v, ANCH.annualizedVolPct.min, ANCH.annualizedVolPct.max)),
    reason: (v, s) => (v == null ? null : { tone: s >= 60 ? 'positive' : s <= 30 ? 'negative' : 'neutral', text: `تقلب سنوي ${v}%` }),
  },
];

// ---------------------------------------------------------------------------
// Speculation-score metrics
// ---------------------------------------------------------------------------

const SPECULATION_METRICS = [
  {
    key: 'avgTurnover', bucket: 'liquidity', weight: 1,
    value: (a) => a.snapshot.volume.avgTurnoverEgp,
    score: (v) => (v == null ? null : normalizeHigher(v, ANCH.turnoverEgp.min, ANCH.turnoverEgp.max)),
    reason: (v, s) => (v == null || s < 60 ? null : { tone: 'notable', text: `سيولة عالية — متوسط تداول ${Math.round(v / 1e6)} مليون ج يوميًا` }),
  },
  {
    key: 'relativeVolume', bucket: 'volumeSurge', weight: 1,
    value: (a) => a.snapshot.volume.relativeVolume,
    score: (v) => (v == null ? null : normalizeHigher(v, ANCH.relativeVolume.min, ANCH.relativeVolume.max)),
    reason: (v) => (v == null || v < 1.5 ? null : { tone: 'notable', text: `حجم التداول ${v}× المتوسط` }),
  },
  {
    key: 'atrPct', bucket: 'volatility', weight: 1,
    value: (a) => a.snapshot.volatility.atrPct,
    score: (v) => (v == null ? null : normalizeHigher(v, ANCH.atrPct.min, ANCH.atrPct.max)),
    reason: (v, s) => (v == null || s < 60 ? null : { tone: 'notable', text: `تقلب يومي (ATR) ${v}%` }),
  },
  {
    key: 'annualizedVol', bucket: 'volatility', weight: 1,
    value: (a) => a.snapshot.volatility.annualizedVolPct,
    score: (v) => (v == null ? null : normalizeHigher(v, ANCH.annualizedVolPct.min, ANCH.annualizedVolPct.max)),
    reason: (v, s) => (v == null || s < 60 ? null : { tone: 'notable', text: `تقلب سنوي ${v}%` }),
  },
  {
    key: 'momentum1m', bucket: 'momentum', weight: 1,
    // Absolute value: a stock that just crashed hard is trading just as
    // speculatively as one that just spiked — this bucket measures how much
    // the price is moving, not which way.
    value: (a) => a.snapshot.returns.m1,
    score: (v) => (v == null ? null : normalizeHigher(Math.abs(v), 0, ANCH.absReturn.m1)),
    reason: (v) => (v == null || Math.abs(v) < 10 ? null : { tone: 'notable', text: `عائد الشهر ${v > 0 ? '+' : ''}${v}%` }),
  },
  {
    key: 'momentum1w', bucket: 'momentum', weight: 0.6,
    value: (a) => a.snapshot.returns.w1,
    score: (v) => (v == null ? null : normalizeHigher(Math.abs(v), 0, ANCH.absReturn.w1)),
    reason: (v) => (v == null || Math.abs(v) < 6 ? null : { tone: 'notable', text: `عائد الأسبوع ${v > 0 ? '+' : ''}${v}%` }),
  },
  {
    key: 'rsiExtremity', bucket: 'momentum', weight: 0.8,
    value: (a) => a.snapshot.momentum.rsi14,
    score: (v) => (v == null ? null : normalizeHigher(Math.abs(v - 50), 0, 40)),
    reason: (v) => (v == null || (v < 70 && v > 30) ? null : { tone: 'notable', text: `RSI ${v} — ${v >= 70 ? 'تشبع شرائي' : 'تشبع بيعي'}` }),
  },
  {
    key: 'breakout', bucket: 'priceAction', weight: 1,
    value: (a) => (a.snapshot.breakout ? 1 : 0),
    score: (v) => (v == null ? null : v ? 80 : 30),
    reason: (v, s, a) => (a.snapshot.breakout ? { tone: 'notable', text: `اختراق ${a.snapshot.breakout.direction === 'up' ? 'صاعد' : 'هابط'} حديث لمستوى ${a.snapshot.breakout.level}` } : null),
  },
  {
    key: 'near52wExtreme', bucket: 'priceAction', weight: 0.8,
    // Distance from whichever 52-week extreme (high or low) is closer —
    // sitting at either edge of the yearly range is the speculative-interest
    // signal, not specifically "near the high".
    value: (a) => {
      const fromHigh = a.snapshot.price.pctFrom52wHigh;
      const fromLow = a.snapshot.price.pctFrom52wLow;
      if (fromHigh == null && fromLow == null) return null;
      return Math.min(Math.abs(fromHigh ?? Infinity), Math.abs(fromLow ?? Infinity));
    },
    score: (v) => (v == null ? null : normalizeLower(v, 0, 25)),
    reason: (v, s, a) => {
      if (v == null || s < 60) return null;
      const nearHigh = Math.abs(a.snapshot.price.pctFrom52wHigh ?? Infinity) <= Math.abs(a.snapshot.price.pctFrom52wLow ?? Infinity);
      return { tone: 'notable', text: nearHigh ? 'قريب من أعلى سعر في 52 أسبوع' : 'قريب من أدنى سعر في 52 أسبوع' };
    },
  },
  {
    key: 'squeeze', bucket: 'priceAction', weight: 0.4,
    // `squeeze` is itself null (not false) when there isn't 6 months of
    // Bollinger-bandwidth history yet — a newly-listed stock — and that must
    // stay "missing" rather than silently read as "no squeeze".
    value: (a) => (a.snapshot.volatility.squeeze == null ? null : a.snapshot.volatility.squeeze ? 1 : 0),
    score: (v) => (v == null ? null : v ? 70 : 40),
    reason: (v) => (v ? { tone: 'notable', text: 'انضغاط بولينجر — حركة قوية محتملة قريبًا' } : null),
  },
  {
    // No real-time news/corporate-actions feed is wired into the deterministic
    // pipeline today (see CLASSIFICATION.md "Limitations") — this metric is
    // always null (missing) and its bucket weight is redistributed to the
    // others, unless a caller explicitly supplies `opts.newsCatalystScore`
    // (0-100) from a real, non-AI source. It is never invented here.
    key: 'newsCatalyst', bucket: 'newsCatalyst', weight: 1,
    value: (a, opts) => opts?.newsCatalystScore ?? null,
    score: (v) => (v == null ? null : clamp(v, 0, 100)),
    reason: (v) => (v == null ? null : { tone: 'notable', text: 'محفّز إخباري خارجي مؤكد' }),
  },
];

/** Human labels for missing-metric keys, used in dataQuality.missingMetrics. */
const METRIC_LABELS = {
  peRatio: 'مكرر الربحية', priceToBook: 'مكرر القيمة الدفترية', returnOnEquity: 'العائد على حقوق الملكية',
  netMargin: 'هامش الربح الصافي', debtToEquity: 'المديونية', currentRatio: 'نسبة التداول',
  dividendYield: 'عائد التوزيعات', priceVsSma200: 'السعر مقابل متوسط 200 يوم', trendQuality: 'قوة الاتجاه',
  longReturn: 'عائد سنة', lowVolatility: 'التقلب السنوي', avgTurnover: 'متوسط السيولة اليومية',
  relativeVolume: 'نسبة حجم التداول', atrPct: 'التقلب اليومي', annualizedVol: 'التقلب السنوي',
  momentum1m: 'عائد الشهر', momentum1w: 'عائد الأسبوع', rsiExtremity: 'مؤشر القوة النسبية',
  breakout: 'الاختراق السعري', near52wExtreme: 'القرب من أعلى/أدنى 52 أسبوع', squeeze: 'انضغاط بولينجر',
  newsCatalyst: 'محفّز إخباري',
};

/** Human labels for bucket keys, used when a whole bucket had nothing to score. */
const BUCKET_LABELS = {
  valuation: 'التقييم', profitability: 'الربحية', financialHealth: 'الصحة المالية',
  dividendQuality: 'جودة التوزيعات', priceTrend: 'الاتجاه السعري', stability: 'الاستقرار',
  liquidity: 'السيولة', volumeSurge: 'اندفاع حجم التداول', volatility: 'التقلب',
  momentum: 'الزخم', priceAction: 'الحركة السعرية', newsCatalyst: 'المحفزات الإخبارية',
};

/**
 * Runs a metric list against one analysis, grouping into buckets and then
 * into a single 0-100 score — the same generic engine for both investment
 * and speculation. Nothing about it is score-specific; only the metric list
 * and bucket weights passed in differ between the two callers below.
 */
function computeBucketedScore(metrics, analysis, bucketWeights, opts) {
  const byBucket = {};
  const missingMetrics = [];
  const reasons = [];

  for (const metric of metrics) {
    const raw = metric.value(analysis, opts);
    const score = metric.score(raw, analysis, opts);
    (byBucket[metric.bucket] ??= []).push({ value: score, weight: metric.weight });
    if (score == null) missingMetrics.push(metric.key);
    const reason = metric.reason?.(raw, score, analysis, opts);
    if (reason) reasons.push({ ...reason, metric: metric.key, bucket: metric.bucket, score: score == null ? null : round(score) });
  }

  const bucketScores = {};
  for (const [bucket, parts] of Object.entries(byBucket)) bucketScores[bucket] = weightedAverage(parts);

  const overallParts = Object.entries(bucketWeights).map(([bucket, weight]) => ({ value: bucketScores[bucket], weight }));
  const score = weightedAverage(overallParts);
  const missingBuckets = Object.keys(bucketWeights).filter((b) => bucketScores[b] == null);

  return {
    score,
    bucketScores,
    missingMetrics,
    missingBuckets,
    reasons,
    totalMetrics: metrics.length,
    availableMetrics: metrics.length - missingMetrics.length,
  };
}

/**
 * Pure classification decision — exported on its own so the boundaries
 * themselves (65 vs. 64.99, the HYBRID corner, etc.) can be unit-tested
 * without constructing a full analysis. See CLASSIFICATION_THRESHOLDS.
 */
export function classify(investmentScore, speculationScore, thresholds = CLASSIFICATION_THRESHOLDS) {
  if (investmentScore == null || speculationScore == null) return 'NEUTRAL';
  if (investmentScore >= thresholds.INVESTMENT_MIN_SCORE && speculationScore < thresholds.INVESTMENT_MAX_SPECULATION) return 'INVESTMENT';
  if (investmentScore < thresholds.SPECULATIVE_MAX_INVESTMENT && speculationScore >= thresholds.SPECULATIVE_MIN_SCORE) return 'SPECULATIVE';
  if (investmentScore >= thresholds.HYBRID_INVESTMENT_THRESHOLD && speculationScore >= thresholds.HYBRID_SPECULATION_THRESHOLD) return 'HYBRID';
  return 'NEUTRAL';
}

/** Distance (0-100 scale) from the nearest boundary that actually bears on this pair of scores. */
function boundaryDistance(investmentScore, speculationScore, t) {
  const gaps = [
    Math.abs(investmentScore - t.INVESTMENT_MIN_SCORE),
    Math.abs(speculationScore - t.INVESTMENT_MAX_SPECULATION),
    Math.abs(investmentScore - t.SPECULATIVE_MAX_INVESTMENT),
    Math.abs(speculationScore - t.SPECULATIVE_MIN_SCORE),
    Math.abs(investmentScore - t.HYBRID_INVESTMENT_THRESHOLD),
    Math.abs(speculationScore - t.HYBRID_SPECULATION_THRESHOLD),
  ];
  return Math.min(...gaps);
}

/**
 * data_quality metadata (req #6): what fed the scores, how complete it was,
 * and how fresh. `severity` mirrors data/quality.js's own vocabulary (the
 * price-series gate `analyzeTicker` already ran before classification even
 * starts) so a caller reads one consistent scale across both.
 */
function buildDataQuality(analysis, investment, speculation) {
  const missingMetrics = [...new Set([...investment.missingMetrics, ...speculation.missingMetrics])]
    .filter((k) => k !== 'newsCatalyst') // always absent today — not a per-stock gap worth flagging, see docs
    .map((k) => METRIC_LABELS[k] ?? k);

  const staleMetrics = [];
  const f = analysis.fundamentals;
  if (f?.asOf) {
    const ageDays = (Date.parse(analysis.snapshot.meta.asOf) - Date.parse(f.asOf)) / 86_400_000;
    if (Number.isFinite(ageDays) && ageDays > FUNDAMENTALS_STALE_DAYS) staleMetrics.push('بيانات الأساسيات المالية');
  }

  const totalMetrics = investment.totalMetrics + speculation.totalMetrics - 1; // newsCatalyst excluded from the count
  const availableMetrics = investment.availableMetrics + speculation.availableMetrics;
  const completenessScore = totalMetrics > 0 ? (availableMetrics / totalMetrics) * 100 : 0;

  return {
    score: round(clamp(completenessScore - staleMetrics.length * 15, 0, 100)),
    missingMetrics,
    staleMetrics,
    hasFundamentals: Boolean(f),
    lastMarketUpdate: analysis.snapshot.meta.asOf,
    lastFundamentalUpdate: f?.asOf ?? null,
    prices: { severity: analysis.quality?.severity ?? 'ok' },
  };
}

/**
 * Confidence (req #5): how much to trust the classification, independent of
 * what it says. Combines data completeness/freshness/quality with how far
 * the two scores actually sit from a decision boundary — a pair of scores
 * that lands well inside INVESTMENT territory is a confident call even with
 * one metric missing; a pair sitting right on the HYBRID corner is not, even
 * with perfect data.
 */
function computeConfidence(investmentScore, speculationScore, dataQuality) {
  const severityScore = { ok: 100, warn: 55, fatal: 0 }[dataQuality.prices.severity] ?? 70;
  const freshnessScore = !dataQuality.hasFundamentals ? 45 : dataQuality.staleMetrics.length ? 60 : 100;
  const distance = boundaryDistance(investmentScore, speculationScore, CLASSIFICATION_THRESHOLDS);
  // A pair of scores 15+ points clear of every boundary is about as
  // confident as this axis gets; closer than that scales down linearly.
  const boundaryScore = clamp((distance / 15) * 100, 0, 100);

  return round(clamp(
    weightedAverage([
      { value: dataQuality.score, weight: CONFIDENCE_WEIGHTS.dataCompleteness },
      { value: freshnessScore, weight: CONFIDENCE_WEIGHTS.dataFreshness },
      { value: boundaryScore, weight: CONFIDENCE_WEIGHTS.boundaryDistance },
      { value: severityScore, weight: CONFIDENCE_WEIGHTS.qualitySeverity },
    ]) ?? 0,
    0,
    100,
  ));
}

const byStrength = (a, b) => Math.abs((b.score ?? 50) - 50) - Math.abs((a.score ?? 50) - 50);

/**
 * Full classification for one `analyzeTicker` result. Pure and deterministic
 * — same `analysis` in, same output out, no I/O.
 *
 * @param {object} analysis - a `usable: true` result from analyze.js's analyzeTicker
 * @param {object} [opts]
 * @param {number} [opts.newsCatalystScore] - 0-100, from a real non-AI source
 *   only (see the newsCatalyst metric above) — omit unless one is actually wired in.
 * @returns {object} { type, investmentScore, speculationScore, confidence, dataQuality, reasons }
 */
export function classifyStock(analysis, opts = {}) {
  if (!analysis?.usable || !analysis.snapshot || !analysis.technical) {
    return {
      type: 'NEUTRAL',
      investmentScore: null,
      speculationScore: null,
      confidence: 0,
      dataQuality: { score: 0, missingMetrics: [], staleMetrics: [], hasFundamentals: false, lastMarketUpdate: null, lastFundamentalUpdate: null, prices: { severity: 'fatal' } },
      reasons: { investment: [], speculation: [], risks: ['بيانات غير كافية لتصنيف هذا السهم'] },
    };
  }

  const investment = computeBucketedScore(INVESTMENT_METRICS, analysis, INVESTMENT_WEIGHTS, opts);
  const speculation = computeBucketedScore(SPECULATION_METRICS, analysis, SPECULATION_WEIGHTS, opts);

  const investmentScore = round(clamp(investment.score ?? 0, 0, 100));
  const speculationScore = round(clamp(speculation.score ?? 0, 0, 100));
  const type = classify(investmentScore, speculationScore);

  const dataQuality = buildDataQuality(analysis, investment, speculation);
  const confidence = computeConfidence(investmentScore, speculationScore, dataQuality);

  const risks = [
    ...investment.reasons.filter((r) => r.tone === 'risk' || r.tone === 'negative'),
    ...(investment.missingBuckets.length
      ? [{ text: `بيانات ${investment.missingBuckets.map((b) => BUCKET_LABELS[b] ?? b).join('، ')} غير متاحة — التقييم الاستثماري جزئي`, tone: 'risk' }]
      : []),
    ...(speculationScore >= 70 && investment.reasons.some((r) => r.metric === 'trendQuality' && r.tone !== 'negative')
      ? [{ text: 'تسارع سعري/تقلب قوي حاليًا — يزيد خطر تصحيح حاد', tone: 'risk' }]
      : []),
  ];

  return {
    type,
    investmentScore,
    speculationScore,
    confidence,
    dataQuality,
    reasons: {
      investment: investment.reasons.filter((r) => r.tone === 'positive').sort(byStrength).slice(0, 6).map((r) => r.text),
      speculation: speculation.reasons.filter((r) => r.tone === 'notable').sort(byStrength).slice(0, 6).map((r) => r.text),
      risks: risks.sort(byStrength).slice(0, 5).map((r) => r.text),
    },
    // Kept for anyone wanting the full breakdown (UI drill-down, debugging) —
    // not part of the compact API row, see api/server.js's /api/scan mapping.
    breakdown: { investment: investment.bucketScores, speculation: speculation.bucketScores },
  };
}

export { CLASSIFICATION_TYPES };
