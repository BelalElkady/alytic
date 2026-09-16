/**
 * The per-feature caps for each tier. 'free' is the 4-trading-day trial
 * (see TRIAL_DAYS/trialInfo in src/api/server.js) — it needs no purchase, so
 * it has no matching PLANS entry below. 'long' and 'trader' are the two paid
 * tiers, each sold at a monthly and a yearly price (see PLANS). Every count
 * resets on the 1st of the calendar month (Cairo time) — see usageFor() in
 * src/api/server.js — except the free tier, which never resets since the
 * trial itself is a one-time window.
 */
export const TIERS = {
  free: { key: 'free', label: 'الباقة المجانية', screenshots: 2, recommendations: 4, cashScans: 1, marketAnalysis: 1 },
  long: { key: 'long', label: 'باقة النفس الطويل', screenshots: 7, recommendations: 480, cashScans: 7, marketAnalysis: 7 },
  trader: { key: 'trader', label: 'باقة الحريفة', screenshots: 12, recommendations: 960, cashScans: 15, marketAnalysis: 15 },
};

/**
 * The price list. Subscriptions are arranged over the support chat and
 * activated by hand from the admin panel, so nothing here charges anyone —
 * these are the figures the "اشترك" screen quotes and the admin panel
 * defaults to. Four purchasable SKUs: each paid tier (see TIERS) at a
 * monthly or yearly length.
 *
 * Yearly saves against twelve monthly payments in both tiers (299 × 12 =
 * 3588 vs 2990; 499 × 12 = 5988 vs 4990) — customer-facing copy can quote
 * the exact EGP figure rather than a rounded percentage.
 */
export const PLANS = {
  long_monthly: { key: 'long_monthly', tier: 'long', label: 'النفس الطويل — شهري', priceEgp: 299, months: 1 },
  long_yearly: { key: 'long_yearly', tier: 'long', label: 'النفس الطويل — سنوي', priceEgp: 2990, months: 12 },
  trader_monthly: { key: 'trader_monthly', tier: 'trader', label: 'الحريفة — شهري', priceEgp: 499, months: 1 },
  trader_yearly: { key: 'trader_yearly', tier: 'trader', label: 'الحريفة — سنوي', priceEgp: 4990, months: 12 },
};

export const planFor = (key) => PLANS[String(key ?? '')] ?? null;

/**
 * One-time top-ups on top of a tier's monthly screenshot allowance — for an
 * account that keeps running out before the month resets. Arranged and paid
 * the same manual way as a subscription (support chat + InstaPay), then an
 * admin adds the matching number of screenshot credits from the admin panel
 * (see CREDIT_KINDS/creditsOf in src/api/server.js) — there is nothing here
 * that grants anything by itself.
 */
export const SCREENSHOT_ADDONS = [
  { key: 'screenshots_8', screenshots: 8, priceEgp: 20 },
  { key: 'screenshots_14', screenshots: 14, priceEgp: 40 },
  { key: 'screenshots_22', screenshots: 22, priceEgp: 60 },
];

/**
 * Where users send the transfer. Handed out by the support bot to a
 * signed-in user and nowhere else — never from the public /api/billing/plans
 * — so the account isn't published to anyone who can curl the site, and every
 * disclosure belongs to an account we can match a transfer against. Kept in
 * the environment rather than the repo so it never lands in git; without
 * INSTAPAY_ADDRESS the bot says an admin will send the details instead.
 */
export const INSTAPAY = {
  address: process.env.INSTAPAY_ADDRESS ?? null,
  accountName: process.env.INSTAPAY_ACCOUNT_NAME ?? null,
};

/**
 * Calendar-month arithmetic that never rolls over: adding a month to Jan 31
 * lands on Feb 28/29, not Mar 3, so a subscription bought on the 31st keeps
 * renewing near month-end instead of drifting a day forward every period.
 */
export function addMonths(date, months) {
  const result = new Date(date.getTime());
  const targetDay = result.getUTCDate();
  result.setUTCMonth(result.getUTCMonth() + months);
  if (result.getUTCDate() < targetDay) result.setUTCDate(0);
  return result;
}
