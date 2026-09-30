/**
 * Thin client over the existing Alytic Express API.
 * Endpoints, payloads and cookie-session auth are unchanged — this only
 * wraps fetch with JSON handling and Arabic error messages.
 */
// Callers get back whatever shape their endpoint returns and access fields
// directly, so the generic default here is intentionally `any`, not a gap.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { nativeApiBase } from "../native/config";
import { isNative } from "../native/platform";
import { clearSessionToken, getSessionToken } from "../native/secure-session";
import { emitSessionExpired } from "../native/session-events";

// A browser talks to the same-origin /api/public proxy (cookie session). A
// native app has no origin, so it calls the absolute URL of that same proxy
// and authenticates with a bearer token from secure storage instead.
const RAW_BASE = isNative()
  ? nativeApiBase()
  : ((import.meta.env["VITE_API_BASE_URL"] as string | undefined) ?? "/api/public");
export const API_BASE = RAW_BASE.replace(/\/$/, "");

/** Auth endpoints answer 401 for "wrong password", which is not an expired session. */
const isAuthRoute = (path: string) => path.startsWith("/api/auth/");

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

// The Lovable editor loads the app inside a cross-site iframe, so the API
// proxy needs to know when to reissue cookies as SameSite=None for it (see
// api/public/$.ts). lovable.js — present only inside that editor preview —
// sets this before the app's own scripts run, so it's a reliable signal.
function isLovablePreview() {
  return typeof window !== "undefined" && Boolean(window.__lovableEvents);
}

async function request<T = any>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  const native = isNative();
  const token = native ? getSessionToken() : null;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      // Cross-origin native calls never carry cookies; the bearer token is the session.
      credentials: native ? "omit" : "include",
      ...init,
      headers: {
        ...(isLovablePreview() ? { "x-lovable-preview": "1" } : {}),
        ...(native ? { "x-egxpert-client": "mobile" } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiError(
      native && typeof navigator !== "undefined" && navigator.onLine === false
        ? "أنت غير متصل بالإنترنت. اتأكد من الاتصال وجرّب تاني."
        : "تعذر الوصول إلى الخادم. تأكد أن الخدمة شغّالة.",
      0,
    );
  }
  const text = await response.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    // A stored token the server no longer accepts (expired, or the password was changed elsewhere).
    if (native && response.status === 401 && token && !isAuthRoute(path)) {
      await clearSessionToken();
      emitSessionExpired();
    }
    throw new ApiError(data?.error ?? `فشل الطلب (${response.status})`, response.status);
  }
  return data as T;
}

export const api = <T = any>(path: string, init?: RequestInit) => request<T>(path, init);

export const post = <T = any>(path: string, body?: unknown) =>
  request<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });

export const postForm = <T = any>(path: string, form: FormData) =>
  request<T>(path, { method: "POST", body: form });

export const postRaw = <T = any>(path: string, body: BodyInit, contentType: string) =>
  request<T>(path, { method: "POST", headers: { "Content-Type": contentType }, body });

export const patch = <T = any>(path: string, body?: unknown) =>
  request<T>(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });

export const del = <T = any>(path: string) => request<T>(path, { method: "DELETE" });
