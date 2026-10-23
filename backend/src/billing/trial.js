import { cairoDateOf, isTradingDay } from '../data/cache.js';

// Every account is on a 5-trading-day free trial from the moment its email is
// confirmed — the window is derived from users.email_verified_at rather than
// stored, so there is nothing to reset. A user who takes a few days to click
// the link still gets the whole trial. The trial runs in 24-hour slices from
// that moment; a slice that starts on a Friday, Saturday or EGX bank holiday
// (isTradingDay) doesn't count and just pushes the end out by a day, so
// verifying before a weekend doesn't burn trial days on a closed market.
export const TRIAL_DAYS = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * When the trial clock started. Takes a session user or a raw users row. An
 * unconfirmed account's trial hasn't started, so it is shown as starting now
 * (a full, still-locked trial — see trialUsable in api/server.js). A
 * confirmed account with no timestamp predates the column and falls back to
 * created_at, which is also what the column's backfill wrote.
 */
export function trialStartOf(user, now = Date.now()) {
  const verifiedAt = user.emailVerifiedAt ?? user.email_verified_at;
  if (verifiedAt) return new Date(verifiedAt).getTime();
  if (user.emailVerified ?? user.email_verified) return new Date(user.createdAt ?? user.created_at).getTime();
  return now;
}

export function trialInfo(user, now = Date.now()) {
  let sliceStart = trialStartOf(user, now);
  let counted = 0;
  let daysLeft = 0;
  while (counted < TRIAL_DAYS) {
    if (isTradingDay(cairoDateOf(sliceStart))) {
      counted += 1;
      if (sliceStart + DAY_MS > now) daysLeft += 1;
    }
    sliceStart += DAY_MS;
  }
  return {
    trialDaysTotal: TRIAL_DAYS,
    trialDaysLeft: daysLeft,
    trialActive: sliceStart > now,
    trialEndsAt: new Date(sliceStart),
  };
}

/**
 * Which trading day of the trial `now` falls in: 0 for the first trading
 * slice, counting only slices trialInfo counts, and -1 before the first one
 * starts. Keeps counting past the trial's end; callers check trialActive.
 */
export function tradingDayIndex(user, now = Date.now()) {
  let sliceStart = trialStartOf(user, now);
  let started = 0;
  while (sliceStart <= now) {
    if (isTradingDay(cairoDateOf(sliceStart))) started += 1;
    sliceStart += DAY_MS;
  }
  return started - 1;
}
