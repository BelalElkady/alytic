import { validateDeviceRegistration } from './devices.js';

/**
 * Mobile-only endpoints: device registration and the notification inbox.
 * Mounted after the auth gate in server.js, so `req.user` is always set.
 * Responses never include push tokens.
 */
export function registerMobileRoutes(app, { wrap, store }) {
  app.post('/api/mobile/devices', wrap(async (req, res) => {
    const parsed = validateDeviceRegistration(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    await store.upsertDevice({ userId: req.user.id, ...parsed.value });
    res.status(201).json({ ok: true });
  }));

  app.get('/api/mobile/devices', wrap(async (req, res) => {
    res.json({ devices: await store.listDevices(req.user.id) });
  }));

  app.delete('/api/mobile/devices/:deviceId', wrap(async (req, res) => {
    await store.deleteDevice(req.user.id, req.params.deviceId);
    res.json({ ok: true });
  }));

  app.get('/api/notifications', wrap(async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    res.json({ notifications: await store.listNotifications(req.user.id, { limit }) });
  }));

  app.post('/api/notifications/:id/read', wrap(async (req, res) => {
    await store.markRead(req.user.id, req.params.id);
    res.json({ ok: true });
  }));
}
