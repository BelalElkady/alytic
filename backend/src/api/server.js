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
import { fileURLToPath, pathToFileURL } from 'node:url';
import { analyzeTicker, analyzeMany } from '../analyze.js';
import { ALL_CODES, UNIVERSE, lookup } from '../config/universe.js';
import { INDICES_AS_OF, UPLOADABLE_INDICES, codesForIndex, effectiveIndices } from '../config/indices.js';
import { getAllIndexOverrides, setIndexOverride, clearIndexOverride } from '../db.js';
import { STYLE_KEYS, rulesForStyle } from '../config/styles.js';
import RULES from '../config/rules.js';
import { loadPortfolio, withPortfolio, recordTrade, setLevels, trackedCodes, recordSnapshot, setNote } from '../portfolio.js';
import { aiAvailable, callWithRetry, getOpenRouterClient } from '../agent/clientOpenRouter.js';

// Pinned independently of the shared MODEL export so a future ALYTIC_MODEL
// change for the text-analysis path can never silently redirect vision too —
// this is the one deliberate holdout on Claude (Qwen's vision accuracy is
// untested and this feature has a history of real accuracy bugs). A stale
// model override once sent this route to a text-only "thinking" model with
// zero vision-capable endpoints, producing an opaque 404 — verified live.
const SCREENSHOT_VISION_MODEL = process.env.ALYTIC_VISION_MODEL ?? 'anthropic/claude-sonnet-5';
import { readBars } from '../data/cache.js';
import { fetchLatestQuotes } from '../data/tv-history.js';
import { login, register, userFromRequest, sessionCookie, clearSessionCookie, googleSignIn, verifyEmail, resendVerification } from '../auth.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const app = express();
app.use(express.json());

// The vanilla-JS UI (formerly public/index.html) is retired in favor of the
// EGXpert frontend in frontend/ (TanStack Start, its own dev/build process).
// This process stays API-only for the browser: send a human landing on it
// straight to the real app instead of serving stale markup.
const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:8080';
app.get('/', (_req, res) => res.redirect(FRONTEND_URL));

app.use(express.static(path.join(ROOT, 'public')));

/** Wrap an async handler so a rejection becomes a 500 instead of an unhandled rejection. */
const wrap = (fn) => (req, res) => fn(req, res).catch((err) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

app.post('/api/auth/register', wrap(async (req, res) => {
  const result = await register(req.body ?? {});
  res.setHeader('Set-Cookie', sessionCookie(result.token));
  res.status(201).json({ user: result.user });
}));

app.post('/api/auth/login', wrap(async (req, res) => {
  const result = await login(req.body ?? {});
  res.setHeader('Set-Cookie', sessionCookie(result.token));
  res.json({ user: result.user });
}));

app.post('/api/auth/google', wrap(async (req, res) => {
  const result = await googleSignIn(req.body ?? {});
  res.setHeader('Set-Cookie', sessionCookie(result.token));
  res.json({ user: result.user });
}));

app.post('/api/auth/verify', wrap(async (req, res) => {
  const result = await verifyEmail(req.body ?? {});
  res.json(result);
}));

app.post('/api/auth/resend-verification', wrap(async (req, res) => {
  await resendVerification(req.body ?? {});
  res.json({ ok: true });
}));

app.post('/api/auth/logout', (_req, res) => {
  res.setHeader('Set-Cookie', clearSessionCookie());
  res.json({ ok: true });
});

app.get('/api/auth/me', wrap(async (req, res) => {
  const user = await userFromRequest(req);
  res.json({ user });
}));

app.use('/api', async (req, res, next) => {
  if (req.path.startsWith('/auth/') || req.path === '/health' || req.path === '/universe' || req.path === '/indices') return next();
  const user = await userFromRequest(req);
  if (!user) return res.status(401).json({ error: 'سجّل الدخول الأول' });
  req.user = user;
  next();
});

const capitalOf = (p) =>
  Object.values(p.positions).reduce((a, pos) => a + pos.shares * pos.avgCost, 0) + p.cash;

// ---- Reference data --------------------------------------------------------

app.get('/api/universe', (_req, res) => {
  res.json({ stocks: UNIVERSE, rules: RULES, aiAvailable: aiAvailable() });
});

// Membership lists for EGX's four headline indices, so the market scan can be
// filtered to one instead of always scanning the whole tracked universe. See
// src/config/indices.js for sourcing and its accuracy caveats.
app.get('/api/indices', (_req, res) => {
  res.json({ indices: effectiveIndices(), asOf: INDICES_AS_OF });
});

// ---- Admin ------------------------------------------------------------------

app.use('/api/admin', (req, res, next) => {
  if (!req.user?.isAdmin) return res.status(403).json({ error: 'للمشرفين فقط' });
  next();
});

/** One line per ticker; a leading "ticker/code/symbol" header row is skipped, as is anything else in the line past the first comma. */
function parseTickerCsv(text) {
  const seen = new Set();
  for (const rawLine of String(text ?? '').split(/\r?\n/)) {
    const token = rawLine.split(',')[0]?.trim().replace(/^["']|["']$/g, '').toUpperCase();
    if (!token || ['TICKER', 'CODE', 'SYMBOL'].includes(token)) continue;
    seen.add(token);
  }
  return [...seen];
}

app.get('/api/admin/indices', wrap(async (req, res) => {
  const overrides = getAllIndexOverrides();
  const indices = UPLOADABLE_INDICES.map((name) => {
    const override = overrides[name];
    const tickers = codesForIndex(name);
    return {
      name,
      tickers,
      count: tickers.length,
      source: override ? 'upload' : 'default',
      updatedAt: override?.updatedAt ?? null,
      updatedBy: override?.updatedBy ?? null,
    };
  });
  res.json({ indices });
}));

app.post('/api/admin/indices/:name', express.raw({ type: '*/*', limit: '256kb' }), wrap(async (req, res) => {
  const name = String(req.params.name).toUpperCase();
  if (!UPLOADABLE_INDICES.includes(name)) return res.status(400).json({ error: `مؤشر غير قابل للرفع: ${name}` });
  if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'ارفع ملف CSV أولاً' });

  const tickers = parseTickerCsv(req.body.toString('utf8'));
  if (!tickers.length) return res.status(400).json({ error: 'الملف فاضي أو مفيهوش أكواد صحيحة' });

  const known = new Set(ALL_CODES);
  const matched = tickers.filter((t) => known.has(t));
  const unmatched = tickers.filter((t) => !known.has(t));
  if (!matched.length) return res.status(400).json({ error: 'ولا كود في الملف موجود في قاعدة الأسهم المتابَعة', unmatched });

  setIndexOverride(name, matched, req.user.id);
  res.json({ ok: true, name, saved: matched.length, unmatched });
}));

app.post('/api/admin/indices/:name/reset', wrap(async (req, res) => {
  const name = String(req.params.name).toUpperCase();
  if (!UPLOADABLE_INDICES.includes(name)) return res.status(400).json({ error: `مؤشر غير قابل للرفع: ${name}` });
  clearIndexOverride(name);
  res.json({ ok: true, name, tickers: codesForIndex(name) });
}));

// ---- Analysis --------------------------------------------------------------

app.get('/api/analyze/:code', wrap(async (req, res) => {
  const portfolio = await loadPortfolio(req.user.id);
  const code = req.params.code.toUpperCase();
  const analysis = await analyzeTicker(code, {
    position: portfolio.positions[code] ?? null,
    capital: capitalOf(portfolio) || 1_000_000,
    force: req.query.force === '1',
  });
  const live = (await fetchLatestQuotes([code])).get(code);
  if (live && analysis.snapshot?.price) {
    analysis.snapshot.price = {
      ...analysis.snapshot.price,
      dailyClose: analysis.snapshot.price.close,
      close: live.price,
      changePct: live.changePct ?? analysis.snapshot.price.changePct,
      lastTradePrice: live.price,
      lastTradeTime: live.time,
    };
  }
  res.status(analysis.usable ? 200 : 422).json(analysis);
}));

app.get('/api/quotes', wrap(async (req, res) => {
  const portfolio = await loadPortfolio(req.user.id);
  const requested = req.query.codes
    ? String(req.query.codes).split(',').map((code) => code.trim().toUpperCase()).filter(Boolean)
    : Object.keys(portfolio.positions);
  const quotes = await fetchLatestQuotes(requested);
  res.json({ asOf: new Date().toISOString(), quotes: Object.fromEntries(quotes) });
}));

app.get('/api/scan', wrap(async (req, res) => {
  const portfolio = await loadPortfolio(req.user.id);
  const indexCodes = req.query.index ? codesForIndex(req.query.index) : null;
  if (req.query.index && !indexCodes) return res.status(400).json({ error: `مؤشر غير معروف: ${req.query.index}` });
  const codes = req.query.codes
    ? String(req.query.codes).split(',').map((s) => s.trim().toUpperCase())
    : indexCodes ?? ALL_CODES;
  const style = req.query.style;
  if (style && !STYLE_KEYS.includes(style)) return res.status(400).json({ error: `أسلوب غير معروف: ${style}` });
  // A style changes which rule numbers the engine sizes and gates setups
  // with — same deterministic engine, different risk/reward and sizing
  // inputs, exactly like every other `rules` param it already accepts.
  const rules = style ? rulesForStyle(RULES, style) : RULES;
  const { results, errors } = await analyzeMany(codes, {
    capital: capitalOf(portfolio) || 1_000_000,
    positions: portfolio.positions,
    concurrency: 5,
    force: req.query.force === '1',
    rules,
  });
  const latestQuotes = await fetchLatestQuotes(results.map((result) => result.code));

  const actionable = results.filter((r) => r.plan.actionable && r.plan.buyingNow.worthIt && r.technical.score >= 58);
  const cashReserve = Math.max(0, portfolio.cash * (rules.sizing.minCashBufferPct / 100));
  const investableCash = Math.max(0, portfolio.cash - cashReserve);
  const maxRecommendations = 3;
  const candidates = results
    .filter((r) => !r.position && r.plan.actionable && r.plan.buyingNow.worthIt && r.plan.targets.mid?.price && (r.plan.sizing?.shares ?? 0) > 0)
    .map((r) => ({
      code: r.code,
      sector: r.sectorAr,
      rankScore: r.technical.score + Math.min(r.plan.buyingNow.riskReward ?? 0, 5) * 4 - r.plan.stop.riskPct * 1.5,
    }))
    .sort((a, b) => b.rankScore - a.rankScore);
  const selected = [];
  const sectors = new Set();
  for (const candidate of candidates) {
    if (selected.length >= maxRecommendations) break;
    if (candidate.sector && sectors.has(candidate.sector)) continue;
    selected.push(candidate);
    if (candidate.sector) sectors.add(candidate.sector);
  }
  for (const candidate of candidates) {
    if (selected.length >= maxRecommendations || selected.some((item) => item.code === candidate.code)) continue;
    selected.push(candidate);
  }
  const allocationPerStock = selected.length ? investableCash / selected.length : 0;
  const selectedCodes = new Set(selected.map((candidate) => candidate.code));
  res.json({
    asOf: results[0]?.asOf ?? null,
    count: results.length,
    cash: portfolio.cash,
    // A compact row per stock — the full analysis is one request away and far
    // too large to send 43 of.
    results: results.map((r) => {
      const live = latestQuotes.get(r.code);
      const livePrice = live?.price ?? r.snapshot.price.close;
      const entry = r.plan.suggestedEntry;
      const riskShares = r.plan.sizing?.shares ?? 0;
      const cashShares = entry > 0 ? Math.floor(Math.max(0, portfolio.cash) / entry) : 0;
      const cashPlanSelected = selectedCodes.has(r.code);
      const allocationShares = entry > 0 ? Math.floor(allocationPerStock / entry) : 0;
      const recommendedShares = cashPlanSelected ? Math.min(riskShares, allocationShares, cashShares) : 0;
      const buyPlan = entry > 0 ? {
        entry,
        stop: r.plan.stop.stop,
        target: r.plan.targets.mid?.price ?? null,
        shares: recommendedShares,
        cost: +(recommendedShares * entry).toFixed(2),
        allocation: cashPlanSelected ? +allocationPerStock.toFixed(2) : 0,
        cashAfter: +(portfolio.cash - recommendedShares * entry).toFixed(2),
        risk: +(recommendedShares * Math.max(0, entry - r.plan.stop.stop)).toFixed(2),
        riskLimitShares: riskShares,
        cashLimitShares: cashShares,
        reason: recommendedShares === 0
          ? (portfolio.cash <= 0 ? 'لا يوجد كاش متاح' : r.plan.sizing?.reason ?? 'لا يوجد حجم مناسب حسب قواعد المخاطرة')
          : `شراء ${recommendedShares} سهم عند ${entry} بأمر محدد؛ توزيع متساوٍ تقريبًا بين أفضل ${selected.length} أسهم مع احتياطي كاش ${rules.sizing.minCashBufferPct}%`,
      } : null;
      const position = r.position && live
        ? { ...r.position, marketValue: +(r.position.shares * livePrice).toFixed(2), unrealizedEgp: +(r.position.shares * (livePrice - r.position.avgCost)).toFixed(2) }
        : r.position;
      return ({
      code: r.code,
      name: r.name,
      sector: r.sectorAr,
      shariah: r.shariah,
      price: livePrice,
      lastTradePrice: live?.price ?? null,
      lastTradeTime: live?.time ?? null,
      changePct: live?.changePct ?? r.snapshot.price.changePct,
      score: r.technical.score,
      signal: r.technical.signal,
      trend: r.snapshot.trend,
      rsi: r.snapshot.momentum.rsi14,
      entryStatus: r.plan.entryStatus,
      suggestedEntry: r.plan.suggestedEntry,
      entryNote: r.plan.entryNote,
      stop: r.plan.stop.stop,
      riskPct: r.plan.stop.riskPct,
      midTarget: r.plan.targets.mid,
      longTarget: r.plan.targets.long,
      riskRewardNow: r.plan.buyingNow.riskReward,
      worthBuyingNow: r.plan.buyingNow.worthIt,
      buyPlan,
      cashPlanSelected,
      position,
    });
    }),
    actionableCodes: actionable.map((r) => r.code),
    focus: req.query.focus ?? 'market',
    style: style ?? 'medium',
    cashPlan: {
      selectedCodes: [...selectedCodes],
      investableCash: +investableCash.toFixed(2),
      reserveCash: +cashReserve.toFixed(2),
      allocationPerStock: +allocationPerStock.toFixed(2),
      unallocatedCash: +(investableCash - results.filter((r) => selectedCodes.has(r.code)).reduce((sum, r) => {
        const entry = r.plan.suggestedEntry;
        const riskShares = r.plan.sizing?.shares ?? 0;
        return sum + Math.min(riskShares, entry > 0 ? Math.floor(allocationPerStock / entry) : 0) * entry;
      }, 0)).toFixed(2),
    },
    errors,
  });
}));

// ---- Portfolio -------------------------------------------------------------

app.get('/api/portfolio', wrap(async (req, res) => {
  const p = await loadPortfolio(req.user.id);
  res.json({ ...p, capital: capitalOf(p), tracked: trackedCodes(p) });
}));

app.post('/api/portfolio/trade', wrap(async (req, res) => {
  const { code, side, shares, price, date, note } = req.body ?? {};
  if (!code || !side || !shares || !price) {
    return res.status(400).json({ error: 'محتاج code و side و shares و price' });
  }
  const updated = await withPortfolio(req.user.id, (portfolio) =>
    recordTrade(portfolio, { code, side, shares: Number(shares), price: Number(price), date, note }),
  );
  res.json({ ...updated, capital: capitalOf(updated) });
}));

app.post('/api/portfolio/cash', wrap(async (req, res) => {
  const amount = Number(req.body?.cash);
  if (!Number.isFinite(amount) || amount < 0) return res.status(400).json({ error: 'مبلغ غير صالح' });
  const updated = await withPortfolio(req.user.id, (portfolio) => ({ ...portfolio, cash: amount }));
  res.json(updated);
}));

app.post('/api/portfolio/levels', wrap(async (req, res) => {
  const { code, stop, target } = req.body ?? {};
  const updated = await withPortfolio(req.user.id, (portfolio) =>
    setLevels(portfolio, code, { stop: stop == null ? null : Number(stop), target: target == null ? null : Number(target) }),
  );
  res.json(updated);
}));

/**
 * Correct a holding's share count / average cost by hand.
 *
 * Needed because a screenshot import can only ever infer a share count when the
 * quantity isn't legible on screen, and an inferred count silently replaced
 * explicitly recorded trades (a real 800-share VLMRA position was overwritten
 * with a derived 1223). This is the way back to the true numbers. Setting
 * either value clears the "estimated" flag — the user has now told us directly.
 */
app.post('/api/portfolio/holding', wrap(async (req, res) => {
  const { code, shares, avgCost } = req.body ?? {};
  if (!code) return res.status(400).json({ error: 'محتاج code' });
  const c = String(code).toUpperCase();

  const nextShares = shares == null || shares === '' ? null : Number(shares);
  const nextAvgCost = avgCost == null || avgCost === '' ? null : Number(avgCost);
  if (nextShares != null && (!Number.isFinite(nextShares) || nextShares < 0)) {
    return res.status(400).json({ error: 'عدد الأسهم لازم يكون رقم موجب' });
  }
  if (nextAvgCost != null && (!Number.isFinite(nextAvgCost) || nextAvgCost <= 0)) {
    return res.status(400).json({ error: 'متوسط الشراء لازم يكون أكبر من صفر' });
  }

  const updated = await withPortfolio(req.user.id, (portfolio) => {
    const existing = portfolio.positions[c];
    if (!existing) throw new Error(`مفيش مركز مفتوح في ${c}`);
    const positions = { ...portfolio.positions };

    // Zero shares means the position is closed out entirely.
    if (nextShares === 0) {
      delete positions[c];
      return { ...portfolio, positions };
    }

    const { derivedFromScreenshot, reportedValue, reportedPnl, ...rest } = existing;
    positions[c] = {
      ...rest,
      shares: nextShares ?? existing.shares,
      avgCost: nextAvgCost ?? existing.avgCost,
    };
    return { ...portfolio, positions };
  });
  res.json(updated);
}));

app.post('/api/portfolio/watchlist', wrap(async (req, res) => {
  const { code, entry, stop, target, qty, note, remove } = req.body ?? {};
  if (!code) return res.status(400).json({ error: 'محتاج code' });
  const c = String(code).toUpperCase();
  const updated = await withPortfolio(req.user.id, (portfolio) => {
    const watchlist = { ...portfolio.watchlist };
    if (remove) delete watchlist[c];
    else watchlist[c] = { entry: Number(entry) || null, stop: Number(stop) || null, target: Number(target) || null, qty: Number(qty) || null, note: note ?? null };
    return { ...portfolio, watchlist };
  });
  res.json(updated);
}));

/** Save today's close into the daily log — the calendar and charts read this. */
app.post('/api/snapshot', wrap(async (req, res) => {
  // Fast, unlocked check for the common "nothing to snapshot" case, so it
  // still returns 400 immediately rather than paying for a lock acquisition.
  const precheck = await loadPortfolio(req.user.id);
  if (!Object.keys(precheck.positions).length) return res.status(400).json({ error: 'مفيش مراكز مفتوحة تتسجّل' });

  const updated = await withPortfolio(req.user.id, async (portfolio) => {
    const codes = Object.keys(portfolio.positions);
    const { results } = await analyzeMany(codes, { capital: capitalOf(portfolio), positions: portfolio.positions, concurrency: 5 });
    // analyzeMany's price comes from the last data *sync*, not from now — a
    // click mid-session (before that day's sync has run) would otherwise save
    // yesterday's cached close mislabeled as today's, disagreeing with the
    // live price the desk is showing at that exact moment. Patch in live
    // quotes the same way /api/scan and /api/analyze already do.
    const live = await fetchLatestQuotes(codes).catch(() => new Map());
    const withLivePrices = results.map((r) => {
      const quote = live.get(r.code);
      if (!quote?.price || !r.position) return r;
      const price = quote.price;
      return {
        ...r,
        snapshot: {
          ...r.snapshot,
          price: { ...r.snapshot.price, close: price, changePct: quote.changePct ?? r.snapshot.price.changePct },
        },
        position: {
          ...r.position,
          marketValue: +(r.position.shares * price).toFixed(2),
          unrealizedEgp: +(r.position.shares * (price - r.position.avgCost)).toFixed(2),
        },
      };
    });
    return recordSnapshot(portfolio, withLivePrices, req.body?.date ?? null);
  });
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
  const precheck = await loadPortfolio(req.user.id);
  const precheckCodes = Object.keys(precheck.positions);
  if (!precheckCodes.length) return res.status(400).json({ error: 'مفيش مراكز مفتوحة' });

  const days = Math.min(Math.max(Number(req.body?.days) || 60, 5), 250);

  // Historical bars are per-symbol disk reads, independent of portfolio state,
  // and reading them for every held code is the slow part of this endpoint —
  // done once here, outside the lock, so it never blocks other writes.
  const series = new Map();
  for (const code of precheckCodes) {
    const bars = (await readBars(code))?.bars ?? [];
    series.set(code, new Map(bars.slice(-days - 5).map((b) => [b.date, b.c])));
  }
  const dates = [...new Set([...series.values()].flatMap((m) => [...m.keys()]))].sort().slice(-days);

  let added = 0;
  let from = null;
  let to = null;

  const updated = await withPortfolio(req.user.id, (portfolio) => {
    const codes = Object.keys(portfolio.positions);
    const log = { ...(portfolio.log ?? {}) };
    let priorTotal = null;

    for (const date of dates) {
      let value = 0;
      const prices = {};
      let complete = true;
      for (const code of codes) {
        const px = series.get(code)?.get(date);
        // Skip days where any holding didn't trade — a partial valuation would
        // show as a phantom drop in the equity curve. Also skip a code that
        // was added to the portfolio after the bars above were read (opened
        // its own history was never fetched here).
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
      from ??= date;
      to = date;
    }

    return { ...portfolio, log };
  });

  res.json({ added, days: Object.keys(updated.log).length, from, to });
}));

app.get('/api/log', wrap(async (req, res) => {
  const p = await loadPortfolio(req.user.id);
  res.json({ log: p.log ?? {}, days: Object.keys(p.log ?? {}).sort() });
}));

app.post('/api/log/note', wrap(async (req, res) => {
  const { date, note } = req.body ?? {};
  if (!date) return res.status(400).json({ error: 'محتاج date' });
  const updated = await withPortfolio(req.user.id, (portfolio) => setNote(portfolio, date, note ?? ''));
  res.json({ ok: true, entry: updated.log[date] });
}));

app.get('/api/settings', wrap(async (req, res) => {
  const p = await loadPortfolio(req.user.id);
  res.json({ settings: { ...RULES, ...(p.settings ?? {}) }, rules: RULES });
}));

app.post('/api/settings', wrap(async (req, res) => {
  const commissionPct = Number(req.body?.commissionPct);
  if (!Number.isFinite(commissionPct) || commissionPct < 0 || commissionPct > 5) {
    return res.status(400).json({ error: 'نسبة عمولة غير منطقية' });
  }
  const updated = await withPortfolio(req.user.id, (portfolio) => ({
    ...portfolio,
    settings: { ...(portfolio.settings ?? {}), commissionPct },
  }));
  res.json({ ok: true, settings: updated.settings });
}));

/** Wipe the log and trades, keeping positions. Destructive and irreversible. */
app.post('/api/reset', wrap(async (req, res) => {
  const scope = req.body?.scope ?? 'log';
  await withPortfolio(req.user.id, (portfolio) =>
    scope === 'all'
      ? { cash: 0, positions: {}, watchlist: {}, trades: [], log: {}, settings: portfolio.settings, realizedPnl: 0 }
      : { ...portfolio, log: {}, trades: [], realizedPnl: 0 },
  );
  res.json({ ok: true, scope });
}));

// ---- Portfolio screenshot import -----------------------------------------

const screenshotAliases = new Map([
  ['CIB', 'COMI'], ['COMMERCIAL INTERNATIONAL BANK', 'COMI'],
  ['TMG', 'TMGH'], ['TAQA ARABIA', 'TAQA'], ['CREDIT AGRICOLE', 'CIEB'],
  ['EFG HERMES', 'HRHO'], ['EFG-HERMES', 'HRHO'], ['MOBILENIL', 'ETEL'],
]);
const screenshotUniverseReference = UNIVERSE.map((stock) => `${stock.code}: ${stock.en}${stock.ar ? ` / ${stock.ar}` : ''}`).join('; ');

const normalizeScreenshotText = (value) => String(value ?? '')
  .normalize('NFKD')
  .replace(/[\u064B-\u065F\u0670]/g, '')
  .replace(/[‐‑‒–—]/g, '-')
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .trim()
  .toUpperCase();

const numberFromScreenshot = (value) => {
  if (typeof value === 'number') return value;
  const arabicDigits = String(value ?? '').replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));
  const cleaned = arabicDigits.replace(/[,،\s]/g, '').replace(/[^\d.-]/g, '');
  return cleaned ? Number(cleaned) : NaN;
};

function resolveScreenshotCode(item) {
  const raw = normalizeScreenshotText(item.code ?? item.symbol ?? item.ticker);
  const compact = raw.replace(/\s+/g, '').replace(/\.(CA|EGX)$/i, '').replace(/^EGX[:\-]/i, '');
  if (lookup(compact)) return compact;
  if (screenshotAliases.has(raw)) return screenshotAliases.get(raw);
  if (screenshotAliases.has(compact)) return screenshotAliases.get(compact);

  const nameText = normalizeScreenshotText(item.name ?? item.company ?? item.companyName);
  if (!nameText) return null;
  if (screenshotAliases.has(nameText)) return screenshotAliases.get(nameText);
  const match = UNIVERSE.find((stock) => [stock.en, stock.ar].some((name) => {
    const normalized = normalizeScreenshotText(name);
    return normalized && (normalized === nameText || normalized.includes(nameText) || nameText.includes(normalized));
  }));
  return match?.code ?? null;
}

app.post('/api/portfolio/import-screenshot', express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '8mb' }), wrap(async (req, res) => {
  if (!aiAvailable()) return res.status(503).json({ error: 'استيراد الصورة محتاج OPENROUTER_API_KEY في .env' });
  if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'ارفع صورة لمحفظتك أولاً' });

  const mediaType = req.headers['content-type'];
  const response = await callWithRetry(() => getOpenRouterClient().chat.completions.create({
    model: SCREENSHOT_VISION_MODEL,
    max_tokens: 4000,
    messages: [
      { role: 'system', content: `You extract stock portfolio data from an image. Never guess a number that is not visible. Return JSON only, without markdown, using this shape: {"cash":number|null,"positions":[{"code":"EGX ticker or null","name":"company name as shown","shares":number|null,"marketValue":number|null,"profit":number|null,"returnPct":number|null,"avgCost":number|null,"lastPrice":number|null,"stop":number|null,"target":number|null}]}. If the ticker is not visible, write the company name as shown.

The single most valuable field is "shares" — the number of shares held (الكمية / عدد الأسهم / كمية). Look for it carefully, including in small print, a secondary line under the company name, or a detail row. A whole number sitting beside a company with no currency symbol is usually the quantity, not a price. Only use null for it if you genuinely cannot see it.

Nearly as valuable is a per-share price: "avgCost" (متوسط التكلفة / متوسط الشراء) and "lastPrice" (السعر الحالي / آخر سعر). These let the share count be recovered exactly from the same screen when quantity is missing, so extract them whenever visible.

Distinguish carefully: "marketValue" (القيمة السوقية) is the TOTAL value of the whole position, while avgCost/lastPrice are PER SHARE. Do not confuse the two. Use only these verified Alytic ticker/name references when identifying a stock: ${screenshotUniverseReference}. Use null when a number is not visible. Ignore numbers unrelated to holdings or cash.` },
      { role: 'user', content: [
        { type: 'image_url', image_url: { url: `data:${mediaType};base64,${req.body.toString('base64')}` } },
        { type: 'text', text: 'Extract the current holdings, share counts, average cost and cash from this image.' },
      ] },
    ],
  }));

  const text = (response.choices?.[0]?.message?.content ?? '').trim();
  let extracted;
  try {
    const cleaned = text.replace(/^```json\s*|\s*```$/g, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    const jsonText = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
    extracted = JSON.parse(jsonText);
  } catch {
    throw new Error('الصورة لم تعطِ بيانات محفظة قابلة للقراءة');
  }

  const extractedPositions = extracted.positions ?? extracted.holdings ?? extracted.stocks ?? [];
  const rows = Array.isArray(extractedPositions)
    ? extractedPositions
    : Object.entries(extractedPositions).map(([code, value]) => ({ ...(value && typeof value === 'object' ? value : { shares: value }), code }));
  // Resolve every row first so the live quotes below can be fetched in one
  // batch rather than a websocket round-trip per stock.
  const parsed = rows.map((item) => ({
    item,
    code: resolveScreenshotCode(item),
    marketValue: numberFromScreenshot(item.marketValue ?? item.value ?? item.currentValue ?? item.totalValue),
    profit: numberFromScreenshot(item.profit ?? item.pnl ?? item.gain ?? item.unrealizedPnl),
    rawAverageCost: numberFromScreenshot(item.avgCost ?? item.averageCost ?? item.cost),
    lastPrice: numberFromScreenshot(item.lastPrice ?? item.price ?? item.currentPrice),
    shares: numberFromScreenshot(item.shares ?? item.quantity ?? item.qty),
  }));

  // A broker screenshot values a holding at the LIVE price, not at yesterday's
  // close — so when a share count has to be back-solved from market value, the
  // live quote is the only divisor that reproduces the broker's own number.
  // Dividing by the cached daily close is what made every imported count wrong:
  // VLMRA showed 39,645 EGP against a real 1205 shares (a live 32.90), but the
  // cached 32.42 close turned that into 1223. A 1.5% price gap is a 1.5% share
  // error, and it compounds per stock with however far each one has moved.
  const needsLiveQuote = parsed
    .filter((p) => p.code && (!Number.isFinite(p.shares) || p.shares <= 0) && Number.isFinite(p.marketValue) && p.marketValue > 0)
    .map((p) => p.code);
  const liveQuotes = needsLiveQuote.length ? await fetchLatestQuotes(needsLiveQuote).catch(() => new Map()) : new Map();

  const positions = {};
  let derivedPositions = 0;
  for (const { item, code, marketValue, profit, rawAverageCost, lastPrice, shares: extractedShares } of parsed) {
    let shares = extractedShares;
    let derived = false;

    // Deriving a share count is a last resort, and *what it divides by* decides
    // whether the answer is arithmetic or a guess. Prices from the screenshot
    // itself are internally consistent with its own market value; a stale close
    // is not.
    if ((!Number.isFinite(shares) || shares <= 0) && code && Number.isFinite(marketValue) && marketValue > 0) {
      const costBasis = Number.isFinite(profit) ? marketValue - profit : NaN;
      const livePrice = liveQuotes.get(code)?.price;

      if (Number.isFinite(costBasis) && costBasis > 0 && Number.isFinite(rawAverageCost) && rawAverageCost > 0) {
        // Exact: all three inputs came off the same screen.
        shares = Math.max(1, Math.round(costBasis / rawAverageCost));
      } else if (Number.isFinite(lastPrice) && lastPrice > 0) {
        // Also screenshot-internal: market value against the price beside it.
        shares = Math.max(1, Math.round(marketValue / lastPrice));
      } else if (Number.isFinite(livePrice) && livePrice > 0) {
        // Live quote — matches what the broker was valuing the position at.
        // Still an inference, so it stays flagged for the user to confirm.
        shares = Math.max(1, Math.round(marketValue / livePrice));
        derived = true;
        derivedPositions++;
      } else {
        const cached = await readBars(code);
        const currentPrice = cached?.bars?.at(-1)?.c;
        if (Number.isFinite(currentPrice) && currentPrice > 0) {
          shares = Math.max(1, Math.round(marketValue / currentPrice));
          derived = true;
          derivedPositions++;
        }
      }
    }
    if (!code || !ALL_CODES.includes(code) || !Number.isFinite(shares) || shares <= 0) continue;
    const avgCost = Number.isFinite(rawAverageCost)
      ? rawAverageCost
      : Number.isFinite(profit) && Number.isFinite(marketValue) ? Math.max(0, (marketValue - profit) / shares) : 0;
    positions[code] = {
      shares,
      avgCost: +avgCost.toFixed(4),
      stop: Number.isFinite(numberFromScreenshot(item.stop)) ? numberFromScreenshot(item.stop) : null,
      target: Number.isFinite(numberFromScreenshot(item.target)) ? numberFromScreenshot(item.target) : null,
      openedAt: new Date().toISOString().slice(0, 10),
      ...(Number.isFinite(marketValue) ? { reportedValue: marketValue } : {}),
      ...(Number.isFinite(profit) ? { reportedPnl: profit } : {}),
      ...(derived ? { derivedFromScreenshot: true } : {}),
    };
  }
  if (!Object.keys(positions).length) throw new Error('اتقرت أكواد الأسهم، لكن الصورة لا تحتوي كمية أو قيمة مركز قابلة للحساب');

  const merge = req.query.merge === '1';
  const importedAt = new Date().toISOString();
  const cashFromScreenshot = numberFromScreenshot(extracted.cash);
  // Only the merge-and-save is locked. The AI extraction above can take
  // several seconds; holding the per-user write lock for that whole span
  // would block ordinary trades/cash edits for no reason, since none of it
  // touches portfolio state until this point.
  const updated = await withPortfolio(req.user.id, (portfolio) => ({
    ...portfolio,
    positions: merge ? { ...portfolio.positions, ...positions } : positions,
    ...(Number.isFinite(cashFromScreenshot) && cashFromScreenshot >= 0 ? { cash: cashFromScreenshot } : {}),
    imports: [...(portfolio.imports ?? []), { importedAt, positions: Object.keys(positions), source: 'screenshot' }].slice(-20),
  }));
  res.json({ ok: true, importedAt, positions: Object.keys(positions).length, derivedPositions, portfolio: { ...updated, capital: capitalOf(updated) } });
}));

// ---- AI endpoints ----------------------------------------------------------

app.post('/api/review', wrap(async (req, res) => {
  if (!aiAvailable()) {
    return res.status(503).json({
      error: 'مفيش مفتاح API. حط OPENROUTER_API_KEY في .env — التحليل الفني شغال من غيره.',
      aiAvailable: false,
    });
  }
  const style = req.body?.style ?? req.query.style;
  if (style && !STYLE_KEYS.includes(style)) return res.status(400).json({ error: `أسلوب غير معروف: ${style}` });
  // The style sets both halves: the rule numbers the engine sizes with and
  // the horizon the analyst reasons in. Both must come from the same choice,
  // or the prose will argue against the numbers underneath it.
  const rules = style ? rulesForStyle(RULES, style) : RULES;
  const effectiveStyle = style ?? 'medium';

  const portfolio = await loadPortfolio(req.user.id);
  const capital = capitalOf(portfolio);

  // An empty book has no personal fit to judge — the honest answer to "what
  // do I do with my cash" is identical for every such user on a given day.
  // Serve today's cached, shared market report instead of paying for a
  // personalized AI call that would just re-derive the same market view.
  if (!Object.keys(portfolio.positions).length) {
    const { getOrGenerateMarketAnalysis, reviewFromMarketReport } = await import('../agent/marketAnalysis.js');
    const report = await getOrGenerateMarketAnalysis({ rules, style: effectiveStyle });
    const review = reviewFromMarketReport(report, { cash: portfolio.cash }, trackedCodes(portfolio));
    return res.json({ review, analyses: [], errors: [], style: effectiveStyle, source: 'daily_market_report', marketAnalysisAsOf: report.asOf });
  }

  const { reviewPortfolio } = await import('../agent/analyst.js');
  const codes = trackedCodes(portfolio);
  const { results, errors } = await analyzeMany(codes, {
    capital,
    positions: portfolio.positions,
    concurrency: 5,
    rules,
  });

  const review = await reviewPortfolio(results, { cash: portfolio.cash, capital }, { rules, style: effectiveStyle });
  res.json({ review, analyses: results, errors, style: effectiveStyle, source: 'ai' });
}));

app.get('/api/market-analysis', wrap(async (req, res) => {
  if (!aiAvailable()) {
    return res.status(503).json({
      error: 'مفيش مفتاح API. حط OPENROUTER_API_KEY في .env — التحليل الفني شغال من غيره.',
      aiAvailable: false,
    });
  }
  const style = req.query.style;
  if (style && !STYLE_KEYS.includes(style)) return res.status(400).json({ error: `أسلوب غير معروف: ${style}` });
  const rules = style ? rulesForStyle(RULES, style) : RULES;
  const { getOrGenerateMarketAnalysis } = await import('../agent/marketAnalysis.js');
  const report = await getOrGenerateMarketAnalysis({ rules, style: style ?? 'medium' });
  res.json({ report });
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

// Only bind a port when executed directly (`npm run serve`, systemd, CLI).
// When imported — by the test suites, which listen on an ephemeral port and
// point the SQLite/bar-cache paths at throwaway directories — the module must
// not grab port 3000.
const isDirectRun = Boolean(process.argv[1])
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  const PORT = process.env.PORT ?? 3000;
  app.listen(PORT, () => {
    console.log(`Alytic على http://localhost:${PORT}`);
    console.log(aiAvailable() ? '  الذكاء الاصطناعي: مفعّل' : '  الذكاء الاصطناعي: متوقف (مفيش OPENROUTER_API_KEY)');
  });
}

export default app;
