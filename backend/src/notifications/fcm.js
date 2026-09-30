import { GoogleAuth } from 'google-auth-library';

/**
 * Sends push messages through Firebase Cloud Messaging (HTTP v1). One sender
 * serves both platforms: FCM delivers to Android directly and to iOS through
 * APNs (the APNs key is uploaded to the Firebase project — see
 * docs/push-notifications.md).
 *
 * The service-account credential comes from the server's environment only. It
 * is never sent to, or bundled in, the app.
 */

/** Parses FCM_SERVICE_ACCOUNT_JSON — raw JSON, or the same JSON base64-encoded (easier to put in an env var). */
export function parseServiceAccount(value) {
  if (!value) return null;
  const text = value.trim().startsWith('{') ? value : Buffer.from(value, 'base64').toString('utf8');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('FCM_SERVICE_ACCOUNT_JSON is not valid JSON (or base64 of JSON)');
  }
  if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
    throw new Error('FCM_SERVICE_ACCOUNT_JSON is missing project_id, client_email or private_key');
  }
  return parsed;
}

// Only these mean the token itself is dead. INVALID_ARGUMENT can just as well be a bad payload, so it never disables a device.
const INVALID_TOKEN_CODES = new Set(['UNREGISTERED', 'NOT_FOUND']);

/** FCM data payload values must all be strings. */
export const stringifyData = (data = {}) =>
  Object.fromEntries(Object.entries(data).filter(([, v]) => v != null).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));

/**
 * @param {object} options
 * @param {object} options.serviceAccount parsed service-account JSON
 * @param {typeof fetch} [options.fetchImpl]
 * @param {() => Promise<string>} [options.getAccessToken] injectable for tests
 */
export function createFcmSender({ serviceAccount, fetchImpl = fetch, getAccessToken }) {
  const auth = getAccessToken
    ? null
    : new GoogleAuth({ credentials: serviceAccount, scopes: ['https://www.googleapis.com/auth/firebase.messaging'] });
  const token = getAccessToken ?? (async () => (await auth.getAccessToken()) ?? '');
  const url = `https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`;

  return {
    /** @returns {Promise<{ok: true} | {ok: false, invalidToken: boolean, status: number, reason: string}>} */
    async send(pushToken, { title, body, data }) {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${await token()}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          message: {
            token: pushToken,
            notification: { title, body },
            data: stringifyData(data),
            android: { priority: 'HIGH', notification: { channel_id: 'alerts' } },
            apns: { headers: { 'apns-priority': '10' }, payload: { aps: { sound: 'default' } } },
          },
        }),
      });
      if (res.ok) return { ok: true };
      const payload = await res.json().catch(() => ({}));
      const detail = payload?.error?.details?.find?.((d) => d.errorCode)?.errorCode ?? payload?.error?.status ?? '';
      // The token itself is never included in logs or results.
      return { ok: false, invalidToken: res.status === 404 || INVALID_TOKEN_CODES.has(detail), status: res.status, reason: String(detail || res.status) };
    },
  };
}

/** The sender configured by the environment, or null when push is not set up (notifications are then only stored). */
export function fcmSenderFromEnv(env = process.env) {
  const serviceAccount = parseServiceAccount(env.FCM_SERVICE_ACCOUNT_JSON);
  return serviceAccount ? createFcmSender({ serviceAccount }) : null;
}
