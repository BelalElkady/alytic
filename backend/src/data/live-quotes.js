/**
 * The one real live-quote pool (see live-quote-pool.js), wired to oanor, the
 * TradingView scrape and the platform database's quota count. Configured
 * entirely from the environment:
 *
 * - OANOR_ENABLED=1       turns oanor on. Unset, everyone gets TradingView.
 * - OANOR_API_KEY         the key; oanor stays off without it.
 * - OANOR_USER_IDS        comma-separated user ids. While set, only these
 *                         accounts get oanor (the allowlist stage), whether
 *                         or not they're subscribed.
 * - OANOR_MONTHLY_QUOTA   the plan's calls per billing period. At 95% of it
 *                         subscribers roll back to TradingView until the reset.
 * - OANOR_BILLING_DAY     day of the month the quota resets (1-28, default 1).
 * - OANOR_COMPARE=1       also fetch TradingView for each oanor batch and keep
 *                         the price gap — the rollout's evidence, off after it.
 *
 * Nothing here logs or emails: the fallback is silent, and the platform admin
 * reads what happened in the admin panel's live-prices tab (liveQuoteStatus).
 */

import { getOanorUsage, putOanorUsage } from '../db.js';
import { OANOR_CLIENT_READY, fetchOanorQuotes } from './oanor.js';
import { createLiveQuotePool, liveQuotesConfigFromEnv } from './live-quote-pool.js';
import { egxSessionOpen } from './cache.js';
import { fetchLatestQuotes } from './tv-history.js';

const config = liveQuotesConfigFromEnv();

const pool = createLiveQuotePool({
  config,
  fetchOanor: (codes) => fetchOanorQuotes(codes, { apiKey: config.apiKey }),
  fetchTv: (codes) => fetchLatestQuotes(codes),
  sessionOpen: () => egxSessionOpen(),
  usageStore: { load: getOanorUsage, save: putOanorUsage },
});

/**
 * Live quotes for a request: pass the requester's `subscribed`
 * (req.access.subscriptionActive) and `userId`. See createLiveQuotePool.
 */
export const fetchLiveQuotes = (codes, options) => pool.fetchLiveQuotes(codes, options);

/** The admin tab's view: how oanor is configured, plus the pool's live status. */
export async function liveQuoteStatus() {
  return {
    config: {
      requested: config.requested,
      enabled: config.enabled,
      hasKey: Boolean(config.apiKey),
      clientReady: OANOR_CLIENT_READY,
      allowlist: config.userIds ? [...config.userIds] : null,
      monthlyQuota: config.monthlyQuota,
      billingDay: config.billingDay,
      compare: config.compare,
    },
    ...(await pool.status()),
  };
}
