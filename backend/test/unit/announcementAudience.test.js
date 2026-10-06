import test from 'node:test';
import assert from 'node:assert/strict';

import { audienceSegmentsOf, audienceMatches, normalizeAudiences, normalizeCtaUrl } from '../../src/announcementAudience.js';

const NOW = Date.parse('2026-10-06T12:00:00Z');
const inDays = (days) => new Date(NOW + days * 24 * 3600_000).toISOString();
const access = (over) => ({ subscriptionActive: false, currentPeriodEnd: null, trialActive: false, trialEndsAt: inDays(-3), ...over });

test('a paid, unexpired subscription is "active" even if the trial is also running', () => {
  assert.deepEqual(audienceSegmentsOf(access({ subscriptionActive: true, currentPeriodEnd: inDays(10), trialActive: true, trialEndsAt: inDays(1) }), NOW), ['active']);
});

test('a subscription that ran out is "expired"', () => {
  assert.deepEqual(audienceSegmentsOf(access({ currentPeriodEnd: inDays(-4) }), NOW), ['expired']);
});

test('no subscription and a finished trial is "never"', () => {
  assert.deepEqual(audienceSegmentsOf(access(), NOW), ['never']);
});

test('a running trial is "trial", and also "trial_ending" within two days of its end', () => {
  assert.deepEqual(audienceSegmentsOf(access({ trialActive: true, trialEndsAt: inDays(4) }), NOW), ['trial']);
  assert.deepEqual(audienceSegmentsOf(access({ trialActive: true, trialEndsAt: inDays(2) }), NOW), ['trial', 'trial_ending']);
  assert.deepEqual(audienceSegmentsOf(access({ trialActive: true, trialEndsAt: inDays(0.2) }), NOW), ['trial', 'trial_ending']);
});

test('an announcement with no audiences is for everyone; otherwise any overlap matches', () => {
  assert.equal(audienceMatches([], ['never']), true);
  assert.equal(audienceMatches(undefined, ['never']), true);
  assert.equal(audienceMatches(['trial', 'expired'], ['expired']), true);
  assert.equal(audienceMatches(['trial_ending'], ['trial']), false);
});

test('normalizeAudiences keeps known segments, drops duplicates and rejects anything else', () => {
  assert.deepEqual(normalizeAudiences(undefined), []);
  assert.deepEqual(normalizeAudiences(['trial', 'trial']), ['trial']);
  assert.equal(normalizeAudiences(['trial', 'vip']), null);
  assert.equal(normalizeAudiences('trial'), null);
});

test('normalizeCtaUrl allows in-app paths and https only', () => {
  assert.equal(normalizeCtaUrl('/subscribe'), '/subscribe');
  assert.equal(normalizeCtaUrl(' /pricing?plan=long '), '/pricing?plan=long');
  assert.equal(normalizeCtaUrl('https://example.com/offer'), 'https://example.com/offer');
  for (const bad of ['http://example.com', '//evil.example.com', '/\\evil.example.com', 'javascript:alert(1)', 'subscribe', '/a b', '', null, 42]) {
    assert.equal(normalizeCtaUrl(bad), null, String(bad));
  }
});
