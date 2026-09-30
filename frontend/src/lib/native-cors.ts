/**
 * CORS for the native apps only.
 *
 * The apps load from capacitor://localhost (iOS) or https://localhost (Android)
 * and call this site's /api/public proxy cross-origin. Browsers on any other
 * site get no CORS headers at all, exactly as before. The apps use a bearer
 * token, not cookies, so `Access-Control-Allow-Credentials` is deliberately
 * never sent. Override the list with MOBILE_ORIGINS (same variable the backend
 * reads for its write guard).
 */
const DEFAULT_ORIGINS = ["capacitor://localhost", "https://localhost"];

export function nativeOrigins(env: Record<string, string | undefined> = process.env): Set<string> {
  const configured = env["MOBILE_ORIGINS"];
  return new Set(
    (configured ? configured.split(",") : DEFAULT_ORIGINS).map((o) => o.trim()).filter(Boolean),
  );
}

const ALLOWED_HEADERS = "authorization, content-type, x-egxpert-client";
const ALLOWED_METHODS = "GET, POST, PUT, PATCH, DELETE, OPTIONS";

/** Headers to add for this request, or null when the caller is not a native app. */
export function nativeCorsHeaders(request: Request, env?: Record<string, string | undefined>): Headers | null {
  const origin = request.headers.get("origin");
  if (!origin || !nativeOrigins(env).has(origin)) return null;
  const headers = new Headers();
  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-headers", ALLOWED_HEADERS);
  headers.set("access-control-allow-methods", ALLOWED_METHODS);
  headers.set("access-control-max-age", "600");
  headers.append("vary", "Origin");
  return headers;
}

/** Answers the preflight for a native app; null for any other caller. */
export function nativePreflight(request: Request, env?: Record<string, string | undefined>): Response | null {
  const headers = nativeCorsHeaders(request, env);
  return headers ? new Response(null, { status: 204, headers }) : null;
}

/** Copies the CORS headers onto a proxied response. */
export function withNativeCors(request: Request, response: Response, env?: Record<string, string | undefined>): Response {
  const cors = nativeCorsHeaders(request, env);
  if (!cors) return response;
  const headers = new Headers(response.headers);
  cors.forEach((value, key) => headers.set(key, value));
  headers.append("access-control-expose-headers", "retry-after");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
