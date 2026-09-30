import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sanitizeProps, track } from "./analytics";
import { cacheGet, cacheSet, clearOfflineCache } from "./offline-cache";
import { stockShareUrl, shareStock } from "./share";
import { nativeCorsHeaders, nativePreflight, withNativeCors } from "../lib/native-cors";

describe("analytics", () => {
  it("drops credential-looking properties", () => {
    expect(sanitizeProps({ item_id: "SWDY", password: "x", authToken: "y", session_id: "z", n: 2, nested: {} })).toEqual({
      item_id: "SWDY",
      n: 2,
    });
  });

  it("forwards to gtag on the web and never throws", () => {
    const gtag = vi.fn();
    (window as unknown as { gtag: unknown }).gtag = gtag;
    track("stock_view", { item_id: "SWDY", token: "secret" });
    expect(gtag).toHaveBeenCalledWith("event", "stock_view", { item_id: "SWDY" });
    (window as unknown as { gtag: unknown }).gtag = () => {
      throw new Error("boom");
    };
    expect(() => track("app_open")).not.toThrow();
    delete (window as unknown as { gtag?: unknown }).gtag;
  });
});

describe("offline cache", () => {
  beforeEach(() => localStorage.clear());

  it("stores with a timestamp, honours max age, and clears only its own keys", async () => {
    localStorage.setItem("unrelated", "keep");
    await cacheSet("watchlist", ["SWDY"], 1_000);
    expect(await cacheGet<string[]>("watchlist", Infinity, 2_000)).toEqual({ savedAt: 1_000, data: ["SWDY"] });
    expect(await cacheGet("watchlist", 500, 2_000)).toBeNull();
    await clearOfflineCache();
    expect(await cacheGet("watchlist")).toBeNull();
    expect(localStorage.getItem("unrelated")).toBe("keep");
  });
});

describe("share", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("builds a normal website URL that the app claims as a universal/app link", () => {
    expect(stockShareUrl("swdy")).toBe("https://egxpert.com/stocks/SWDY");
  });

  it("uses the Web Share API in a browser, treats cancel as not an error, and falls back to the clipboard", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { share });
    expect(await shareStock("SWDY", "السويدي")).toBe("shared");
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ url: "https://egxpert.com/stocks/SWDY" }));

    share.mockRejectedValueOnce(Object.assign(new Error("Share canceled"), { name: "AbortError" }));
    expect(await shareStock("SWDY")).toBe("cancelled");

    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    expect(await shareStock("SWDY")).toBe("copied");
    expect(writeText).toHaveBeenCalledWith("https://egxpert.com/stocks/SWDY");
  });
});

describe("native CORS", () => {
  const req = (origin?: string, method = "GET") =>
    new Request("https://egxpert.com/api/public/api/portfolio", { method, ...(origin ? { headers: { origin } } : {}) });

  it("answers the app origins only, without credentials", () => {
    const headers = nativeCorsHeaders(req("capacitor://localhost"), {})!;
    expect(headers.get("access-control-allow-origin")).toBe("capacitor://localhost");
    expect(headers.get("access-control-allow-credentials")).toBeNull();
    expect(headers.get("access-control-allow-headers")).toContain("authorization");
    expect(nativeCorsHeaders(req("https://evil.example"), {})).toBeNull();
    expect(nativeCorsHeaders(req(), {})).toBeNull();
  });

  it("preflights for the app and ignores everyone else", async () => {
    expect(nativePreflight(req("https://localhost", "OPTIONS"), {})?.status).toBe(204);
    expect(nativePreflight(req("https://evil.example", "OPTIONS"), {})).toBeNull();
  });

  it("decorates a proxied response for the app, and leaves other callers' responses alone", async () => {
    const upstream = () => new Response('{"ok":true}', { status: 200, headers: { "content-type": "application/json" } });
    const decorated = withNativeCors(req("https://localhost"), upstream(), {});
    expect(decorated.headers.get("access-control-allow-origin")).toBe("https://localhost");
    expect(await decorated.json()).toEqual({ ok: true });
    expect(withNativeCors(req("https://evil.example"), upstream(), {}).headers.get("access-control-allow-origin")).toBeNull();
  });

  it("honours MOBILE_ORIGINS", () => {
    expect(nativeCorsHeaders(req("app://x"), { MOBILE_ORIGINS: "app://x" })).not.toBeNull();
    expect(nativeCorsHeaders(req("capacitor://localhost"), { MOBILE_ORIGINS: "app://x" })).toBeNull();
  });
});
