/**
 * Configuration for the investment/speculation classification engine (see
 * scoring/classification.js). Every threshold, weight and normalization
 * anchor the engine uses lives here — nothing is hardcoded in the scoring
 * code itself — so retuning the system is a one-file change. See
 * CLASSIFICATION.md at the repo root for the full methodology writeup.
 */

/** Classification decision boundaries — see classify() in scoring/classification.js. */
export const CLASSIFICATION_THRESHOLDS = {
  INVESTMENT_MIN_SCORE: 65,
  INVESTMENT_MAX_SPECULATION: 55,
  SPECULATIVE_MIN_SCORE: 65,
  SPECULATIVE_MAX_INVESTMENT: 50,
  HYBRID_INVESTMENT_THRESHOLD: 60,
  HYBRID_SPECULATION_THRESHOLD: 60,
};

export const CLASSIFICATION_TYPES = ['INVESTMENT', 'SPECULATIVE', 'HYBRID', 'NEUTRAL'];

/**
 * Investment-score bucket weights (must sum to 100). Adapted from the
 * textbook fundamentals/growth/ROE/valuation/debt/dividend/trend/volatility
 * split to what EGX data actually supports: this app's only mechanical
 * fundamentals source (TradingView's screener, see data/tradingview.js) has
 * no revenue/earnings *growth* series and no ROIC, so "earnings growth" and
 * "ROE/ROIC" are folded into `profitability` instead of scored separately —
 * see CLASSIFICATION.md "Data sources" for the full reasoning.
 */
export const INVESTMENT_WEIGHTS = {
  valuation: 20,        // P/E, P/B
  profitability: 25,    // ROE, net margin
  financialHealth: 20,  // debt/equity, current ratio
  dividendQuality: 10,  // yield (no consistency history available — see docs)
  priceTrend: 15,       // durable trend: 200dma position, 1y return, trend quality
  stability: 10,        // inverse of long-run volatility
};

/** Speculation-score bucket weights (must sum to 100). */
export const SPECULATION_WEIGHTS = {
  liquidity: 20,
  volumeSurge: 15,
  volatility: 20,
  momentum: 25,
  priceAction: 10,
  newsCatalyst: 10, // always redistributed today — see CLASSIFICATION.md "Limitations"
};

/**
 * Calibration anchors for absolute-threshold (min/max) normalization. A true
 * cross-sectional percentile (see scoring/normalize.js percentileRank) needs
 * the whole EGX universe's values in hand at once — cheap for fundamentals
 * (data/tradingview.js's screener pull already returns all ~600 listings in
 * one call, so fundamentals ARE percentile-ranked, see enrichWithPercentiles
 * there) but not for technicals, where a true percentile would mean running
 * the full technical snapshot for every EGX stock on every single-ticker
 * request. These anchors are the documented fallback for that case, and are
 * deliberately not arbitrary: each is derived from, or consistent with, a
 * number this codebase already trades decisions on (config/rules.js,
 * scoring/technical.js) rather than invented fresh for this feature.
 */
export const NORMALIZATION_ANCHORS = {
  // rules.liquidity.minAvgTurnoverEgp (2,000,000) is the floor this app
  // already requires to hold a position at all; 10% of it is "essentially
  // untradeable" and 25x it is blue-chip liquidity.
  turnoverEgp: { min: 200_000, max: 50_000_000 },
  relativeVolume: { min: 0.3, max: 3.5 },
  // scoring/technical.js flags atrPct > 4 as "high volatility, cut position
  // size" — used here as the midpoint of the speculative range rather than
  // its ceiling.
  atrPct: { min: 0.5, max: 8 },
  annualizedVolPct: { min: 15, max: 90 },
  absReturn: { w1: 15, m1: 30 },
  priceVsSma200Pct: { min: -25, max: 60 },
  longReturnPct: { min: -30, max: 80 },
  trendScore: { min: -60, max: 80 },
  currentRatio: { low: 0.5, target: 1.8, high: 5 },
  returnOnEquityPct: { min: -5, max: 35 },
  netMarginPct: { min: -10, max: 30 },
  dividendYieldPct: { min: 0, max: 12 },
  // Fallbacks used only when the universe-wide percentile (see
  // enrichWithPercentiles in data/tradingview.js) could not be computed —
  // e.g. the screener call failed for this batch.
  peRatio: { min: 3, max: 40 },
  priceToBook: { min: 0.3, max: 5 },
  debtToEquity: { min: 0, max: 3 },
};

/** Weights combined (via weightedAverage) into the 0-100 classification confidence. */
export const CONFIDENCE_WEIGHTS = {
  dataCompleteness: 35, // share of metrics that were actually available
  dataFreshness: 20,    // fundamentals present and dated, price data current
  boundaryDistance: 30, // how far the scores sit from the nearest decision threshold
  qualitySeverity: 15,  // the price-series data-quality gate's own verdict
};

/**
 * A fundamentals field is only "stale" (as opposed to merely fetched today)
 * once it is older than this — see dataQuality() in scoring/classification.js.
 * TradingView's screener stamps `asOf` with the fetch date rather than the
 * underlying filing's period, so with today's single data source this rarely
 * fires; the check exists so a future source with real filing dates is
 * handled correctly without changing this module.
 */
export const FUNDAMENTALS_STALE_DAYS = 10;
