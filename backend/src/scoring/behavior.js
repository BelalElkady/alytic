/**
 * The investor's own track record, read from the trade log and the daily log.
 *
 * Deterministic, like the rest of scoring/: the AI cash review (see
 * agent/cashAnalysis.js) is handed these figures to judge, never asked to
 * derive them from raw trades. Holding periods are FIFO-matched lot by lot,
 * and the inferred style uses the same thresholds as
 * frontend/src/lib/invest-style.ts's inferInvestStyle(), so the style the UI
 * auto-selects and the style this profile reports can't disagree.
 */

import { lookup, sectorLabel } from '../config/universe.js';

// Mirrors frontend/src/lib/invest-style.ts — keep the two in step.
const MIN_CLOSED_TRADES = 3;
const TRADER_MAX_AVG_DAYS = 10;
const MEDIUM_MAX_AVG_DAYS = 60;

const DAY_MS = 86_400_000;
const r1 = (x) => Math.round(x * 10) / 10;

function daysBetween(from, to) {
  const ms = new Date(to).getTime() - new Date(from).getTime();
  return Number.isFinite(ms) ? Math.max(0, ms / DAY_MS) : 0;
}

function sectorOf(code) {
  const meta = lookup(code);
  return meta?.sector ? sectorLabel(meta.sector) : 'غير مصنف';
}

/**
 * @param {object} portfolio - the loaded portfolio (trades, log, realizedPnl)
 * @param {object} [opts]
 * @param {number} [opts.capital] - current capital, to express ticket sizes as a share of it
 * @param {string} [opts.today] - YYYY-MM-DD, for trade-frequency windows
 */
export function behaviorProfile(portfolio, { capital = 0, today = new Date().toISOString().slice(0, 10) } = {}) {
  const trades = [...(portfolio.trades ?? [])].filter((t) => t?.date && t?.code).sort((a, b) => a.date.localeCompare(b.date));

  const lots = {};    // code -> [{ shares, date }] open FIFO lots
  const running = {}; // code -> { shares, avgCost } replayed position
  const buyValueBySector = {};
  const buyTickets = [];
  let averagingDownBuys = 0;
  let addingToWinnerBuys = 0;
  let weightedDays = 0, matchedShares = 0;
  let winDays = 0, winShares = 0, lossDays = 0, lossShares = 0;
  let wins = 0, losses = 0, grossWin = 0, grossLoss = 0;
  let closedTrips = 0;

  for (const t of trades) {
    const pos = (running[t.code] ??= { shares: 0, avgCost: 0 });
    const open = (lots[t.code] ??= []);

    if (t.side === 'buy') {
      if (pos.shares > 0 && t.price < pos.avgCost) averagingDownBuys += 1;
      else if (pos.shares > 0 && t.price > pos.avgCost) addingToWinnerBuys += 1;
      const value = t.shares * t.price;
      buyTickets.push(value);
      buyValueBySector[sectorOf(t.code)] = (buyValueBySector[sectorOf(t.code)] ?? 0) + value;
      pos.avgCost = (pos.shares * pos.avgCost + value) / (pos.shares + t.shares);
      pos.shares += t.shares;
      open.push({ shares: t.shares, date: t.date });
      continue;
    }
    if (t.side !== 'sell') continue;

    const realized = t.realized ?? t.shares * (t.price - pos.avgCost);
    const won = realized > 0;
    if (won) { wins += 1; grossWin += realized; } else { losses += 1; grossLoss += -realized; }

    let remaining = t.shares;
    while (remaining > 0 && open.length) {
      const lot = open[0];
      const matched = Math.min(remaining, lot.shares);
      const days = daysBetween(lot.date, t.date) * matched;
      weightedDays += days;
      matchedShares += matched;
      if (won) { winDays += days; winShares += matched; } else { lossDays += days; lossShares += matched; }
      remaining -= matched;
      lot.shares -= matched;
      if (lot.shares <= 0) open.shift();
    }
    pos.shares = Math.max(0, pos.shares - t.shares);
    if (pos.shares === 0) pos.avgCost = 0;
    closedTrips += 1;
  }

  const buys = trades.filter((t) => t.side === 'buy').length;
  const within = (days) => trades.filter((t) => daysBetween(t.date, today) <= days).length;
  const avgHoldDays = matchedShares ? r1(weightedDays / matchedShares) : null;
  const inferredStyle = closedTrips < MIN_CLOSED_TRADES || !matchedShares
    ? null
    : avgHoldDays < TRADER_MAX_AVG_DAYS ? 'trader' : avgHoldDays < MEDIUM_MAX_AVG_DAYS ? 'medium' : 'long';

  const totalBuyValue = buyTickets.reduce((a, b) => a + b, 0);
  const avgTicket = buyTickets.length ? totalBuyValue / buyTickets.length : null;
  const sectorPreference = Object.entries(buyValueBySector)
    .map(([sector, value]) => ({ sector, pctOfBuys: r1((value / totalBuyValue) * 100) }))
    .sort((a, b) => b.pctOfBuys - a.pctOfBuys)
    .slice(0, 3);

  // How much cash this investor actually tends to sit on, from saved closes.
  const logEntries = Object.values(portfolio.log ?? {})
    .filter((e) => e?.total > 0 && e.cash != null)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .slice(-60);
  const cashShares = logEntries.map((e) => (e.cash / e.total) * 100);

  return {
    tradesCount: trades.length,
    buys,
    sells: closedTrips,
    firstTradeDate: trades[0]?.date ?? null,
    lastTradeDate: trades.at(-1)?.date ?? null,
    tradesLast30d: within(30),
    tradesLast90d: within(90),
    distinctStocks: new Set(trades.map((t) => t.code)).size,
    avgHoldDays,
    avgHoldDaysWinners: winShares ? r1(winDays / winShares) : null,
    avgHoldDaysLosers: lossShares ? r1(lossDays / lossShares) : null,
    inferredStyle,
    winRatePct: closedTrips ? r1((wins / closedTrips) * 100) : null,
    avgWinEgp: wins ? Math.round(grossWin / wins) : null,
    avgLossEgp: losses ? Math.round(grossLoss / losses) : null,
    profitFactor: grossLoss > 0 ? r1(grossWin / grossLoss) : null,
    realizedPnl: Math.round(portfolio.realizedPnl ?? 0),
    averagingDownBuys,
    addingToWinnerBuys,
    avgBuyTicketEgp: avgTicket != null ? Math.round(avgTicket) : null,
    largestBuyTicketEgp: buyTickets.length ? Math.round(Math.max(...buyTickets)) : null,
    avgBuyTicketPctOfCapital: avgTicket != null && capital > 0 ? r1((avgTicket / capital) * 100) : null,
    sectorPreference,
    avgCashPct: cashShares.length ? r1(cashShares.reduce((a, b) => a + b, 0) / cashShares.length) : null,
    loggedDays: logEntries.length,
  };
}

const n = (x, unit = '') => (x == null ? 'n/a' : `${x}${unit}`);

/** The profile as prompt lines — English scaffolding, engine figures as given. */
export function behaviorLines(profile, { style, styleAuto } = {}) {
  if (!profile.tradesCount) {
    return '- No trades recorded yet — there is no behavior history to read. Do not invent one; advise as for a first-time deployment.';
  }
  const styleLine = profile.inferredStyle
    ? `- Style inferred from actual holding periods: ${profile.inferredStyle} | style this review uses: ${style} (${styleAuto ? 'auto — taken from that behavior' : 'picked manually by the investor'})` +
      (profile.inferredStyle !== style ? ' ⚠️ the investor\'s actual behavior does not match the style they picked' : '')
    : `- Too few closed trades (${profile.sells}) to infer a style from behavior | style this review uses: ${style} (${styleAuto ? 'default' : 'picked manually'})`;
  return [
    `- Trades: ${profile.tradesCount} (${profile.buys} buys, ${profile.sells} sells) across ${profile.distinctStocks} stocks, ${profile.firstTradeDate} → ${profile.lastTradeDate} | last 30 days: ${profile.tradesLast30d} · last 90 days: ${profile.tradesLast90d}`,
    styleLine,
    `- Average holding period: ${n(profile.avgHoldDays, ' days')} | winners held ${n(profile.avgHoldDaysWinners, ' days')} · losers held ${n(profile.avgHoldDaysLosers, ' days')}`,
    `- Closed trades: win rate ${n(profile.winRatePct, '%')} | avg win ${n(profile.avgWinEgp, ' EGP')} · avg loss ${n(profile.avgLossEgp, ' EGP')} | profit factor ${n(profile.profitFactor)} | realized P/L ${profile.realizedPnl} EGP`,
    `- Buys into an existing position below its average cost (averaging down): ${profile.averagingDownBuys} | above it (adding to a winner): ${profile.addingToWinnerBuys}`,
    `- Buy ticket size: avg ${n(profile.avgBuyTicketEgp, ' EGP')} (${n(profile.avgBuyTicketPctOfCapital, '% of current capital')}) · largest ${n(profile.largestBuyTicketEgp, ' EGP')}`,
    `- Sectors bought most (by value): ${profile.sectorPreference.map((s) => `${s.sector} ${s.pctOfBuys}%`).join(' · ') || 'n/a'}`,
    `- Usual cash level over the last ${profile.loggedDays} saved closes: ${n(profile.avgCashPct, '% of capital')}`,
  ].join('\n');
}
