import test from 'node:test';
import assert from 'node:assert/strict';

import '../helpers/env.js';

import { recordEvent, latestEventFor, _resetForTests } from '../../src/data/corporateEvents.js';

test('a confirmed ratio replaces a suspected one, never the other way round, and survives a reload', async () => {
  await recordEvent({ code: 'poul', lastBefore: '2026-09-24', rawBefore: 38.2, factor: 2.6, status: 'suspected' });
  await recordEvent({ code: 'POUL', lastBefore: '2026-09-24', rawBefore: 38.2, factor: 2.688241359, status: 'confirmed', kind: 'merger' });
  await recordEvent({ code: 'POUL', lastBefore: '2026-09-24', rawBefore: 38.2, factor: 2.5, status: 'suspected' });
  _resetForTests();
  const event = await latestEventFor('POUL');
  assert.equal(event.status, 'confirmed');
  assert.equal(event.factor, 2.688241359);
  assert.equal(await latestEventFor('COMI'), null);
});
