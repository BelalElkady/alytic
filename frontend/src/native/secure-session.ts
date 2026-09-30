import { isNative } from "./platform";

/**
 * The mobile session token, kept in the platform's secure store (iOS Keychain,
 * Android Keystore-backed encrypted preferences) — never in localStorage, which
 * any script in the WebView can read and which is included in device backups.
 *
 * The website keeps using its HttpOnly cookie; it never sees a token, so on the
 * web this module is inert.
 */
const KEY = "egxpert.session-token";

let cached: string | null = null;
let loaded = false;

async function store() {
  const { SecureStorage } = await import("@aparajita/capacitor-secure-storage");
  // Keep the token out of iCloud/Android backups and only readable once the device has been unlocked.
  await SecureStorage.setSynchronize(false);
  return SecureStorage;
}

/** Reads the stored token into memory. Call once at start-up, before the first API request. */
export async function loadSessionToken(): Promise<string | null> {
  if (!isNative()) return null;
  if (loaded) return cached;
  try {
    const secure = await store();
    const value = await secure.get(KEY);
    cached = typeof value === "string" && value ? value : null;
  } catch {
    cached = null;
  }
  loaded = true;
  return cached;
}

/** The token held in memory (synchronous so api.ts can attach it to every request). */
export const getSessionToken = (): string | null => cached;

export async function saveSessionToken(token: string): Promise<void> {
  cached = token;
  loaded = true;
  if (!isNative()) return;
  const secure = await store();
  await secure.set(KEY, token);
}

export async function clearSessionToken(): Promise<void> {
  cached = null;
  loaded = true;
  if (!isNative()) return;
  try {
    const secure = await store();
    await secure.remove(KEY);
  } catch {
    // Nothing stored, or the keystore is unavailable: either way there is nothing left to leak.
  }
}

/** Test hook. */
export function resetSessionCacheForTests() {
  cached = null;
  loaded = false;
}
