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
