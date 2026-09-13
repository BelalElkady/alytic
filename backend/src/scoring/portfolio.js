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
import { CLASSIFICATION_TYPES } from '../config/classification.js';

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

/**
 * Portfolio-level read of investment-vs-speculation classification (see
 * scoring/classification.js) — the difference between "a good stock" and "a
 * good stock for this portfolio" the analyst is asked to keep separate
 * (prompts/system.js) needs the book's *composition* by classification, not
 * just each holding's own scores. Weighted by market value, like every other
 * concentration figure in this file.
 *
 * @param {object[]} analyses - analyzeTicker results; only held ones (.position) count
 */
export function portfolioClassificationSummary(analyses) {
  const held = analyses.filter((a) => a.position && a.classification);
  const totalValue = held.reduce((sum, a) => sum + (a.position.marketValue ?? 0), 0) || 1;

  const valueByType = Object.fromEntries(CLASSIFICATION_TYPES.map((t) => [t, 0]));
  let investmentSum = 0;
  let speculationSum = 0;
  let scoredCount = 0;

  for (const a of held) {
    const c = a.classification;
    const value = a.position.marketValue ?? 0;
    valueByType[c.type] = (valueByType[c.type] ?? 0) + value;
    if (c.investmentScore != null && c.speculationScore != null) {
      investmentSum += c.investmentScore;
      speculationSum += c.speculationScore;
      scoredCount++;
    }
  }

  const pctByType = Object.fromEntries(
    Object.entries(valueByType).map(([type, value]) => [type, r1((value / totalValue) * 100)]),
  );

  // HYBRID names carry real speculative character alongside their investment
  // case (that is the whole point of the label), so they count toward
  // exposure here — a book that is half HYBRID is not "half safe".
  const speculativeExposurePct = r1((pctByType.SPECULATIVE ?? 0) + (pctByType.HYBRID ?? 0));

  const speculativeHoldings = held
    .filter((a) => a.classification.type === 'SPECULATIVE' || a.classification.type === 'HYBRID')
    .map((a) => ({ code: a.code, type: a.classification.type, pctOfCapital: r1(((a.position.marketValue ?? 0) / totalValue) * 100) }))
    .sort((a, b) => b.pctOfCapital - a.pctOfCapital);

  return {
    holdings: held.length,
    pctByType,
    avgInvestmentScore: scoredCount ? r1(investmentSum / scoredCount) : null,
    avgSpeculationScore: scoredCount ? r1(speculationSum / scoredCount) : null,
    speculativeExposurePct,
    speculativePositionsCount: speculativeHoldings.length,
    largestSpeculativePositionPct: speculativeHoldings[0]?.pctOfCapital ?? 0,
    speculativeHoldings,
  };
}
