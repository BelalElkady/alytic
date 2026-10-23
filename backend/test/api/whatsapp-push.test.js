/**
 * The welcome messages pushed to n8n the moment something happens: trial_welcome
 * when a confirmed user has a phone, paid_welcome on the first Activation. A
 * local HTTP server stands in for n8n's webhook.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';

import '../helpers/env.js';

import { startServer, request, registerUser, uniqueEmail, uniquePhone, tokenEmailedTo } from '../helpers/server.js';
import { normalizePhone } from '../../src/phone.js';
import { setUserRole, supabase } from '../../src/db.js';

const SECRET = 'whatsapp-push-secret';
process.env.WHATSAPP_AUTOMATION_SECRET = SECRET;
process.env.WHATSAPP_LAUNCH_AT = '2026-01-01T00:00:00Z';

// The fake n8n: records every push; answers 500 while `failing` is set.
const pushes = [];
let failing = false;
const n8n = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    pushes.push({ headers: req.headers, body: JSON.parse(body) });
    res.statusCode = failing ? 500 : 200;
    res.end('{}');
  });
});
n8n.listen(0);
await once(n8n, 'listening');
process.env.N8N_WHATSAPP_WEBHOOK_URL = `http://127.0.0.1:${n8n.address().port}/webhook`;

const ctx = await startServer();
const { baseUrl } = ctx;
test.after(async () => {
  await ctx.close();
  n8n.close();
});

const allowed = new Set();
const allow = (phone) => {
  allowed.add(phone);
  process.env.WHATSAPP_ALLOWED_PHONES = [...allowed].join(',');
};
const pushesTo = (phone) => pushes.filter((p) => p.body.request.to === phone.replace(/^\+/, ''));
/** Pushes are fire-and-forget; give the one in flight a moment to land. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

// Every step is off by default; the pushes need theirs switched on.
await supabase.from('whatsapp_steps').upsert([
  { key: 'trial_welcome', enabled: true, template_name: 'trial_welcome' },
  { key: 'paid_welcome', enabled: true, template_name: 'paid_welcome' },
]);

async function admin() {
  const account = await registerUser(baseUrl);
  await setUserRole(account.user.id, 'admin');
  return account;
}
const activate = (actor, userId) =>
  request(baseUrl, 'POST', `/api/admin/users/${userId}/subscription`, { cookie: actor.cookie, body: { plan: 'long_monthly' } });

test('confirming the email pushes one trial_welcome with the secret', async () => {
  const email = uniqueEmail();
  const phone = uniquePhone();
  allow(normalizePhone(phone));
  await request(baseUrl, 'POST', '/api/auth/register', { body: { email, password: 'Passw0rd!123', name: 'منى', phone } });
  const token = await tokenEmailedTo(email, 'verify-email');
  assert.equal((await request(baseUrl, 'POST', '/api/auth/verify', { body: { token } })).status, 200);
  await settle();
  const sent = pushesTo(normalizePhone(phone));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].headers.authorization, `Bearer ${SECRET}`);
  assert.equal(sent[0].body.request.template.name, 'trial_welcome');
  assert.ok(sent[0].body.messageId);
});

test('a user without a phone gets the welcome when the phone is saved, once', async () => {
  const account = await registerUser(baseUrl);
  await supabase.from('users').update({ phone: null }).eq('id', account.user.id);
  const phone = `+2011${String(Date.now()).slice(-8)}`;
  allow(phone);
  for (let i = 0; i < 2; i++) {
    const res = await request(baseUrl, 'POST', '/api/account/phone', { cookie: account.cookie, body: { phone } });
    assert.equal(res.status, 200, res.text);
  }
  await settle();
  assert.equal(pushesTo(phone).length, 1);
});

test('the first Activation pushes paid_welcome; a second does not', async () => {
  const actor = await admin();
  const account = await registerUser(baseUrl);
  allow(account.user.phone);
  assert.equal((await activate(actor, account.user.id)).status, 200);
  assert.equal((await activate(actor, account.user.id)).status, 200);
  await settle();
  const paid = pushesTo(account.user.phone).filter((p) => p.body.request.template.name === 'paid_welcome');
  assert.equal(paid.length, 1);
});

test('an opted-out user gets no paid_welcome', async () => {
  const actor = await admin();
  const account = await registerUser(baseUrl);
  allow(account.user.phone);
  await supabase.from('users').update({ whatsapp_opt_out_at: new Date().toISOString() }).eq('id', account.user.id);
  assert.equal((await activate(actor, account.user.id)).status, 200);
  await settle();
  assert.equal(pushesTo(account.user.phone).filter((p) => p.body.request.template.name === 'paid_welcome').length, 0);
});

test('n8n failing does not fail the user’s request', async () => {
  failing = true;
  try {
    const actor = await admin();
    const account = await registerUser(baseUrl);
    allow(account.user.phone);
    assert.equal((await activate(actor, account.user.id)).status, 200);
    await settle();
    const { data: rows } = await supabase.from('whatsapp_messages').select('status').eq('user_id', account.user.id).eq('step', 'paid_welcome');
    assert.equal(rows[0]?.status, 'failed', 'a push n8n refused is marked failed, never retried');
  } finally {
    failing = false;
  }
});
