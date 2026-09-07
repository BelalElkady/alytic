#!/usr/bin/env node
/**
 * Regenerates the tradeable universe from every source available.
 *
 * Replaces the hand-typed table that had nine tickers attached to the wrong
 * company. Nothing here is remembered; every row is assembled from a feed and
 * then required to prove itself against real price data.
 *
 * THREE SOURCES, because no single one is complete:
 *   - data/reference/egx-listing.csv  — the EGX listing directory (280 names)
 *   - TradingView screener            — live identity, price and fundamentals (284)
 *   - Yahoo / TradingView chart feeds — the daily history indicators need
 *
 * The first two overlap on only 257 tickers, so each carries names the other
 * lacks: the CSV alone has Ezz Steel and Banque du Caire, TradingView alone has
 * ENPPI and Petroleum Marine Services. The union is ~307, and every candidate
 * is then admitted only if some feed serves a usable series for it AND that
 * series passes the quality gate.
 *
 *   node scripts/build-universe.js
 *   node scripts/build-universe.js --min-turnover 2000000   liquid names only
 *   node scripts/build-universe.js --no-fallback            skip TradingView history
 *
 * Output: src/config/universe.generated.json
 */

import { promises as fs, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchScreener } from '../src/data/tradingview.js';
import { checkQuality } from '../src/data/quality.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'src', 'config', 'universe.generated.json');
const CSV = path.join(ROOT, 'data', 'reference', 'egx-listing.csv');

const argOf = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] != null ? Number(process.argv[i + 1]) : fallback;
};
// Liquidity is an ATTRIBUTE, not an admission criterion — filtering it here
// once shrank the universe by 81 names with no way to see them from the app.
// Callers filter at query time via `liquidCodes()`.
const MIN_TURNOVER = argOf('--min-turnover', 0);
const MIN_BARS = argOf('--min-bars', 60);
const USE_FALLBACK = !process.argv.includes('--no-fallback');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** CSV sector vocabulary → this project's keys. */
const CSV_SECTOR_MAP = {
  Banking: 'banks', 'Financial Services': 'financials', Insurance: 'financials', FinTech: 'tech',
  Technology: 'tech', Telecom: 'telecom', Media: 'telecom', 'Real Estate': 'realestate',
  Industrial: 'industrials', 'Building Materials': 'industrials', Automotive: 'industrials',
  Petrochemical: 'materials', Agriculture: 'consumer', Consumer: 'consumer',
  Healthcare: 'healthcare', Tourism: 'tourism', Transport: 'transport',
  Energy: 'energy', Diversified: 'holding',
};

/** Minimal CSV parser — handles quoted fields containing commas. */
function parseCsv(text) {
  const lines = text.replace(/^﻿/, '').trim().split(/\r?\n/);
  const header = lines[0].split(',').map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = [];
    let cur = '';
    let quoted = false;
    for (const ch of line) {
      if (ch === '"') { quoted = !quoted; continue; }
      if (ch === ',' && !quoted) { cells.push(cur); cur = ''; continue; }
      cur += ch;
    }
    cells.push(cur);
    return Object.fromEntries(header.map((h, i) => [h, (cells[i] ?? '').trim()]));
  });
}

/** Business-activity screen only — never the financial-ratio screens. */
function shariahGuess({ name, industry }) {
  const text = `${name} ${industry ?? ''}`.toLowerCase();
  if (/islamic|baraka|faisal/.test(text)) return 'compliant';
  if (/\bbank|banque|insurance|financ|leasing|credit|brokerage/.test(text)) return 'non_compliant';
  if (/tobacco|cigarette|brewer|wine|spirits|alcohol|casino/.test(text)) return 'non_compliant';
  if (/pharma|fertiliz|cement|steel|food|textile|telecom|weav|chemical|oil|poultry|dairy|ceramic/.test(text)) return 'compliant';
  return 'review';
}

/**
 * Yahoo returns plain-text "Too Many Requests" (not JSON) under load, which
 * throws on parse and would otherwise be misreported as "no data" — quietly
 * dropping good stocks. Back off and retry instead.
 */
async function yahooChart(symbol, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(
        `https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?range=2y&interval=1d`,
        { headers: { 'User-Agent': UA } },
      );
      if (res.status === 429) { await sleep(2500 * (i + 1)); continue; }
      const text = await res.text();
      try { return JSON.parse(text); } catch { await sleep(1200); continue; }
    } catch { await sleep(800); }
  }
  return null;
}

/** Normalised bars from a Yahoo chart payload, or null. */
function barsFromYahoo(json) {
  const r = json?.chart?.result?.[0];
  if (!r?.timestamp) return null;
  const q = r.indicators?.quote?.[0] ?? {};
  const out = [];
  for (let i = 0; i < r.timestamp.length; i++) {
    const c = q.close?.[i];
    if (!Number.isFinite(c)) continue;
    const o = q.open?.[i] ?? c, h = q.high?.[i] ?? c, l = q.low?.[i] ?? c;
    if (![o, h, l].every(Number.isFinite)) continue;
    out.push({
      date: new Date(r.timestamp[i] * 1000).toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' }),
      t: r.timestamp[i], o: +o, h: +Math.max(h, o, c), l: +Math.min(l, o, c), c: +c,
      v: Number.isFinite(q.volume?.[i]) ? q.volume[i] : 0,
    });
  }
  return out.length ? out : null;
}

// --- Assemble the candidate list -------------------------------------------

console.log('بيجمع قائمة الأسهم من كل المصادر...');

let csvRows = [];
if (existsSync(CSV)) {
  csvRows = parseCsv(readFileSync(CSV, 'utf8')).filter((r) => r.ticker);
  console.log(`  ${csvRows.length} من ملف EGX المرجعي`);
} else {
  console.log('  (ملف egx-listing.csv مش موجود — هيعتمد على TradingView بس)');
}

let tvRows = [];
try {
  tvRows = await fetchScreener();
  console.log(`  ${tvRows.length} من TradingView`);
} catch (err) {
  console.log(`  TradingView فشل: ${err.message}`);
}

const tvByCode = new Map(tvRows.map((r) => [r.code, r]));
const candidates = new Map();

// TradingView first — its names are confirmed against a live feed.
for (const r of tvRows) {
  candidates.set(r.code, {
    code: r.code, name: r.name, sector: r.sector, industry: r.industry,
    price: r.price, turnoverEgp: r.turnoverEgp, marketCapEgp: r.marketCapEgp,
    origin: 'tradingview',
  });
}
// Then anything the CSV knows about that TradingView does not list.
for (const r of csvRows) {
  if (candidates.has(r.ticker)) continue;
  candidates.set(r.ticker, {
    code: r.ticker, name: r.company_name, sector: CSV_SECTOR_MAP[r.sector] ?? 'holding',
    industry: r.sector, price: null, turnoverEgp: 0, marketCapEgp: null,
    yahooHint: r.yahoo_ticker || null, origin: 'egx-csv',
  });
}

const list = [...candidates.values()].filter((r) => (r.turnoverEgp ?? 0) >= MIN_TURNOVER);
console.log(`\n${candidates.size} رمز فريد | ${list.length} فوق حد السيولة`);
console.log(`بيتأكد من وجود تاريخ أسعار صالح لكل واحد...\n`);

// --- Resolve history and admit ---------------------------------------------

const accepted = [];
const rejected = [];
const needsFallback = [];
const queue = [...list];
let done = 0;

const entry = (row, source, symbol, bars, note) => ({
  code: row.code,
  source,
  yahoo: source === 'yahoo' ? symbol : null,
  en: row.name,
  sector: row.sector ?? 'holding',
  industry: row.industry ?? null,
  shariah: shariahGuess(row),
  marketCapEgp: row.marketCapEgp ?? null,
  avgTurnoverEgp: Math.round(row.turnoverEgp ?? 0),
  bars,
  origin: row.origin,
  ...(note ? { note } : {}),
});

await Promise.all(Array.from({ length: 5 }, async () => {
  while (queue.length) {
    const row = queue.shift();
    if (++done % 50 === 0) process.stderr.write(`  ${done}/${list.length}\n`);

    const symbol = row.yahooHint || `${row.code}.CA`;
    const bars = barsFromYahoo(await yahooChart(symbol));

    if (!bars || bars.length < MIN_BARS) { needsFallback.push(row); continue; }

    // Yahoo can serve a dead symbol whose prices bear no relation to the live
    // market — ORAS.CA sits frozen at 71.05 while the stock trades at 848.90.
    const last = bars.at(-1).c;
    if (row.price && Math.abs(last - row.price) / row.price > 0.25) {
      needsFallback.push({ ...row, yahooConflict: last });
      continue;
    }

    const q = checkQuality(bars, { code: row.code });
    if (!q.ok) { rejected.push({ code: row.code, name: row.name, reason: q.issues.find((i) => i.level === 'fatal').message }); continue; }
    accepted.push(entry(row, 'yahoo', symbol, bars.length, q.severity === 'warn' ? q.issues[0].message : null));
  }
}));

if (USE_FALLBACK && needsFallback.length) {
  console.log(`\nYahoo مش عنده ${needsFallback.length} سهم — بيجرب TradingView...`);
  const { fetchDailyTV } = await import('../src/data/tv-history.js');

  for (const [i, row] of needsFallback.entries()) {
    if ((i + 1) % 25 === 0) process.stderr.write(`  ${i + 1}/${needsFallback.length}\n`);
    if (!tvByCode.has(row.code)) {
      rejected.push({ code: row.code, name: row.name, reason: 'مش موجود على Yahoo ولا TradingView' });
      continue;
    }
    try {
      const data = await fetchDailyTV(row.code);
      const q = checkQuality(data.bars, { code: row.code });
      if (!q.ok) rejected.push({ code: row.code, name: row.name, reason: q.issues.find((x) => x.level === 'fatal').message });
      else accepted.push(entry(row, 'tradingview', `EGX:${row.code}`, data.bars.length,
        row.yahooConflict ? `Yahoo بيرجّع ${row.yahooConflict} — رمز ميت، اتاخد من TradingView` : null));
    } catch {
      rejected.push({ code: row.code, name: row.name, reason: 'مفيش تاريخ أسعار على أي مصدر' });
    }
    await sleep(400); // a public endpoint deserves a polite request rate
  }
} else if (needsFallback.length) {
  for (const row of needsFallback) rejected.push({ code: row.code, name: row.name, reason: 'مفيش تاريخ على Yahoo (الـfallback متوقف)' });
}

accepted.sort((a, b) => (b.marketCapEgp ?? 0) - (a.marketCapEgp ?? 0));

await fs.writeFile(OUT, JSON.stringify({
  generatedAt: new Date().toISOString(),
  sources: {
    listing: existsSync(CSV) ? `egx-listing.csv (${csvRows.length})` : null,
    screener: `TradingView (${tvRows.length})`,
    history: 'Yahoo chart, TradingView chart fallback',
  },
  minTurnoverEgp: MIN_TURNOVER,
  minBars: MIN_BARS,
  candidateTotal: candidates.size,
  accepted: accepted.length,
  bySource: accepted.reduce((a, s) => ({ ...a, [s.source]: (a[s.source] ?? 0) + 1 }), {}),
  stocks: accepted,
  rejected,
}, null, 2), 'utf8');

console.log(`\n✅ ${accepted.length} سهم قابل للتحليل من ${candidates.size} مرشح`);
console.log(`   Yahoo: ${accepted.filter((s) => s.source === 'yahoo').length} · TradingView: ${accepted.filter((s) => s.source === 'tradingview').length}`);
console.log(`   ${rejected.length} مستبعد`);
console.log(`   → ${path.relative(ROOT, OUT)}`);

const reasons = {};
for (const r of rejected) {
  const k = /نادر|مش بيتداول/.test(r.reason) ? 'لا يتداول فعليًا'
    : /مفيش تاريخ|مش موجود/.test(r.reason) ? 'لا يوجد تاريخ أسعار'
    : /مجمدة|ثابت/.test(r.reason) ? 'بيانات مجمدة' : 'أخرى';
  reasons[k] = (reasons[k] ?? 0) + 1;
}
console.log('\nأسباب الاستبعاد:');
for (const [k, v] of Object.entries(reasons)) console.log(`  ${String(v).padStart(3)} — ${k}`);
