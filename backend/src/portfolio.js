/**
 * Portfolio state: positions, cash, watchlist and the trade log.
 *
 * Persisted as one JSON file per user so accounts never share positions,
 * trades, cash, or performance history.
 *
 * Average cost is recomputed from the trade log rather than stored as truth,
 * so a mistyped trade can be corrected by fixing that one entry.
 */

import { createHash } from 'node:crypto';
import RULES from './config/rules.js';
import { getPortfolio, putPortfolio } from './db.js';
import { lookup } from './config/universe.js';

const EMPTY = {
  cash: 0,
  positions: {},   // code -> { shares, avgCost, stop, target, openedAt }
  watchlist: {},   // favorites the user picked to watch — code -> { addedAt, note }
  trades: [],      // { date, code, side, shares, price, commission, note }
  // One entry per saved close, keyed YYYY-MM-DD. This is what the calendar and
  // the equity curve read — without it the app can show today but has no
  // memory, so "how did the book do this month" is unanswerable.
  log: {},         // date -> { total, positionsValue, cash, dayChange, pl, prices, stops, note, changes }
  settings: { commissionPct: 0.20 },
  realizedPnl: 0,
  updatedAt: null,
};

export async function loadPortfolio(userId = 'local') {
  return { ...EMPTY, ...((await getPortfolio(userId)) ?? {}) };
}

export async function savePortfolio(p, userId = 'local') {
  await putPortfolio(userId, p);
  return p;
}

/**
 * Per-user write lock. Every mutating endpoint (trade, cash, watchlist,
 * levels, snapshot, settings, reset, screenshot import...) used to do
 * `loadPortfolio` → mutate → `savePortfolio` as three separate steps with an
 * `await` between the read and the write. Two requests landing close together
 * — a double-click on "تسجيل" with no submit-disable, two tabs open on the
 * same account, or just ordinary network jitter — could both read the same
 * starting state; the second write then overwrote the first, silently
 * discarding whatever it had added. That is exactly what "logging a trade
 * deletes other entries" looks like from the outside: nothing is actually
 * deleted, a write is lost and the portfolio reverts to a state one commit old.
 *
 * `withPortfolio` closes that window by serialising every read-modify-write
 * cycle per user: the next caller's `loadPortfolio` cannot run until the
 * previous caller's `savePortfolio` has fully landed. One in-process queue per
 * userId, chained on a promise — no external lock needed since this is a
 * single Node process in front of one SQLite file.
 */
const writeQueues = new Map();

export async function withPortfolio(userId, mutator) {
  const previous = writeQueues.get(userId) ?? Promise.resolve();
  const run = previous
    .catch(() => {}) // a prior failure must not jam the queue for later callers
    .then(async () => {
      const portfolio = await loadPortfolio(userId);
      const next = await mutator(portfolio);
      await savePortfolio(next, userId);
      return next;
    });
  writeQueues.set(userId, run);
  try {
    return await run;
  } finally {
    // Only clear the slot if nobody queued behind us — otherwise this would
    // drop the reference to the run a later caller is chained onto.
    if (writeQueues.get(userId) === run) writeQueues.delete(userId);
  }
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

  // A code outside the analyzable universe used to be accepted silently: cash
  // moved, a trade row appeared in the log, but the resulting position could
  // never be priced or analyzed, so it never rendered anywhere — the Positions
  // tab just said "no open positions" while money had quietly moved. Reject it
  // here instead, at the one place every entry point (API, CLI) funnels through.
  if (!lookup(c)) {
    throw new Error(`الكود "${c}" مش في قائمة الأسهم اللي التطبيق بيقدر يتابعها — اختاره من القائمة بدل الكتابة اليدوية.`);
  }

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
    // avgCost intentionally unchanged. partialTakenAt makes the "profit X%+ =
    // sell part" rule fire once per position instead of every day after.
    else p.positions[c] = { ...existing, shares: left, partialTakenAt: when };
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

/**
 * Walk one stock's trades, in log order, from a starting holding. Returns the
 * shares and average cost it ends on, the cash it moved, the P&L it realised
 * (and each sell's share of it), and whether any sell exceeded what was held.
 * Same arithmetic as recordTrade, minus the rounding.
 */
function replayCode(trades, start) {
  let shares = start.shares;
  let avgCost = start.avgCost;
  let cash = 0;
  let realized = 0;
  let oversold = false;
  const sellRealized = [];
  for (const t of trades) {
    const value = t.shares * t.price;
    const commission = t.commission ?? 0;
    if (t.side === 'buy') {
      avgCost = shares + t.shares > 0 ? (Math.max(shares, 0) * avgCost + value) / (Math.max(shares, 0) + t.shares) : 0;
      shares += t.shares;
      cash -= value + commission;
    } else {
      if (t.shares > shares + 1e-9) oversold = true;
      const r = t.shares * (t.price - avgCost) - commission;
      realized += r;
      sellRealized.push(r);
      shares -= t.shares;
      if (shares <= 1e-9) avgCost = 0;
      cash += value - commission;
    }
  }
  return { shares, avgCost, cash, realized, sellRealized, oversold };
}

/**
 * Correct (`next` = the fixed trade) or delete (`next` = null) the trade at
 * `index` in the log.
 *
 * A position isn't always built from logged trades alone: a screenshot import
 * or a manual holding fix can set shares and average cost directly. So rather
 * than rebuilding the book from nothing, each affected stock's trades are
 * replayed from the holding they must have started from, once as logged and
 * once as corrected, and only the difference is applied to the position, cash
 * and realised P&L. That starting holding is solved from the current one: its
 * shares are today's minus the logged net, and since the replayed average cost
 * is linear in the starting average, two replays pin that down exactly. An
 * edit that changes nothing leaves the portfolio as it was.
 */
export function editTrade(portfolio, index, next, rules = RULES) {
  const old = portfolio.trades?.[index];
  if (!old) throw new Error('الصفقة دي مش موجودة — حدّث الصفحة وجرب تاني.');

  let replacement = null;
  if (next) {
    const code = String(next.code ?? '').toUpperCase();
    const shares = Number(next.shares);
    const price = Number(next.price);
    if (!(shares > 0) || !(price > 0)) throw new Error('عدد الأسهم والسعر لازم يكونوا أكبر من صفر');
    if (next.side !== 'buy' && next.side !== 'sell') throw new Error(`نوع الصفقة لازم يكون buy أو sell، مش ${next.side}`);
    if (!lookup(code)) {
      throw new Error(`الكود "${code}" مش في قائمة الأسهم اللي التطبيق بيقدر يتابعها — اختاره من القائمة بدل الكتابة اليدوية.`);
    }
    const { realized: _realized, ...kept } = old;
    replacement = {
      ...kept,
      date: next.date || old.date,
      code,
      side: next.side,
      shares,
      price,
      commission: +(shares * price * (rules.commissionPct / 100)).toFixed(2),
      note: next.note !== undefined ? next.note : old.note ?? null,
    };
  }

  const trades = [...portfolio.trades];
  if (replacement) trades[index] = replacement;
  else trades.splice(index, 1);

  const positions = { ...portfolio.positions };
  let cash = portfolio.cash ?? 0;
  let realizedPnl = portfolio.realizedPnl ?? 0;

  for (const code of new Set([old.code, replacement?.code].filter(Boolean))) {
    const before = portfolio.trades.filter((t) => t.code === code);
    const after = trades.filter((t) => t.code === code);
    const current = positions[code];
    const net = before.reduce((sum, t) => sum + (t.side === 'buy' ? t.shares : -t.shares), 0);
    const startShares = (current?.shares ?? 0) - net;

    const at0 = replayCode(before, { shares: startShares, avgCost: 0 }).avgCost;
    const at1 = replayCode(before, { shares: startShares, avgCost: 1 }).avgCost;
    const slope = at1 - at0;
    const startAvg = Math.abs(slope) > 1e-12 ? ((current?.avgCost ?? 0) - at0) / slope : 0;
    const start = { shares: startShares, avgCost: startAvg };

    const was = replayCode(before, start);
    const now = replayCode(after, start);
    if (now.oversold && !was.oversold) {
      throw new Error(`بعد التعديل هتبقى بايع من ${code} أكتر من اللي كان عندك.`);
    }
    if (now.shares < -1e-9) throw new Error(`بعد التعديل عدد أسهم ${code} هيبقى بالسالب.`);

    cash += now.cash - was.cash;
    realizedPnl += now.realized - was.realized;

    // Each sell's realised figure depends on the average cost before it.
    let sell = 0;
    for (let i = 0; i < trades.length; i++) {
      if (trades[i].code !== code || trades[i].side !== 'sell') continue;
      trades[i] = { ...trades[i], realized: +now.sellRealized[sell++].toFixed(2) };
    }

    if (now.shares <= 1e-9) {
      delete positions[code];
    } else {
      const firstBuy = after.find((t) => t.side === 'buy');
      positions[code] = {
        ...(current ?? { stop: null, target: null, openedAt: firstBuy?.date ?? old.date }),
        shares: +now.shares.toFixed(4),
        avgCost: +now.avgCost.toFixed(4),
      };
    }
  }

  return { ...portfolio, trades, positions, cash: +cash.toFixed(2), realizedPnl: +realizedPnl.toFixed(2) };
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
 * Fingerprints exactly the inputs that change a personalized AI review's
 * substance — holdings, watchlist and cash — so a cached review is reused
 * only while the portfolio it was written for hasn't actually moved. See
 * analyst.js's getOrGenerateReview.
 */
export function portfolioHash(portfolio) {
  const positions = Object.entries(portfolio.positions)
    .map(([code, pos]) => [code, pos.shares, pos.avgCost, pos.stop ?? null])
    .sort((a, b) => a[0].localeCompare(b[0]));
  const watchlist = Object.keys(portfolio.watchlist ?? {}).sort();
  return createHash('sha256').update(JSON.stringify({ positions, watchlist, cash: portfolio.cash })).digest('hex');
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

  // No saved entry to diff against yet (first-ever snapshot, or a gap before
  // it) — fall back to today's real exchange move instead of reporting a
  // flat 0%, using each holding's own close-to-close change from the synced
  // daily bars.
  const dayChange = priorTotal != null
    ? total - priorTotal
    : held.reduce((sum, a) => {
        const changePct = a.snapshot.price.changePct;
        return changePct == null ? sum : sum + a.position.marketValue * (changePct / 100);
      }, 0);
  const priorEffective = priorTotal ?? total - dayChange;

  const entry = {
    date: day,
    total: +total.toFixed(2),
    positionsValue: +positionsValue.toFixed(2),
    cash: portfolio.cash,
    pl: +pl.toFixed(2),
    dayChange: +dayChange.toFixed(2),
    dayChangePct: priorEffective ? +((dayChange / priorEffective) * 100).toFixed(2) : 0,
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
