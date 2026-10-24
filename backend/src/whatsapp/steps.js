import { z } from 'zod';

import { PLANS } from '../billing/plans.js';

/**
 * The WhatsApp lifecycle steps (docs/superpowers/specs/2026-10-23-whatsapp-lifecycle-design.md).
 * Each one is a Meta-approved template; the admin page can switch it on/off,
 * point it at another template name and change its offer values. A step with
 * no whatsapp_steps row uses these defaults — switched off, so nothing is sent
 * until an Admin turns it on.
 */
export const STEP_KEYS = ['trial_welcome', 'trial_stoploss', 'trial_ending', 'trial_ended', 'paid_welcome', 'survey', 'renewal'];

/** The trial steps in the order they fall due; a user only ever gets the latest one due. */
export const TRIAL_STEPS = ['trial_welcome', 'trial_stoploss', 'trial_ending', 'trial_ended'];

/** Steps pushed the moment something happens rather than found by the schedule. */
export const EVENT_STEPS = ['trial_welcome', 'paid_welcome'];

const OFFER_DEFAULTS = { discountPct: 20, validDays: 3, plan: 'long_yearly' };

export const DEFAULT_STEPS = Object.fromEntries(
  STEP_KEYS.map((key) => [
    key,
    {
      enabled: false,
      templateName: key,
      templateLang: 'ar',
      params:
        key === 'trial_ending' || key === 'trial_ended'
          ? { ...OFFER_DEFAULTS }
          : key === 'renewal'
            ? { ...OFFER_DEFAULTS, validDays: 7, whatsNew: '' }
            : {},
    },
  ]),
);

const offerSchema = z.object({
  discountPct: z.number().int().min(0).max(90),
  validDays: z.number().int().min(1).max(30),
  plan: z.enum(Object.keys(PLANS)),
});

const PARAM_SCHEMAS = {
  trial_ending: offerSchema,
  trial_ended: offerSchema,
  renewal: offerSchema.extend({
    whatsNew: z.string().max(200).refine((text) => !/[\r\n]/.test(text)),
  }),
};

/** The zod schema for one step's offer values; steps without an offer take none. */
export const stepParamsSchema = (key) => PARAM_SCHEMAS[key] ?? z.object({});

/** Template names as WhatsApp Manager allows them. */
export const TEMPLATE_NAME = /^[a-z0-9_]{1,512}$/;

/**
 * What the admin page saves for one step. An enabled renewal must say what's
 * new: Meta rejects an empty template parameter, which would fail the offer
 * for every lapsed user due in that run.
 */
export const stepInputSchema = (key) =>
  z
    .object({ enabled: z.boolean(), templateName: z.string().regex(TEMPLATE_NAME), params: stepParamsSchema(key) })
    .refine((input) => key !== 'renewal' || !input.enabled || input.params.whatsNew.trim().length > 0);

/** The quick-reply buttons on the survey template — an incoming message with one of these texts is an answer. */
export const SURVEY_ANSWERS = ['السعر', 'مش محتاجه دلوقتي', 'فيه حاجة ناقصة'];

export const STOP_WORDS = ['إيقاف', 'ايقاف', 'stop', 'الغاء', 'إلغاء'];

export const isStopWord = (text) => STOP_WORDS.includes(String(text ?? '').trim().toLowerCase());

/** Scheduled steps go out between 10:00 and 21:00 Cairo time; event steps go out at once. */
export const SEND_WINDOW = { startHour: 10, endHour: 21 };

/** Days an existing user has, after the announcement, to switch messages off before the first one. */
export const GRACE_DAYS = 3;

const cairoHour = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', hourCycle: 'h23' });

export function inSendWindow(now = new Date()) {
  const hour = Number(cairoHour.format(now));
  return hour >= SEND_WINDOW.startHour && hour < SEND_WINDOW.endHour;
}
