/**
 * Portfolio-level structure: concentration, diversification, cash headroom,
 * and a health score derived from them.
 *
 * This is arithmetic, so it lives here rather than in the prompt. The analyst
 * is asked to *judge* whether a stock fits the book — it should never be asked
 * to work out what percentage a position already is, or to eyeball whether a
 * sector is overweight. Every number below is computed from the same position
 * values the rest of the engine uses, and handed to the model ready-made.
 */

import RULES from '../config/rules.js';

const r1 = (x) => (x == null ? null : +x.toFixed(1));

/**
 * @param {object[]} analyses - analyzeTicker results (held ones carry .position)
 * @param {object} ctx - { cash, capital }
 */
export function portfolioStructure(analyses, ctx = {}, rules = RULES) {
  const held = analyses.filter((a) => a.position);
  const positionsValue = held.reduce((sum, a) => sum + (a.position.marketValue ?? 0), 0);
  const cash = ctx.cash ?? 0;
  const capital = ctx.capital || positionsValue + cash || 1;

  const weights = held
    .map((a) => ({
      code: a.code,
      sector: a.sectorAr ?? 'غير مصنف',
      value: a.position.marketValue ?? 0,
      pctOfCapital: r1(((a.position.marketValue ?? 0) / capital) * 100),
    }))
    .sort((a, b) => b.value - a.value);

  const bySector = {};
  for (const w of weights) bySector[w.sector] = (bySector[w.sector] ?? 0) + w.value;
  const sectors = Object.entries(bySector)
    .map(([sector, value]) => ({ sector, value, pctOfCapital: r1((value / capital) * 100) }))
    .sort((a, b) => b.value - a.value);

  const sumTop = (n) => r1((weights.slice(0, n).reduce((s, w) => s + w.value, 0) / capital) * 100);

  const structure = {
    capital: Math.round(capital),
    positionsValue: Math.round(positionsValue),
    cash: Math.round(cash),
    cashPct: r1((cash / capital) * 100),
    holdings: weights.length,
    weights,
    sectors,
    largestPct: weights[0]?.pctOfCapital ?? 0,
    top3Pct: sumTop(3),
    top5Pct: sumTop(5),
  };

  return { ...structure, health: healthScore(structure, rules) };
}

/**
 * A 0-100 read on how well-structured the book is, with every deduction
 * named. Deliberately explainable rather than clever: the analyst quotes the
 * reasons, so an unexplained number would be useless to it.
 */
function healthScore(s, rules) {
  const reasons = [];
  let score = 100;

  const overPosition = s.largestPct - rules.sizing.maxPositionPct;
  if (overPosition > 0) {
    const penalty = Math.min(30, Math.round(overPosition * 1.5));
    score -= penalty;
    reasons.push(`largest position ${s.largestPct}% > limit ${rules.sizing.maxPositionPct}% (-${penalty})`);
  }

  const topSector = s.sectors[0];
  const overSector = (topSector?.pctOfCapital ?? 0) - rules.sizing.maxSectorPct;
  if (topSector && overSector > 0) {
    const penalty = Math.min(30, Math.round(overSector * 1.2));
    score -= penalty;
    reasons.push(`${topSector.sector} sector ${topSector.pctOfCapital}% > limit ${rules.sizing.maxSectorPct}% (-${penalty})`);
  }

  if (s.holdings > 0 && s.holdings < 5) {
    const penalty = (5 - s.holdings) * 5;
    score -= penalty;
    reasons.push(`only ${s.holdings} holdings — weak diversification (-${penalty})`);
  }

  if (s.top3Pct > 60 && s.holdings > 3) {
    const penalty = Math.min(20, Math.round((s.top3Pct - 60) * 0.8));
    score -= penalty;
    reasons.push(`top 3 positions ${s.top3Pct}% of capital (-${penalty})`);
  }

  if (s.cashPct < rules.sizing.minCashBufferPct) {
    const penalty = Math.min(10, Math.round((rules.sizing.minCashBufferPct - s.cashPct) * 1.5));
    score -= penalty;
    reasons.push(`cash ${s.cashPct}% < required reserve ${rules.sizing.minCashBufferPct}% (-${penalty})`);
  }

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    reasons,
  };
}
