import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
const secure = {
  setSynchronize: vi.fn(async () => {}),
  get: vi.fn(async (key: string) => store.get(key) ?? null),
  set: vi.fn(async (key: string, value: string) => void store.set(key, value)),
  remove: vi.fn(async (key: string) => void store.delete(key)),
};
vi.mock("@aparajita/capacitor-secure-storage", () => ({ SecureStorage: secure }));
vi.mock("./platform", () => ({ isNative: () => true, nativePlatform: () => "ios" }));

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  vi.resetModules();
  store.clear();
  localStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

async function load() {
  const secureSession = await import("./secure-session");
  const api = await import("../lib/api");
  const events = await import("./session-events");
  const session = await import("./session");
  return { ...secureSession, ...api, ...events, ...session };
}

describe("native session", () => {
  it("calls the absolute https proxy with a bearer token and no cookies", async () => {
    const m = await load();
    await m.saveSessionToken("tok123");
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await m.api("/api/portfolio");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://egxpert.com/api/public/api/portfolio");
    expect(init.credentials).toBe("omit");
    expect(init.headers.authorization).toBe("Bearer tok123");
    expect(init.headers["x-egxpert-client"]).toBe("mobile");
  });

  it("keeps the token in secure storage, never in localStorage", async () => {
    const m = await load();
    await m.persistLoginResult({ token: "tok123" });
    expect(secure.set).toHaveBeenCalledWith("egxpert.session-token", "tok123");
    expect(JSON.stringify({ ...localStorage })).not.toContain("tok123");
  });

  it("restores the session token on the next launch", async () => {
    store.set("egxpert.session-token", "persisted");
    const m = await load();
    expect(m.getSessionToken()).toBeNull();
    expect(await m.loadSessionToken()).toBe("persisted");
    expect(m.getSessionToken()).toBe("persisted");
  });

  it("an expired session clears the token and tells the UI; a wrong password does not", async () => {
    const m = await load();
    await m.saveSessionToken("old");
    const expired = vi.fn();
    m.onSessionExpired(expired);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(401, { error: "سجّل الدخول الأول" })));
    await expect(m.api("/api/portfolio")).rejects.toMatchObject({ status: 401 });
    expect(expired).toHaveBeenCalledTimes(1);
    expect(store.has("egxpert.session-token")).toBe(false);
    expect(m.getSessionToken()).toBeNull();

    await m.saveSessionToken("again");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(401, { error: "bad credentials" })));
    await expect(m.post("/api/auth/login", {})).rejects.toMatchObject({ status: 401 });
    expect(expired).toHaveBeenCalledTimes(1);
  });

  it("logout clears the stored token", async () => {
    const m = await load();
    await m.saveSessionToken("tok");
    await m.clearSessionToken();
    expect(store.has("egxpert.session-token")).toBe(false);
  });

  it("explains an offline failure instead of a generic error", async () => {
    const m = await load();
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(m.api("/api/portfolio")).rejects.toMatchObject({ status: 0, message: expect.stringContaining("غير متصل") });
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  });

  it("refreshes a stale session once and stores the new token", async () => {
    const { refreshNativeSession } = await import("./session-refresh");
    const m = await load();
    await m.saveSessionToken("old");
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, token: "fresh" }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await refreshNativeSession(10_000_000_000)).toBe(true);
    expect(store.get("egxpert.session-token")).toBe("fresh");
    expect(fetchMock.mock.calls[0]![0]).toContain("/api/auth/refresh");
    // Just refreshed: no second call.
    expect(await refreshNativeSession(10_000_000_000 + 1000)).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
