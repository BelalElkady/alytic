/**
 * The price list and the InstaPay account users transfer to. Subscriptions
 * are activated by hand from the admin panel after the money lands, so
 * nothing here charges anyone — these are the figures the "اشترك" screen
 * quotes and the admin panel defaults to.
 *
 * Yearly is twelve months less 10% (149 × 12 × 0.9 = 1609.2), rounded up to a
 * whole pound.
 */
export const PLANS = {
  monthly: { key: 'monthly', label: 'شهري', priceEgp: 149, months: 1 },
  yearly: { key: 'yearly', label: 'سنوي', priceEgp: 1610, months: 12 },
};

/**
 * Where users send the transfer. Kept in the environment rather than the repo
 * so a real payment handle never lands in git — without INSTAPAY_ADDRESS the
 * subscribe screen falls back to telling the user to contact support, which
 * is correct behaviour rather than a broken page.
 */
export const INSTAPAY = {
  address: process.env.INSTAPAY_ADDRESS ?? null,
  accountName: process.env.INSTAPAY_ACCOUNT_NAME ?? null,
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
