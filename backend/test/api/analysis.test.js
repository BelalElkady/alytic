/**
 * Analysis endpoints over fixture bars.
 *
 * ABUK/SWDY/ORAS fixtures are written into the per-file bar cache before any
 * request, so /api/analyze, /api/scan and /api/snapshot run entirely on
 * synthetic data. (Fundamentals and live quotes degrade gracefully to empty
 * when their network endpoints are unreachable — the endpoints still answer.)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import '../helpers/env.js';

import { startServer, request, registerUser } from '../helpers/server.js';
import { writeBars, synthBars, frozenBars } from '../helpers/bars.js';

const UP = synthBars({ sessions: 300, start: 100, driftPct: 0.12, seed: 31 });
const FLAT = synthBars({ sessions: 260, start: 80, driftPct: 0.01, seed: 32 });
await writeBars('ABUK', UP);
await writeBars('SWDY', FLAT);
// EFIC shares ABUK's materials sector — used by the sector-exposure cash-plan test.
await writeBars('EFIC', synthBars({ sessions: 300, start: 100, driftPct: 0.12, seed: 52 }));
await writeBars('ORAS', frozenBars({ sessions: 80 }));

const ctx = await startServer();
const { baseUrl } = ctx;
const { cookie } = await registerUser(baseUrl);

test.after(() => ctx.close());

test('GET /api/analyze/:code returns the full deterministic verdict', async () => {
  const res = await request(baseUrl, 'GET', '/api/analyze/abuk', { cookie });
  assert.equal(res.status, 200, res.text);
  const a = res.body;
  assert.equal(a.code, 'ABUK');
  assert.equal(a.usable, true);
  // The server patches the live quote over the cached close, so the close may
  // differ from the fixture — the plan/stop/target arithmetic below is what
  // must stay internally consistent (all computed from the cached bars).
  assert.ok(a.snapshot.price.close > 0);
  assert.ok(a.technical.score >= 0 && a.technical.score <= 100);
  assert.ok(a.technical.signal.action);
  assert.ok(['buy_now', 'limit_pullback', 'too_extended', 'wait'].includes(a.plan.entryStatus));
  assert.ok(a.plan.stop.stop < a.plan.suggestedEntry);
  assert.ok(a.plan.stop.riskPct > 0 && a.plan.stop.riskPct <= 12);
  assert.ok(a.plan.targets.mid === null || a.plan.targets.mid.price > a.plan.suggestedEntry);
  assert.equal(a.position, null);
  assert.ok(a.quality.ok);
  // Investment-vs-speculation classification (see scoring/classification.js)
  // reaches the API unchanged — computed inside analyzeTicker, never recomputed here.
  assert.ok(['INVESTMENT', 'SPECULATIVE', 'HYBRID', 'NEUTRAL'].includes(a.classification.type));
  assert.ok(a.classification.investmentScore >= 0 && a.classification.investmentScore <= 100);
  assert.ok(a.classification.speculationScore >= 0 && a.classification.speculationScore <= 100);
  assert.ok(a.classification.confidence >= 0 && a.classification.confidence <= 100);
  assert.ok(Array.isArray(a.classification.reasons.investment));
  assert.ok(Array.isArray(a.classification.dataQuality.missingMetrics));
});

test('same bars → same numbers: the reproducibility guarantee', async () => {
  const first = await request(baseUrl, 'GET', '/api/analyze/ABUK', { cookie });
  const second = await request(baseUrl, 'GET', '/api/analyze/ABUK', { cookie });
  for (const key of ['technical.score', 'plan.entryStatus', 'plan.suggestedEntry', 'plan.stop.stop', 'snapshot.momentum.rsi14']) {
    const [f, s] = key.split('.');
    const walk = (obj) => obj[f] != null ? (s ? obj[f][s] : obj[f]) : null;
    assert.deepEqual(walk(first.body), walk(second.body), key);
  }
  if (first.body.plan.targets.mid && second.body.plan.targets.mid) {
    assert.equal(first.body.plan.targets.mid.price, second.body.plan.targets.mid.price);
    assert.equal(first.body.plan.targets.mid.horizon.sessions, second.body.plan.targets.mid.horizon.sessions);
  }
});

test('a frozen series is refused with 422, not scored', async () => {
  const res = await request(baseUrl, 'GET', '/api/analyze/ORAS', { cookie });
  assert.equal(res.status, 422);
  assert.equal(res.body.usable, false);
  assert.ok(res.body.error);
  assert.ok(res.body.quality.ok === false);
});

test('GET /api/scan plans the cash allocation across the requested codes', async () => {
  const res = await request(baseUrl, 'GET', '/api/scan?codes=ABUK,SWDY', { cookie });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.count, 2);
  assert.ok(Array.isArray(res.body.results));
  for (const row of res.body.results) {
    assert.ok(['ABUK', 'SWDY'].includes(row.code));
    assert.ok(row.score >= 0 && row.score <= 100);
    assert.ok(row.signal);
    assert.ok(row.price > 0);
    assert.ok(row.sector, 'rows carry the Arabic sector label');
    // Compact classification (see scoring/classification.js) — the full
    // breakdown/reasons stay behind /api/analyze/:code to keep this row small.
    assert.ok(['INVESTMENT', 'SPECULATIVE', 'HYBRID', 'NEUTRAL'].includes(row.classification.type));
    assert.ok(row.classification.investmentScore >= 0 && row.classification.investmentScore <= 100);
    if (row.buyPlan) {
      assert.ok(row.buyPlan.entry > 0);
      assert.ok(row.buyPlan.stop > 0);
      assert.ok(Number.isInteger(row.buyPlan.shares));
      assert.ok(row.buyPlan.cost >= 0);
      assert.ok(Number.isInteger(row.buyPlan.riskLimitShares), 'risk-sized shares (sector-aware)');
      assert.ok(Number.isInteger(row.buyPlan.cashLimitShares));
      assert.ok(row.buyPlan.cashAfter >= 0);
      assert.ok(row.buyPlan.reason);
    }
  }
  const cp = res.body.cashPlan;
  assert.ok(cp);
  assert.ok(cp.selectedCodes.every((c) => ['ABUK', 'SWDY'].includes(c)));
  assert.ok(cp.investableCash >= 0 && cp.reserveCash >= 0 && cp.allocationPerStock >= 0);
  assert.ok(cp.unallocatedCash >= 0);
  assert.ok(res.body.actionableCodes.every((c) => ['ABUK', 'SWDY'].includes(c)));

  const badStyle = await request(baseUrl, 'GET', '/api/scan?codes=ABUK&style=yolo', { cookie });
  assert.equal(badStyle.status, 400);
  const badIndex = await request(baseUrl, 'GET', '/api/scan?codes=ABUK&index=NOPE', { cookie });
  assert.equal(badIndex.status, 400);
  const styled = await request(baseUrl, 'GET', '/api/scan?codes=ABUK&style=trader', { cookie });
  assert.equal(styled.status, 200);
  assert.equal(styled.body.style, 'trader');
});

test('the cash plan sizes candidates against the sector the book is already in', async () => {
  // ABUK and EFIC share the materials sector. Without a position both size
  // normally; once the book holds a large ABUK stake the sector cap binds and
  // EFIC sizes to zero — dropping out of the cash plan instead of piling on.
  const sectorRow = (res, code) => res.body.results.find((r) => r.code === code);

  // Baseline: no positions → EFIC is a real candidate with a positive risk size.
  const { cookie: cleanCookie } = await registerUser(baseUrl);
  await request(baseUrl, 'POST', '/api/portfolio/cash', { body: { cash: 1_000_000 }, cookie: cleanCookie });
  const clean = await request(baseUrl, 'GET', '/api/scan?codes=ABUK,EFIC', { cookie: cleanCookie });
  assert.equal(clean.status, 200, clean.text);
  const cleanEfic = sectorRow(clean, 'EFIC');
  assert.equal(cleanEfic.position, null);
  assert.ok(cleanEfic.score >= 58, `EFIC should read as actionable (score ${cleanEfic.score})`);
  assert.equal(cleanEfic.worthBuyingNow, true);
  assert.ok(cleanEfic.midTarget?.price, 'an actionable row needs a mid target to be a candidate');
  assert.ok(Number.isInteger(cleanEfic.buyPlan.riskLimitShares) && cleanEfic.buyPlan.riskLimitShares > 0,
    `unsaturated EFIC should size to shares, got ${cleanEfic.buyPlan?.riskLimitShares}`);

  // Now hold a large ABUK stake: 4,000 shares × the fixture close (~143 EGP)
  // is ~40% of capital — past the 30% sector cap.
  const { cookie: heavyCookie } = await registerUser(baseUrl);
  await request(baseUrl, 'POST', '/api/portfolio/cash', { body: { cash: 1_000_000 }, cookie: heavyCookie });
  const trade = await request(baseUrl, 'POST', '/api/portfolio/trade', {
    body: { code: 'ABUK', side: 'buy', shares: 4_000, price: 1 }, cookie: heavyCookie,
  });
  assert.equal(trade.status, 200);
  const heavy = await request(baseUrl, 'GET', '/api/scan?codes=ABUK,EFIC', { cookie: heavyCookie });
  assert.equal(heavy.status, 200, heavy.text);

  const heavyEfic = sectorRow(heavy, 'EFIC');
  assert.equal(heavyEfic.sector, cleanEfic.sector, 'ABUK and EFIC share the sector');
  assert.equal(heavyEfic.buyPlan.riskLimitShares, 0, 'the saturated sector must size to zero');
  assert.equal(heavyEfic.buyPlan.shares, 0);
  assert.equal(heavyEfic.cashPlanSelected, false);
  // "للقطاع" (for-the-sector) is "لـ" + "القطاع" with the alef elided per
  // normal Arabic orthography, so "القطاع" is never a literal substring of it.
  assert.ok(heavyEfic.buyPlan.reason.includes('قطاع'), heavyEfic.buyPlan.reason);
  assert.ok(!heavy.body.cashPlan.selectedCodes.includes('EFIC'));

  // The held row itself keeps a position and is never a buy candidate.
  const heldAbuk = sectorRow(heavy, 'ABUK');
  assert.ok(heldAbuk.position);
  assert.ok(!heavy.body.cashPlan.selectedCodes.includes('ABUK'));
});

test('GET /api/indices/performance answers with one row per index even when the feed is unreachable', async () => {
  const res = await request(baseUrl, 'GET', '/api/indices/performance', { cookie });
  assert.equal(res.status, 200, res.text);
  assert.ok(res.body.asOf);
  assert.ok(Array.isArray(res.body.indices));
  assert.deepEqual(res.body.indices.map((i) => i.name).sort(), ['EGX100', 'EGX30', 'EGX33', 'EGX70']);
  for (const row of res.body.indices) {
    assert.ok(row.constituentCount > 0);
    assert.ok(row.quotedCount >= 0);
    // With the live feed unreachable in tests, best/worst/changePct degrade to
    // null rather than the request failing — never a partial/broken shape.
    if (row.quotedCount === 0) {
      assert.equal(row.best, null);
      assert.equal(row.worst, null);
      assert.equal(row.avgChangePct, null);
    } else {
      assert.ok(row.best.code && Number.isFinite(row.best.changePct));
      assert.ok(row.worst.code && Number.isFinite(row.worst.changePct));
    }
  }
});

test('GET /api/quotes answers with a quote map even when the feed is unreachable', async () => {
  const res = await request(baseUrl, 'GET', '/api/quotes?codes=ABUK,SWDY', { cookie });
  assert.equal(res.status, 200);
  assert.ok(typeof res.body.quotes === 'object');
  assert.ok(res.body.asOf);
});

test('POST /api/snapshot logs the day using fixture prices', async () => {
  const { cookie: c2 } = await registerUser(baseUrl);
  await request(baseUrl, 'POST', '/api/portfolio/cash', { body: { cash: 50_000 }, cookie: c2 });
  const trade = await request(baseUrl, 'POST', '/api/portfolio/trade', {
    body: { code: 'ABUK', side: 'buy', shares: 100, price: 110 }, cookie: c2,
  });
  assert.equal(trade.status, 200);

  const snap = await request(baseUrl, 'POST', '/api/snapshot', { body: {}, cookie: c2 });
  assert.equal(snap.status, 200, snap.text);
  // Live quotes are patched over the cached close, so assert self-consistency
  // rather than the fixture value itself.
  assert.ok(snap.body.entry.prices.ABUK > 0);
  assert.equal(snap.body.entry.positionsValue, +(snap.body.entry.prices.ABUK * 100).toFixed(2));

  // empty book → 400
  const { cookie: c3 } = await registerUser(baseUrl);
  const empty = await request(baseUrl, 'POST', '/api/snapshot', { body: {}, cookie: c3 });
  assert.equal(empty.status, 400);
});

test('POST /api/log/backfill reconstructs history from fixture bars', async () => {
  const { cookie: c4 } = await registerUser(baseUrl);
  await request(baseUrl, 'POST', '/api/portfolio/cash', { body: { cash: 100_000 }, cookie: c4 });
  await request(baseUrl, 'POST', '/api/portfolio/trade', {
    body: { code: 'ABUK', side: 'buy', shares: 100, price: 110 }, cookie: c4,
  });
  const res = await request(baseUrl, 'POST', '/api/log/backfill', { body: { days: 30 }, cookie: c4 });
  assert.equal(res.status, 200, res.text);
  assert.ok(res.body.added >= 1);
  assert.ok(res.body.from && res.body.to);
  assert.ok(Object.keys(res.body).includes('days'));

  // days is clamped into [5, 250]
  const tiny = await request(baseUrl, 'POST', '/api/log/backfill', { body: { days: 1 }, cookie: c4 });
  assert.equal(tiny.status, 200);

  const empty = await request(baseUrl, 'POST', '/api/log/backfill', { body: {}, cookie: await registerUser(baseUrl).then((u) => u.cookie) });
  assert.equal(empty.status, 400);
  assert.ok(empty.body.error.includes('مفيش مراكز'));
});