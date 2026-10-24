import test from 'node:test';
import assert from 'node:assert/strict';

import { TRIAL_DAYS, trialInfo, tradingDayIndex } from '../../src/billing/trial.js';

// Thursday 2026-10-22, 10:00 Cairo. Friday and Saturday never count.
const VERIFIED = '2026-10-22T10:00:00+03:00';
const user = { emailVerified: true, emailVerifiedAt: VERIFIED };
const at = (iso) => Date.parse(iso);

test('a trial confirmed this morning has all five days left', () => {
  const info = trialInfo(user, at('2026-10-22T12:00:00+03:00'));
  assert.equal(info.trialActive, true);
  assert.equal(info.trialDaysLeft, TRIAL_DAYS);
});

test('the weekend after a Thursday confirmation pushes the end out', () => {
  const info = trialInfo(user, at('2026-10-22T12:00:00+03:00'));
  assert.ok(info.trialEndsAt.getTime() > at('2026-10-28T10:00:00+03:00'), info.trialEndsAt.toISOString());
});

test('a raw users row counts from email_verified_at too', () => {
  const row = { email_verified: true, email_verified_at: VERIFIED, created_at: '2026-10-01T00:00:00Z' };
  assert.equal(trialInfo(row, at('2026-10-22T12:00:00+03:00')).trialDaysLeft, TRIAL_DAYS);
});

test('tradingDayIndex counts trading slices only', () => {
  assert.equal(tradingDayIndex(user, at('2026-10-22T12:00:00+03:00')), 0);
  assert.equal(tradingDayIndex(user, at('2026-10-24T12:00:00+03:00')), 0, 'Saturday is not a trading day');
  assert.equal(tradingDayIndex(user, at('2026-10-25T11:00:00+03:00')), 1, 'Sunday is the second trading day');
  assert.equal(tradingDayIndex(user, at('2026-10-22T09:00:00+03:00')), -1, 'before the first slice starts');
});

test('an unconfirmed account has a full trial that has not started', () => {
  const unverified = { emailVerified: false, createdAt: '2026-01-01T00:00:00Z' };
  assert.equal(trialInfo(unverified, at('2026-10-22T12:00:00+03:00')).trialDaysLeft, TRIAL_DAYS);
});
