/**
 * Public, client-safe configuration for the native apps. Everything here is
 * inlined into the JavaScript that ships inside the APK / IPA and is therefore
 * readable by anyone — never put a secret behind a VITE_ variable. See
 * docs/mobile-environment.md.
 */
type AppEnv = "development" | "staging" | "production";

const env = import.meta.env as Record<string, string | undefined>;

const trimSlash = (value: string) => value.replace(/\/+$/, "");

/** The website the app belongs to: share links and deep links use this host. */
export const SITE_URL = trimSlash(env["VITE_SITE_URL"] ?? "https://egxpert.com");

export const APP_ENV: AppEnv = (["development", "staging", "production"] as const).includes(
  env["VITE_APP_ENV"] as AppEnv,
)
  ? (env["VITE_APP_ENV"] as AppEnv)
  : "production";

/** Hosts whose https links open inside the app (must match the Android/iOS link configuration). */
export const LINK_HOSTS = (env["VITE_LINK_HOSTS"] ?? new URL(SITE_URL).host)
  .split(",")
  .map((host) => host.trim().toLowerCase())
  .filter(Boolean);

/** Custom URL scheme, a fallback for places that cannot open https links (egxpert://stock/SWDY). */
export const URL_SCHEME = env["VITE_URL_SCHEME"] ?? "egxpert";

/**
 * Where a native build sends API calls. A browser uses the same-origin
 * /api/public proxy; a native app has no origin of its own, so it needs the
 * absolute URL of the same proxy. Production must be https.
 */
export function nativeApiBase(): string {
  const configured = env["VITE_API_BASE_URL"];
  const base = trimSlash(configured && /^https?:\/\//.test(configured) ? configured : `${SITE_URL}/api/public`);
  if (APP_ENV === "production" && !base.startsWith("https://")) {
    throw new Error("Production builds must use an https API base URL");
  }
  return base;
}

export const APP_VERSION = env["VITE_APP_VERSION"] ?? "0.0.0";
