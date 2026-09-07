/**
 * Portfolio state: positions, cash, watchlist and the trade log.
 *
 * Persisted as a single JSON file so it is trivially inspectable and editable
 * by hand — this is one investor's book, not a multi-tenant ledger, and a
 * format you can open in an editor beats one you need a tool to read.
 *
 * Average cost is recomputed from the trade log rather than stored as truth,
 * so a mistyped trade can be corrected by fixing that one entry.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import RULES from './config/rules.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'data', 'portfolio.json');

const EMPTY = {
  cash: 0,
  positions: {},   // code -> { shares, avgCost, stop, target, openedAt }
  watchlist: {},   // code -> { entry, stop, target, qty, note }
  trades: [],      // { date, code, side, shares, price, commission, note }
  // One entry per saved close, keyed YYYY-MM-DD. This is what the calendar and
  // the equity curve read — without it the app can show today but has no
  // memory, so "how did the book do this month" is unanswerable.
  log: {},         // date -> { total, positionsValue, cash, dayChange, pl, prices, stops, note, changes }
  settings: { commissionPct: 0.20 },
  realizedPnl: 0,
  updatedAt: null,
};

export async function loadPortfolio() {
  try {
    const raw = JSON.parse(await fs.readFile(FILE, 'utf8'));
    return { ...EMPTY, ...raw };
  } catch {
    return { ...EMPTY };
  }
}

export async function savePortfolio(p) {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify({ ...p, updatedAt: new Date().toISOString() }, null, 2), 'utf8');
  return p;
}

/**
 * Record a trade and roll the position forward.
 *
 * Buys move average cost; sells never do — they realise P&L against the
 * existing average and leave it untouched for the remaining shares. Getting
 * this backwards is the classic way a book quietly stops reflecting reality.
 */
export async function recordTrade(portfolio, { code, side, shares, price, date = null, note = null }, rules = RULES) {
  const c = code.toUpperCase();
  const p = { ...portfolio, positions: { ...portfolio.positions }, trades: [...portfolio.trades] };
  const commission = shares * price * (rules.commissionPct / 100);
  const when = date ?? new Date().toISOString().slice(0, 10);

  if (!(shares > 0) || !(price > 0)) throw new Error('عدد الأسهم والسعر لازم يكونوا أكبر من صفر');

  const existing = p.positions[c] ?? { shares: 0, avgCost: 0, stop: null, target: null, openedAt: when };

  if (side === 'buy') {
    const totalCost = existing.shares * existing.avgCost + shares * price;
    const totalShares = existing.shares + shares;
    p.positions[c] = {
      ...existing,
      shares: totalShares,
      avgCost: +(totalCost / totalShares).toFixed(4),
      openedAt: existing.shares === 0 ? when : existing.openedAt,
    };
    p.cash = +(p.cash - shares * price - commission).toFixed(2);
  } else if (side === 'sell') {
    if (shares > existing.shares) {
      throw new Error(`عندك ${existing.shares} سهم بس من ${c}، مش ${shares}`);
    }
    const realized = shares * (price - existing.avgCost) - commission;
    p.realizedPnl = +((p.realizedPnl ?? 0) + realized).toFixed(2);
    const left = existing.shares - shares;
    if (left === 0) delete p.positions[c];
    else p.positions[c] = { ...existing, shares: left }; // avgCost intentionally unchanged
    p.cash = +(p.cash + shares * price - commission).toFixed(2);
  } else {
    throw new Error(`نوع الصفقة لازم يكون buy أو sell، مش ${side}`);
  }

  p.trades.push({
    date: when,
    code: c,
    side,
    shares,
    price,
    commission: +commission.toFixed(2),
    note,
    ...(side === 'sell' ? { realized: +(shares * (price - existing.avgCost) - commission).toFixed(2) } : {}),
  });

  return p;
}

/** Update the stored stop/target for a position (e.g. after a trailing-stop move). */
export function setLevels(portfolio, code, { stop, target }) {
  const c = code.toUpperCase();
  const pos = portfolio.positions[c];
  if (!pos) throw new Error(`مفيش مركز مفتوح في ${c}`);
  return {
    ...portfolio,
    positions: {
      ...portfolio.positions,
      [c]: { ...pos, ...(stop != null ? { stop } : {}), ...(target != null ? { target } : {}) },
    },
  };
}

/** Codes to analyze: everything held plus everything watched. */
export function trackedCodes(portfolio) {
  return [...new Set([...Object.keys(portfolio.positions), ...Object.keys(portfolio.watchlist)])];
}

/**
 * Record one day's close into the log, and ratchet any trailing stops it moved.
 *
 * `dayChange` is measured against the previous *saved* entry rather than
 * against yesterday's calendar date — the market is shut two days a week and
 * the app may not be opened daily, so consecutive log entries are the only
 * honest baseline.
 */
export function recordSnapshot(portfolio, analyses, date = null) {
  const day = date ?? new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
  const held = analyses.filter((a) => a.usable && a.position);

  const prices = {};
  const stops = {};
  const recs = {};
  const changes = [];

  let positionsValue = 0;
  let pl = 0;

  for (const a of held) {
    prices[a.code] = a.snapshot.price.close;
    stops[a.code] = a.position.stop;
    recs[a.code] = { action: a.position.recommendation?.action, text: a.position.recommendation?.text };
    positionsValue += a.position.marketValue;
    pl += a.position.unrealizedEgp;
    if (a.position.trailing?.moved) {
      changes.push(`${a.code}: الوقف ارتفع من ${a.position.trailing.from} إلى ${a.position.stop} (وقف متحرك)`);
    }
  }

  const total = positionsValue + portfolio.cash;
  const prior = Object.keys(portfolio.log ?? {}).sort().filter((d) => d < day).pop();
  const priorTotal = prior ? portfolio.log[prior].total : null;

  const entry = {
    date: day,
    total: +total.toFixed(2),
    positionsValue: +positionsValue.toFixed(2),
    cash: portfolio.cash,
    pl: +pl.toFixed(2),
    dayChange: priorTotal == null ? 0 : +(total - priorTotal).toFixed(2),
    dayChangePct: priorTotal ? +(((total - priorTotal) / priorTotal) * 100).toFixed(2) : 0,
    prices,
    stops,
    recs,
    changes,
    note: portfolio.log?.[day]?.note ?? null, // never clobber a note already written
  };

  return { ...portfolio, log: { ...(portfolio.log ?? {}), [day]: entry } };
}

export function setNote(portfolio, date, note) {
  const existing = portfolio.log?.[date];
  if (!existing) throw new Error(`مفيش بيانات محفوظة ليوم ${date}`);
  return { ...portfolio, log: { ...portfolio.log, [date]: { ...existing, note } } };
}
