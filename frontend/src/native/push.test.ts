import { beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (event: never) => void;
const handlers = new Map<string, Handler>();
const messaging = {
  checkPermissions: vi.fn(),
  requestPermissions: vi.fn(),
  getToken: vi.fn(),
  deleteToken: vi.fn(async () => {}),
  addListener: vi.fn(async (name: string, handler: Handler) => {
    handlers.set(name, handler);
    return { remove: async () => {} };
  }),
};
const prefs = new Map<string, string>();
const apiPost = vi.fn(async () => ({ ok: true }));
const apiDel = vi.fn(async () => ({ ok: true }));

vi.mock("@capacitor-firebase/messaging", () => ({ FirebaseMessaging: messaging }));
vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    get: async ({ key }: { key: string }) => ({ value: prefs.get(key) ?? null }),
    set: async ({ key, value }: { key: string; value: string }) => void prefs.set(key, value),
  },
}));
vi.mock("@capacitor/device", () => ({ Device: { getInfo: async () => ({ osVersion: "18.1" }) } }));
vi.mock("./platform", () => ({ isNative: () => true, nativePlatform: () => "ios" }));
vi.mock("../lib/api", () => ({ post: apiPost, del: apiDel }));

const TOKEN = "fcm-token-".padEnd(40, "x");

beforeEach(() => {
  vi.resetModules();
  handlers.clear();
  prefs.clear();
  vi.clearAllMocks();
});

describe("push notifications", () => {
  it("does not prompt by itself: permission is requested only by enablePush", async () => {
    messaging.checkPermissions.mockResolvedValue({ receive: "prompt" });
    const push = await import("./push");
    expect(await push.getPushPermission()).toBe("prompt");
    expect(messaging.requestPermissions).not.toHaveBeenCalled();
  });

  it("enablePush: asks the OS, then registers the token with device details", async () => {
    messaging.requestPermissions.mockResolvedValue({ receive: "granted" });
    messaging.getToken.mockResolvedValue({ token: TOKEN });
    const push = await import("./push");

    expect(await push.enablePush()).toBe("granted");
    expect(apiPost).toHaveBeenCalledWith(
      "/api/mobile/devices",
      expect.objectContaining({ platform: "ios", pushToken: TOKEN, osVersion: "18.1", enabled: true, deviceId: expect.any(String) }),
    );
  });

  it("enablePush: a denial registers nothing", async () => {
    messaging.requestPermissions.mockResolvedValue({ receive: "denied" });
    const push = await import("./push");
    expect(await push.enablePush()).toBe("denied");
    expect(apiPost).not.toHaveBeenCalled();
  });

  it("keeps one stable device id across launches", async () => {
    const push = await import("./push");
    const first = await push.getDeviceId();
    expect(await push.getDeviceId()).toBe(first);
  });

  it("re-registers when FCM rotates the token", async () => {
    messaging.checkPermissions.mockResolvedValue({ receive: "granted" });
    messaging.getToken.mockResolvedValue({ token: TOKEN });
    const push = await import("./push");
    await push.initPush({ navigate: vi.fn() });
    apiPost.mockClear();

    handlers.get("tokenReceived")!({ token: "rotated-".padEnd(40, "y") } as never);
    await vi.waitFor(() => expect(apiPost).toHaveBeenCalledWith("/api/mobile/devices", expect.objectContaining({ pushToken: expect.stringContaining("rotated-") })));
  });

  it("tapping a notification opens its deep link and marks it read", async () => {
    messaging.checkPermissions.mockResolvedValue({ receive: "prompt" });
    const navigate = vi.fn();
    const push = await import("./push");
    await push.initPush({ navigate });

    handlers.get("notificationActionPerformed")!({
      notification: { data: { type: "stock_target_reached", code: "SWDY", path: "/stock/SWDY", notificationId: "n1" } },
    } as never);
    expect(navigate).toHaveBeenCalledWith({ to: "/stock/SWDY" });
    expect(apiPost).toHaveBeenCalledWith("/api/notifications/n1/read");
  });

  it("a notification with an unsafe or unknown path opens nothing", async () => {
    const push = await import("./push");
    expect(push.targetForNotification({ path: "https://evil.example/x" })).toBeNull();
    expect(push.targetForNotification({ path: "/admin" })).toBeNull();
    expect(push.targetForNotification({ code: "SWDY" })).toEqual({ to: "/stock/SWDY" });
    expect(push.targetForNotification(null)).toBeNull();
  });

  it("shows foreground notifications through the callback", async () => {
    messaging.checkPermissions.mockResolvedValue({ receive: "prompt" });
    const onForeground = vi.fn();
    const push = await import("./push");
    await push.initPush({ navigate: vi.fn(), onForeground });
    handlers.get("notificationReceived")!({ notification: { title: "t", body: "b", data: { path: "/portfolio" } } } as never);
    expect(onForeground).toHaveBeenCalledWith({ title: "t", body: "b", target: { to: "/portfolio" } });
  });

  it("sign-out deregisters this device and deletes the FCM token", async () => {
    const push = await import("./push");
    const id = await push.getDeviceId();
    await push.unregisterPushDevice();
    expect(apiDel).toHaveBeenCalledWith(`/api/mobile/devices/${id}`);
    expect(messaging.deleteToken).toHaveBeenCalled();
  });
});
