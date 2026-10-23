import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_STEPS, inSendWindow, isStopWord, stepInputSchema, stepParamsSchema } from '../../src/whatsapp/steps.js';
import { dueStepFor, isEligible, launchGate } from '../../src/whatsapp/eligibility.js';

const DAY = 24 * 60 * 60 * 1000;
const at = (iso) => new Date(iso);
// Every step switched on, so a test only sees the timing rules.
const STEPS = Object.fromEntries(Object.entries(DEFAULT_STEPS).map(([key, step]) => [key, { ...step, enabled: true }]));
const LAUNCH = at('2026-10-01T10:00:00+03:00');

// Confirmed Thursday 2026-10-22 10:00 Cairo. Trading days: Thu 22 (0), Sun 25 (1),
// Mon 26 (2), Tue 27 (3), Wed 28 (4); the trial ends Thursday 29 at 10:00.
const user = (over = {}) => ({
  id: 'u1',
  name: 'أحمد',
  phone: '+201012345678',
  email_verified: true,
  email_verified_at: '2026-10-22T10:00:00+03:00',
  created_at: '2026-10-22T09:00:00+03:00',
  whatsapp_opt_out_at: null,
  is_suspended: false,
  is_admin: false,
  is_marketer: false,
  ...over,
});
const due = (over = {}) =>
  dueStepFor({ user: user(), subscription: null, sent: [], steps: STEPS, launchAt: LAUNCH, now: at('2026-10-22T12:00:00+03:00'), ...over });

test('isEligible names why a user is skipped', () => {
  assert.equal(isEligible(user()), null);
  assert.equal(isEligible(user({ phone: null })), 'no_phone');
  assert.equal(isEligible(user({ email_verified: false, email_verified_at: null })), 'unconfirmed');
  assert.equal(isEligible(user({ whatsapp_opt_out_at: '2026-10-20T00:00:00Z' })), 'opted_out');
  assert.equal(isEligible(user({ is_suspended: true })), 'suspended');
  assert.equal(isEligible(user({ is_admin: true })), 'staff');
  assert.equal(isEligible(user({ is_marketer: true })), 'staff');
  assert.equal(isEligible(user({ id: 'local' })), 'staff');
});

test('nothing is due before launch', () => {
  assert.deepEqual(due({ launchAt: null }), { skip: 'not_launched' });
});

test('users who signed up before launch wait out the grace period', () => {
  const launchAt = at('2026-10-21T10:00:00+03:00');
  const old = user({ created_at: '2026-09-01T00:00:00Z' });
  assert.deepEqual(due({ user: old, launchAt, now: at('2026-10-22T12:00:00+03:00') }), { skip: 'grace' });
  assert.equal(due({ launchAt, now: at('2026-10-22T12:00:00+03:00') }).step, 'trial_welcome', 'a user created after launch is not held back');
});

test('day 0 catches up the welcome, day 1 has nothing due', () => {
  assert.deepEqual(due(), { step: 'trial_welcome', cycleKey: '' });
  assert.deepEqual(due({ now: at('2026-10-25T12:00:00+03:00') }), { skip: 'none_due' });
});

test('trading day 2 is the stop-loss tip', () => {
  assert.deepEqual(due({ now: at('2026-10-26T12:00:00+03:00') }), { step: 'trial_stoploss', cycleKey: '' });
});

test('the last trading day is the trial-ending offer, even when nothing was sent before', () => {
  assert.deepEqual(due({ now: at('2026-10-28T12:00:00+03:00') }), { step: 'trial_ending', cycleKey: '' });
});

test('an earlier step is skipped once a later one went out', () => {
  const sent = [{ step: 'trial_ending', cycle_key: '' }];
  assert.deepEqual(due({ sent, now: at('2026-10-26T12:00:00+03:00') }), { skip: 'later_step_sent' });
});

test('the day after the trial is trial_ended; three days after is the survey', () => {
  assert.deepEqual(due({ now: at('2026-10-30T12:00:00+03:00') }), { step: 'trial_ended', cycleKey: '' });
  assert.deepEqual(due({ now: at('2026-11-01T12:00:00+02:00') }), { step: 'survey', cycleKey: '' });
});

test('a step already sent is not sent again', () => {
  assert.deepEqual(due({ sent: [{ step: 'trial_stoploss', cycle_key: '' }], now: at('2026-10-26T12:00:00+03:00') }), { skip: 'already_sent' });
});

test('a disabled step is skipped', () => {
  const steps = { ...STEPS, trial_stoploss: { ...STEPS.trial_stoploss, enabled: false } };
  assert.deepEqual(due({ steps, now: at('2026-10-26T12:00:00+03:00') }), { skip: 'disabled' });
});

test('an active subscriber gets nothing', () => {
  const subscription = { current_period_end: '2027-01-01T00:00:00Z' };
  assert.deepEqual(due({ subscription }), { skip: 'active' });
});

test('an Expired user gets one renewal offer per lapse', () => {
  const now = at('2026-11-10T12:00:00+02:00');
  const subscription = { current_period_end: new Date(now.getTime() - 2 * DAY).toISOString() };
  const cycleKey = '2026-11-08';
  assert.deepEqual(due({ subscription, now }), { step: 'renewal', cycleKey });
  assert.deepEqual(due({ subscription, now, sent: [{ step: 'renewal', cycle_key: cycleKey }] }), { skip: 'already_sent' });
  const later = { current_period_end: '2027-02-01T10:00:00+02:00' };
  assert.deepEqual(
    due({ subscription: later, now: at('2027-02-03T12:00:00+02:00'), sent: [{ step: 'renewal', cycle_key: cycleKey }] }),
    { step: 'renewal', cycleKey: '2027-02-01' },
  );
});

test('a subscription that ended less than a day ago is not chased yet', () => {
  const now = at('2026-11-10T12:00:00+02:00');
  assert.deepEqual(due({ subscription: { current_period_end: new Date(now.getTime() - 3600_000).toISOString() }, now }), { skip: 'none_due' });
});

test('stop words match with spaces and any letter case', () => {
  for (const text of [' إيقاف ', 'ايقاف', 'STOP', 'Stop', 'الغاء', 'إلغاء']) assert.equal(isStopWord(text), true, text);
  assert.equal(isStopWord('ايقاف الرسايل من فضلك'), false);
});

test('the send window is 10:00 to 21:00 Cairo time', () => {
  assert.equal(inSendWindow(at('2026-10-22T09:59:00+03:00')), false);
  assert.equal(inSendWindow(at('2026-10-22T10:00:00+03:00')), true);
  assert.equal(inSendWindow(at('2026-10-22T20:59:00+03:00')), true);
  assert.equal(inSendWindow(at('2026-10-22T21:00:00+03:00')), false);
});

test('offer params are validated per step', () => {
  assert.equal(stepParamsSchema('trial_ending').safeParse({ discountPct: 0, validDays: 3, plan: 'long_yearly' }).success, true);
  assert.equal(stepParamsSchema('trial_ending').safeParse({ discountPct: 95, validDays: 3, plan: 'long_yearly' }).success, false);
  assert.equal(stepParamsSchema('trial_ending').safeParse({ discountPct: 20, validDays: 3, plan: 'gold' }).success, false);
  assert.equal(stepParamsSchema('renewal').safeParse({ discountPct: 20, validDays: 7, plan: 'long_yearly', whatsNew: 'سطر\nتاني' }).success, false);
});

test('launchGate holds back everything before launch and old users during the grace period', () => {
  const launchAt = at('2026-10-21T10:00:00+03:00');
  const old = user({ created_at: '2026-09-01T00:00:00Z' });
  assert.equal(launchGate(user(), null, at('2026-10-22T12:00:00+03:00')), 'not_launched');
  assert.equal(launchGate(user(), launchAt, at('2026-10-20T12:00:00+03:00')), 'not_launched', 'a launch time in the future has not launched yet');
  assert.equal(launchGate(old, launchAt, at('2026-10-22T12:00:00+03:00')), 'grace');
  assert.equal(launchGate(old, launchAt, at('2026-10-25T12:00:00+03:00')), null);
  assert.equal(launchGate(user(), launchAt, at('2026-10-22T12:00:00+03:00')), null);
});

test('dueStepFor sends nothing while launch is still in the future', () => {
  assert.deepEqual(due({ launchAt: at('2026-12-01T10:00:00+02:00') }), { skip: 'not_launched' });
});

test('an enabled renewal needs its whatsNew text; a disabled one may leave it empty', () => {
  const params = { discountPct: 20, validDays: 7, plan: 'long_yearly', whatsNew: '' };
  assert.equal(stepInputSchema('renewal').safeParse({ enabled: true, templateName: 'renewal', params }).success, false);
  assert.equal(stepInputSchema('renewal').safeParse({ enabled: false, templateName: 'renewal', params }).success, true);
  assert.equal(stepInputSchema('renewal').safeParse({ enabled: true, templateName: 'renewal', params: { ...params, whatsNew: 'محافظ متعددة' } }).success, true);
  assert.equal(stepInputSchema('trial_ending').safeParse({ enabled: true, templateName: 'Trial Ending', params: { discountPct: 0, validDays: 3, plan: 'long_yearly' } }).success, false);
});
