#!/usr/bin/env node
/**
 * Regenerates the tradeable universe from live sources.
 *
 * Replaces the hand-typed table that had nine tickers attached to the wrong
 * company. Identity now comes from TradingView's screener, and each candidate
 * is only admitted once Yahoo is confirmed to serve enough daily history for
 * the indicators to mean anything.
 *
 *   node scripts/build-universe.js                  liquid names (default)
 *   node scripts/build-universe.js --min-turnover 0 everything listed
 *
 * Output: src/config/universe.generated.json
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchScreener } from '../src/data/tradingview.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'src', 'config', 'universe.generated.json');

const argOf = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] != null ? Number(process.argv[i + 1]) : fallback;
};
const MIN_TURNOVER = argOf('--min-turnover', 2_000_000);
const MIN_BARS = argOf('--min-bars', 60);

/** Business-activity screen only — never the financial-ratio screens. */
function shariahGuess(row) {
  const text = `${row.name} ${row.industry ?? ''}`.toLowerCase();
  if (/islamic|baraka|faisal/.test(text)) return 'compliant';
  if (/\bbank|insurance|financ|leasing|credit|brokerage|investment bank/.test(text)) return 'non_compliant';
  if (/tobacco|cigarette|brewer|wine|spirits|alcohol|hotel|casino/.test(text)) return 'non_compliant';
  if (/pharma|fertiliz|cement|steel|food|textile|telecom|weav|chemical|oil|poultry|dairy/.test(text)) return 'compliant';
  return 'review';
}

async function yahooBars(code) {
  try {
    const res = await fetch(
      `https://query2.finance.yahoo.com/v8/finance/chart/${code}.CA?range=1y&interval=1d`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } },
    );
    const j = await res.json();
    const r = j.chart?.result?.[0];
    if (!r) return { bars: 0, last: null };
    const closes = (r.indicators?.quote?.[0]?.close ?? []).filter((x) => x != null);
    return { bars: closes.length, last: closes.at(-1) ?? null };
  } catch {
    return { bars: 0, last: null };
  }
}

console.log('بيجيب قائمة الأسهم من TradingView...');
const listed = await fetchScreener();
console.log(`  ${listed.length} سهم مقيّد`);

const candidates = listed.filter((r) => (r.turnoverEgp ?? 0) >= MIN_TURNOVER);
console.log(`  ${candidates.length} فوق حد السيولة (${(MIN_TURNOVER / 1e6).toFixed(1)} مليون ج/يوم)`);
console.log(`بيتأكد من تاريخ الأسعار على Yahoo لـ ${candidates.length} رمز...`);

const accepted = [];
const rejected = [];
const queue = [...candidates];

await Promise.all(Array.from({ length: 8 }, async () => {
  while (queue.length) {
    const row = queue.shift();
    const { bars, last } = await yahooBars(row.code);

    if (bars < MIN_BARS) {
      rejected.push({ code: row.code, name: row.name, reason: bars === 0 ? 'لا يوجد تاريخ على Yahoo' : `${bars} جلسة فقط` });
      continue;
    }

    // A large gap between the live price and Yahoo's last close means the two
    // feeds disagree about what this symbol is — an unadjusted split, or a dead
    // Yahoo listing. ORAS was the case that motivated this: TradingView 848.90
    // against Yahoo 71.05.
    const drift = last && row.price ? Math.abs(last - row.price) / row.price * 100 : null;
    if (drift != null && drift > 25) {
      rejected.push({ code: row.code, name: row.name, reason: `تعارض في السعر: TradingView ${row.price} مقابل Yahoo ${last.toFixed(2)} (${drift.toFixed(0)}%)` });
      continue;
    }

    accepted.push({
      code: row.code,
      yahoo: `${row.code}.CA`,
      en: row.name,
      sector: row.sector ?? 'holding',
      tvSector: row.tvSector,
      industry: row.industry,
      shariah: shariahGuess(row),
      marketCapEgp: row.marketCapEgp,
      avgTurnoverEgp: Math.round(row.turnoverEgp),
      bars,
      priceDriftPct: drift == null ? null : +drift.toFixed(1),
    });
  }
}));

accepted.sort((a, b) => (b.marketCapEgp ?? 0) - (a.marketCapEgp ?? 0));

await fs.writeFile(OUT, JSON.stringify({
  generatedAt: new Date().toISOString(),
  source: 'TradingView screener (identity, sector, fundamentals) + Yahoo chart (history validation)',
  minTurnoverEgp: MIN_TURNOVER,
  minBars: MIN_BARS,
  listedTotal: listed.length,
  accepted: accepted.length,
  stocks: accepted,
  rejected,
}, null, 2), 'utf8');

console.log(`\n✅ ${accepted.length} سهم قابل للتحليل → ${path.relative(ROOT, OUT)}`);
console.log(`   ${rejected.length} مستبعد`);
console.log('\nأكبر 10 بالقيمة السوقية:');
for (const s of accepted.slice(0, 10)) {
  console.log(`  ${s.code.padEnd(6)} ${String(Math.round((s.marketCapEgp ?? 0) / 1e9)).padStart(4)} مليار ج  ${s.en.slice(0, 46)}`);
}
console.log('\nأهم المستبعدين:');
for (const r of rejected.slice(0, 8)) console.log(`  ${r.code.padEnd(6)} ${r.reason}`);
