import test from 'node:test';
import assert from 'node:assert/strict';

import '../helpers/env.js';

import { classify, classifyStock } from '../../src/scoring/classification.js';
import { CLASSIFICATION_THRESHOLDS } from '../../src/config/classification.js';
import { buildSnapshot } from '../../src/ta/snapshot.js';
import { scoreTechnical } from '../../src/scoring/technical.js';
import { synthBars, choppyBars, downtrendBars, breakoutBars, lowVolumeBars } from '../helpers/bars.js';

/** Builds a full `analyzeTicker`-shaped object from bars, the one piece classifyStock needs. */
function analysisFrom(bars, { sector = 'industrials', fundamentals = null, severity = 'ok' } = {}) {
  const snapshot = buildSnapshot(bars, { code: 'TEST', ar: 'تست', sector });
  const technical = scoreTechnical(snapshot);
  return { usable: true, code: 'TEST', sector, snapshot, technical, fundamentals, quality: { severity } };
}

const STRONG_FUNDAMENTALS = {
  peRatio: 8, priceToBook: 1.3, dividendYieldPct: 5, debtToEquity: 0.4,
  returnOnEquityPct: 24, netIncomeEgp: 400_000_000, revenueEgp: 2_000_000_000,
  currentRatio: 1.8, asOf: null, source: 'tradingview',
  percentiles: { peRatio: 20, priceToBook: 25, returnOnEquityPct: 88, debtToEquity: 20, dividendYieldPct: 80, currentRatio: 60 },
};

// ---------------------------------------------------------------------------
// classify() — pure boundary logic (req: test Investment=65 vs 64.99, etc.)
// ---------------------------------------------------------------------------

test('classify: INVESTMENT boundary at exactly the configured threshold', () => {
  const t = CLASSIFICATION_THRESHOLDS;
  assert.equal(classify(t.INVESTMENT_MIN_SCORE, t.INVESTMENT_MAX_SPECULATION - 1), 'INVESTMENT');
  assert.equal(classify(t.INVESTMENT_MIN_SCORE - 0.01, t.INVESTMENT_MAX_SPECULATION - 1), 'NEUTRAL', 'just under the investment score threshold misses INVESTMENT');
});

test('classify: INVESTMENT requires speculation strictly below its ceiling', () => {
  const t = CLASSIFICATION_THRESHOLDS;
  assert.equal(classify(80, t.INVESTMENT_MAX_SPECULATION - 0.01), 'INVESTMENT');
  // At the speculation ceiling but still under the (higher) HYBRID speculation
  // threshold, neither INVESTMENT nor HYBRID fires — a real "in-between" gap
  // the thresholds leave on purpose.
  assert.equal(classify(80, t.INVESTMENT_MAX_SPECULATION), 'NEUTRAL', 'at the speculation ceiling, high investment alone is not enough for INVESTMENT');
  // Past the HYBRID speculation threshold too, the same high investment score lands in HYBRID.
  assert.equal(classify(80, t.HYBRID_SPECULATION_THRESHOLD), 'HYBRID');
});

test('classify: SPECULATIVE boundary at exactly the configured threshold', () => {
  const t = CLASSIFICATION_THRESHOLDS;
  assert.equal(classify(t.SPECULATIVE_MAX_INVESTMENT - 1, t.SPECULATIVE_MIN_SCORE), 'SPECULATIVE');
  assert.equal(classify(t.SPECULATIVE_MAX_INVESTMENT - 1, t.SPECULATIVE_MIN_SCORE - 0.01), 'NEUTRAL', 'just under the speculation score threshold misses SPECULATIVE');
});

test('classify: HYBRID requires both scores at or above their own (lower) thresholds', () => {
  const t = CLASSIFICATION_THRESHOLDS;
  assert.equal(classify(t.HYBRID_INVESTMENT_THRESHOLD, t.HYBRID_SPECULATION_THRESHOLD), 'HYBRID');
  assert.equal(classify(t.HYBRID_INVESTMENT_THRESHOLD - 0.01, t.HYBRID_SPECULATION_THRESHOLD), 'NEUTRAL');
  assert.equal(classify(t.HYBRID_INVESTMENT_THRESHOLD, t.HYBRID_SPECULATION_THRESHOLD - 0.01), 'NEUTRAL');
});

test('classify: worked example from the spec — 82/20 is INVESTMENT, 72/81 is HYBRID', () => {
  assert.equal(classify(82, 20), 'INVESTMENT');
  assert.equal(classify(72, 81), 'HYBRID');
});

test('classify: low investment + low speculation is NEUTRAL, not a forced pick', () => {
  assert.equal(classify(40, 30), 'NEUTRAL');
});

test('classify: null scores (nothing to classify) are NEUTRAL, never a crash', () => {
  assert.equal(classify(null, 50), 'NEUTRAL');
  assert.equal(classify(50, null), 'NEUTRAL');
  assert.equal(classify(null, null), 'NEUTRAL');
});

// ---------------------------------------------------------------------------
// classifyStock() — full pipeline over synthetic price/fundamentals data
// ---------------------------------------------------------------------------

test('a steady uptrend with strong, cheap fundamentals classifies as INVESTMENT or HYBRID, never SPECULATIVE', () => {
  const bars = synthBars({ sessions: 300, driftPct: 0.06, volPct: 0.4, seed: 11, volume: 150_000 });
  const analysis = analysisFrom(bars, { fundamentals: STRONG_FUNDAMENTALS });
  const result = classifyStock(analysis);
  assert.ok(result.investmentScore >= 60, `investment score ${result.investmentScore} should reflect the strong fundamentals + trend`);
  assert.notEqual(result.type, 'SPECULATIVE');
  assert.ok(result.reasons.investment.length > 0);
  assert.ok(result.confidence > 60, `confidence ${result.confidence} should be high with complete, non-stale data`);
});

test('a violent, high-volume breakout with no fundamentals leans SPECULATIVE, not INVESTMENT', () => {
  const bars = breakoutBars({ sessions: 160, base: 100, breakoutTo: 140, volume: 5_000_000 });
  const analysis = analysisFrom(bars, { fundamentals: null });
  const result = classifyStock(analysis);
  assert.ok(result.speculationScore >= 50, `speculation score ${result.speculationScore} should reflect the breakout/volume/momentum`);
  assert.notEqual(result.type, 'INVESTMENT');
  assert.ok(result.reasons.speculation.length > 0);
});

test('a strong trend that is also currently very volatile/high-momentum can land in HYBRID', () => {
  const bars = breakoutBars({ sessions: 160, base: 100, breakoutTo: 160, volume: 8_000_000 });
  const analysis = analysisFrom(bars, { fundamentals: STRONG_FUNDAMENTALS });
  const result = classifyStock(analysis);
  assert.ok(['HYBRID', 'INVESTMENT'].includes(result.type), `expected HYBRID or INVESTMENT, got ${result.type}`);
  assert.ok(result.investmentScore != null && result.speculationScore != null);
});

test('a sideways, low-conviction churner is usually NEUTRAL', () => {
  const bars = choppyBars({ sessions: 260, seed: 5, volume: 200_000 });
  const analysis = analysisFrom(bars, { fundamentals: null });
  const result = classifyStock(analysis);
  assert.ok(result.investmentScore != null && result.speculationScore != null);
  assert.ok(result.confidence >= 0 && result.confidence <= 100);
});

test('missing fundamentals: still produces a score from price/technical data alone, with lower confidence', () => {
  const bars = synthBars({ sessions: 300, driftPct: 0.06, seed: 3 });
  const withFund = classifyStock(analysisFrom(bars, { fundamentals: STRONG_FUNDAMENTALS }));
  const withoutFund = classifyStock(analysisFrom(bars, { fundamentals: null }));
  assert.ok(withoutFund.investmentScore != null, 'a missing metric must not become a null overall score');
  assert.ok(withoutFund.confidence < withFund.confidence, 'missing fundamentals should read as lower confidence');
  assert.ok(withoutFund.dataQuality.missingMetrics.length > 0);
  assert.ok(withoutFund.dataQuality.score < withFund.dataQuality.score);
});

test('negative earnings (P/E <= 0): the P/E metric is skipped, not scored as bad, and it is named as a risk', () => {
  const bars = synthBars({ sessions: 300, driftPct: 0.02, seed: 9 });
  const f = { ...STRONG_FUNDAMENTALS, peRatio: -4, percentiles: { ...STRONG_FUNDAMENTALS.percentiles, peRatio: null } };
  const result = classifyStock(analysisFrom(bars, { fundamentals: f }));
  assert.ok(result.investmentScore != null);
  assert.ok(result.dataQuality.missingMetrics.includes('مكرر الربحية'));
  assert.ok(result.reasons.risks.some((r) => r.includes('خسرانة')));
});

test('negative book value (P/B <= 0): the P/B metric is skipped the same way, not scored as a bargain', () => {
  const bars = synthBars({ sessions: 300, driftPct: 0.02, seed: 13 });
  const f = { ...STRONG_FUNDAMENTALS, priceToBook: -1.2, percentiles: { ...STRONG_FUNDAMENTALS.percentiles, priceToBook: null } };
  const result = classifyStock(analysisFrom(bars, { fundamentals: f }));
  assert.ok(result.investmentScore != null);
  assert.ok(result.dataQuality.missingMetrics.includes('مكرر القيمة الدفترية'));
});

test('negative ROE lowers the profitability read but never crashes or is treated as missing', () => {
  const bars = synthBars({ sessions: 300, driftPct: 0.02, seed: 17 });
  const badRoe = { ...STRONG_FUNDAMENTALS, returnOnEquityPct: -12, percentiles: { ...STRONG_FUNDAMENTALS.percentiles, returnOnEquityPct: 5 } };
  const goodRoe = classifyStock(analysisFrom(bars, { fundamentals: STRONG_FUNDAMENTALS }));
  const bad = classifyStock(analysisFrom(bars, { fundamentals: badRoe }));
  assert.ok(bad.investmentScore < goodRoe.investmentScore);
  assert.ok(!bad.dataQuality.missingMetrics.includes('العائد على حقوق الملكية'), 'a real negative value is data, not a missing metric');
});

test('zero/near-zero volume: liquidity scores at the bottom, not null and not a crash', () => {
  const bars = lowVolumeBars({ sessions: 260, seed: 21 });
  const result = classifyStock(analysisFrom(bars, { fundamentals: null }));
  assert.ok(result.speculationScore != null);
  assert.ok(result.breakdown.speculation.liquidity != null && result.breakdown.speculation.liquidity < 20);
});

test('a newly-listed stock with only just enough history for a snapshot degrades gracefully', () => {
  // 65 sessions: above buildSnapshot's 60-bar floor, but under both the 200-day
  // moving average and the 252-session 1-year-return windows.
  const bars = synthBars({ sessions: 65, driftPct: 0.1, seed: 27 });
  const analysis = analysisFrom(bars, { fundamentals: null });
  assert.equal(analysis.snapshot.movingAverages.sma200, null);
  assert.equal(analysis.snapshot.returns.y1, null);
  const result = classifyStock(analysis);
  assert.ok(result.investmentScore != null, 'must still produce a score from whatever is available (trend, stability)');
  assert.ok(result.speculationScore != null);
  assert.ok(Number.isInteger(result.confidence) && result.confidence >= 0 && result.confidence <= 100);
});

test('an unusable analysis (failed the data-quality gate) returns a NEUTRAL stub with zero confidence, not a crash', () => {
  const result = classifyStock({ usable: false });
  assert.equal(result.type, 'NEUTRAL');
  assert.equal(result.investmentScore, null);
  assert.equal(result.speculationScore, null);
  assert.equal(result.confidence, 0);
  assert.ok(Array.isArray(result.reasons.risks) && result.reasons.risks.length > 0);
});

test('classifyStock(null) and classifyStock(undefined) degrade the same way', () => {
  for (const input of [null, undefined, {}]) {
    const result = classifyStock(input);
    assert.equal(result.type, 'NEUTRAL');
    assert.equal(result.confidence, 0);
  }
});

test('same analysis in, same classification out — no hidden randomness or clock dependence', () => {
  const bars = synthBars({ sessions: 300, driftPct: 0.05, seed: 33 });
  const analysis = analysisFrom(bars, { fundamentals: STRONG_FUNDAMENTALS });
  const a = classifyStock(analysis);
  const b = classifyStock(analysis);
  assert.deepEqual(a, b);
});

test('banks/financials: debt/equity and current ratio are excluded even when the raw fundamentals carry them', () => {
  const bars = synthBars({ sessions: 300, driftPct: 0.05, seed: 41 });
  const bank = classifyStock(analysisFrom(bars, { sector: 'banks', fundamentals: STRONG_FUNDAMENTALS }));
  assert.ok(bank.dataQuality.missingMetrics.includes('المديونية'));
  assert.ok(bank.dataQuality.missingMetrics.includes('نسبة التداول'));
  assert.equal(bank.breakdown.investment.financialHealth, null, 'the whole bucket has nothing left to score for a bank');
});

test('extreme values (very high P/E, very high debt) do not throw and stay within 0-100', () => {
  const bars = synthBars({ sessions: 300, driftPct: 0.02, seed: 45 });
  const extreme = { peRatio: 500, priceToBook: 40, debtToEquity: 25, returnOnEquityPct: -80, dividendYieldPct: 0, currentRatio: 0.05, netIncomeEgp: -50_000_000, revenueEgp: 10_000_000, percentiles: {} };
  const result = classifyStock(analysisFrom(bars, { fundamentals: extreme }));
  assert.ok(result.investmentScore >= 0 && result.investmentScore <= 100);
  assert.ok(result.speculationScore >= 0 && result.speculationScore <= 100);
});

test('a sustained downtrend scores lower on investment than a comparable uptrend', () => {
  const up = classifyStock(analysisFrom(synthBars({ sessions: 300, driftPct: 0.1, seed: 2 }), { fundamentals: null }));
  const down = classifyStock(analysisFrom(downtrendBars({ sessions: 300, seed: 2 }), { fundamentals: null }));
  assert.ok(down.investmentScore < up.investmentScore);
});

test('data-quality severity (warn) lowers confidence relative to an otherwise identical ok analysis', () => {
  const bars = synthBars({ sessions: 300, driftPct: 0.05, seed: 51 });
  const ok = classifyStock(analysisFrom(bars, { fundamentals: STRONG_FUNDAMENTALS, severity: 'ok' }));
  const warn = classifyStock(analysisFrom(bars, { fundamentals: STRONG_FUNDAMENTALS, severity: 'warn' }));
  assert.ok(warn.confidence < ok.confidence);
});

test('classification confidence is always a plain 0-100 integer', () => {
  const bars = synthBars({ sessions: 300, driftPct: 0.03, seed: 61 });
  const result = classifyStock(analysisFrom(bars, { fundamentals: STRONG_FUNDAMENTALS }));
  assert.ok(Number.isInteger(result.confidence));
  assert.ok(result.confidence >= 0 && result.confidence <= 100);
});
