import {
  failStaleWhatsappMessages,
  getSubscription,
  getUserById,
  getUserByPhone,
  getWhatsappSteps,
  insertWhatsappInbound,
  insertWhatsappMessage,
  lastAutoReplyAt,
  listSubscriptionGrants,
  listWhatsappCandidates,
  markWhatsappFollowUpIfEmpty,
  markWhatsappInboundAutoReplied,
  setWhatsappMessageResult,
  setWhatsappOptOut,
  setWhatsappStatusByMetaId,
  surveyAnswerCounts,
  upsertWhatsappStep,
  whatsappStepCounts,
} from '../db.js';
import { PLANS } from '../billing/plans.js';
import { trialInfo } from '../billing/trial.js';
import { normalizePhone } from '../phone.js';
import { currentTenant } from '../tenancy/context.js';
import { defaultTenant } from '../tenancy/registry.js';
import { dueStepFor, isEligible, launchGate } from './eligibility.js';
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
  // Staleness is real elapsed time since the claim (n8n never reported), so it
  // uses the wall clock even when `now` is moved for a test.
  await failStaleWhatsappMessages(new Date(Date.now() - 2 * HOUR_MS).toISOString());
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

/**
 * Pushes an event step (trial_welcome, paid_welcome) to n8n's webhook right
 * away. Callers fire and forget: it never throws into a user's request. A push
 * n8n refuses is marked failed and not retried — a missed welcome beats a
 * double one.
 */
export async function pushStep(userId, step) {
  const url = process.env.N8N_WHATSAPP_WEBHOOK_URL;
  if (!url || !isSendingTenant(currentTenant())) return;
  const user = await getUserById(userId);
  if (!user || isEligible(user) || launchGate(user, launchAt(), new Date())) return;
  const subscription = await getSubscription(userId);

  if (step === 'trial_welcome') {
    // Only while the trial runs: a user who adds a phone months later is not "new".
    if (subscription || !trialInfo(user).trialActive) return;
  } else if (step === 'paid_welcome') {
    const grants = await listSubscriptionGrants(userId, { limit: 5 });
    if (!subscription || grants.filter((g) => g.action === 'grant').length > 1) return;
  }

  const item = await claimStep({ user, subscription, step });
  if (!item) return;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.WHATSAPP_AUTOMATION_SECRET ?? ''}` },
      body: JSON.stringify(item),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`n8n answered ${res.status}`);
  } catch (err) {
    await recordResult({ messageId: item.messageId, status: 'failed', error: `push: ${err.message}` });
    throw err;
  }
}

/** Where each offer step put its discount in the template params (see render.js). */
const DISCOUNT_PARAM = { trial_ending: 2, trial_ended: 1, renewal: 3 };

/**
 * Per user, for the admin users list: the last step sent and its status, and
 * the offer still running (so the Admin accepts the lower amount at
 * Activation). `messages` is listWhatsappMessagesForUsers' output, newest first.
 */
export function whatsappSummaries(messages, now = new Date()) {
  const byUser = new Map();
  for (const row of messages) {
    let summary = byUser.get(row.user_id);
    if (!summary) {
      summary = { lastStep: row.step, lastStatus: row.status, offer: null };
      byUser.set(row.user_id, summary);
    }
    const expires = row.offer_expires_at ? new Date(row.offer_expires_at) : null;
    if (!summary.offer && expires && expires.getTime() > now.getTime() && row.status !== 'failed') {
      summary.offer = { discountPct: Number(row.rendered_params?.[DISCOUNT_PARAM[row.step]] ?? 0), expiresAt: expires.toISOString() };
    }
  }
  return byUser;
}

/** The admin page's data: each step's settings with its 30-day counts, and the survey answers. */
export async function stepsOverview(now = new Date()) {
  const [steps, counts, answers] = await Promise.all([
    mergedSteps(),
    whatsappStepCounts(new Date(now.getTime() - 30 * 24 * HOUR_MS).toISOString()),
    surveyAnswerCounts(SURVEY_ANSWERS),
  ]);
  return {
    steps: STEP_KEYS.map((key) => {
      const tally = { sent: 0, delivered: 0, read: 0, failed: 0 };
      for (const row of counts) if (row.step === key && row.status in tally) tally[row.status] = row.count;
      return { key, ...steps[key], counts: tally };
    }),
    surveyAnswers: answers,
    liveSending: isLiveSending(),
    // For the admin page's preview: the plan an offer is on, and its full price.
    plans: Object.fromEntries(Object.entries(PLANS).map(([key, plan]) => [key, { label: plan.label.split(' — ')[0], priceEgp: plan.priceEgp }])),
  };
}

/** Saves an Admin's change to one step; `input` is already validated by the route. */
export async function saveStep(key, { enabled, templateName, params }, updatedBy) {
  await upsertWhatsappStep({ key, enabled, templateName, params, updatedBy });
  return { key, ...(await mergedSteps())[key] };
}

export const setWhatsappEnabled = (userId, enabled) => setWhatsappOptOut(userId, !enabled);

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
