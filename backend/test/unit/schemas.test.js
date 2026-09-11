import test from 'node:test';
import assert from 'node:assert/strict';

import '../helpers/env.js';

import { FundamentalsSchema } from '../../src/agent/schemas.js';

/** A complete fundamentals payload exactly as the research agent should emit it. */
const full = {
  code: 'ABUK',
  asOf: '2026-09-01',
  peRatio: 8.5,
  epsEgp: 4.2,
  bookValueEgp: 18.75,
  priceToBook: 1.1,
  dividendYieldPct: 6.3,
  marketCapEgp: 7_500_000_000,
  revenueGrowthPct: 12.4,
  profitGrowthPct: -3.1,
  debtToEquity: 0.42,
  returnOnEquityPct: 24.6,
  returnOnAssetsPct: 13.2,
  currentRatio: 1.8,
  evToEbitda: 5.9,
  netDebtToEbitda: 0.8,
  freeCashFlowYieldPct: 4.7,
  dividendHistory: [
    { exDate: '2026-05-20', paymentDate: '2026-06-05', amountEgp: 1.25, type: 'نقدي' },
    { exDate: null, paymentDate: null, amountEgp: null, type: 'أسهم منحة' },
  ],
  businessSummary: 'شركة أسمدة بتنتج يوريا ونشتريها المزارعين.',
  fundamentalStrength: 'قوية',
  keyPositives: ['أرباح مستقرة'],
  keyRisks: ['الغاز'],
  recentNews: [{ date: '2026-08-30', headline: 'توزيعات جديدة', impact: 'إيجابي' }],
  sources: ['https://mubasher.info/markets/EGX/stocks/ABUK'],
  confidence: 'عالية',
};

test('a complete payload parses with every widened field', () => {
  const parsed = FundamentalsSchema.parse(full);
  assert.equal(parsed.priceToBook, 1.1);
  assert.equal(parsed.returnOnEquityPct, 24.6);
  assert.equal(parsed.currentRatio, 1.8);
  assert.equal(parsed.evToEbitda, 5.9);
  assert.equal(parsed.netDebtToEbitda, 0.8);
  assert.equal(parsed.freeCashFlowYieldPct, 4.7);
  assert.equal(parsed.returnOnAssetsPct, 13.2);
  assert.equal(parsed.dividendHistory.length, 2);
  assert.equal(parsed.dividendHistory[0].type, 'نقدي');
  assert.equal(parsed.dividendHistory[1].type, 'أسهم منحة');
  assert.equal(parsed.dividendHistory[1].amountEgp, null, 'a bonus dividend has no cash amount');
});

test('every ratio is nullable and an empty dividend history is valid', () => {
  const parsed = FundamentalsSchema.parse({
    ...full,
    peRatio: null,
    epsEgp: null,
    bookValueEgp: null,
    priceToBook: null,
    dividendYieldPct: null,
    marketCapEgp: null,
    revenueGrowthPct: null,
    profitGrowthPct: null,
    debtToEquity: null,
    returnOnEquityPct: null,
    returnOnAssetsPct: null,
    currentRatio: null,
    evToEbitda: null,
    netDebtToEbitda: null,
    freeCashFlowYieldPct: null,
    dividendHistory: [],
  });
  assert.equal(parsed.peRatio, null);
  assert.deepEqual(parsed.dividendHistory, []);
});

test('a dividend with unknown dates and no amount still parses', () => {
  const parsed = FundamentalsSchema.parse({
    ...full,
    dividendHistory: [{ exDate: null, paymentDate: null, amountEgp: null, type: 'نقدي' }],
  });
  assert.equal(parsed.dividendHistory.length, 1);
});

test('garbage is rejected with a named issue', () => {
  // a non-numeric P/E
  assert.throws(() => FundamentalsSchema.parse({ ...full, peRatio: 'cheap' }));
  // an unknown dividend type
  assert.throws(() => FundamentalsSchema.parse({
    ...full,
    dividendHistory: [{ exDate: null, paymentDate: null, amountEgp: 1, type: 'توزيع مجاني' }],
  }));
  // an invalid strength verdict
  assert.throws(() => FundamentalsSchema.parse({ ...full, fundamentalStrength: 'رهيبة' }));
  // an invalid news impact
  assert.throws(() => FundamentalsSchema.parse({
    ...full,
    recentNews: [{ date: '2026-08-30', headline: 'x', impact: 'متذبذب' }],
  }));
  // missing required narrative fields
  assert.throws(() => FundamentalsSchema.parse({ ...full, businessSummary: undefined }));
  assert.throws(() => FundamentalsSchema.parse({ ...full, code: undefined }));
});