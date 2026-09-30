import { post, del } from "../lib/api";
import { APP_VERSION } from "./config";
import { resolveDeepLink } from "./deep-links";
import { track } from "./analytics";
import { isNative, nativePlatform } from "./platform";

/**
 * Push notifications.
 *
 * The app only ever holds a device token (an opaque FCM registration token —
 * on iOS FCM hands the message to APNs). It is registered with the EGXpert
 * backend, which is the only party that can send: the FCM service credentials
 * never leave the server. See docs/push-notifications.md.
 */
export type PushPermission = "granted" | "denied" | "prompt" | "unsupported";

const DEVICE_ID_KEY = "egxpert.device-id";
const SOFT_PROMPT_KEY = "egxpert.push-soft-prompt";

async function messaging() {
  const { FirebaseMessaging } = await import("@capacitor-firebase/messaging");
  return FirebaseMessaging;
}

/** A random id generated on first launch. Deliberately not a hardware or advertising identifier. */
export async function getDeviceId(): Promise<string> {
  const { Preferences } = await import("@capacitor/preferences");
  const existing = (await Preferences.get({ key: DEVICE_ID_KEY })).value;
  if (existing) return existing;
  const fresh = crypto.randomUUID();
  await Preferences.set({ key: DEVICE_ID_KEY, value: fresh });
  return fresh;
}

export async function getPushPermission(): Promise<PushPermission> {
  if (!isNative()) return "unsupported";
  try {
    const { receive } = await (await messaging()).checkPermissions();
    return receive === "granted" ? "granted" : receive === "denied" ? "denied" : "prompt";
  } catch {
    return "unsupported";
  }
}

/** Sends this device's token to the backend (create or refresh; one row per user+device). */
export async function registerToken(token: string): Promise<void> {
  const { Device } = await import("@capacitor/device");
  const info = await Device.getInfo();
  await post("/api/mobile/devices", {
    deviceId: await getDeviceId(),
    platform: nativePlatform(),
    pushToken: token,
    appVersion: APP_VERSION,
    osVersion: info.osVersion,
    enabled: true,
  });
}

/**
 * Asks the OS for permission (the system dialog) and, if granted, registers the
 * token. Call this from a user action — e.g. a "turn on price alerts" button —
 * not at launch: a cold prompt is usually refused and can never be asked again.
 */
export async function enablePush(): Promise<PushPermission> {
  if (!isNative()) return "unsupported";
  const plugin = await messaging();
  const { receive } = await plugin.requestPermissions();
  track("notification_permission", { result: receive });
  if (receive !== "granted") return receive === "denied" ? "denied" : "prompt";
  const { token } = await plugin.getToken();
  await registerToken(token);
  return "granted";
}

/** Stops alerts to this device and forgets the token (sign-out, or turning alerts off). */
export async function unregisterPushDevice(): Promise<void> {
  if (!isNative()) return;
  try {
    await del(`/api/mobile/devices/${encodeURIComponent(await getDeviceId())}`);
  } catch {
    // Already signed out or offline: the server also drops tokens FCM reports as dead.
  }
  try {
    await (await messaging()).deleteToken();
  } catch {
    // No token yet.
  }
}

export type PushNavigate = (target: { to: string; search?: Record<string, string> }) => void;

/** Where a tapped notification should open, from its data payload. Unknown payloads open nothing. */
export function targetForNotification(data: unknown): { to: string; search?: Record<string, string> } | null {
  if (!data || typeof data !== "object") return null;
  const payload = data as Record<string, unknown>;
  const fromPath = resolveDeepLink(typeof payload["path"] === "string" ? payload["path"] : null);
  if (fromPath) return fromPath;
  const code = typeof payload["code"] === "string" ? payload["code"] : null;
  if (code) return resolveDeepLink(`/stock/${code}`);
  return null;
}

let initialised = false;

/**
 * Wires the listeners. Runs once per app launch after sign-in: keeps the
 * backend's token fresh (FCM rotates tokens), opens the right screen when a
 * notification is tapped, and shows notifications that arrive while the app is
 * open through `onForeground` (the OS does not display those itself).
 */
export async function initPush(options: {
  navigate: PushNavigate;
  onForeground?: (n: { title?: string | undefined; body?: string | undefined; target: ReturnType<typeof targetForNotification> }) => void;
}): Promise<void> {
  if (!isNative() || initialised) return;
  initialised = true;
  const plugin = await messaging();

  await plugin.addListener("tokenReceived", ({ token }) => {
    void getPushPermission().then((permission) => {
      if (permission === "granted") void registerToken(token).catch(() => {});
    });
  });

  await plugin.addListener("notificationActionPerformed", ({ notification }) => {
    const target = targetForNotification(notification.data);
    track("notification_open", {
      type: String((notification.data as Record<string, unknown> | undefined)?.["type"] ?? "unknown"),
    });
    const id = (notification.data as Record<string, unknown> | undefined)?.["notificationId"];
    if (typeof id === "string") void post(`/api/notifications/${encodeURIComponent(id)}/read`).catch(() => {});
    if (target) options.navigate(target);
  });

  await plugin.addListener("notificationReceived", ({ notification }) => {
    options.onForeground?.({
      title: notification.title,
      body: notification.body,
      target: targetForNotification(notification.data),
    });
  });

  // Returning user who already allowed alerts: refresh the registration (last_seen) quietly.
  if ((await getPushPermission()) === "granted") {
    try {
      await registerToken((await plugin.getToken()).token);
    } catch {
      // Offline at launch; tokenReceived / the next launch will retry.
    }
  }
}

/** The one-time in-app explanation shown before the system dialog. */
export function shouldShowSoftPrompt(): boolean {
  try {
    return localStorage.getItem(SOFT_PROMPT_KEY) === null;
  } catch {
    return false;
  }
}

export function dismissSoftPrompt(): void {
  try {
    localStorage.setItem(SOFT_PROMPT_KEY, String(Date.now()));
  } catch {
    // ignore
  }
}
