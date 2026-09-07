/**
 * REST API.
 *
 * This exists mainly so the API key stops living in the browser. The previous
 * single-file UI called `api.anthropic.com` straight from the page, which
 * cannot work (CORS, and no key was attached) and would have leaked the key to
 * every visitor if it had. Every model call now happens behind this process.
 *
 * The technical endpoints work with no key at all; only /api/review and
 * /api/fundamentals need one, and they say so plainly when it is missing.
 */

import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeTicker, analyzeMany } from '../analyze.js';
import { ALL_CODES, UNIVERSE, lookup } from '../config/universe.js';
import RULES from '../config/rules.js';
import { loadPortfolio, savePortfolio, recordTrade, setLevels, trackedCodes, recordSnapshot, setNote } from '../portfolio.js';
import { aiAvailable } from '../agent/client.js';
import { readBars } from '../data/cache.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const app = express();
app.use(express.json());
app.use(express.static(path.join(ROOT, 'public')));

/** Wrap an async handler so a rejection becomes a 500 instead of an unhandled rejection. */
const wrap = (fn) => (req, res) => fn(req, res).catch((err) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

const capitalOf = (p) =>
  Object.values(p.positions).reduce((a, pos) => a + pos.shares * pos.avgCost, 0) + p.cash;

// ---- Reference data --------------------------------------------------------

app.get('/api/universe', (_req, res) => {
  res.json({ stocks: UNIVERSE, rules: RULES, aiAvailable: aiAvailable() });
});

// ---- Analysis --------------------------------------------------------------

app.get('/api/analyze/:code', wrap(async (req, res) => {
  const portfolio = await loadPortfolio();
  const code = req.params.code.toUpperCase();
  const analysis = await analyzeTicker(code, {
    position: portfolio.positions[code] ?? null,
    capital: capitalOf(portfolio) || 1_000_000,
    force: req.query.force === '1',
  });
  res.status(analysis.usable ? 200 : 422).json(analysis);
}));

app.get('/api/scan', wrap(async (req, res) => {
  const portfolio = await loadPortfolio();
  const codes = req.query.codes ? String(req.query.codes).split(',').map((s) => s.trim().toUpperCase()) : ALL_CODES;
  const { results, errors } = await analyzeMany(codes, {
    capital: capitalOf(portfolio) || 1_000_000,
    positions: portfolio.positions,
    concurrency: 5,
    force: req.query.force === '1',
  });

  const actionable = results.filter((r) => r.plan.actionable && r.plan.buyingNow.worthIt && r.technical.score >= 58);
  res.json({
    asOf: results[0]?.asOf ?? null,
    count: results.length,
    // A compact row per stock — the full analysis is one request away and far
    // too large to send 43 of.
    results: results.map((r) => ({
      code: r.code,
      name: r.name,
      sector: r.sectorAr,
      shariah: r.shariah,
      price: r.snapshot.price.close,
      changePct: r.snapshot.price.changePct,
      score: r.technical.score,
      signal: r.technical.signal,
      trend: r.snapshot.trend,
      rsi: r.snapshot.momentum.rsi14,
      entryStatus: r.plan.entryStatus,
      suggestedEntry: r.plan.suggestedEntry,
      stop: r.plan.stop.stop,
      riskPct: r.plan.stop.riskPct,
      midTarget: r.plan.targets.mid,
      longTarget: r.plan.targets.long,
      riskRewardNow: r.plan.buyingNow.riskReward,
      worthBuyingNow: r.plan.buyingNow.worthIt,
      position: r.position,
    })),
    actionableCodes: actionable.map((r) => r.code),
    errors,
  });
}));

// ---- Portfolio -------------------------------------------------------------

app.get('/api/portfolio', wrap(async (_req, res) => {
  const p = await loadPortfolio();
  res.json({ ...p, capital: capitalOf(p), tracked: trackedCodes(p) });
}));

app.post('/api/portfolio/trade', wrap(async (req, res) => {
  const { code, side, shares, price, date, note } = req.body ?? {};
  if (!code || !side || !shares || !price) {
    return res.status(400).json({ error: 'محتاج code و side و shares و price' });
  }
  const updated = await recordTrade(await loadPortfolio(), {
    code, side, shares: Number(shares), price: Number(price), date, note,
  });
  await savePortfolio(updated);
  res.json({ ...updated, capital: capitalOf(updated) });
}));

app.post('/api/portfolio/cash', wrap(async (req, res) => {
  const amount = Number(req.body?.cash);
  if (!Number.isFinite(amount) || amount < 0) return res.status(400).json({ error: 'مبلغ غير صالح' });
  const updated = await savePortfolio({ ...(await loadPortfolio()), cash: amount });
  res.json(updated);
}));

app.post('/api/portfolio/levels', wrap(async (req, res) => {
  const { code, stop, target } = req.body ?? {};
  const updated = setLevels(await loadPortfolio(), code, {
    stop: stop == null ? null : Number(stop),
    target: target == null ? null : Number(target),
  });
  await savePortfolio(updated);
  res.json(updated);
}));

app.post('/api/portfolio/watchlist', wrap(async (req, res) => {
  const { code, entry, stop, target, qty, note, remove } = req.body ?? {};
  if (!code) return res.status(400).json({ error: 'محتاج code' });
  const p = await loadPortfolio();
  const c = String(code).toUpperCase();
  const watchlist = { ...p.watchlist };
  if (remove) delete watchlist[c];
  else watchlist[c] = { entry: Number(entry) || null, stop: Number(stop) || null, target: Number(target) || null, qty: Number(qty) || null, note: note ?? null };
  const updated = await savePortfolio({ ...p, watchlist });
  res.json(updated);
}));

/** Save today's close into the daily log — the calendar and charts read this. */
app.post('/api/snapshot', wrap(async (req, res) => {
  const portfolio = await loadPortfolio();
  const codes = Object.keys(portfolio.positions);
  if (!codes.length) return res.status(400).json({ error: 'مفيش مراكز مفتوحة تتسجّل' });

  const { results } = await analyzeMany(codes, {
    capital: capitalOf(portfolio),
    positions: portfolio.positions,
    concurrency: 5,
  });

  const updated = recordSnapshot(portfolio, results, req.body?.date ?? null);
  await savePortfolio(updated);
  const day = Object.keys(updated.log).sort().pop();
  res.json({ saved: day, entry: updated.log[day], days: Object.keys(updated.log).length });
}));

/**
 * Backfill the daily log from real historical closes.
 *
 * A fresh install has no history, so the calendar and the equity curve have
 * nothing to draw. This reconstructs them from actual EGX closes valued against
 * the shares you hold TODAY — so it answers "what would this book have been
 * worth", not "what was my book worth". Entries are marked `reconstructed` and
 * never overwrite a real saved close.
 */
app.post('/api/log/backfill', wrap(async (req, res) => {
  const portfolio = await loadPortfolio();
  const codes = Object.keys(portfolio.positions);
  if (!codes.length) return res.status(400).json({ error: 'مفيش مراكز مفتوحة' });

  const days = Math.min(Math.max(Number(req.body?.days) || 60, 5), 250);
  const series = new Map();
  for (const code of codes) {
    const bars = (await readBars(code))?.bars ?? [];
    series.set(code, new Map(bars.slice(-days - 5).map((b) => [b.date, b.c])));
  }

  const dates = [...new Set([...series.values()].flatMap((m) => [...m.keys()]))].sort().slice(-days);
  const log = { ...(portfolio.log ?? {}) };
  let added = 0;
  let priorTotal = null;

  for (const date of dates) {
    let value = 0;
    const prices = {};
    let complete = true;
    for (const code of codes) {
      const px = series.get(code).get(date);
      // Skip days where any holding didn't trade — a partial valuation would
      // show as a phantom drop in the equity curve.
      if (px == null) { complete = false; break; }
      prices[code] = px;
      value += portfolio.positions[code].shares * px;
    }
    if (!complete) continue;

    const total = value + portfolio.cash;
    if (!log[date]?.reconstructed && log[date]) { priorTotal = log[date].total; continue; }

    const cost = codes.reduce((a, c) => a + portfolio.positions[c].shares * portfolio.positions[c].avgCost, 0);
    log[date] = {
      date,
      total: +total.toFixed(2),
      positionsValue: +value.toFixed(2),
      cash: portfolio.cash,
      pl: +(value - cost).toFixed(2),
      dayChange: priorTotal == null ? 0 : +(total - priorTotal).toFixed(2),
      dayChangePct: priorTotal ? +(((total - priorTotal) / priorTotal) * 100).toFixed(2) : 0,
      prices,
      stops: {},
      recs: {},
      changes: [],
      note: log[date]?.note ?? null,
      reconstructed: true,
    };
    priorTotal = total;
    added++;
  }

  await savePortfolio({ ...portfolio, log });
  res.json({ added, days: Object.keys(log).length, from: dates[0], to: dates.at(-1) });
}));

app.get('/api/log', wrap(async (_req, res) => {
  const p = await loadPortfolio();
  res.json({ log: p.log ?? {}, days: Object.keys(p.log ?? {}).sort() });
}));

app.post('/api/log/note', wrap(async (req, res) => {
  const { date, note } = req.body ?? {};
  if (!date) return res.status(400).json({ error: 'محتاج date' });
  const updated = setNote(await loadPortfolio(), date, note ?? '');
  await savePortfolio(updated);
  res.json({ ok: true, entry: updated.log[date] });
}));

app.get('/api/settings', wrap(async (_req, res) => {
  const p = await loadPortfolio();
  res.json({ settings: { ...RULES, ...(p.settings ?? {}) }, rules: RULES });
}));

app.post('/api/settings', wrap(async (req, res) => {
  const p = await loadPortfolio();
  const commissionPct = Number(req.body?.commissionPct);
  if (!Number.isFinite(commissionPct) || commissionPct < 0 || commissionPct > 5) {
    return res.status(400).json({ error: 'نسبة عمولة غير منطقية' });
  }
  const updated = await savePortfolio({ ...p, settings: { ...(p.settings ?? {}), commissionPct } });
  res.json({ ok: true, settings: updated.settings });
}));

/** Wipe the log and trades, keeping positions. Destructive and irreversible. */
app.post('/api/reset', wrap(async (req, res) => {
  const p = await loadPortfolio();
  const scope = req.body?.scope ?? 'log';
  const updated =
    scope === 'all'
      ? { cash: 0, positions: {}, watchlist: {}, trades: [], log: {}, settings: p.settings, realizedPnl: 0 }
      : { ...p, log: {}, trades: [], realizedPnl: 0 };
  await savePortfolio(updated);
  res.json({ ok: true, scope });
}));

// ---- AI endpoints ----------------------------------------------------------

app.post('/api/review', wrap(async (_req, res) => {
  if (!aiAvailable()) {
    return res.status(503).json({
      error: 'مفيش مفتاح API. حط ANTHROPIC_API_KEY في .env — التحليل الفني شغال من غيره.',
      aiAvailable: false,
    });
  }
  const { reviewPortfolio } = await import('../agent/analyst.js');
  const portfolio = await loadPortfolio();
  const codes = trackedCodes(portfolio);
  if (!codes.length) return res.status(400).json({ error: 'المحفظة وقائمة المراقبة فاضيين' });

  const capital = capitalOf(portfolio);
  const { results, errors } = await analyzeMany(codes, {
    capital,
    positions: portfolio.positions,
    concurrency: 5,
  });

  const review = await reviewPortfolio(results, { cash: portfolio.cash, capital });
  res.json({ review, analyses: results, errors });
}));

app.get('/api/fundamentals/:code', wrap(async (req, res) => {
  if (!aiAvailable()) return res.status(503).json({ error: 'مفيش مفتاح API', aiAvailable: false });
  const { getFundamentals } = await import('../agent/fundamentals.js');
  const data = await getFundamentals(req.params.code, { force: req.query.force === '1' });
  if (!data) return res.status(404).json({ error: 'ما لقيتش بيانات أساسية موثوقة' });
  res.json(data);
}));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, aiAvailable: aiAvailable(), universeSize: ALL_CODES.length });
});

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => {
  console.log(`Alytic على http://localhost:${PORT}`);
  console.log(aiAvailable() ? '  الذكاء الاصطناعي: مفعّل' : '  الذكاء الاصطناعي: متوقف (مفيش ANTHROPIC_API_KEY)');
});

export default app;
