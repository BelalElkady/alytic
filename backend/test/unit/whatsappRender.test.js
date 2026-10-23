import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_STEPS } from '../../src/whatsapp/steps.js';
import { buildRequest } from '../../src/whatsapp/render.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-28T12:00:00+03:00');
const APP = 'https://egxpert.com';
const arDate = (d) => new Intl.DateTimeFormat('ar-EG', { day: 'numeric', month: 'long', timeZone: 'Africa/Cairo' }).format(d);
const user = { name: 'أحمد علي', phone: '+201012345678' };
const textsOf = (request) => request.template.components[0].parameters.map((p) => p.text);
const build = (step, over = {}) =>
  buildRequest({ step, config: DEFAULT_STEPS[step], user, subscription: null, appUrl: APP, now: NOW, ...over });

test('trial_ending fills the offer in the template order', () => {
  const { request, renderedParams, offerExpiresAt } = build('trial_ending', {
    config: { ...DEFAULT_STEPS.trial_ending, params: { discountPct: 20, validDays: 3, plan: 'long_yearly' } },
  });
  const expires = new Date(NOW.getTime() + 3 * DAY);
  assert.equal(request.messaging_product, 'whatsapp');
  assert.equal(request.to, '201012345678');
  assert.equal(request.type, 'template');
  assert.equal(request.template.name, 'trial_ending');
  assert.deepEqual(request.template.language, { code: 'ar' });
  assert.deepEqual(textsOf(request), ['أحمد', 'النفس الطويل', '20', '2392', arDate(expires), `${APP}/subscribe`]);
  assert.deepEqual(renderedParams, textsOf(request));
  assert.equal(offerExpiresAt.getTime(), expires.getTime());
});

test('an empty name becomes صديقنا', () => {
  assert.equal(textsOf(build('survey', { user: { ...user, name: '  ' } }).request)[0], 'صديقنا');
});

test('trial_ended keeps the offer deadline already given', () => {
  const existing = new Date(NOW.getTime() + DAY);
  const { request, offerExpiresAt } = build('trial_ended', { existingOfferExpiresAt: existing });
  assert.equal(offerExpiresAt.getTime(), existing.getTime());
  assert.equal(textsOf(request)[2], arDate(existing));
});

test('trial_ended starts a fresh offer when the old one ran out', () => {
  const { offerExpiresAt } = build('trial_ended', { existingOfferExpiresAt: new Date(NOW.getTime() - DAY) });
  assert.equal(offerExpiresAt.getTime(), NOW.getTime() + 3 * DAY);
});

test('whitespace in a param is collapsed for Meta', () => {
  const config = { ...DEFAULT_STEPS.renewal, params: { ...DEFAULT_STEPS.renewal.params, whatsNew: 'محافظ    متعددة  وتنبيهات' } };
  assert.equal(textsOf(build('renewal', { config }).request)[1], 'محافظ متعددة وتنبيهات');
});

test('the configured template name is used', () => {
  assert.equal(build('trial_welcome', { config: { ...DEFAULT_STEPS.trial_welcome, templateName: 'welcome_v2' } }).request.template.name, 'welcome_v2');
});

test('steps without an offer have no expiry', () => {
  const { request, offerExpiresAt } = build('trial_welcome');
  assert.equal(offerExpiresAt, null);
  assert.deepEqual(textsOf(request), ['أحمد', '5', `${APP}/portfolio`]);
});

test('paid_welcome names the plan and the period end', () => {
  const subscription = { plan: 'trader_monthly', tier: 'trader', current_period_end: '2026-11-28T12:00:00+02:00' };
  assert.deepEqual(textsOf(build('paid_welcome', { subscription }).request), [
    'أحمد',
    'الحريفة',
    arDate(new Date(subscription.current_period_end)),
    `${APP}/portfolio`,
  ]);
});
