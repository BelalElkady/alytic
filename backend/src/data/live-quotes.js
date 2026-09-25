/**
 * The one real live-quote pool (see live-quote-pool.js), wired to oanor,
 * the TradingView scrape, the platform database's quota count and the
 * platform admins' inbox. Configured entirely from the environment:
 *
 * - OANOR_ENABLED=1       turns oanor on. Unset, everyone gets TradingView.
 * - OANOR_API_KEY         the key; oanor stays off without it.
 * - OANOR_USER_IDS        comma-separated user ids. While set, only these
 *                         accounts get oanor (the allowlist stage), whether
 *                         or not they're subscribed.
 * - OANOR_MONTHLY_QUOTA   the plan's calls per billing period. At 95% of it
 *                         subscribers roll back to TradingView until the reset.
 * - OANOR_BILLING_DAY     day of the month the quota resets (1-28, default 1).
 * - OANOR_COMPARE=1       also fetch TradingView for each oanor batch and log
 *                         the price gap — the rollout's evidence, off after it.
 */

import { getOanorUsage, putOanorUsage } from '../db.js';
import { sendEmail } from '../email.js';
import { runWithTenant } from '../tenancy/context.js';
import { defaultTenant, platformAdminEmails } from '../tenancy/registry.js';
import { fetchOanorQuotes } from './oanor.js';
import { createLiveQuotePool, liveQuotesConfigFromEnv } from './live-quote-pool.js';
import { egxSessionOpen } from './cache.js';
import { fetchLatestQuotes } from './tv-history.js';

const config = liveQuotesConfigFromEnv();
if (config.requested && !config.enabled) {
  console.warn(
    `[oanor] OANOR_ENABLED=1 but ${!config.apiKey ? 'OANOR_API_KEY is empty' : 'the oanor client is not written yet (src/data/oanor.js)'}; everyone stays on TradingView`,
  );
} else if (config.enabled && !config.monthlyQuota) {
  console.warn('[oanor] OANOR_MONTHLY_QUOTA is unset; only oanor\'s own answer will stop calls when the quota runs out');
}

/** Emails the platform admins once when subscribers roll back to TradingView for the rest of a period. */
async function alertQuotaRollback({ reason, callsUsed, quota, resetsOn }) {
  const why = reason === 'count'
    ? `وصلنا ${callsUsed} من ${quota ?? '؟'} طلب (٩٥٪ من الحصة)`
    : `oanor رفض الطلبات لأن الحصة خلصت أو الاشتراك مش مفعّل (${callsUsed} طلب مستخدم)`;
  const html = `
    <p>أسعار oanor اللحظية اتوقفت للمشتركين: ${why}.</p>
    <p>كل المشتركين رجعوا لأسعار TradingView (متأخرة حوالي ١٥ دقيقة) لحد ما الحصة تتجدد يوم <strong>${resetsOn}</strong>.</p>
    <p>لو عايز ترجّعها قبل كده: رقّي باقة oanor وارفع <code>OANOR_MONTHLY_QUOTA</code> في <code>backend/.env</code> وأعد تشغيل السيرفر.</p>`;
  // Sent as the main site: this is the platform's bill, not any one tenant's.
  await runWithTenant(defaultTenant(), () =>
    Promise.all(platformAdminEmails().map((to) => sendEmail({ to, subject: 'oanor: الحصة الشهرية خلصت', html }))),
  );
}

const pool = createLiveQuotePool({
  config,
  fetchOanor: (codes) => fetchOanorQuotes(codes, { apiKey: config.apiKey }),
  fetchTv: (codes) => fetchLatestQuotes(codes),
  sessionOpen: () => egxSessionOpen(),
  usageStore: { load: getOanorUsage, save: putOanorUsage },
  onRollback: alertQuotaRollback,
});

/**
 * Live quotes for a request: pass the requester's `subscribed`
 * (req.access.subscriptionActive) and `userId`. See createLiveQuotePool.
 */
export const fetchLiveQuotes = (codes, options) => pool.fetchLiveQuotes(codes, options);

export const liveQuoteStats = () => pool.stats();
