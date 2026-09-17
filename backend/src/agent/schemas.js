/**
 * Zod schemas for the agents' structured outputs.
 *
 * These are contracts, not suggestions — `output_config.format` constrains the
 * model to them, so the UI can render results without defensive parsing. Every
 * schema below except StopPlanSchema/TrailingStopSchema deliberately excludes
 * numeric prices: no other schema lets the model return an indicator value, a
 * stop, or a target price it invented — the prices it may quote there are the
 * ones handed to it, its own fields are judgement, confidence and prose.
 *
 * StopPlanSchema and TrailingStopSchema are the one deliberate exception — by
 * product decision, the stop-loss itself is AI-determined rather than
 * mechanically computed (see backend/src/agent/stopPlanner.js). Both are kept
 * narrow (a number plus a short reason) and their output is still
 * sanity-clamped server-side before it can reach position sizing or the
 * mechanical exit trigger — see stopPlanner.js for the clamp.
 */

import { z } from 'zod';

export const ACTIONS = [
  'buy',          // new position
  'accumulate',   // add gradually on a pullback
  'hold',         // keep as-is, no change
  'reduce',       // partial trim
  'take_profit',  // sell at target
  'exit',         // full exit
  'avoid',        // do not enter at all
  'wait',         // interesting, but price isn't right yet
];

// Values stay Arabic — this is literal output data the UI renders directly,
// not prompt text, so it isn't part of translating the prompt layer.
export const CONVICTION = ['عالية', 'متوسطة', 'منخفضة'];

/** One stock's verdict. */
export const StockVerdictSchema = z.object({
  code: z.string().describe('EGX ticker code'),
  action: z.enum(ACTIONS).describe('The final decision'),
  conviction: z.enum(CONVICTION).describe('Confidence in the decision'),

  headline: z.string().describe('One short sentence in Egyptian Arabic summarizing the decision'),
  reasoning: z.string().describe(
    '2-4 sentences in Egyptian Arabic. Must name the strongest supporting signal and the strongest opposing signal from the numbers given to you.',
  ),

  // The two halves the decision must keep separate: is this a good stock, and
  // is it a good stock *for this book*. A high stockView with a negative
  // portfolioView is a normal, expected outcome — not a contradiction.
  stockView: z
    .string()
    .describe('In Egyptian Arabic — the stock judged on its own merits, regardless of the portfolio: quality, valuation, momentum. One or two sentences.'),

  portfolioView: z
    .string()
    .describe(
      'In Egyptian Arabic — what this trade means specifically for the current portfolio: current weight, sector concentration, ' +
        'diversification, and opportunity cost. One or two sentences.',
    ),

  positionSizing: z
    .object({
      currentPct: z
        .number()
        .nullable()
        .describe('Current weight of this stock as % of capital — copy it as-is from the brief; null if not present'),
      recommendedPct: z
        .string()
        .describe('Target weight as a range, e.g. "4-6%", or "0%" for exit. A range, not a single number — do not manufacture false precision.'),
      rationale: z.string().describe('In Egyptian Arabic — why this size specifically. One sentence.'),
    })
    .describe('Recommended position size after accounting for concentration and risk limits'),

  betterAlternative: z
    .string()
    .nullable()
    .describe(
      'In Egyptian Arabic — if another stock in the portfolio or watchlist deserves the same money more, name it and say why. ' +
        'Return null if none. Never invent a code not present in the brief.',
    ),

  conflictNoted: z
    .string()
    .nullable()
    .describe('In Egyptian Arabic — if the indicators genuinely disagree, explain the conflict here. Return null if they align.'),

  orderInstruction: z
    .string()
    .nullable()
    .describe(
      'The exact order if action is warranted: type (limit/market), price, and quantity if available. Return null if no action today.',
    ),

  invalidation: z
    .string()
    .describe('In Egyptian Arabic — what would make this decision wrong: the level or event that, if it happens, means exit.'),

  timingNote: z
    .string()
    .describe('In Egyptian Arabic — expected timing for the move, based on the time estimate given to you.'),

  riskFlags: z
    .array(z.string())
    .describe('In Egyptian Arabic — concrete risks: liquidity, volatility, sector concentration, proximity to resistance. Empty array if none.'),

  // The research trail behind the verdict. The prompt requires a check before
  // any money-moving recommendation, so an action verdict arriving with this
  // empty means the research step was skipped — which is itself worth seeing.
  // A clean check ("looked, found nothing material") belongs here too.
  externalContext: z
    .array(
      z.object({
        headline: z.string(),
        date: z.string().nullable().describe('Date of the news item if known, otherwise null'),
        source: z.string().describe('Source name or URL'),
        relevance: z.string().describe('In Egyptian Arabic — one short sentence: how this affected the decision'),
      }),
    )
    .describe(
      'The research you actually did before this decision: news, disclosures, company or sector events. ' +
        'Required for any verdict other than a plain hold — even a "checked, nothing material found" result belongs here, written as one.',
    ),
});

/** The whole portfolio review. */
export const PortfolioReviewSchema = z.object({
  marketRead: z.string().describe('In Egyptian Arabic — 2-3 sentences on today\'s Egyptian market regime, based on the stocks shown to you'),

  verdicts: z.array(StockVerdictSchema).describe('One decision per stock in the portfolio and watchlist'),

  // The engine computes the health *score* (see scoring/portfolio.js); this is
  // the analyst's reading of it — what the concentration numbers mean and what
  // would actually fix them.
  portfolioAssessment: z
    .string()
    .describe(
      'In Egyptian Arabic — your read of the portfolio\'s structure itself: concentration, diversification, and the biggest ' +
        'structural risk in it right now, and what would fix it. 2-3 sentences, grounded in the concentration numbers given to you.',
    ),

  cashAdvice: z.string().describe('In Egyptian Arabic — cash recommendation in 2-3 sentences: stay in cash or deploy, and into what'),

  topPriority: z.string().describe('In Egyptian Arabic — the single most important action for tomorrow, one sentence'),

  portfolioRisks: z.array(z.string()).describe('In Egyptian Arabic — portfolio-wide risks: concentration, correlation, volatility'),
});

/**
 * One deeply-researched market-wide opportunity. Narrative only — code, action,
 * conviction and the research trail come from the model; the price, stop,
 * target and risk/reward it refers to are merged in server-side from that
 * day's engine output after the model responds, the same separation the
 * portfolio review keeps. See marketAnalysis.js.
 */
export const MarketOpportunitySchema = z.object({
  code: z.string().describe('EGX ticker code'),
  action: z.enum(ACTIONS).describe('The call for this name'),
  conviction: z.enum(CONVICTION),

  headline: z.string().describe('One short sentence in Egyptian Arabic summarizing the opportunity'),

  stockView: z
    .string()
    .describe(
      'In Egyptian Arabic — the full case: quality, valuation, growth, momentum, technical picture. ' +
        '4-6 sentences — this is the deep, detailed writeup, not a one-liner.',
    ),

  catalysts: z
    .array(z.string())
    .describe('In Egyptian Arabic — specific reasons this matters now: a result, a disclosure, a technical setup, a sector move. Grounded in research, not generic.'),

  risks: z.array(z.string()).describe('In Egyptian Arabic — what would make this call wrong'),

  suitableFor: z
    .array(z.enum(['trader', 'medium', 'long']))
    .describe('Which investor horizons this specific setup actually fits — not all three by default. A fast breakout suits trader; a slow value re-rating suits long.'),

  externalContext: z
    .array(
      z.object({
        headline: z.string(),
        date: z.string().nullable(),
        source: z.string().describe('Source name or URL'),
        relevance: z.string().describe('In Egyptian Arabic — one short sentence: how this affected the call'),
      }),
    )
    .describe('The research behind this pick. Required and non-empty — an unresearched name has no place in a deep report.'),
});

/** Shared by MarketAnalysisSchema and MarketReframeSchema — see the latter for why they diverge. */
const CashDeploymentGuideSchema = z
  .object({
    philosophy: z
      .string()
      .describe(
        'In Egyptian Arabic — how someone starting from cash today, with no existing positions, should think about deploying it ' +
          'given the current market regime. 3-5 sentences: aggressive or cautious, concentrated or spread, why.',
      ),
    allocations: z
      .array(
        z.object({
          code: z.string().describe('Must be one of the codes in topOpportunities — never invent a code not listed there'),
          pctOfInvestableCash: z
            .string()
            .describe('Suggested share of investable cash as a range, e.g. "15-20%" — a range, never a single number'),
          reason: z.string().describe('In Egyptian Arabic — why this allocation, one sentence'),
        }),
      )
      .describe('A model deployment plan in percentages, so it applies to any cash amount without being recomputed per user'),
    reserveCashPct: z.number().describe('Suggested % to keep as an uninvested reserve, given today\'s regime'),
    note: z.string().describe('In Egyptian Arabic — anything a fresh-cash reader specifically needs to know today'),
  })
  .describe('The generic, portfolio-agnostic answer to "I have cash and nothing else — what do I do with it today?"');

/**
 * The daily, market-wide deep report — one per trading day, generated once
 * with real research (see marketAnalysis.js's RESEARCH_STYLE) and then
 * cheaply reframed per investor style — see MarketReframeSchema.
 *
 * Deliberately larger and slower than a portfolio review: nobody pays for it
 * per request, so it can afford to actually be thorough.
 */
export const MarketAnalysisSchema = z.object({
  marketOverview: z
    .string()
    .describe(
      'In Egyptian Arabic — the full regime read: overall trend and breadth across the names shown to you, liquidity conditions, ' +
        'EGP and macro drivers in play, and how EGX30/EGX70/EGX33 are behaving relative to each other. ' +
        '2-3 solid paragraphs — this is the deep overview, not a summary line.',
    ),

  sectorViews: z
    .array(
      z.object({
        sector: z.string().describe('Sector name, in Arabic, exactly as given to you'),
        regime: z.string().describe('In Egyptian Arabic — one short phrase: the sector\'s current state (e.g. leading, lagging, rotating in, under pressure)'),
        summary: z
          .string()
          .describe('In Egyptian Arabic — why the sector is where it is, and what would change that. 2-4 sentences.'),
        risks: z.array(z.string()).describe('In Egyptian Arabic — sector-specific risks'),
      }),
    )
    .describe('One entry per sector actually represented in the scanned names — do not invent sectors with nothing behind them.'),

  topOpportunities: z
    .array(MarketOpportunitySchema)
    .describe(
      'The best setups across the whole scanned market today, ranked by conviction, each with a full deep writeup and its own research. ' +
        'Quality over quantity — a shorter list where every entry is genuinely researched beats a long one padded with weak names.',
    ),

  cashDeploymentGuide: CashDeploymentGuideSchema,

  risksToWatch: z.array(z.string()).describe('In Egyptian Arabic — market-wide risks that apply regardless of which stock a reader picks'),

  topPriority: z.string().describe('In Egyptian Arabic — the single most important thing for a reader to know or do today, one sentence'),
});

/**
 * The cheap, no-research follow-up that turns one day's already-researched
 * base report (see MarketAnalysisSchema, generated once per day with real web
 * search) into a horizon-specific version for 'trader' or 'long' — see
 * reframeMarketAnalysis() in marketAnalysis.js. Only the framing changes;
 * topOpportunities, sectorViews and risksToWatch are carried over unchanged
 * from the base report rather than re-asked of the model, since the
 * underlying research does not depend on investor horizon (see suitableFor
 * on MarketOpportunitySchema) — only which of them get surfaced and how the
 * cash guide is written does.
 */
export const MarketReframeSchema = z.object({
  marketOverview: z
    .string()
    .describe(
      'In Egyptian Arabic — the same researched facts as the base report, re-angled for this horizon. ' +
        'Not a repeat of the original wording. 2-3 sentences.',
    ),
  cashDeploymentGuide: CashDeploymentGuideSchema,
  topPriority: z.string().describe('In Egyptian Arabic — the single most important thing for this horizon\'s reader today, one sentence'),
});

export const CASH_STANCES = [
  'deploy_now',       // the setups are ready — place the plan's orders now
  'deploy_gradually', // deploy in tranches over the coming sessions
  'hold_cash',        // nothing here is worth the money today
];

export const CASH_PICK_ACTIONS = [
  'buy_now',          // place the engine's limit order as given
  'buy_on_pullback',  // worth owning, but wait for a better price before filling
  'wait',             // not yet — a condition has to be met first
  'skip',             // leave this one out of the deployment
];

/**
 * The AI's review of one user's engine-built cash plan (/api/scan?focus=cash).
 * Judgement only: which stocks, share counts, entries, stops and amounts are
 * all the engine's and are rendered from the scan payload, never from here.
 * See cashAnalysis.js.
 */
export const CashPlanReviewSchema = z.object({
  stance: z.enum(CASH_STANCES).describe('The overall call on deploying this cash today'),
  headline: z.string().describe('One short sentence in Egyptian Arabic: the overall call on this cash today'),

  marketRead: z
    .string()
    .describe('In Egyptian Arabic — 2-3 sentences on whether today\'s market regime favors deploying cash, based on the context given to you'),

  portfolioRead: z
    .string()
    .describe(
      'In Egyptian Arabic — 2-3 sentences on the investor\'s current portfolio as it bears on this cash: concentration, ' +
        'sector exposure, and any existing holding that needs attention before new money goes in. Grounded in the portfolio numbers given to you.',
    ),

  behaviorRead: z
    .string()
    .describe(
      'In Egyptian Arabic — 2-3 sentences on what this investor\'s own trading record shows (holding periods, win rate, averaging down, ' +
        'ticket size, usual cash level) and how that shaped this advice. If there is no trade history, say so in one sentence.',
    ),

  deploymentPlan: z
    .string()
    .describe(
      'In Egyptian Arabic — how to actually carry the plan out: which orders first, in how many tranches and over what period, ' +
        'and what to wait for before each later tranche. 2-4 sentences, quoting only amounts and prices given to you.',
    ),

  picks: z
    .array(
      z.object({
        code: z.string().describe('EGX ticker — exactly one of the codes in the engine plan, never any other'),
        action: z.enum(CASH_PICK_ACTIONS),
        conviction: z.enum(CONVICTION),
        comment: z
          .string()
          .describe('In Egyptian Arabic — 1-2 sentences: why this action, naming the strongest supporting and opposing signal from the brief'),
        portfolioFit: z
          .string()
          .describe('In Egyptian Arabic — one short sentence: how this pick fits this investor\'s current holdings and their own trading habits'),
        watchFor: z
          .string()
          .describe('In Egyptian Arabic — one short sentence: the level or event that would change this call'),
      }),
    )
    .describe('One entry per stock in the engine plan, in the same order — no more, no fewer'),

  reserveAdvice: z
    .string()
    .describe('In Egyptian Arabic — one or two sentences on the reserve and any cash the plan leaves unallocated: keep it, or what would justify using it'),

  risks: z.array(z.string()).describe('In Egyptian Arabic — at most 4 concrete risks to this deployment: concentration, liquidity, market regime'),

  topPriority: z.string().describe('In Egyptian Arabic — the single most important thing to do with this cash next session, one sentence'),
});

/**
 * Where to place the initial stop for a fresh entry — AI-determined, shared
 * across every user for the same (stock, style, trading day). See
 * getOrGenerateStopPlan in stopPlanner.js.
 */
export const StopPlanSchema = z.object({
  stop: z.number().describe('The stop-loss price in EGP — must be below the given entry/current price and above 0'),
  basis: z.string().describe('In Egyptian Arabic — one short sentence: why this level specifically (structure, volatility, or a blend)'),
});

/**
 * The trailing stop for one user's already-open position — AI-determined,
 * cached per (user, stock, style, trading day, position state). See
 * getOrGenerateTrailingStop in stopPlanner.js.
 */
export const TrailingStopSchema = z.object({
  stop: z.number().describe('The stop-loss price in EGP for this open position'),
  rationale: z.string().describe('In Egyptian Arabic — one short sentence: why this level given the position\'s profit and the stock\'s current structure'),
  moved: z.boolean().describe('true if you are raising the stop above where it last sat, false if you are keeping it where it was'),
});

/** Fundamentals gathered from the web for one company. */
export const FundamentalsSchema = z.object({
  code: z.string(),
  asOf: z.string().describe('Date of the latest available data, YYYY-MM-DD or a description like "Q2 2026"'),

  peRatio: z.number().nullable().describe('P/E ratio, null if unavailable'),
  epsEgp: z.number().nullable().describe('Earnings per share in EGP'),
  bookValueEgp: z.number().nullable(),
  priceToBook: z.number().nullable().describe('P/B ratio'),
  dividendYieldPct: z.number().nullable(),
  marketCapEgp: z.number().nullable(),
  revenueGrowthPct: z.number().nullable().describe('Year-over-year revenue growth %'),
  profitGrowthPct: z.number().nullable().describe('Year-over-year net profit growth %'),
  debtToEquity: z.number().nullable(),
  returnOnEquityPct: z.number().nullable().describe('ROE %'),
  returnOnAssetsPct: z.number().nullable().describe('ROA %'),
  currentRatio: z.number().nullable().describe('Current assets / current liabilities'),
  evToEbitda: z.number().nullable().describe('Enterprise value / EBITDA'),
  netDebtToEbitda: z.number().nullable(),
  freeCashFlowYieldPct: z.number().nullable().describe('Free cash flow / market cap, %'),
  dividendHistory: z
    .array(
      z.object({
        exDate: z.string().nullable().describe('Ex-dividend date, YYYY-MM-DD, null if unknown'),
        paymentDate: z.string().nullable().describe('YYYY-MM-DD, null if unknown'),
        amountEgp: z.number().nullable().describe('Cash amount per share in EGP, null for a stock/bonus dividend'),
        type: z.enum(['نقدي', 'أسهم منحة']),
      }),
    )
    .describe('Most recent distributions first. Empty array for a stock with no dividend history.'),

  businessSummary: z.string().describe('In Egyptian Arabic — two sentences on what the company does and where its profit comes from'),
  fundamentalStrength: z.enum(['قوية', 'متوسطة', 'ضعيفة']),
  keyPositives: z.array(z.string()),
  keyRisks: z.array(z.string()),
  recentNews: z.array(
    z.object({
      date: z.string(),
      headline: z.string(),
      impact: z.enum(['إيجابي', 'سلبي', 'محايد']),
    }),
  ),

  sources: z.array(z.string()).describe('URLs this data came from'),
  confidence: z
    .enum(['عالية', 'متوسطة', 'منخفضة'])
    .describe('Your confidence in this data. Say منخفضة if you found no reliable sources.'),
});
