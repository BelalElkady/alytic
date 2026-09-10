#!/usr/bin/env node
/**
 * Verifies every entry in universe.js against the live feed.
 *
 * Exists because the first version of that file was typed from memory and had
 * nine tickers attached to the wrong company — two of which reached a
 * recommendation list. A mislabelled ticker is the worst failure this project
 * can have: every number downstream is correct, and you buy the wrong company.
 *
 *   node scripts/verify-universe.js          report only
 *   node scripts/verify-universe.js --strict exit 1 on any problem (for CI)
 */

import { UNIVERSE } from '../src/config/universe.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36';
const strict = process.argv.includes('--strict');

/** Words too generic to prove two names refer to the same company. */
const STOP = new Set([
  'company', 'companies', 'holding', 'holdings', 'industries', 'industry', 'egypt',
  'egyptian', 'group', 'for', 'and', 'the', 'sae', 'co', 'corp', 'plc', 'investments',
  'investment', 'development', 'chemical', 'chemicals', 'financial', 'international',
]);

const tokens = (s) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ')
    .filter((w) => w.length > 2 && !STOP.has(w));

async function fetchName(symbol) {
  const res = await fetch(
    `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`,
    { headers: { 'User-Agent': UA } },
  );
  const body = await res.json();
  const meta = body?.chart?.result?.[0]?.meta;
  if (!meta) return null;
  // Yahoo sometimes returns a merged id string ("ESRS.CA,0P0000ALLL,...") in
  // shortName for suspended listings; that is not a company name.
  const name = meta.longName ?? meta.shortName ?? null;
  return name && !/^[A-Z0-9.]+,/.test(name) ? name : null;
}

const problems = [];
let checked = 0;

for (const s of UNIVERSE) {
  let live;
  try {
    live = await fetchName(s.yahoo);
  } catch (err) {
    problems.push({ code: s.code, kind: 'fetch-failed', detail: err.message });
    continue;
  }
  checked++;

  if (!live) {
    problems.push({ code: s.code, kind: 'no-name', detail: 'الرمز ما رجّعش اسم شركة — موقوف أو مشطوب' });
    continue;
  }

  // Names made entirely of generic words ("GB Corp", "B Investments Holding")
  // tokenize to nothing, so compare the normalized strings directly before
  // falling back to token overlap — otherwise an exact match reads as a mismatch.
  const flat = (x) => x.toLowerCase().replace(/[^a-z0-9]/g, '');
  const mine = tokens(s.en);
  const theirs = tokens(live);

  const matches =
    flat(s.en) === flat(live) ||
    flat(s.en).includes(flat(live)) ||
    flat(live).includes(flat(s.en)) ||
    (mine.length > 0 && mine.some((w) => theirs.some((t) => t.startsWith(w) || w.startsWith(t))));

  if (!matches) {
    problems.push({ code: s.code, kind: 'name-mismatch', detail: `الملف: ${s.en}\n         الحي:  ${live}` });
  }
}

console.log(`\nفحص ${checked}/${UNIVERSE.length} رمز — ${problems.length ? `${problems.length} مشكلة` : 'كله سليم'}\n`);

for (const p of problems) {
  console.log(`  ${p.code.padEnd(6)} [${p.kind}]`);
  console.log(`         ${p.detail}\n`);
}

if (problems.length && strict) process.exit(1);
