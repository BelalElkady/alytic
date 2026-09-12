/**
 * The price list. Subscriptions are arranged over the support chat and
 * activated by hand from the admin panel, so nothing here charges anyone —
 * these are the figures the "اشترك" screen quotes and the admin panel
 * defaults to.
 *
 * Yearly saves 189 EGP against twelve monthly payments (149 × 12 = 1788),
 * i.e. 10.6%. Customer-facing copy says "توفير ١٨٩ جنيه" rather than a
 * percentage: the exact figure needs no rounding, and rounding 10.57 up to 11
 * would overstate the saving.
 */
export const PLANS = {
  monthly: { key: 'monthly', label: 'شهري', priceEgp: 149, months: 1 },
  yearly: { key: 'yearly', label: 'سنوي', priceEgp: 1599, months: 12 },
};

export const planFor = (key) => PLANS[String(key ?? '')] ?? null;

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
