import test from 'node:test';
import assert from 'node:assert/strict';

import { canonicalEmail, isDisposableEmail } from '../../src/emailIdentity.js';

test('canonicalEmail: every spelling of one Gmail mailbox collapses to the same string', () => {
  for (const spelling of [
    'belal@gmail.com',
    'Belal@Gmail.com',
    'b.e.l.a.l@gmail.com',
    'belal+trial2@gmail.com',
    'b.elal+x.y@googlemail.com',
    'belal@googlemail.com',
  ]) {
    assert.equal(canonicalEmail(spelling), 'belal@gmail.com', spelling);
  }
});

test('canonicalEmail: dots are only ignored on Gmail; +tags are dropped everywhere', () => {
  assert.equal(canonicalEmail('first.last@outlook.com'), 'first.last@outlook.com');
  assert.equal(canonicalEmail('first.last+news@outlook.com'), 'first.last@outlook.com');
  assert.equal(canonicalEmail('me+2@company.eg'), 'me@company.eg');
});

test('canonicalEmail: different mailboxes stay different', () => {
  assert.notEqual(canonicalEmail('ahmed@gmail.com'), canonicalEmail('ahmad@gmail.com'));
  assert.notEqual(canonicalEmail('me@outlook.com'), canonicalEmail('me@gmail.com'));
});

test('canonicalEmail: a bare "+" local part is left alone rather than emptied', () => {
  assert.equal(canonicalEmail('+@x.dev'), '+@x.dev');
});

test('isDisposableEmail flags throwaway providers, case-insensitively, and nothing else', () => {
  assert.equal(isDisposableEmail('anyone@mailinator.com'), true);
  assert.equal(isDisposableEmail('Anyone@YOPMAIL.com'), true);
  assert.equal(isDisposableEmail('anyone@gmail.com'), false);
  assert.equal(isDisposableEmail('anyone@mailinator.com.eg'), false);
});
