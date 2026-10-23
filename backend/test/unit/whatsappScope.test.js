import test from 'node:test';
import assert from 'node:assert/strict';

import { sendingScope } from '../../src/whatsapp/scope.js';

const PROD = 'https://xssjwnevhbpcdmtbatiy.supabase.co';
const TEST = 'https://qfxuejkbnrdszycqxvdx.supabase.co';
const scope = (env) => sendingScope({ NODE_ENV: 'production', SUPABASE_URL: PROD, ...env });

test('production sends to every eligible user', () => {
  const s = scope({});
  assert.equal(s.live, true);
  assert.equal(s.everyone, true);
  assert.equal(s.allows('+201000000001'), true);
});

test('WHATSAPP_ALLOWLIST_ONLY=true keeps production to the allowlist', () => {
  const s = scope({ WHATSAPP_ALLOWLIST_ONLY: 'true', WHATSAPP_ALLOWED_PHONES: '+201012345678, 01112345678' });
  assert.equal(s.live, true, 'still production (the test clock stays off)');
  assert.equal(s.everyone, false);
  assert.equal(s.allows('+201012345678'), true);
  assert.equal(s.allows('+201112345678'), true, 'Egyptian national format is normalised');
  assert.equal(s.allows('+201000000001'), false);
});

test('allowlist-only with an empty list sends nothing', () => {
  const s = scope({ WHATSAPP_ALLOWLIST_ONLY: 'true' });
  assert.equal(s.canSend, false);
  assert.equal(s.allows('+201012345678'), false);
});

test('outside production the allowlist always applies, whatever the flag says', () => {
  for (const env of [{ NODE_ENV: 'development' }, { SUPABASE_URL: TEST }, { SUPABASE_URL: TEST, WHATSAPP_ALLOWLIST_ONLY: 'false' }]) {
    const s = scope({ ...env, WHATSAPP_ALLOWED_PHONES: '+201012345678' });
    assert.equal(s.live, false);
    assert.equal(s.everyone, false);
    assert.equal(s.allows('+201012345678'), true);
    assert.equal(s.allows('+201000000001'), false);
  }
  assert.equal(scope({ NODE_ENV: 'development' }).canSend, false, 'no list: nothing is sent');
});

test('only "true" switches allowlist-only on', () => {
  assert.equal(scope({ WHATSAPP_ALLOWLIST_ONLY: 'yes' }).everyone, true);
  assert.equal(scope({ WHATSAPP_ALLOWLIST_ONLY: ' TRUE ' }).everyone, false);
});
