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
import { getPortfolioById, putPortfolioById, getUserUsage, putUserUsage, listPortfoliosForUser, insertPortfolio, updatePortfolioMeta, softDeletePortfolio } from './db.js';
import { lookup } from './config/universe.js';
import { currentTenant } from './tenancy/context.js';

const EMPTY = {
  cash: 0,
  positions: {},   // code -> { shares, avgCost, stop, target, openedAt, addedOrder, sharesSetAt }
  watchlist: {},   // favorites the user picked to watch — code -> { addedAt, note }
  trades: [],      // { date, code, side, shares, price, commission, note } — a 'dividend' row's price is the cash paid per share
  // One entry per saved close, keyed YYYY-MM-DD. This is what the calendar and
  // the equity curve read — without it the app can show today but has no
  // memory, so "how did the book do this month" is unanswerable.
  log: {},         // date -> { total, positionsValue, cash, cashFlow, dayChange, pl, prices, stops, note, changes, savedAt }
  cashFlows: [],   // { at, amount, source } — money moved in or out other than by the market; see recordCashFlow
  corporateActions: [], // bonus shares, splits, mergers found on held stocks — see corporateActions.js
  settings: {},
  realizedPnl: 0,
  updatedAt: null,
};

// A Portfolio lives at its own `id`, not at the User's id — a User can have
// more than one. Callers resolve which Portfolio they mean (e.g. via
// `primaryPortfolioIdFor`) and pass that id in directly.
export async function loadPortfolio(portfolioId) {
  const row = await getPortfolioById(portfolioId);
  return stampAddedOrder({ ...EMPTY, ...(row?.state ?? {}) });
}

export async function savePortfolio(p, portfolioId) {
  const stamped = stampAddedOrder(p);
  await putPortfolioById(portfolioId, stamped);
  return stamped;
}

/**
 * Gives every position without one an `addedOrder` — its place in the order
 * the positions arrived in (see "Order added" in CONTEXT.md). The order has to
 * be stored: the portfolio lives in a jsonb column, and jsonb re-sorts object
 * keys, so the order positions were written in is gone once saved.
 *
 * In memory, before a save, key order is still arrival order (a screenshot
 * import builds its positions top row first), so new positions are numbered
 * in that order after everything already stamped. A portfolio saved before
 * this existed has no counter and its key order is jsonb's, so its positions
 * are numbered by the day they were opened, then by code.
 */
export function stampAddedOrder(p) {
  const positions = p.positions ?? {};
  let unstamped = Object.keys(positions).filter((c) => !Number.isFinite(positions[c]?.addedOrder));
  const stamped = Object.values(positions).map((pos) => pos?.addedOrder).filter(Number.isFinite);
  let next = Number.isFinite(p.nextAddedOrder) ? p.nextAddedOrder : Math.max(0, ...stamped.map((n) => n + 1));
  if (!unstamped.length) return next === p.nextAddedOrder ? p : { ...p, nextAddedOrder: next };
  if (!Number.isFinite(p.nextAddedOrder)) {
    unstamped = unstamped.sort((a, b) =>
      String(positions[a].openedAt ?? '').localeCompare(String(positions[b].openedAt ?? '')) || a.localeCompare(b));
  }
  const nextPositions = { ...positions };
  for (const c of unstamped) nextPositions[c] = { ...positions[c], addedOrder: next++ };
  return { ...p, positions: nextPositions, nextAddedOrder: next };
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
 *
 * The same queue also guards `withUserUsage` and `withPortfolioAndUsage`
 * below — a User's quota (the `users` table's usage/credit columns) and a
 * User's Portfolio book are different rows, but a screenshot import or a
 * paid stock review that spends quota *and* writes the book (Task 7) needs
 * both changes to land as one atomic step from every other caller's point of
 * view. If usage had its own queue, a `withPortfolio` write and a
 * `withUserUsage` write for the same user could run concurrently and
 * interleave — the exact lost-update shape this queue exists to prevent, just
 * moved from "two book writes" to "a book write racing a usage write". So
 * there is deliberately one lock per User, not one per (User, resource): all
 * three functions below queue on the same `queueKey`.
 */
const writeQueues = new Map();

/**
 * Runs `fn` as the next step in this user's queue, chained after whatever is
 * already running (or resolved immediately if the queue is empty), and clears
 * the slot afterwards so the map doesn't grow forever. Shared by
 * `withPortfolio`, `withUserUsage` and `withPortfolioAndUsage` so they all
 * mutually exclude each other for the same user — see the comment above.
 */
async function withUserLock(userId, fn) {
  // Per site as well as per user: the 'local' CLI id exists in every tenant's database.
  const queueKey = `${currentTenant()?.id ?? ''}:${userId}`;
  const previous = writeQueues.get(queueKey) ?? Promise.resolve();
  const run = previous
    .catch(() => {}) // a prior failure must not jam the queue for later callers
    .then(fn);
  writeQueues.set(queueKey, run);
  try {
    return await run;
  } finally {
    // Only clear the slot if nobody queued behind us — otherwise this would
    // drop the reference to the run a later caller is chained onto.
    if (writeQueues.get(queueKey) === run) writeQueues.delete(queueKey);
  }
}

export async function withPortfolio(userId, portfolioId, mutator) {
  return withUserLock(userId, async () => {
    const portfolio = await loadPortfolio(portfolioId);
    return savePortfolio(stampSharesSetAt(portfolio, await mutator(portfolio)), portfolioId);
  });
}

/**
 * Creates a new Portfolio for this User — named and styled from the start
 * (map #98: every Portfolio has its own Investing style from creation) —
 * unless the User is already at their tier's cap (#103). Seeds the new
 * Portfolio's own style setting to match (see the plan's Global
 * Constraints' two-place style write), so its first recommendation, before
 * it has any trade history of its own, already follows the style it was
 * given rather than defaulting to "medium". Locked per-user, same as every
 * other Portfolio write, so two concurrent creates can't both slip past
 * the cap.
 *
 * @returns {Promise<{ok: true, portfolio: object} | {ok: false, reason: 'cap' | 'duplicate_style'}>}
 */
export async function createPortfolioForUser(userId, { name, style }, cap) {
  return withUserLock(userId, async () => {
    const list = await listPortfoliosForUser(userId);
    if (list.length >= cap) return { ok: false, reason: 'cap' };
    if (list.some((portfolio) => (portfolio.style ?? portfolio.state?.settings?.investStyle) === style)) {
      return { ok: false, reason: 'duplicate_style' };
    }
    const ordinal = list.length ? Math.max(...list.map((p) => p.ordinal)) + 1 : 0;
    const row = await insertPortfolio(userId, { name, style, ordinal });
    await savePortfolio({ ...EMPTY, settings: { investStyle: style } }, row.id);
    return { ok: true, portfolio: row };
  });
}

/**
 * This Portfolio's writable rank — its 0-based position among the User's
 * live Portfolios, ordered by ordinal (creation order) — #103's definition.
 * -1 if portfolioId isn't one of this User's live Portfolios.
 */
export async function portfolioRankFor(userId, portfolioId) {
  const list = await listPortfoliosForUser(userId);
  return list.findIndex((p) => p.id === portfolioId);
}

/**
 * Renames and/or restyles a Portfolio — blocked once it's past the User's
 * cap (#103: read-only, same as every other write) or if it isn't one of
 * this User's live Portfolios. Keeps the two-place style write (see the
 * plan's Global Constraints) in step, the same as creation does.
 *
 * @returns {Promise<{ok: true} | {ok: false, reason: 'not_found' | 'readonly' | 'duplicate_style'}>}
 */
export async function renamePortfolio(userId, portfolioId, { name, style }, cap) {
  return withUserLock(userId, async () => {
    const rank = await portfolioRankFor(userId, portfolioId);
    if (rank === -1) return { ok: false, reason: 'not_found' };
    if (rank >= cap) return { ok: false, reason: 'readonly' };
    const list = await listPortfoliosForUser(userId);
    const current = list.find((portfolio) => portfolio.id === portfolioId);
    const currentStyle = current?.style ?? current?.state?.settings?.investStyle;
    if (style && style !== currentStyle && list.some(
      (portfolio) => portfolio.id !== portfolioId && (portfolio.style ?? portfolio.state?.settings?.investStyle) === style,
    )) {
      return { ok: false, reason: 'duplicate_style' };
    }
    await updatePortfolioMeta(portfolioId, { name, style });
    if (style) {
      const portfolio = await loadPortfolio(portfolioId);
      await savePortfolio({ ...portfolio, settings: { ...portfolio.settings, investStyle: style } }, portfolioId);
    }
    return { ok: true };
  });
}

/**
 * Soft-deletes a Portfolio — allowed even when it's read-only (#102's
 * resolution: deleting a locked Portfolio is how a User promotes the next
 * one), refused only when it's the User's last live Portfolio.
 *
 * @returns {Promise<{ok: true} | {ok: false, reason: 'not_found' | 'last'}>}
 */
export async function deletePortfolio(userId, portfolioId) {
  return withUserLock(userId, async () => {
    const list = await listPortfoliosForUser(userId);
    if (!list.some((p) => p.id === portfolioId)) return { ok: false, reason: 'not_found' };
    if (list.length <= 1) return { ok: false, reason: 'last' };
    await softDeletePortfolio(portfolioId);
    return { ok: true };
  });
}

/**
 * Same read-modify-write serialisation as `withPortfolio`, for a User's
 * usage/Credits row instead of their Portfolio book — e.g. charging a cash or
 * market-scan session (Task 7). Queues behind the same per-user lock
 * `withPortfolio` uses, so a usage write can never race a book write for the
 * same user.
 */
export async function withUserUsage(userId, mutator) {
  return withUserLock(userId, async () => {
    const usage = await getUserUsage(userId);
    const next = await mutator(usage);
    await putUserUsage(userId, next);
    return next;
  });
}

/**
 * For the two call sites (Task 7: screenshot import, a paid stock review)
 * that must spend a User's quota *and* write that User's Portfolio book as
 * one atomic step — both reads happen before `mutator` runs, both writes
 * happen after, and the whole thing is one turn of the same per-user queue
 * `withPortfolio` and `withUserUsage` use, so nothing else for this user can
 * observe it half-done.
 */
export async function withPortfolioAndUsage(userId, portfolioId, mutator) {
  return withUserLock(userId, async () => {
    const [usage, portfolio] = await Promise.all([getUserUsage(userId), loadPortfolio(portfolioId)]);
    const next = await mutator({ usage, portfolio });
    const stamped = stampSharesSetAt(portfolio, next.portfolio);
    const [, savedPortfolio] = await Promise.all([
      putUserUsage(userId, next.usage),
      savePortfolio(stamped, portfolioId),
    ]);
    return { usage: next.usage, portfolio: savedPortfolio };
  });
}

/**
 * Marks each holding whose share count or average cost this write changed
 * with the Cairo day it happened. A corporate action (see corporateActions.js)
 * only rewrites a holding whose numbers were set before it — one set after it,
 * say from a fresh broker screenshot, is already on the new basis.
 */
export function stampSharesSetAt(before, after, now = new Date()) {
  const day = now.toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
  let positions = null;
  for (const [code, pos] of Object.entries(after.positions ?? {})) {
    const was = before.positions?.[code];
    if (was && was.shares === pos.shares && was.avgCost === pos.avgCost) continue;
    if (pos.sharesSetAt === day) continue;
    positions ??= { ...after.positions };
    positions[code] = { ...pos, sharesSetAt: day };
  }
  return positions ? { ...after, positions } : after;
}

/** A trade's entered fees as a non-negative amount, 0 when left blank. */
function feesOf(fees) {
  const n = Number(fees ?? 0);
  if (!Number.isFinite(n) || n < 0) throw new Error('العمولة لازم تكون رقم صفر أو أكبر');
  return n;
}

/**
 * Record a trade and roll the position forward.
 *
 * Buys move average cost; sells never do — they realise P&L against the
 * existing average and leave it untouched for the remaining shares. Getting
 * this backwards is the classic way a book quietly stops reflecting reality.
 *
 * A dividend (`shares` entitled × `price` paid per share) is cash received:
 * it adds to cash and realised P&L, pays no commission, and leaves the
 * position alone — the shares may since have been sold, since a dividend is
 * paid to whoever held on the record date.
 *
 * `fees` is what the broker actually charged for the trade, as the user
 * entered it; it's optional and a trade without it pays none.
 */
export async function recordTrade(portfolio, { code, side, shares, price, fees = 0, date = null, note = null }) {
  const c = code.toUpperCase();
  const p = { ...portfolio, positions: { ...portfolio.positions }, trades: [...portfolio.trades] };
  const commission = side === 'dividend' ? 0 : feesOf(fees);
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
  } else if (side === 'dividend') {
    p.realizedPnl = +((p.realizedPnl ?? 0) + shares * price).toFixed(2);
    p.cash = +(p.cash + shares * price).toFixed(2);
  } else {
    throw new Error(`نوع الصفقة لازم يكون buy أو sell أو dividend، مش ${side}`);
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
    ...(side === 'dividend' ? { realized: +(shares * price).toFixed(2) } : {}),
  });

  return p;
}

/**
 * Walk one stock's trades, in log order, from a starting holding. Returns the
 * shares and average cost it ends on, the cash it moved, the P&L it realised
 * (and each sell's share of it), and whether any sell exceeded what was held.
 * Same arithmetic as recordTrade, minus the rounding; a dividend only adds
 * cash and realised P&L.
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
    } else if (t.side === 'dividend') {
      cash += value;
      realized += value;
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
export function editTrade(portfolio, index, next) {
  const old = portfolio.trades?.[index];
  if (!old) throw new Error('الصفقة دي مش موجودة — حدّث الصفحة وجرب تاني.');

  let replacement = null;
  if (next) {
    const code = String(next.code ?? '').toUpperCase();
    const shares = Number(next.shares);
    const price = Number(next.price);
    if (!(shares > 0) || !(price > 0)) throw new Error('عدد الأسهم والسعر لازم يكونوا أكبر من صفر');
    if (!['buy', 'sell', 'dividend'].includes(next.side)) throw new Error(`نوع الصفقة لازم يكون buy أو sell أو dividend، مش ${next.side}`);
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
      // Fees left out of the edit keep what the trade was logged with.
      commission: next.side === 'dividend' ? 0 : +feesOf(next.fees ?? old.commission ?? 0).toFixed(2),
      note: next.note !== undefined ? next.note : old.note ?? null,
      ...(next.side === 'dividend' ? { realized: +(shares * price).toFixed(2) } : {}),
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
    const net = before.reduce((sum, t) => sum + (t.side === 'buy' ? t.shares : t.side === 'sell' ? -t.shares : 0), 0);
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

/**
 * Note value that entered (+) or left (−) the book without the market moving
 * it: cash set by hand or read off a screenshot, or shares that appear or
 * disappear through an import or a holding fix. The daily close subtracts
 * these from the change in total, so a 50,000 deposit on a flat day doesn't
 * show as a 50,000 gain. Trades aren't flows — they swap cash for shares.
 */
export function recordCashFlow(portfolio, amount, source, at = new Date()) {
  if (!Number.isFinite(amount) || Math.abs(amount) < 0.005) return portfolio;
  const flow = { at: at.toISOString(), amount: +amount.toFixed(2), source };
  return { ...portfolio, cashFlows: [...(portfolio.cashFlows ?? []), flow].slice(-500) };
}

/**
 * Market value of the shares that differ between two position maps, valued at
 * one set of prices (falling back to average cost where there's no price) —
 * the flow to record when positions are replaced or corrected by hand.
 */
export function positionsFlow(before, after, prices) {
  let flow = 0;
  for (const code of new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])) {
    const delta = (after?.[code]?.shares ?? 0) - (before?.[code]?.shares ?? 0);
    if (!delta) continue;
    const price = prices.get(code) ?? after?.[code]?.avgCost ?? before?.[code]?.avgCost ?? 0;
    flow += delta * price;
  }
  return flow;
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
 * honest baseline. Cash flows recorded after that entry was saved are taken
 * out, so only what the market did remains.
 */
export function recordSnapshot(portfolio, analyses, date = null, now = new Date()) {
  const day = date ?? now.toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
  const savedAt = now.toISOString();
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

  // The prior total already includes every flow made before it was saved.
  // Entries from before flows were tracked have no savedAt, and every flow
  // postdates them.
  const priorSavedAt = prior ? portfolio.log[prior].savedAt : null;
  const flows = prior
    ? (portfolio.cashFlows ?? []).filter((f) => (!priorSavedAt || f.at > priorSavedAt) && f.at <= savedAt)
    : [];
  const cashFlow = flows.reduce((sum, f) => sum + f.amount, 0);
  const inflow = flows.reduce((sum, f) => sum + Math.max(f.amount, 0), 0);

  // No saved entry to diff against yet (first-ever snapshot, or a gap before
  // it) — fall back to today's real exchange move instead of reporting a
  // flat 0%, using each holding's own close-to-close change from the synced
  // daily bars. marketValue is today's value, so a +pct move on it was
  // earned on marketValue / (1 + pct/100).
  const dayChange = priorTotal != null
    ? total - priorTotal - cashFlow
    : held.reduce((sum, a) => {
        const changePct = a.snapshot.price.changePct;
        return changePct == null || changePct <= -100 ? sum : sum + a.position.marketValue * (changePct / (100 + changePct));
      }, 0);
  // New money counts as capital at work for the day's percentage.
  const priorEffective = priorTotal != null ? priorTotal + inflow : total - dayChange;

  const entry = {
    date: day,
    total: +total.toFixed(2),
    positionsValue: +positionsValue.toFixed(2),
    cash: portfolio.cash,
    cashFlow: +cashFlow.toFixed(2),
    pl: +pl.toFixed(2),
    dayChange: +dayChange.toFixed(2),
    dayChangePct: priorEffective ? +((dayChange / priorEffective) * 100).toFixed(2) : 0,
    prices,
    stops,
    recs,
    changes,
    note: portfolio.log?.[day]?.note ?? null, // never clobber a note already written
    savedAt,
  };

  return { ...portfolio, log: { ...(portfolio.log ?? {}), [day]: entry } };
}

export function setNote(portfolio, date, note) {
  const existing = portfolio.log?.[date];
  if (!existing) throw new Error(`مفيش بيانات محفوظة ليوم ${date}`);
  return { ...portfolio, log: { ...portfolio.log, [date]: { ...existing, note } } };
}

/**
 * Keeps a stock's AI recommendation on the portfolio as its last one — the
 * position card shows it, on any device, until the user asks for a new one.
 * Only what the card shows is kept (the full verdict's prose would bloat the
 * row every request loads), along with what it was written against: the
 * style, the price, and the holding, so the card can say when it's outdated
 * instead of hiding it. Entries for stocks no longer held are dropped.
 * `stop`, when the stop was in play, is kept beside it (see stopContextOf).
 */
/**
 * What to keep about the stop behind a verdict: the rule book's R1 block
 * (level, whether it fired, the closes it needs, and the keep-a-core option's
 * eligibility with its blockers) plus the model, and the verdict's reasoning
 * trimmed so the portfolio row stays small. Null unless the stop fired or is
 * on warning, so quiet holds add nothing to the row.
 */
export function stopContextOf(analysis, verdict) {
  const r1 = analysis?.position?.ruleBook?.stop;
  if (!r1 || !(r1.fired || r1.warning)) return null;
  const fh = r1.fundamentalHold;
  return {
    level: r1.level,
    fired: Boolean(r1.fired),
    distancePct: r1.distancePct,
    confirmCloses: r1.confirmCloses ?? 1,
    warning: r1.warning ?? null,
    fundamentalHold: fh ? { eligible: Boolean(fh.eligible), blockers: fh.blockers ?? [], holdThrough: fh.holdThrough ?? null } : null,
    model: verdict?._meta?.model ?? null,
    reasoning: typeof verdict?.reasoning === 'string' ? verdict.reasoning.slice(0, 1200) : null,
  };
}

export function rememberVerdict(p, code, verdict, { style, price = null, now = Date.now(), stop = null } = {}) {
  const c = String(code).toUpperCase();
  const pos = p.positions?.[c];
  const kept = {};
  for (const [k, v] of Object.entries(p.lastVerdicts ?? {})) if (p.positions?.[k]) kept[k] = v;
  if (pos && verdict?.action) {
    kept[c] = {
      at: now,
      style,
      price,
      shares: pos.shares,
      avgCost: pos.avgCost,
      verdict: {
        action: verdict.action,
        conviction: verdict.conviction ?? null,
        headline: verdict.headline ?? '',
        orderInstruction: verdict.orderInstruction ?? null,
        invalidation: verdict.invalidation ?? null,
        reentryPlan: verdict.reentryPlan ?? null,
        scenarios: verdict.scenarios ?? null,
      },
      // Why a stop-break verdict said what it said — the rule book's stop
      // block and the model's reasoning — so it can be looked up afterwards.
      // Null on a verdict with no stop in play.
      ...(stop ? { stopContext: stop } : {}),
    };
  }
  return { ...p, lastVerdicts: kept };
}
