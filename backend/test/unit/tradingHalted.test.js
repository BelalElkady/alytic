import test from 'node:test';
import assert from 'node:assert/strict';

import '../helpers/env.js';

import { tradingHalted } from '../../src/data/cache.js';

// Cairo is UTC+3 in late September 2026 (EEST).
const at = (iso) => new Date(iso);
const unix = (iso) => Date.parse(iso) / 1000;

test('traded today: trading', () => {
  assert.equal(tradingHalted(unix('2026-09-27T07:15:00Z'), at('2026-09-27T09:00:00Z')), null);
});

test('no trade half an hour into the session: halted since the last trade', () => {
  // Sunday 11:00 Cairo, last trade Thursday.
  assert.deepEqual(tradingHalted(unix('2026-09-24T11:25:00Z'), at('2026-09-27T08:00:00Z')), { since: '2026-09-24' });
});

test('before the grace period the previous session is enough', () => {
  // Sunday 10:10 Cairo, last trade Thursday afternoon: not yet.
  assert.equal(tradingHalted(unix('2026-09-24T11:25:00Z'), at('2026-09-27T07:10:00Z')), null);
});

test('a whole missed session is halted even before today\'s opens', () => {
  // Sunday 09:00 Cairo, last trade Wednesday: Thursday was missed.
  assert.deepEqual(tradingHalted(unix('2026-09-23T11:25:00Z'), at('2026-09-27T06:00:00Z')), { since: '2026-09-23' });
});

test('the weekend is not a halt, and an unknown time says nothing', () => {
  // Saturday noon, last trade Thursday.
  assert.equal(tradingHalted(unix('2026-09-24T11:25:00Z'), at('2026-09-26T09:00:00Z')), null);
  assert.equal(tradingHalted(undefined), null);
});
