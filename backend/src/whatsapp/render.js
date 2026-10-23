import { PLANS, TIERS } from '../billing/plans.js';
import { TRIAL_DAYS } from '../billing/trial.js';

const DAY_MS = 24 * 60 * 60 * 1000;

const arDate = new Intl.DateTimeFormat('ar-EG', { day: 'numeric', month: 'long', timeZone: 'Africa/Cairo' });

const firstName = (name) => String(name ?? '').trim().split(/\s+/)[0] || 'صديقنا';

/** "النفس الطويل — سنوي" → "النفس الطويل": the template already says which period. */
const planName = (planKey) => String(PLANS[planKey]?.label ?? '').split(' — ')[0];

/** Meta rejects template params with newlines or long runs of spaces. */
const clean = (value) => String(value).replace(/\s+/g, ' ').trim();

/**
 * The Graph API body for one step, plus what goes in the log row. The
 * placeholder order per step is the template drafts' order in the spec —
 * change one only together with the template in WhatsApp Manager.
 */
export function buildRequest({ step, config, user, subscription, appUrl, now, existingOfferExpiresAt = null }) {
  const name = firstName(user.name);
  const { discountPct, validDays, plan, whatsNew } = config.params ?? {};
  const price = plan ? Math.round(PLANS[plan].priceEgp * (1 - discountPct / 100)) : null;
  const fresh = validDays ? new Date(now.getTime() + validDays * DAY_MS) : null;
  const offerExpiresAt =
    step === 'trial_ended' && existingOfferExpiresAt && new Date(existingOfferExpiresAt).getTime() > now.getTime()
      ? new Date(existingOfferExpiresAt)
      : fresh;
  const subscribe = `${appUrl}/subscribe`;
  const portfolio = `${appUrl}/portfolio`;

  const params = {
    trial_welcome: () => [name, TRIAL_DAYS, portfolio],
    trial_stoploss: () => [name, portfolio],
    trial_ending: () => [name, planName(plan), discountPct, price, arDate.format(offerExpiresAt), subscribe],
    trial_ended: () => [name, discountPct, arDate.format(offerExpiresAt), subscribe],
    paid_welcome: () => [
      name,
      planName(subscription.plan) || String(TIERS[subscription.tier]?.label ?? '').replace(/^باقة /, ''),
      arDate.format(new Date(subscription.current_period_end)),
      portfolio,
    ],
    survey: () => [name],
    renewal: () => [name, whatsNew, planName(plan), discountPct, price, arDate.format(offerExpiresAt), subscribe],
  }[step]().map(clean);

  return {
    request: {
      messaging_product: 'whatsapp',
      to: String(user.phone).replace(/^\+/, ''),
      type: 'template',
      template: {
        name: config.templateName,
        language: { code: config.templateLang ?? 'ar' },
        components: [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }],
      },
    },
    renderedParams: params,
    offerExpiresAt: validDays ? offerExpiresAt : null,
  };
}
