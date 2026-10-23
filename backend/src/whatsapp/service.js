import {
  failStaleWhatsappMessages,
  getUserByPhone,
  getWhatsappSteps,
  insertWhatsappInbound,
  insertWhatsappMessage,
  lastAutoReplyAt,
  listWhatsappCandidates,
  markWhatsappFollowUpIfEmpty,
  markWhatsappInboundAutoReplied,
  setWhatsappMessageResult,
  setWhatsappOptOut,
  setWhatsappStatusByMetaId,
} from '../db.js';
import { normalizePhone } from '../phone.js';
import { defaultTenant } from '../tenancy/registry.js';
import { dueStepFor } from './eligibility.js';
import { buildRequest } from './render.js';
import { DEFAULT_STEPS, STEP_KEYS, SURVEY_ANSWERS, inSendWindow, isStopWord } from './steps.js';

const HOUR_MS = 60 * 60 * 1000;
const PRODUCTION_PROJECT = 'xssjwnevhbpcdmtbatiy';
/** Most items one /due call hands n8n; the rest wait for the next run. */
export const DUE_BATCH = 50;

export const REPLIES = {
  optOut: 'تمام، مش هنبعتلك رسايل تاني. تقدر ترجّعها من الإعدادات.',
  surveyThanks: 'شكراً، وصلنا ردك 🙏',
  supportPointer: (appUrl) => `أهلاً! لأي سؤال أو للاشتراك كلّمنا من الشات جوه الموقع: ${appUrl}`,
};

/**
 * Real users can only be messaged from production. Anywhere else (a laptop,
 * CI, a backend pointed at the backup copy) only the team's numbers in
 * WHATSAPP_ALLOWED_PHONES are claimed, and with no list nothing is.
 */
export function isLiveSending() {
  return process.env.NODE_ENV === 'production' && String(process.env.SUPABASE_URL ?? '').includes(PRODUCTION_PROJECT);
}

function allowedPhones() {
  return new Set(String(process.env.WHATSAPP_ALLOWED_PHONES ?? '').split(',').map((p) => normalizePhone(p)).filter(Boolean));
}

export const phoneAllowed = (phone) => isLiveSending() || allowedPhones().has(phone);

/** WHATSAPP_LAUNCH_AT as a Date; null (nothing sends) until it is set. */
export function launchAt() {
  const value = new Date(process.env.WHATSAPP_LAUNCH_AT ?? '');
  return Number.isNaN(value.getTime()) ? null : value;
}

/** Only the main site sends: white-label sites are out of scope. */
export const isSendingTenant = (tenant) => Boolean(tenant) && tenant.id === defaultTenant()?.id;

const appUrl = () => defaultTenant()?.appUrl ?? '';

/** The admin page's settings over the code defaults, per step. */
export async function mergedSteps() {
  const rows = new Map((await getWhatsappSteps()).map((row) => [row.key, row]));
  return Object.fromEntries(
    STEP_KEYS.map((key) => {
      const row = rows.get(key);
      const base = DEFAULT_STEPS[key];
      return [
        key,
        row
          ? { enabled: row.enabled, templateName: row.template_name, templateLang: row.template_lang, params: { ...base.params, ...row.params } }
          : base,
      ];
    }),
  );
}

/** Inserts the log row (the claim) and returns what n8n sends, or null when the step was already claimed. */
async function claim({ user, subscription, sent = [], step, cycleKey, steps, now }) {
  const existingOfferExpiresAt = sent.find((row) => row.step === 'trial_ending')?.offer_expires_at ?? null;
  const { request, renderedParams, offerExpiresAt } = buildRequest({
    step,
    config: steps[step],
    user,
    subscription,
    appUrl: appUrl(),
    now,
    existingOfferExpiresAt,
  });
  const row = await insertWhatsappMessage({ userId: user.id, step, cycleKey, phone: user.phone, renderedParams, offerExpiresAt });
  return row ? { messageId: row.id, request } : null;
}

/** Everything due at `now`, claimed so a second call can't hand it out again. */
export async function claimDue(now = new Date()) {
  await failStaleWhatsappMessages(new Date(now.getTime() - 2 * HOUR_MS).toISOString());
  if (!inSendWindow(now)) return [];
  if (!isLiveSending() && allowedPhones().size === 0) return [];
  const steps = await mergedSteps();
  const launch = launchAt();
  const items = [];
  for (const candidate of await listWhatsappCandidates()) {
    if (items.length >= DUE_BATCH) break;
    if (!phoneAllowed(candidate.phone)) continue;
    const due = dueStepFor({ user: candidate, subscription: candidate.subscription, sent: candidate.sent, steps, launchAt: launch, now });
    if (!due.step) continue;
    const item = await claim({ ...due, user: candidate, subscription: candidate.subscription, sent: candidate.sent, steps, now });
    if (item) items.push(item);
  }
  return items;
}

/** Claims one event step for a user (see pushStep). Null when it can't or already went out. */
export async function claimStep({ user, subscription, step, now = new Date() }) {
  if (!phoneAllowed(user.phone)) return null;
  const steps = await mergedSteps();
  if (!steps[step]?.enabled) return null;
  return claim({ user, subscription, step, cycleKey: '', steps, now });
}

export function recordResult({ messageId, status, metaMessageId, error }) {
  return setWhatsappMessageResult(messageId, { status, metaMessageId, error });
}

/** A Meta event relayed by n8n. Returns the reply n8n should send, if any. */
export async function handleMetaEvent(event, now = new Date()) {
  if (event.type === 'status') {
    const row = await setWhatsappStatusByMetaId(event.metaMessageId, event.status, event.error);
    if (row && (event.status === 'delivered' || event.status === 'read')) await markWhatsappFollowUpIfEmpty(row.user_id);
    return {};
  }

  const phone = normalizePhone(event.from);
  if (!phone) return {};
  const user = await getUserByPhone(phone);
  const inbound = await insertWhatsappInbound({ userId: user?.id, phone, text: event.text, metaMessageId: event.metaMessageId });
  if (!inbound) return {};
  const to = phone.replace(/^\+/, '');

  if (isStopWord(event.text)) {
    if (user) await setWhatsappOptOut(user.id, true);
    return { reply: { to, text: REPLIES.optOut } };
  }
  if (SURVEY_ANSWERS.includes(String(event.text).trim())) return { reply: { to, text: REPLIES.surveyThanks } };

  const last = await lastAutoReplyAt(phone);
  if (last && now.getTime() - new Date(last).getTime() < 24 * HOUR_MS) return {};
  await markWhatsappInboundAutoReplied(inbound.id);
  return { reply: { to, text: REPLIES.supportPointer(appUrl()) } };
}
