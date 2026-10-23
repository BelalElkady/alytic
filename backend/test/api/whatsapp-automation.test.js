/**
 * The endpoints n8n calls: /api/automation/whatsapp/due, /result, /events.
 * Same harness as the other API suites. Only phones this file adds to
 * WHATSAPP_ALLOWED_PHONES are ever claimed, so other suites' users sharing the
 * test database are never touched.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import '../helpers/env.js';

import { startServer, request, registerUser } from '../helpers/server.js';
import { supabase } from '../../src/db.js';

const SECRET = 'whatsapp-test-secret';
process.env.WHATSAPP_AUTOMATION_SECRET = SECRET;
process.env.WHATSAPP_LAUNCH_AT = '2026-01-01T00:00:00Z';
const allowed = new Set();
const allow = (phone) => {
  allowed.add(phone);
  process.env.WHATSAPP_ALLOWED_PHONES = [...allowed].join(',');
};

const ctx = await startServer();
const { baseUrl } = ctx;
test.after(() => ctx.close());

const auth = { authorization: `Bearer ${SECRET}` };
// Thursday 2026-10-22 noon Cairo, inside the send window.
const AT = '2026-10-22T12:00:00+03:00';
const due = (at = AT) => request(baseUrl, 'GET', `/api/automation/whatsapp/due?at=${encodeURIComponent(at)}`, { headers: auth });
const post = (path, body) => request(baseUrl, 'POST', `/api/automation/whatsapp/${path}`, { headers: auth, body });
const toOf = (phone) => phone.replace(/^\+/, '');
const itemFor = (res, phone) => res.body.items.find((item) => item.request.to === toOf(phone));

/** A confirmed user whose trial started at `verifiedAt`, on the allowlist unless told otherwise. */
async function trialUser(verifiedAt = '2026-10-22T10:00:00+03:00', { allowPhone = true } = {}) {
  const account = await registerUser(baseUrl);
  await supabase.from('users').update({ email_verified_at: verifiedAt }).eq('id', account.user.id);
  if (allowPhone) allow(account.user.phone);
  return account;
}

const messagesOf = async (userId) =>
  (await supabase.from('whatsapp_messages').select('*').eq('user_id', userId).order('created_at')).data;

test('all three automation paths need the secret', async () => {
  for (const [method, path] of [['GET', 'due'], ['POST', 'result'], ['POST', 'events']]) {
    const none = await request(baseUrl, method, `/api/automation/whatsapp/${path}`, { body: method === 'POST' ? {} : undefined });
    assert.equal(none.status, 401, `${path} without a secret`);
    const wrong = await request(baseUrl, method, `/api/automation/whatsapp/${path}`, {
      headers: { authorization: 'Bearer nope' },
      body: method === 'POST' ? {} : undefined,
    });
    assert.equal(wrong.status, 401, `${path} with a wrong secret`);
  }
  assert.equal((await due()).status, 200);
});

test('/due claims a fresh user once, and never a phone off the allowlist', async () => {
  const listed = await trialUser();
  const unlisted = await trialUser(undefined, { allowPhone: false });

  const first = await due();
  assert.equal(first.status, 200, first.text);
  const item = itemFor(first, listed.user.phone);
  assert.ok(item, 'the allowlisted user is due');
  assert.equal(item.request.template.name, 'trial_welcome');
  assert.equal(itemFor(first, unlisted.user.phone), undefined, 'the unlisted user is never claimed');
  assert.equal((await messagesOf(unlisted.user.id)).length, 0);

  const second = await due();
  assert.equal(itemFor(second, listed.user.phone), undefined, 'a claimed step is not handed out twice');
});

test('a delivery status never moves backwards and ticks the follow-up box', async () => {
  const account = await trialUser();
  const item = itemFor(await due(), account.user.phone);
  const metaMessageId = `wamid.${crypto.randomUUID()}`;
  assert.equal((await post('result', { messageId: item.messageId, status: 'sent', metaMessageId })).status, 200);
  for (const status of ['delivered', 'read', 'delivered']) {
    const res = await post('events', { type: 'status', metaMessageId, status, at: new Date().toISOString(), error: null });
    assert.equal(res.status, 200, res.text);
  }
  const [row] = await messagesOf(account.user.id);
  assert.equal(row.status, 'read');
  const { data: followUp } = await supabase.from('user_follow_ups').select('whatsapp_at').eq('user_id', account.user.id).maybeSingle();
  assert.ok(followUp?.whatsapp_at, 'delivered ticks the WhatsApp follow-up box');
});

test('a stop word in any spacing or case opts the user out', async () => {
  for (const text of [' إيقاف ', 'STOP']) {
    const account = await trialUser();
    const res = await post('events', { type: 'message', from: account.user.phone, metaMessageId: `wamid.${crypto.randomUUID()}`, text });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.body.reply.text, 'تمام، مش هنبعتلك رسايل تاني. تقدر ترجّعها من الإعدادات.');
    assert.equal(res.body.reply.to, toOf(account.user.phone));
    const { data: row } = await supabase.from('users').select('whatsapp_opt_out_at').eq('id', account.user.id).single();
    assert.ok(row.whatsapp_opt_out_at, `"${text}" opts out`);
    assert.equal(itemFor(await due(), account.user.phone), undefined, 'nothing is due after opting out');
  }
});

test('any other message gets the support-chat pointer once a day', async () => {
  const account = await trialUser();
  const send = () => post('events', { type: 'message', from: account.user.phone, metaMessageId: `wamid.${crypto.randomUUID()}`, text: 'عايز اشترك' });
  const first = await send();
  assert.match(first.body.reply.text, /الشات جوه الموقع/);
  assert.equal((await send()).body.reply, undefined, 'no second pointer within 24 hours');
});

test('a changed phone gets the next step; the log keeps the old number', async () => {
  const account = await trialUser();
  const oldPhone = account.user.phone;
  await due();
  const newPhone = `+2010${String(crypto.randomInt(100_000_000)).padStart(8, '0')}`;
  await supabase.from('users').update({ phone: newPhone }).eq('id', account.user.id);
  allow(newPhone);
  const res = await due('2026-10-26T12:00:00+03:00');
  const item = itemFor(res, newPhone);
  assert.equal(item?.request.template.name, 'trial_stoploss');
  const rows = await messagesOf(account.user.id);
  assert.equal(rows[0].phone, oldPhone);
  assert.equal(rows[1].phone, newPhone);
});

test('a queued row with no result for 2 hours turns failed', async () => {
  const account = await trialUser();
  await due();
  const threeHoursAgo = new Date(Date.now() - 3 * 3600_000).toISOString();
  await supabase.from('whatsapp_messages').update({ created_at: threeHoursAgo }).eq('user_id', account.user.id);
  await due();
  const [row] = await messagesOf(account.user.id);
  assert.equal(row.status, 'failed');
});

test('/result and /events reject malformed bodies', async () => {
  assert.equal((await post('result', { messageId: 'not-a-uuid', status: 'sent' })).status, 400);
  assert.equal((await post('events', { type: 'nope' })).status, 400);
});
