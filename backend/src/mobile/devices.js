/** Validation for POST /api/mobile/devices. Kept pure so it is unit-tested without a database. */
const PLATFORMS = new Set(['android', 'ios']);
const DEVICE_ID = /^[A-Za-z0-9-]{8,64}$/;

const text = (value, max) => (typeof value === 'string' && value.length <= max ? value.trim() : null);

/** @returns {{value: object} | {error: string}} */
export function validateDeviceRegistration(body) {
  const b = body ?? {};
  if (typeof b.deviceId !== 'string' || !DEVICE_ID.test(b.deviceId)) return { error: 'deviceId غير صالح' };
  if (!PLATFORMS.has(b.platform)) return { error: 'platform لازم يكون android أو ios' };
  if (typeof b.pushToken !== 'string' || b.pushToken.length < 20 || b.pushToken.length > 4096) return { error: 'pushToken غير صالح' };
  return {
    value: {
      deviceId: b.deviceId,
      platform: b.platform,
      pushToken: b.pushToken,
      appVersion: text(b.appVersion, 32),
      osVersion: text(b.osVersion, 32),
      enabled: b.enabled !== false,
    },
  };
}
