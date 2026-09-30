import { LINK_HOSTS, URL_SCHEME } from "./config";

export type DeepLinkTarget = { to: string; params?: Record<string, string> };

const STOCK_CODE = /^[A-Za-z0-9.\-]{1,12}$/;

/**
 * Maps a URL that opened the app (a universal/app link, an egxpert:// link or
 * a push payload's path) onto a route that exists in this app. Anything that is
 * not on the allow-list returns null, so a crafted link can never navigate the
 * WebView somewhere unexpected.
 *
 * Public web URLs differ slightly from the app's routes (the site links
 * /stocks/SWDY and /alerts; the app's routes are /stock/$code and /targets),
 * so the aliases live here, in one table.
 */
const STATIC: Record<string, string> = {
  "": "/portfolio",
  portfolio: "/portfolio",
  positions: "/portfolio",
  alerts: "/targets",
  targets: "/targets",
  market: "/market",
  indices: "/indices",
  calendar: "/calendar",
  charts: "/charts",
  cash: "/cash",
  settings: "/settings",
  profile: "/settings",
  subscribe: "/subscribe",
  "reset-password": "/reset-password",
  "verify-email": "/verify-email",
  "track-record": "/track-record",
};

export function resolveDeepLink(raw: string | null | undefined): { to: string; search?: Record<string, string> } | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    // A push payload may carry just a path.
    if (!raw.startsWith("/") || raw.startsWith("//")) return null;
    url = new URL(raw, "https://placeholder.invalid");
    return resolvePath(url.pathname, url.searchParams);
  }

  if (url.protocol === "https:") {
    if (!LINK_HOSTS.includes(url.host.toLowerCase())) return null;
    return resolvePath(url.pathname, url.searchParams);
  }
  if (url.protocol === `${URL_SCHEME}:`) {
    // egxpert://stock/SWDY parses with host "stock"; egxpert:///stock/SWDY with an empty host.
    return resolvePath(`/${url.host}${url.pathname}`.replace(/\/{2,}/g, "/"), url.searchParams);
  }
  return null;
}

function resolvePath(pathname: string, query: URLSearchParams) {
  const parts = pathname.split("/").filter(Boolean);
  const [first = "", second] = parts;
  const head = first.toLowerCase();

  if ((head === "stock" || head === "stocks") && second && parts.length === 2) {
    if (!STOCK_CODE.test(second)) return null;
    return { to: `/stock/${second.toUpperCase()}` };
  }
  if (parts.length <= 1 && head in STATIC) {
    const to = STATIC[head]!;
    // Email links carry a one-time token the target screen needs.
    const token = query.get("token");
    return token && /^[A-Za-z0-9_-]{8,256}$/.test(token) ? { to, search: { token } } : { to };
  }
  return null;
}
