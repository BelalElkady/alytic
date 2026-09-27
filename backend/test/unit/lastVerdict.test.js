import test from 'node:test';
import assert from 'node:assert/strict';

import { rememberVerdict } from '../../src/portfolio.js';

test('rememberVerdict: keeps the card fields and what the verdict was written against', () => {
  const p = { positions: { COMI: { shares: 100, avgCost: 80 } } };
  const verdict = { action: 'hold', conviction: 'high', headline: 'احتفظ', reasoning: 'long prose', invalidation: 'تحت 75' };
  const next = rememberVerdict(p, 'comi', verdict, { style: 'medium', price: 82.5, now: 1000 });
  assert.deepEqual(next.lastVerdicts.COMI, {
    at: 1000,
    style: 'medium',
    price: 82.5,
    shares: 100,
    avgCost: 80,
    verdict: { action: 'hold', conviction: 'high', headline: 'احتفظ', orderInstruction: null, invalidation: 'تحت 75' },
  });
});

test('rememberVerdict: a new verdict replaces the old one and sold stocks are dropped', () => {
  const p = {
    positions: { COMI: { shares: 100, avgCost: 80 } },
    lastVerdicts: {
      COMI: { at: 1, verdict: { action: 'hold' } },
      SWDY: { at: 1, verdict: { action: 'sell' } },
    },
  };
  const next = rememberVerdict(p, 'COMI', { action: 'trim', headline: 'خفف' }, { style: 'short', now: 2 });
  assert.equal(next.lastVerdicts.COMI.verdict.action, 'trim');
  assert.equal(next.lastVerdicts.COMI.at, 2);
  assert.equal(next.lastVerdicts.SWDY, undefined);
});
