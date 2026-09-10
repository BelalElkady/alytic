import { afterEach, describe, expect, it, vi } from "vitest";

import { api, ApiError, API_BASE, post, postForm } from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("api client", () => {
  it("talks to the same-origin proxy by default", () => {
    expect(API_BASE).toBe("/api/public");
  });

  it("returns parsed JSON on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, value: 42 }));
    vi.stubGlobal("fetch", fetchMock);

    const data = await api<{ ok: boolean }>("/api/health");
    expect(data).toEqual({ ok: true, value: 42 });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/public/api/health",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("surfaces the backend's Arabic error message with its status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(401, { error: "سجّل الدخول الأول" })),
    );

    await expect(api("/api/portfolio")).rejects.toMatchObject({
      status: 401,
      message: "سجّل الدخول الأول",
    });
  });

  it("falls back to a generic message when the error body is not JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("<html>boom</html>", { status: 500 })),
    );

    await expect(api("/api/anything")).rejects.toMatchObject({
      status: 500,
      message: "فشل الطلب (500)",
    });
  });

  it("reports network failure as status 0 with its own message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("failed to fetch")));

    await expect(api("/api/anything")).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(0);
      expect((err as ApiError).message.includes("تعذر الوصول")).toBe(true);
      return true;
    });
  });

  it("empty bodies resolve to null", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    expect(await api("/api/auth/logout")).toBeNull();
  });

  it("post sends JSON with the right content type", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await post("/api/portfolio/trade", { code: "ABUK", side: "buy" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/public/api/portfolio/trade",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "ABUK", side: "buy" }),
      }),
    );
  });

  it("postForm forwards a FormData body untouched", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const form = new FormData();
    form.append("x", "1");
    await postForm("/api/portfolio/import-screenshot", form);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/public/api/portfolio/import-screenshot",
      expect.objectContaining({ method: "POST", body: form }),
    );
  });
});
