import test from 'node:test';
import assert from 'node:assert/strict';

import '../helpers/env.js';

import { attachRuleChecks, checkAgainstRuleBook, ruleBookExpectation } from '../../src/agent/ruleCheck.js';

/** A rule book with nothing fired; pass overrides for the rules under test. */
const book = ({ stop = {}, target = {}, partialProfit = {}, relativeWeakness = null, averagingDown = {} } = {}) => ({
  stop: { fired: false, warning: null, fundamentalHold: null, ...stop },
  target: { fired: false, ...target },
  partialProfit: { fired: false, ...partialProfit },
  relativeWeakness,
  averagingDown: { fired: false, ...averagingDown },
});

test('ruleCheck: nothing fired expects hold; a sale is more cautious, an add contradicts', () => {
  assert.deepEqual(checkAgainstRuleBook(book(), 'hold'), { rule: 'none', expected: ['hold'], action: 'hold', outcome: 'follows' });
  assert.equal(checkAgainstRuleBook(book(), 'reduce').outcome, 'more_cautious');
  assert.equal(checkAgainstRuleBook(book(), 'accumulate').outcome, 'contradicts');
  assert.equal(checkAgainstRuleBook(book(), 'buy').outcome, 'contradicts');
});

test('ruleCheck: a fired stop expects exit, and hold contradicts it', () => {
  const fired = book({ stop: { fired: true } });
  assert.equal(checkAgainstRuleBook(fired, 'exit').outcome, 'follows');
  assert.equal(checkAgainstRuleBook(fired, 'hold').outcome, 'contradicts');
  assert.equal(checkAgainstRuleBook(fired, 'reduce').outcome, 'contradicts');
});

test('ruleCheck: the fundamental-hold options make reduce, and hold-through hold, follow a fired stop', () => {
  const core = book({ stop: { fired: true, fundamentalHold: { eligible: true, holdThrough: null } } });
  assert.deepEqual(ruleBookExpectation(core).expected, ['exit', 'reduce']);
  assert.equal(checkAgainstRuleBook(core, 'hold').outcome, 'contradicts');

  const through = book({ stop: { fired: true, fundamentalHold: { eligible: true, holdThrough: { stop: 40 } } } });
  assert.equal(checkAgainstRuleBook(through, 'hold').outcome, 'follows');

  const blocked = book({ stop: { fired: true, fundamentalHold: { eligible: false, blockers: ['x'] } } });
  assert.deepEqual(ruleBookExpectation(blocked).expected, ['exit']);
});

test('ruleCheck: rules are walked R1 → R3 → R4 → R7 → R5, first fired decides', () => {
  const all = book({
    target: { fired: true },
    partialProfit: { fired: true },
    relativeWeakness: { fired: true },
    averagingDown: { fired: true },
  });
  assert.equal(ruleBookExpectation(all).rule, 'R3');
  assert.equal(ruleBookExpectation(book({ partialProfit: { fired: true }, relativeWeakness: { fired: true } })).rule, 'R4');
  assert.equal(ruleBookExpectation(book({ relativeWeakness: { fired: true }, averagingDown: { fired: true } })).rule, 'R7');
  assert.equal(ruleBookExpectation(book({ averagingDown: { fired: true } })).rule, 'R5');
});

test('ruleCheck: a fired R7 expects reduce; hold contradicts, a full exit is more cautious', () => {
  const lagging = book({ relativeWeakness: { available: true, fired: true } });
  assert.equal(checkAgainstRuleBook(lagging, 'reduce').outcome, 'follows');
  assert.equal(checkAgainstRuleBook(lagging, 'exit').outcome, 'more_cautious');
  assert.equal(checkAgainstRuleBook(lagging, 'hold').outcome, 'contradicts');
});

test('ruleCheck: a fired R5 expects accumulate; holding instead is more cautious', () => {
  const add = book({ averagingDown: { fired: true } });
  assert.equal(checkAgainstRuleBook(add, 'accumulate').outcome, 'follows');
  assert.equal(checkAgainstRuleBook(add, 'hold').outcome, 'more_cautious');
  assert.equal(checkAgainstRuleBook(add, 'buy').outcome, 'contradicts');
});

test('ruleCheck: one close under a two-close stop is hold, and selling on it contradicts', () => {
  const warned = book({ stop: { warning: { needed: 2, closesUnder: 1 } } });
  assert.equal(checkAgainstRuleBook(warned, 'hold').outcome, 'follows');
  assert.equal(checkAgainstRuleBook(warned, 'exit').outcome, 'contradicts');
});

test('attachRuleChecks: adds ruleCheck to held verdicts, leaves the rest alone, logs each one', (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const log = t.mock.method(console, 'log', () => {});
  const analyses = [
    { code: 'AAAA', position: { ruleBook: book({ stop: { fired: true } }) } },
    { code: 'BBBB', position: { ruleBook: book() } },
    { code: 'CCCC' },
  ];
  const verdicts = [
    { code: 'AAAA', action: 'hold' },
    { code: 'BBBB', action: 'hold' },
    { code: 'CCCC', action: 'buy' },
  ];
  const out = attachRuleChecks(verdicts, analyses, 'portfolio_review');

  assert.equal(out[0].ruleCheck.outcome, 'contradicts');
  assert.equal(out[1].ruleCheck.outcome, 'follows');
  assert.equal(out[2].ruleCheck, undefined);
  assert.equal(warn.mock.callCount(), 1);
  assert.match(warn.mock.calls[0].arguments[0], /^\[rule-check\] portfolio_review AAAA R1 expected=exit got=hold contradicts$/);
  assert.equal(log.mock.callCount(), 1);
});
