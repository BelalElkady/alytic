import { createServerFn } from "@tanstack/react-start";

import { backendFetch, incomingHost } from "@/lib/backend";
import { DEFAULT_TENANT, type Tenant } from "@/lib/tenant";

const CACHE_MS = 60_000;
const cache = new Map<string, { tenant: Tenant; at: number }>();

/**
 * The tenant for the current request's host, asked of the backend and kept
 * for a minute per host. A failed lookup is not cached. It falls back to a
 * plain site named after the host rather than to the main brand, so a
 * client's visitors never see another company's name during an outage.
 */
export const getTenant = createServerFn({ method: "GET" }).handler(async (): Promise<Tenant> => {
  const host = ((await incomingHost()) ?? "").toLowerCase();
  const cached = cache.get(host);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.tenant;
  try {
    const res = await backendFetch("/api/tenant");
    if (res.ok) {
      const tenant = (await res.json()) as Tenant;
      cache.set(host, { tenant, at: Date.now() });
      return tenant;
    }
  } catch {
    // Fall through to the neutral fallback below.
  }
  const bare = host.replace(/:\d+$/, "").replace(/^www\./, "");
  if (!bare || bare === "localhost" || bare === new URL(DEFAULT_TENANT.siteUrl).host)
    return DEFAULT_TENANT;
  return {
    id: "unknown",
    name: bare,
    siteUrl: `https://${bare}`,
    brand: { name: bare, faviconUrl: null, colors: {}, analytics: {} },
    features: {},
  };
});
