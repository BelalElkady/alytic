/**
 * Who an announcement is for, and where its call-to-action button may point.
 *
 * Audiences are renewal-status segments (see "Renewal status" in CONTEXT.md),
 * plus "trial_ending" — a Trial with two days or fewer left, the same cut-off
 * the admin users screen uses to flag a trial as about to end. A User can sit
 * in more than one segment (a trial about to end is also in the trial), and an
 * announcement with no audiences is shown to everyone.
 */

export const ANNOUNCEMENT_AUDIENCES = ['trial', 'trial_ending', 'active', 'expired', 'never'];

const DAY_MS = 24 * 60 * 60 * 1000;
const TRIAL_ENDING_DAYS = 2;

/** The segments a User currently belongs to, from their `accessInfo()` result. */
export function audienceSegmentsOf(access, now = Date.now()) {
  if (access.subscriptionActive) return ['active'];
  // A subscription row that isn't active is a lapsed paid plan, whatever the trial says.
  if (access.currentPeriodEnd) return ['expired'];
  if (!access.trialActive) return ['never'];
  const daysLeft = Math.ceil((Date.parse(access.trialEndsAt) - now) / DAY_MS);
  return daysLeft <= TRIAL_ENDING_DAYS ? ['trial', 'trial_ending'] : ['trial'];
}

/** True when an announcement with these audiences should be shown to a User in these segments. */
export function audienceMatches(audiences, segments) {
  if (!Array.isArray(audiences) || audiences.length === 0) return true;
  return audiences.some((audience) => segments.includes(audience));
}

/** Cleans an admin-supplied audience list: known segments only, no duplicates. Null when it isn't a list of them. */
export function normalizeAudiences(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  if (!value.every((entry) => ANNOUNCEMENT_AUDIENCES.includes(entry))) return null;
  return [...new Set(value)];
}

const CTA_URL_MAX = 500;

/**
 * A button link the popup may render: a page inside the app ("/subscribe") or
 * an https URL. Anything else — javascript:, protocol-relative "//host", plain
 * http — is rejected, since the value ends up in an href shown to every User.
 */
export function normalizeCtaUrl(value) {
  if (typeof value !== 'string') return null;
  const url = value.trim();
  if (!url || url.length > CTA_URL_MAX || /[\s\u0000-\u001f\\]/.test(url)) return null;
  if (url.startsWith('/')) return url.startsWith('//') ? null : url;
  try {
    return new URL(url).protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}
