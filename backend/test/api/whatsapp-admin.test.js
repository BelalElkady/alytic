/**
 * The user's WhatsApp switch, the admin step settings, and the WhatsApp
 * summary on the admin users list.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import '../helpers/env.js';

import { startServer, request, registerUser } from '../helpers/server.js';
import { setUserRole, supabase } from '../../src/db.js';

const ctx = await startServer();
const { baseUrl } = ctx;
test.after(() => ctx.close());

async function accountWithRole(role) {
  const account = await registerUser(baseUrl);
  await setUserRole(account.user.id, role);
  return account;
}
const putStep = (actor, key, body) => request(baseUrl, 'PUT', `/api/admin/whatsapp/steps/${key}`, { cookie: actor.cookie, body });
const offer = { discountPct: 0, validDays: 3, plan: 'long_yearly' };

test('the settings switch turns WhatsApp off and on, and /me shows it', async () => {
  const account = await registerUser(baseUrl);
  const me = async () => (await request(baseUrl, 'GET', '/api/auth/me', { cookie: account.cookie })).body.user;
  assert.equal((await me()).whatsappEnabled, true, 'on by default (opt-in by notice)');
  const off = await request(baseUrl, 'PATCH', '/api/account/whatsapp', { cookie: account.cookie, body: { enabled: false } });
  assert.equal(off.status, 200, off.text);
  assert.deepEqual(off.body, { whatsappEnabled: false });
  assert.equal((await me()).whatsappEnabled, false);
  await request(baseUrl, 'PATCH', '/api/account/whatsapp', { cookie: account.cookie, body: { enabled: true } });
  assert.equal((await me()).whatsappEnabled, true);
  const bad = await request(baseUrl, 'PATCH', '/api/account/whatsapp', { cookie: account.cookie, body: { enabled: 'yes' } });
  assert.equal(bad.status, 400);
});

test('a Marketer can read the step settings but not change them', async () => {
  const marketer = await accountWithRole('marketer');
  const read = await request(baseUrl, 'GET', '/api/admin/whatsapp/steps', { cookie: marketer.cookie });
  assert.equal(read.status, 200, read.text);
  assert.equal(read.body.steps.length, 7);
  assert.equal(typeof read.body.liveSending, 'boolean');
  assert.equal((await putStep(marketer, 'trial_ending', { enabled: true, templateName: 'trial_ending', params: offer })).status, 403);
});

test('an Admin saves a step; bad names and unknown keys are refused in Arabic', async () => {
  const admin = await accountWithRole('admin');
  const ok = await putStep(admin, 'trial_ending', { enabled: true, templateName: 'trial_ending', params: offer });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.body.step.params.discountPct, 0, 'a 0% offer is a valid setting');

  const badName = await putStep(admin, 'trial_ending', { enabled: true, templateName: 'Trial Ending', params: offer });
  assert.equal(badName.status, 400);
  assert.match(badName.body.error, /[؀-ۿ]/);

  const unknown = await putStep(admin, 'nope', { enabled: true, templateName: 'nope', params: {} });
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.error, 'الخطوة دي مش موجودة');
});

test('the users list shows a live offer for the Admin to honor', async () => {
  const admin = await accountWithRole('admin');
  const target = await registerUser(baseUrl);
  const expiresAt = new Date(Date.now() + 2 * 24 * 3600_000).toISOString();
  await supabase.from('whatsapp_messages').insert({
    user_id: target.user.id,
    step: 'trial_ending',
    phone: target.user.phone,
    rendered_params: ['x', 'النفس الطويل', '20', '2392', 'y', 'z'],
    offer_expires_at: expiresAt,
    status: 'delivered',
  });
  const list = await request(baseUrl, 'GET', '/api/admin/users', { cookie: admin.cookie });
  assert.equal(list.status, 200);
  const row = list.body.users.find((u) => u.id === target.user.id);
  assert.ok(row, 'the user is listed');
  assert.equal(row.whatsapp.lastStep, 'trial_ending');
  assert.equal(row.whatsapp.lastStatus, 'delivered');
  assert.deepEqual(row.whatsapp.offer, { discountPct: 20, expiresAt: new Date(expiresAt).toISOString() });
});
