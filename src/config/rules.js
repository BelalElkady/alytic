/**
 * Trading rules. These encode the discipline the recommendations are held to —
 * changing a number here changes every stop, target and sizing decision the
 * engine makes, so this file is the single place to tune the strategy.
 *
 * Defaults mirror the "متوسط" (medium-horizon) style: hold for weeks to months,
 * trail the stop, scale out into strength, never average down a laggard.
 */

export const RULES = {
  horizon: {
    // Sessions used when phrasing "when" in recommendations. EGX trades Sun-Thu.
    sessionsPerWeek: 5,
    sessionsPerMonth: 21,
    midTermMonths: [1, 4],   // الهدف المتوسط
    longTermMonths: [6, 18], // الهدف البعيد
  },

  stop: {
    atrMultiple: 2.5,        // volatility stop distance
    minAtrMultiple: 1.5,     // never tighter than this, or noise takes you out
    structureBufferPct: 1.0, // sit this far under the support being defended
    maxStopPct: 12,          // hard cap on risk per position
    minStopPct: 3,           // a stop closer than this is not a stop
    honorOn: 'close',        // stops trigger on a session close, not an intraday wick
  },

  trailing: {
    enabled: true,
    activateAtProfitPct: 12, // start trailing once the position is up this much
    trailPct: 8,             // distance held below the running high
    ratchetOnly: true,       // a trailing stop never moves down
  },

  takeProfit: {
    partialAtProfitPct: 15,  // scale out here
    partialFraction: 0.30,
    limitAbovePricePct: 2,   // place the scale-out as a limit above market
    atTargetFraction: 1 / 3, // sell this much when the mid target prints
    raiseStopAfterTargetPct: 8,
  },

  entry: {
    // Never chase: buy on a pullback into support, as a limit order.
    preferLimitOrders: true,
    maxChasePctAboveSupport: 3,  // within this of support, buying now is fine
    maxPullbackWaitPct: 9,       // beyond this, the limit would never fill — say "wait"
    minRiskReward: 1.8,          // reject setups whose mid target doesn't pay 1.8R
  },

  sizing: {
    riskPerTradePct: 1.5,    // percent of total capital risked per position
    maxPositionPct: 15,      // no single name above this share of the book
    maxSectorPct: 30,        // nor any one sector
    minCashBufferPct: 5,
  },

  liquidity: {
    // A position you cannot exit in a few sessions is not a position.
    minAvgTurnoverEgp: 2_000_000,
    maxPositionVsDailyTurnover: 0.10,
  },

  averagingDown: {
    // Only ever add to a leader with real fundamentals, never to rescue a laggard.
    allowed: true,
    onlyIfTrendScoreAbove: 20,
    onlyIfAboveSma200: true,
    maxAddsPerPosition: 1,
  },

  commissionPct: 0.20,

  webSearch: {
    // Server-side searches the portfolio review may make in one call, total —
    // not per stock. The model is instructed to spend these on names that
    // actually warrant it (an alert fired, an unexplained move), not to
    // exhaustively search every holding. ~$0.03-0.05/search at current rates,
    // so 6 caps a single review's search spend near $0.20-0.30 worst case.
    maxUsesPerReview: 6,
  },
};

export default RULES;
