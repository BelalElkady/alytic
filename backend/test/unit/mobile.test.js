import test from 'node:test';
import assert from 'node:assert/strict';

import { validateDeviceRegistration } from '../../src/mobile/devices.js';
import { parseServiceAccount, createFcmSender, stringifyData } from '../../src/notifications/fcm.js';
import { createNotificationService } from '../../src/notifications/service.js';
import { evaluatePositionAlerts, runPriceAlerts } from '../../src/notifications/priceAlerts.js';
import { isNotificationType, pathFor, NOTIFICATION_TYPES } from '../../src/notifications/types.js';
import { isNativeOrigin, originGuard } from '../../src/security.js';

const token = 'x'.repeat(40);

test('device registration: accepts a complete body and normalises it', () => {
  const { value } = validateDeviceRegistration({ deviceId: 'abcd-1234-efgh', platform: 'ios', pushToken: token, appVersion: '1.0.0', osVersion: '18.1' });
  assert.equal(value.platform, 'ios');
  assert.equal(value.enabled, true);
});

test('device registration: rejects bad platform, id and token', () => {
  assert.ok(validateDeviceRegistration({ deviceId: 'abcd-1234', platform: 'web', pushToken: token }).error);
  assert.ok(validateDeviceRegistration({ deviceId: '../etc', platform: 'ios', pushToken: token }).error);
  assert.ok(validateDeviceRegistration({ deviceId: 'abcd-1234', platform: 'ios', pushToken: 'short' }).error);
  assert.ok(validateDeviceRegistration(null).error);
});

test('every notification type builds a path', () => {
  for (const type of Object.keys(NOTIFICATION_TYPES)) assert.match(pathFor(type, { code: 'SWDY' }), /^\//);
  assert.equal(pathFor('stock_target_reached', { code: 'SWDY' }), '/stock/SWDY');
  assert.equal(isNotificationType('nope'), false);
});

test('service account parsing: raw JSON, base64 and errors', () => {
  const sa = { project_id: 'p', client_email: 'a@b.c', private_key: 'k' };
  assert.equal(parseServiceAccount(JSON.stringify(sa)).project_id, 'p');
  assert.equal(parseServiceAccount(Buffer.from(JSON.stringify(sa)).toString('base64')).client_email, 'a@b.c');
  assert.equal(parseServiceAccount(''), null);
  assert.throws(() => parseServiceAccount('{"project_id":"p"}'));
});

test('fcm sender: posts the v1 message and classifies dead tokens', async () => {
  const calls = [];
  const responses = [
    new Response('{}', { status: 200 }),
    new Response(JSON.stringify({ error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } }), { status: 404 }),
    new Response(JSON.stringify({ error: { status: 'INVALID_ARGUMENT' } }), { status: 400 }),
  ];
  const sender = createFcmSender({
    serviceAccount: { project_id: 'proj' },
    getAccessToken: async () => 'ya29.test',
    fetchImpl: async (url, init) => { calls.push({ url, init }); return responses.shift(); },
  });
  assert.deepEqual(await sender.send(token, { title: 't', body: 'b', data: { code: 'SWDY', n: 1 } }), { ok: true });
  const sent = JSON.parse(calls[0].init.body).message;
  assert.equal(calls[0].url, 'https://fcm.googleapis.com/v1/projects/proj/messages:send');
  assert.equal(calls[0].init.headers.authorization, 'Bearer ya29.test');
  assert.deepEqual(sent.data, { code: 'SWDY', n: '1' });
  assert.equal((await sender.send(token, { title: 't', body: 'b' })).invalidToken, true);
  assert.equal((await sender.send(token, { title: 't', body: 'b' })).invalidToken, false);
  assert.deepEqual(stringifyData({ a: null, b: { c: 1 } }), { b: '{"c":1}' });
});

function fakeStore(devices) {
  const log = { disabled: [], sent: [], notifications: [] };
  return {
    log,
    async insertNotification(n) { const row = { id: `n${log.notifications.length + 1}`, ...n }; log.notifications.push(row); return row; },
    async listEnabledDevices() { return devices; },
    async disableDevice(_u, id) { log.disabled.push(id); },
    async markSent(id) { log.sent.push(id); },
  };
}

test('notify: stores, pushes to every device, disables dead tokens, marks sent', async () => {
  const store = fakeStore([{ device_id: 'a', push_token: 'good' }, { device_id: 'b', push_token: 'dead' }]);
  const sender = { async send(t, msg) { this.last = msg; return t === 'dead' ? { ok: false, invalidToken: true } : { ok: true }; } };
  const svc = createNotificationService({ store, sender });
  const out = await svc.notify('u1', { type: 'stock_target_reached', title: 'SWDY وصل للهدف', body: 'x', data: { code: 'SWDY' } });
  assert.equal(out.delivered, 1);
  assert.equal(out.failed, 1);
  assert.deepEqual(store.log.disabled, ['b']);
  assert.deepEqual(store.log.sent, ['n1']);
  assert.equal(sender.last.data.path, '/stock/SWDY');
  assert.equal(sender.last.data.notificationId, 'n1');
});

test('notify: still stores the notification when push is not configured, and rejects unknown types', async () => {
  const store = fakeStore([]);
  const svc = createNotificationService({ store, sender: null });
  const out = await svc.notify('u1', { type: 'system_announcement', title: 't', body: 'b' });
  assert.equal(out.delivered, 0);
  assert.equal(store.log.notifications.length, 1);
  await assert.rejects(svc.notify('u1', { type: 'bogus', title: 't', body: 'b' }));
});

test('price alerts: target and stop are detected from user levels', () => {
  const prices = new Map([['SWDY', 50], ['COMI', 70], ['ABUK', 30]]);
  const alerts = evaluatePositionAlerts({ SWDY: { target: 48 }, COMI: { stop: 72 }, ABUK: { target: 40, stop: 20 } }, prices);
  assert.deepEqual(alerts.map((a) => [a.code, a.type]), [['SWDY', 'stock_target_reached'], ['COMI', 'stop_loss_triggered']]);
});

test('price alerts: each level fires once and only users with devices are evaluated', async () => {
  const sentKeys = new Set();
  const notified = [];
  const deps = {
    getPortfolios: async () => [
      { user_id: 'u1', state_json: { positions: { SWDY: { target: 48 } } } },
      { user_id: 'u2', state_json: { positions: { SWDY: { target: 48 } } } },
    ],
    fetchPrices: async () => new Map([['SWDY', 50]]),
    hasDevices: async (id) => id === 'u1',
    alreadySent: async (_u, key) => sentKeys.has(key),
    notify: async (u, n) => { sentKeys.add(n.data.dedupeKey); notified.push([u, n.type]); },
  };
  assert.deepEqual(await runPriceAlerts(deps), { users: 1, sent: 1 });
  assert.deepEqual(await runPriceAlerts(deps), { users: 1, sent: 0 });
  assert.deepEqual(notified, [['u1', 'stock_target_reached']]);
});

test('native origin: only the exact app origins, and the write guard lets them through', () => {
  assert.equal(isNativeOrigin('capacitor://localhost'), true);
  assert.equal(isNativeOrigin('https://localhost'), true);
  assert.equal(isNativeOrigin('https://evil.example'), false);
  assert.equal(isNativeOrigin('https://localhost.evil.example'), false);
  assert.equal(isNativeOrigin(undefined), false);

  const guard = originGuard({ allowedOrigins: ['https://egxpert.com'], allowLocalhost: false });
  const run = (origin) => {
    let outcome = 'next';
    const req = { method: 'POST', originalUrl: '/api/x', get: (h) => (h.toLowerCase() === 'origin' ? origin : undefined) };
    const res = { status: () => ({ json: () => { outcome = 'blocked'; } }) };
    guard(req, res, () => {});
    return outcome;
  };
  assert.equal(run('capacitor://localhost'), 'next');
  assert.equal(run('https://evil.example'), 'blocked');
});
