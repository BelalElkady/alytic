/**
 * Thin client over the existing Alytic Express API.
 * Endpoints, payloads and cookie-session auth are unchanged — this only
 * wraps fetch with JSON handling and Arabic error messages.
 */
const RAW_BASE = (import.meta.env["VITE_API_BASE_URL"] as string | undefined) ?? "/api/public";
export const API_BASE = RAW_BASE.replace(/\/$/, "");

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T = any>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      credentials: "include",
      ...init,
    });
  } catch {
    throw new ApiError("تعذر الوصول إلى الخادم. تأكد أن الخدمة شغّالة.", 0);
  }
  const text = await response.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    throw new ApiError(data?.error ?? `فشل الطلب (${response.status})`, response.status);
  }
  return data as T;
}

export const api = <T = any,>(path: string, init?: RequestInit) => request<T>(path, init);

export const post = <T = any,>(path: string, body?: unknown) =>
  request<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });

export const postForm = <T = any,>(path: string, form: FormData) =>
  request<T>(path, { method: "POST", body: form });

export const postRaw = <T = any,>(path: string, body: BodyInit, contentType: string) =>
  request<T>(path, { method: "POST", headers: { "Content-Type": contentType }, body });
