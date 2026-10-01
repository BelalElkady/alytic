import test from 'node:test';
import assert from 'node:assert/strict';

import { rememberVerdict, stopContextOf } from '../../src/portfolio.js';

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
    verdict: { action: 'hold', conviction: 'high', headline: 'احتفظ', orderInstruction: null, invalidation: 'تحت 75', reentryPlan: null, scenarios: null },
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

test('rememberVerdict: keeps the stop context beside the verdict only when one is given', () => {
  const p = { positions: { SWDY: { shares: 870, avgCost: 84.45 } } };
  const stop = { level: 114.7, fired: true };
  assert.deepEqual(rememberVerdict(p, 'SWDY', { action: 'exit' }, { style: 'long', stop }).lastVerdicts.SWDY.stopContext, stop);
  assert.equal('stopContext' in rememberVerdict(p, 'SWDY', { action: 'exit' }, { style: 'long' }).lastVerdicts.SWDY, false);
});

test('stopContextOf: keeps why the stop verdict was reached, trimmed, and nothing for a quiet hold', () => {
  const analysis = {
    position: {
      ruleBook: {
        stop: {
          level: 114.7, fired: true, distancePct: -8.5, confirmCloses: 2, warning: null,
          fundamentalHold: { eligible: false, blockers: ['investment score 52 < 65'] },
        },
      },
    },
  };
  const ctx = stopContextOf(analysis, { reasoning: 'x'.repeat(5000), _meta: { model: 'm' } });
  assert.equal(ctx.level, 114.7);
  assert.equal(ctx.fired, true);
  assert.deepEqual(ctx.fundamentalHold, { eligible: false, blockers: ['investment score 52 < 65'], holdThrough: null });
  assert.equal(ctx.model, 'm');
  assert.equal(ctx.reasoning.length, 1200);

  const warned = stopContextOf({ position: { ruleBook: { stop: { level: 114.7, fired: false, warning: { closesUnder: 1, needed: 2 } } } } }, {});
  assert.deepEqual(warned.warning, { closesUnder: 1, needed: 2 });
  assert.equal(warned.fundamentalHold, null);

  const quiet = { position: { ruleBook: { stop: { level: 90, fired: false, warning: null } } } };
  assert.equal(stopContextOf(quiet, {}), null);
  assert.equal(stopContextOf(null, {}), null);
});
