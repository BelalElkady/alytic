import { trialInfo, tradingDayIndex } from '../billing/trial.js';
import { cairoDateOf } from '../data/cache.js';
import { GRACE_DAYS, TRIAL_STEPS } from './steps.js';

const DAY_MS = 24 * 60 * 60 * 1000;

const pick = (user, camel, snake) => user[camel] ?? user[snake];

/**
 * Why this user can't get any WhatsApp step, or null when they can. Only
 * confirmed users with a phone ever qualify. Takes a users row or a session
 * user.
 */
export function isEligible(user) {
  if (!user.phone) return 'no_phone';
  if (!pick(user, 'emailVerifiedAt', 'email_verified_at') && !pick(user, 'emailVerified', 'email_verified')) return 'unconfirmed';
  if (pick(user, 'whatsappOptOutAt', 'whatsapp_opt_out_at')) return 'opted_out';
  if (pick(user, 'isSuspended', 'is_suspended')) return 'suspended';
  if (pick(user, 'isAdmin', 'is_admin') || pick(user, 'isMarketer', 'is_marketer') || user.id === 'local') return 'staff';
  return null;
}

/** The trial step due right now (the latest one whose time has come), or a reason there is none. */
function trialStepDue(user, now) {
  const trial = trialInfo(user, now.getTime());
  if (trial.trialActive) {
    if (trial.trialDaysLeft <= 1) return 'trial_ending';
    const day = tradingDayIndex(user, now.getTime());
    if (day >= 2) return 'trial_stoploss';
    if (day === 0) return 'trial_welcome';
    return null;
  }
  const sinceEnd = now.getTime() - trial.trialEndsAt.getTime();
  if (sinceEnd < 2 * DAY_MS) return 'trial_ended';
  if (sinceEnd >= 3 * DAY_MS) return 'survey';
  return null;
}

/**
 * Which WhatsApp step this user should get at `now`, or `{ skip: reason }`.
 * `sent` is the user's [{ step, cycle_key }], `steps` the merged step config,
 * `launchAt` the WHATSAPP_LAUNCH_AT moment (null: nothing has launched).
 * paid_welcome is never returned — it is pushed on Activation.
 */
export function dueStepFor({ user, subscription, sent, steps, launchAt, now }) {
  if (!launchAt) return { skip: 'not_launched' };
  const ineligible = isEligible(user);
  if (ineligible) return { skip: ineligible };

  const createdAt = new Date(pick(user, 'createdAt', 'created_at')).getTime();
  if (createdAt < launchAt.getTime() && now.getTime() < launchAt.getTime() + GRACE_DAYS * DAY_MS) return { skip: 'grace' };

  let step;
  let cycleKey = '';
  if (subscription) {
    const periodEnd = new Date(subscription.current_period_end).getTime();
    if (periodEnd > now.getTime()) return { skip: 'active' };
    if (now.getTime() - periodEnd < DAY_MS) return { skip: 'none_due' };
    step = 'renewal';
    cycleKey = cairoDateOf(periodEnd);
  } else {
    step = trialStepDue(user, now);
    if (!step) return { skip: 'none_due' };
    const order = TRIAL_STEPS.indexOf(step);
    if (order >= 0 && sent.some((row) => TRIAL_STEPS.indexOf(row.step) > order)) return { skip: 'later_step_sent' };
  }

  if (!steps[step]?.enabled) return { skip: 'disabled' };
  if (sent.some((row) => row.step === step && (row.cycle_key ?? '') === cycleKey)) return { skip: 'already_sent' };
  return { step, cycleKey };
}
