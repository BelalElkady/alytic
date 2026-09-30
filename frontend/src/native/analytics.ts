import { isNative } from "./platform";

/**
 * Product events (app_open, login, stock_view, ...). The website already loads
 * Google Analytics through the root route, so on the web this forwards to
 * gtag when it exists. The native apps ship with no third-party analytics SDK
 * and no advertising identifiers, so native events are not sent anywhere
 * unless a first-party collector is added later (see docs/mobile-privacy.md).
 *
 * Properties are filtered so credentials can never be attached by accident.
 */
export type AnalyticsEvent =
  | "app_open"
  | "login"
  | "signup"
  | "stock_view"
  | "stock_added_watchlist"
  | "portfolio_view"
  | "notification_open"
  | "notification_permission"
  | "ai_analysis_started"
  | "ai_analysis_completed"
  | "subscription_started"
  | "share";

const FORBIDDEN = /pass|token|secret|key|authorization|cookie|session/i;

export function sanitizeProps(props: Record<string, unknown> = {}): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [name, value] of Object.entries(props)) {
    if (FORBIDDEN.test(name)) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") out[name] = value;
  }
  return out;
}

type Gtag = (command: "event", name: string, params: Record<string, unknown>) => void;

export function track(event: AnalyticsEvent, props: Record<string, unknown> = {}): void {
  if (isNative() || typeof window === "undefined") return;
  const gtag = (window as unknown as { gtag?: Gtag }).gtag;
  try {
    gtag?.("event", event, sanitizeProps(props));
  } catch {
    // Analytics must never break the app.
  }
}
