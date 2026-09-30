import { isNotificationType, pathFor } from './types.js';

/**
 * Creates notifications and delivers them to the user's devices.
 *
 * Every notification is stored first (the in-app list and read state come from
 * there) and then pushed to each enabled device. A device whose token FCM
 * reports as dead is disabled so it is not retried forever. Storage and the
 * sender are injected, so this is unit-tested without Supabase or FCM.
 *
 * @param {object} deps
 * @param {object} deps.store  see mobile/store.js
 * @param {{send: Function}|null} deps.sender  null when FCM is not configured
 */
export function createNotificationService({ store, sender, now = () => new Date() }) {
  return {
    /** @returns {Promise<{notification: object, delivered: number, failed: number}>} */
    async notify(userId, { type, title, body, data = {} }) {
      if (!isNotificationType(type)) throw new Error(`Unknown notification type: ${type}`);
      if (!title || !body) throw new Error('A notification needs a title and a body');

      const payload = { ...data, type, path: data.path ?? pathFor(type, data) };
      const notification = await store.insertNotification({ userId, type, title, body, data: payload });
      payload.notificationId = notification.id;

      let delivered = 0;
      let failed = 0;
      if (sender) {
        for (const device of await store.listEnabledDevices(userId)) {
          try {
            const result = await sender.send(device.push_token, { title, body, data: payload });
            if (result.ok) delivered += 1;
            else {
              failed += 1;
              if (result.invalidToken) await store.disableDevice(userId, device.device_id);
            }
          } catch {
            failed += 1; // network trouble: keep the device, try again next time
          }
        }
        if (delivered > 0) await store.markSent(notification.id, now().toISOString());
      }
      return { notification, delivered, failed };
    },
  };
}
