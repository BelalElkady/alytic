import { post } from "../lib/api";
import { isNative } from "./platform";
import { REFRESH_AFTER_MS, persistLoginResult } from "./session";

const STAMP_KEY = "egxpert.session-refreshed-at";

const readStamp = (): number => {
  try {
    return Number(localStorage.getItem(STAMP_KEY)) || 0;
  } catch {
    return 0;
  }
};

/**
 * Sliding session: the server issues 30-day tokens, so a user who opens the app
 * at least once a week never gets signed out, while an abandoned install expires.
 * The timestamp is not sensitive (it is not the token), so localStorage is fine.
 * A failure is ignored — the current token keeps working until it expires.
 */
export async function refreshNativeSession(now = Date.now()): Promise<boolean> {
  if (!isNative() || now - readStamp() < REFRESH_AFTER_MS) return false;
  try {
    const result = await post("/api/auth/refresh");
    await persistLoginResult(result);
    localStorage.setItem(STAMP_KEY, String(now));
    return true;
  } catch {
    return false;
  }
}
