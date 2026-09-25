import test from 'node:test';
import assert from 'node:assert/strict';

import '../helpers/env.js';

import { egxSessionOpen } from '../../src/data/cache.js';

// Cairo is UTC+3 in late September 2026 (summer time), so 10:00 Cairo is 07:00Z.
const cairo = (isoDate, hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(`${isoDate}T${String(h - 3).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`);
};

test('egxSessionOpen: 10:00 to 14:30 Cairo time on a trading day', () => {
  const sunday = '2026-09-27';
  assert.equal(egxSessionOpen(cairo(sunday, '09:59')), false);
  assert.equal(egxSessionOpen(cairo(sunday, '10:00')), true);
  assert.equal(egxSessionOpen(cairo(sunday, '14:29')), true);
  assert.equal(egxSessionOpen(cairo(sunday, '14:30')), false);
});

test('egxSessionOpen: closed all day Friday and Saturday', () => {
  assert.equal(egxSessionOpen(cairo('2026-09-25', '12:00')), false);
  assert.equal(egxSessionOpen(cairo('2026-09-26', '12:00')), false);
});
