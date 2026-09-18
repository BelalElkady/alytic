import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizePhone } from '../../src/phone.js';

test('normalizePhone: every Egyptian spelling becomes the same +20 number', () => {
  for (const spelling of [
    '01012345678',
    '010 1234 5678',
    '010-1234-5678',
    '+201012345678',
    '+20 10 1234 5678',
    '00201012345678',
    '0020 (10) 1234-5678',
  ]) {
    assert.equal(normalizePhone(spelling), '+201012345678', spelling);
  }
});

test('normalizePhone: accepts every Egyptian mobile prefix', () => {
  for (const prefix of ['010', '011', '012', '015']) {
    assert.equal(normalizePhone(`${prefix}98765432`), `+2${prefix}98765432`);
  }
});

test('normalizePhone: numbers from other countries pass with their country code', () => {
  assert.equal(normalizePhone('+966 51 234 5678'), '+966512345678');
  assert.equal(normalizePhone('00971 50 123 4567'), '+971501234567');
  assert.equal(normalizePhone('+44 7911 123456'), '+447911123456');
  assert.equal(normalizePhone('+1 (415) 555-0132'), '+14155550132');
});

test('normalizePhone: the same number in different spellings collapses to one string', () => {
  assert.equal(normalizePhone('+1 415 555 0132'), normalizePhone('001-415-555-0132'));
});

test('normalizePhone: without a country code only Egyptian mobiles are recognised', () => {
  for (const bad of ['0991234567', '5123456789', '0501234567', '123']) {
    assert.equal(normalizePhone(bad), null, bad);
  }
});

test('normalizePhone: Egypt keeps its stricter mobile-only check under +20', () => {
  assert.equal(normalizePhone('+20 22 345 6789'), null, 'a Cairo landline is not a mobile');
  assert.equal(normalizePhone('+20 10 1234 567'), null, 'too short');
  assert.equal(normalizePhone('+2001012345678'), null, 'the national 0 must not be kept after +20');
});

test('normalizePhone: refuses malformed input', () => {
  for (const bad of [undefined, null, '', '   ', '+', '+0123456789', '+12345', '+1234567890123456', 'abc', '+966abc12345', '++966512345678']) {
    assert.equal(normalizePhone(bad), null, String(bad));
  }
});
