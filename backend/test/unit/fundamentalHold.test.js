import test from 'node:test';
import assert from 'node:assert/strict';

import '../helpers/env.js';

import RULES from '../../src/config/rules.js';
import { rulesForStyle } from '../../src/config/styles.js';
import { fundamentalHoldOption } from '../../src/analyze.js';
import { analystSystemPrompt } from '../../src/agent/prompts/system.js';

const strong = { investmentScore: 78, confidence: 80, dataQuality: { hasFundamentals: true } };
const inputs = (over = {}) => ({
  shares: 870, price: 105, stopFired: true, classification: strong,
  longTermStop: { stop: 92 }, liquidityOk: true, sessionsUnder: 4, ...over,
});

test('fundamentalHoldOption: nothing to offer while the stop has not fired', () => {
  assert.equal(fundamentalHoldOption(inputs({ stopFired: false }), rulesForStyle(RULES, 'medium')), null);
});

test('fundamentalHoldOption: a strong business under its stop gets both options, with the engine\'s numbers', () => {
  const opt = fundamentalHoldOption(inputs(), rulesForStyle(RULES, 'medium'));
  assert.equal(opt.eligible, true);
  assert.equal(opt.keepQty, 435);
  assert.equal(opt.sellQty, 435);
  assert.equal(opt.coreStop, 92);
  assert.deepEqual(opt.holdThrough, {
    stop: 92, riskPct: 12.38, sessionsUnder: 4, sessionsLeft: 6, maxSessionsUnder: 10,
  });
});

test('fundamentalHoldOption: the long style lets a dip run longer than medium', () => {
  assert.equal(fundamentalHoldOption(inputs({ sessionsUnder: 15 }), rulesForStyle(RULES, 'medium')).eligible, false);
  const long = fundamentalHoldOption(inputs({ sessionsUnder: 15 }), rulesForStyle(RULES, 'long'));
  assert.equal(long.eligible, true);
  assert.equal(long.holdThrough.sessionsLeft, 5);
});

test('fundamentalHoldOption: a dip that has run past the limit goes back to the full exit', () => {
  const opt = fundamentalHoldOption(inputs({ sessionsUnder: 11 }), rulesForStyle(RULES, 'medium'));
  assert.equal(opt.eligible, false);
  assert.match(opt.blockers.join(' '), /11 closes under the stop.*10/);
});

test('fundamentalHoldOption: a trader never gets the exception', () => {
  const opt = fundamentalHoldOption(inputs(), rulesForStyle(RULES, 'trader'));
  assert.equal(opt.eligible, false);
  assert.match(opt.blockers.join(' '), /not allowed for this style/);
});

test('fundamentalHoldOption: weak fundamentals, thin data, a broken long-term trend or thin liquidity all block it', () => {
  const rules = rulesForStyle(RULES, 'long');
  assert.match(fundamentalHoldOption(inputs({ classification: { ...strong, investmentScore: 50 } }), rules).blockers.join(' '), /investment score 50/);
  assert.match(fundamentalHoldOption(inputs({ classification: { ...strong, confidence: 30 } }), rules).blockers.join(' '), /confidence 30/);
  assert.match(fundamentalHoldOption(inputs({ classification: { investmentScore: null, dataQuality: { hasFundamentals: false } } }), rules).blockers.join(' '), /no fundamentals/);
  assert.match(fundamentalHoldOption(inputs({ longTermStop: { stop: 110 } }), rules).blockers.join(' '), /long-term trend broken/);
  assert.match(fundamentalHoldOption(inputs({ liquidityOk: false }), rules).blockers.join(' '), /liquidity/);
});

test('fundamentalHoldOption: with hold-through switched off only the core is offered', () => {
  const rules = rulesForStyle({ ...RULES, stop: { ...RULES.stop, fundamentalHold: { ...RULES.stop.fundamentalHold, holdThrough: false } } }, 'medium');
  const opt = fundamentalHoldOption(inputs({ sessionsUnder: 40 }), rules);
  assert.equal(opt.eligible, true);
  assert.equal(opt.holdThrough, null);
});

test('analystSystemPrompt: tells the model to judge the company\'s long-term chances when the stop breaks', () => {
  const prompt = analystSystemPrompt(rulesForStyle(RULES, 'medium'), 'medium');
  assert.match(prompt, /Hold through/);
  assert.match(prompt, /judge the company's long-term chances/);
  assert.equal(prompt.includes('Default is still exit'), false);
});
