/**
 * The daily, market-wide deep report.
 *
 * Unlike reviewPortfolio() — personalized, called per user per request — this
 * scans the whole tracked universe once, writes one deep AI report, and is
 * cached in market_reports keyed by (trading day, investor style). Every user
 * requesting it that day reads the same stored row; the AI is asked exactly
 * once per (day, style), not once per request. That is the entire point: see
 * getOrGenerateMarketAnalysis, which callers should use instead of
 * generateMarketAnalysis directly.
 *
 * Because the cost is shared rather than per-request, this can afford to be
 * genuinely thorough — deep research on a real slate of candidates — in a way
 * a personalized review, paid for by one person per call, cannot.
 */

import { analyzeMany } from '../analyze.js';
import { ALL_CODES } from '../config/universe.js';
import { expectedLastSession } from '../data/cache.js';
import { MODEL_CHAIN, requestStructuredOR } from './clientOpenRouter.js';
import { MarketAnalysisSchema, MarketReframeSchema } from './schemas.js';
import { briefFor, crossCheckTool } from './analyst.js';
import { marketAnalysisSystemPrompt, marketReframeSystemPrompt } from './prompts/system.js';
import RULES from '../config/rules.js';
import { DEFAULT_STYLE, rulesForStyle } from '../config/styles.js';
import { getMarketReport, putMarketReport } from '../db.js';

// Names actually given a deep, researched writeup. A scan filter, not the
// final list — the model still chooses which of these earn a place in
// topOpportunities, and is free to include fewer. Lowered from 24: the
// prompt already asks for "fewer, genuinely well-researched" over a padded
// list, so researching more candidates than typically survive into
// topOpportunities was mostly paying for names that get discarded anyway.
const CANDIDATE_LIMIT = 15;

// The one style that pays for real web research each day. The other styles
// (see STYLE_KEYS in config/styles.js) get a cheap, search-free reframe of
// this style's report instead of their own full research pass — the
// underlying facts (news, disclosures, numbers) don't depend on investor
// horizon, only which opportunities surface and how the cash guide reads do.
// See reframeMarketAnalysis() and MarketOpportunitySchema's `suitableFor`.
const RESEARCH_STYLE = DEFAULT_STYLE;

/** Deterministic, no AI — the same work /api/scan already does. Safe to run
 * unconditionally to learn today's asOf before deciding whether to spend. */
async function scanMarket() {
  const { results, errors } = await analyzeMany(ALL_CODES, { capital: 1_000_000, concurrency: 6 });
  return { results, errors };
}

function rankCandidates(results) {
  return results
    .filter((r) => r.liquidity?.ok !== false)
    .map((r) => ({ r, rank: r.technical.score + Math.min(r.plan?.buyingNow?.riskReward ?? 0, 5) * 3 }))
    .sort((a, b) => b.rank - a.rank)
    .slice(0, CANDIDATE_LIMIT)
    .map((x) => x.r);
}

function sectorBreadthLines(results) {
  const bySector = {};
  for (const r of results) (bySector[r.sectorAr ?? 'unclassified'] ??= []).push(r);
  return Object.entries(bySector)
    .sort((a, b) => b[1].length - a[1].length)
    .map(([sector, list]) => {
      const avgScore = Math.round(list.reduce((sum, r) => sum + r.technical.score, 0) / list.length);
      const up = list.filter((r) => (r.snapshot.price.changePct ?? 0) > 0).length;
      return `  ${sector}: ${list.length} stocks, avg engine score ${avgScore}, ${up}/${list.length} up today`;
    })
    .join('\n');
}

/**
 * Runs the deep scan and the AI report. Expensive and uncached — callers
 * should use getOrGenerateMarketAnalysis instead, which checks storage first
 * and prevents two concurrent requests from paying for this twice.
 */
export async function generateMarketAnalysis({ model = MODEL_CHAIN, rules = RULES, style = DEFAULT_STYLE } = {}) {
  const { results } = await scanMarket();
  const asOf = results[0]?.asOf ?? new Date().toISOString().slice(0, 10);
  const effectiveRules = rulesForStyle(rules, style);
  const ranked = rankCandidates(results);

  const userMessage = `# Daily EGX market scan — close of ${asOf}

## Market breadth
- Stocks scanned: ${results.length}
- Sector breakdown:
${sectorBreadthLines(results)}

## Candidates for deep research (top ${ranked.length} by engine score and reward/risk — research and select from these for topOpportunities)
${ranked.map(briefFor).join('\n\n')}

---
Research the candidates above and write today's deep report: the market overview, a view of every sector represented above, your best genuinely-researched opportunities (not necessarily all ${ranked.length} — only the ones that earn it), a cash deployment guide in percentages for someone starting from scratch today, market-wide risks, and the single top priority for tomorrow.
Remember: every price, stop, target and risk/reward you refer to must come from the numbers given to you above — never invent or recompute one.`;

  const perStock = effectiveRules.webSearch?.perStock ?? 2;
  // A larger, shared budget than a personal review's — this runs once per
  // (day, style) and is read by everyone, so real depth is affordable here in
  // a way it would not be if paid for on every request.
  const searchBudget = Math.min(60, Math.max(perStock * 4, ranked.length * perStock));

  const { data, raw } = await requestStructuredOR({
    model,
    schema: MarketAnalysisSchema,
    schemaName: 'market_analysis',
    // Far bigger output than a single review (sector-by-sector writeups plus
    // several fully-researched opportunities) — needs real room even on the
    // cheaper model, unlike reviewPortfolio's 4000.
    maxTokens: 16000,
    system: marketAnalysisSystemPrompt(effectiveRules, style),
    messages: [{ role: 'user', content: userMessage }],
    webSearch: { engine: 'auto', max_results: 4, max_uses: searchBudget },
    clientTools: [crossCheckTool],
    feature: 'market_research',
  });

  // The model picked codes and wrote the narrative; every number an
  // opportunity displays is merged in here from that day's engine output, the
  // same separation reviewPortfolio keeps. A code the model names that isn't
  // in the scanned set is dropped rather than shown with no real numbers
  // behind it — that should not happen given the brief, but the boundary
  // holds either way.
  const byCode = new Map(results.map((r) => [r.code, r]));
  const topOpportunities = (data.topOpportunities ?? [])
    .map((op) => {
      const r = byCode.get(op.code);
      if (!r) return null;
      return {
        ...op,
        price: r.snapshot.price.close,
        entry: r.plan.suggestedEntry,
        stop: r.plan.stop.stop,
        riskPct: r.plan.stop.riskPct,
        midTarget: r.plan.targets.mid,
        longTarget: r.plan.targets.long,
        riskReward: r.plan.buyingNow.riskReward,
        sector: r.sectorAr,
      };
    })
    .filter(Boolean);

  const report = {
    asOf,
    style,
    marketOverview: data.marketOverview,
    sectorViews: data.sectorViews,
    topOpportunities,
    cashDeploymentGuide: data.cashDeploymentGuide,
    risksToWatch: data.risksToWatch,
    topPriority: data.topPriority,
    stocksScanned: results.length,
    candidatesResearched: ranked.length,
  };

  return { report, raw };
}

/** Opportunities from the base report actually tagged for this style — or,
 * failing that (a quiet day where nothing was tagged for it), all of them
 * rather than forcing an empty report. */
function pickOpportunitiesForStyle(base, style) {
  const matched = (base.topOpportunities ?? []).filter((op) => op.suitableFor?.includes(style));
  return matched.length ? matched : (base.topOpportunities ?? []);
}

/**
 * Turns the day's already-researched RESEARCH_STYLE report into a
 * `style`-specific one without paying for a second research pass: no web
 * search, no cross-check tool, a small maxTokens — this call only rewrites
 * framing (overview emphasis, cash guide, top priority), never facts.
 * sectorViews and risksToWatch carry over unchanged since neither is
 * horizon-specific; topOpportunities is filtered by `suitableFor` rather
 * than re-asked of the model.
 */
async function reframeMarketAnalysis({ model, rules, style, base }) {
  const effectiveRules = rulesForStyle(rules, style);
  const opportunities = pickOpportunitiesForStyle(base, style);

  const userMessage = `# Reframing today's already-researched EGX market report for a different horizon

## Market overview as researched today
${base.marketOverview}

## Opportunities suited to this horizon (already researched — codes, numbers and catalysts are final; do not re-research or invent)
${
  opportunities.length
    ? opportunities.map((op) => `- ${op.code} (${op.action}, ${op.conviction}): ${op.headline}`).join('\n')
    : 'No opportunities were researched today at all — say so and recommend holding cash.'
}

## Market-wide risks already identified today
${(base.risksToWatch ?? []).join(' | ') || 'none noted'}

---
Write: (1) a short reframed market overview for this horizon (2-3 sentences — same facts as above, different emphasis, not a copy of the wording), (2) the cash deployment guide for this horizon using only the codes listed above, (3) today's top priority for this horizon.`;

  const { data, raw } = await requestStructuredOR({
    model,
    schema: MarketReframeSchema,
    schemaName: 'market_reframe',
    maxTokens: 2000,
    system: marketReframeSystemPrompt(effectiveRules, style),
    messages: [{ role: 'user', content: userMessage }],
    feature: 'market_reframe',
  });

  const report = {
    asOf: base.asOf,
    style,
    marketOverview: data.marketOverview,
    sectorViews: base.sectorViews,
    topOpportunities: opportunities,
    cashDeploymentGuide: data.cashDeploymentGuide,
    risksToWatch: base.risksToWatch,
    topPriority: data.topPriority,
    stocksScanned: base.stocksScanned,
    candidatesResearched: base.candidatesResearched,
  };

  return { report, raw };
}

// One in-flight generation per (day, style) within this process, so two
// requests landing before the first finishes await the same run instead of
// each starting their own — the DB's ON CONFLICT DO NOTHING stops a double
// *write*, this stops the double *spend* that would otherwise happen first.
const inFlight = new Map();

/**
 * The entry point every route should use. Returns today's report for this
 * style — from storage if already generated, otherwise generates it once,
 * stores it, and returns it. Only ever calls the model when nothing is
 * stored yet for this (trading day, style).
 *
 * @param {object} [opts]
 * @param {boolean} [opts.force] - regenerate even if a report is already
 *   stored. For manual/admin use; never set this from a per-user request path,
 *   or the whole point of caching is defeated.
 */
export async function getOrGenerateMarketAnalysis({ model = MODEL_CHAIN, rules = RULES, style = DEFAULT_STYLE, force = false } = {}) {
  if (!force) {
    // Fast path, no network scan: the overwhelmingly common call is someone
    // re-reading a report that was already generated earlier today, and
    // scanMarket() below exists only to *learn* asOf — when the trading
    // calendar alone can guess it correctly (the normal case), there is
    // nothing left for the scan to tell us. A wrong guess (an EGX holiday
    // this calendar doesn't know about) just falls through to the real scan
    // below exactly as before — this can only skip work, never skip correctness.
    const guessed = await getMarketReport(expectedLastSession(), style);
    if (guessed) return guessed;
  }

  const { results } = await scanMarket();
  const asOf = results[0]?.asOf ?? new Date().toISOString().slice(0, 10);

  if (!force) {
    const cached = await getMarketReport(asOf, style);
    if (cached) return cached;
  }

  const key = `${asOf}:${style}`;
  if (inFlight.has(key)) return inFlight.get(key);

  const task = (async () => {
    let report, raw;
    if (style === RESEARCH_STYLE) {
      ({ report, raw } = await generateMarketAnalysis({ model, rules, style }));
    } else {
      // Not forcing the base research here even when `force` is set for this
      // style — regenerating a stale 'trader' framing shouldn't also force a
      // brand-new (paid, searched) 'medium' report unless that's what was
      // actually asked for.
      const base = await getOrGenerateMarketAnalysis({ model, rules, style: RESEARCH_STYLE });
      ({ report, raw } = await reframeMarketAnalysis({ model, rules, style, base }));
    }
    await putMarketReport(report.asOf, style, report, raw.model, raw.usage);
    // Re-read so every caller — including this one, if a concurrent request
    // won the insert first — sees exactly what ended up stored.
    return (await getMarketReport(report.asOf, style)) ?? { ...report, _meta: { model: raw.model, generatedAt: new Date().toISOString(), usage: raw.usage } };
  })();
  inFlight.set(key, task);
  try {
    return await task;
  } finally {
    inFlight.delete(key);
  }
}

/** "15-20%" -> 0.175, "0%" -> 0. Midpoint of whatever numbers are present. */
function midpointFraction(rangeText) {
  const nums = String(rangeText ?? '').match(/\d+(\.\d+)?/g)?.map(Number) ?? [];
  if (!nums.length) return 0;
  return (nums.reduce((a, b) => a + b, 0) / nums.length) / 100;
}

/**
 * Builds a PortfolioReviewSchema-shaped response entirely from a cached daily
 * report and a user's actual cash — no model call. This is what an
 * empty-book request gets instead of reviewPortfolio(): the same report
 * everyone reads that day, with only the cash percentages turned into this
 * user's real EGP amounts (pure arithmetic, never re-asked of the model).
 *
 * @param {object} report - from getOrGenerateMarketAnalysis
 * @param {object} ctx - { cash }
 * @param {string[]} watchlistCodes - the user's own watchlist, if any
 */
export function reviewFromMarketReport(report, ctx = {}, watchlistCodes = []) {
  const cash = ctx.cash ?? 0;
  const byCode = new Map((report.topOpportunities ?? []).map((op) => [op.code, op]));

  const verdicts = watchlistCodes.map((code) => {
    const op = byCode.get(code);
    if (!op) {
      // Not among the names researched today — say so plainly rather than
      // silently omitting it or, worse, guessing at a verdict with no research.
      return {
        code,
        action: 'wait',
        conviction: 'متوسطة',
        headline: 'مش مغطى في تقرير السوق النهاردة',
        reasoning: 'السهم ده مش من ضمن الأسهم اللي اتبحثت بعمق في تقرير السوق اليومي — راجعه يدويًا أو استنى تقرير الغد.',
        stockView: 'غير متاح — مش من ضمن أهم الفرص المبحوثة اليوم.',
        portfolioView: 'محفظتك فاضية من المراكز حاليًا، فمفيش تأثير على التركز.',
        positionSizing: { currentPct: 0, recommendedPct: '0%', rationale: 'السهم مش من ضمن فرص تقرير اليوم.' },
        betterAlternative: report.topOpportunities?.[0]?.code ?? null,
        conflictNoted: null,
        orderInstruction: null,
        invalidation: 'غير متاح.',
        timingNote: 'غير متاح.',
        riskFlags: [],
        externalContext: [],
        scenarios: null,
        reentryPlan: null,
        reviewDepth: 'unreviewed',
      };
    }
    return {
      code: op.code,
      action: op.action,
      conviction: op.conviction,
      headline: op.headline,
      reasoning: op.stockView,
      stockView: op.stockView,
      portfolioView: 'محفظتك فاضية من المراكز حاليًا — الفرصة دي من تقرير السوق العام، مش مخصصة لمحفظتك تحديدًا.',
      positionSizing: { currentPct: 0, recommendedPct: '0%', rationale: 'مفيش مركز مفتوح فيه دلوقتي.' },
      betterAlternative: null,
      conflictNoted: null,
      orderInstruction: op.entry ? `أمر محدد عند ${op.entry}` : null,
      invalidation: op.stop ? `إغلاق تحت ${op.stop} يلغي الفرصة.` : 'غير متاح.',
      timingNote: op.midTarget?.horizon?.ar ?? 'غير متاح.',
      riskFlags: op.risks ?? [],
      externalContext: op.externalContext ?? [],
      scenarios: null,
      reentryPlan: null,
      reviewDepth: 'market_report',
    };
  });

  const guide = report.cashDeploymentGuide;
  const allocationLines = (guide?.allocations ?? []).map((a) => {
    const amount = Math.round(cash * midpointFraction(a.pctOfInvestableCash));
    return `${a.code}: ~${amount.toLocaleString('en-US')} ج (${a.pctOfInvestableCash} من الكاش القابل للاستثمار) — ${a.reason}`;
  });
  const cashAdvice = [guide?.philosophy, allocationLines.join(' | '), guide?.note].filter(Boolean).join(' ') || 'مفيش توصية كاش متاحة النهاردة.';

  return {
    marketRead: report.marketOverview,
    verdicts,
    portfolioAssessment: 'مفيش مراكز مفتوحة حاليًا — القراءة دي مبنية على تقرير السوق العام مش على محفظة فعلية.',
    cashAdvice,
    topPriority: report.topPriority,
    portfolioRisks: report.risksToWatch ?? [],
  };
}
