/**
 * The price list. Subscriptions are arranged over the support chat and
 * activated by hand from the admin panel, so nothing here charges anyone —
 * these are the figures the "اشترك" screen quotes and the admin panel
 * defaults to.
 *
 * Yearly is twelve months less 10% (149 × 12 × 0.9 = 1609.2), rounded up to a
 * whole pound.
 */
export const PLANS = {
  monthly: { key: 'monthly', label: 'شهري', priceEgp: 149, months: 1 },
  yearly: { key: 'yearly', label: 'سنوي', priceEgp: 1610, months: 12 },
};

export const planFor = (key) => PLANS[String(key ?? '')] ?? null;

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
