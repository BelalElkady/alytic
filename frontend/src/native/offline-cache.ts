import { isNative } from "./platform";

/**
 * A small cache for information that is safe to keep on the device: the stock
 * list, the last stock viewed, a watchlist snapshot, UI preferences. It never
 * holds credentials, portfolio values, or anything from another account — the
 * whole cache is wiped on sign-out (see clearOfflineCache).
 *
 * Entries carry the time they were saved so the UI can say "as of 14:32"
 * instead of passing a cached price off as a live one.
 */
const PREFIX = "egxpert.cache.";

export type Cached<T> = { savedAt: number; data: T };

async function backend() {
  if (isNative()) {
    const { Preferences } = await import("@capacitor/preferences");
    return {
      get: async (key: string) => (await Preferences.get({ key })).value,
      set: async (key: string, value: string) => void (await Preferences.set({ key, value })),
      remove: async (key: string) => void (await Preferences.remove({ key })),
      keys: async () => (await Preferences.keys()).keys,
    };
  }
  return {
    get: async (key: string) => localStorage.getItem(key),
    set: async (key: string, value: string) => localStorage.setItem(key, value),
    remove: async (key: string) => localStorage.removeItem(key),
    keys: async () => Object.keys(localStorage),
  };
}

export async function cacheSet<T>(name: string, data: T, now = Date.now()): Promise<void> {
  try {
    await (await backend()).set(PREFIX + name, JSON.stringify({ savedAt: now, data } satisfies Cached<T>));
  } catch {
    // Storage full or blocked — caching is best effort.
  }
}

export async function cacheGet<T>(name: string, maxAgeMs = Infinity, now = Date.now()): Promise<Cached<T> | null> {
  try {
    const raw = await (await backend()).get(PREFIX + name);
    if (!raw) return null;
    const entry = JSON.parse(raw) as Cached<T>;
    if (typeof entry?.savedAt !== "number" || now - entry.savedAt > maxAgeMs) return null;
    return entry;
  } catch {
    return null;
  }
}

export async function clearOfflineCache(): Promise<void> {
  try {
    const store = await backend();
    for (const key of await store.keys()) if (key.startsWith(PREFIX)) await store.remove(key);
  } catch {
    // ignore
  }
}

/** "آخر تحديث 14:32" for a cached entry. */
export const savedAtLabel = (savedAt: number) =>
  new Date(savedAt).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" });
