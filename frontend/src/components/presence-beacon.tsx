import { useEffect } from "react";

import { post } from "@/lib/api";

const PING_EVERY_MS = 60_000;
const STORAGE_KEY = "egx-visitor-id";

/** One id per browser, so several tabs count once. Falls back to a per-page id when storage is blocked. */
function visitorId(): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return saved;
    const fresh = crypto.randomUUID();
    localStorage.setItem(STORAGE_KEY, fresh);
    return fresh;
  } catch {
    return crypto.randomUUID();
  }
}

/**
 * Tells the server this browser is on the site, which is all the admin
 * panel's "online now" is built from. Pings only while the tab is visible, so
 * a forgotten background tab stops counting after a few minutes. Renders
 * nothing and swallows every failure — presence must never surface an error.
 */
export function PresenceBeacon() {
  useEffect(() => {
    const vid = visitorId();
    const ping = () => {
      if (document.visibilityState !== "visible") return;
      post("/api/presence", { vid }).catch(() => {});
    };
    ping();
    const timer = window.setInterval(ping, PING_EVERY_MS);
    document.addEventListener("visibilitychange", ping);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", ping);
    };
  }, []);
  return null;
}
