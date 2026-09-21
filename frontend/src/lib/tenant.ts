import { useRouterState } from "@tanstack/react-router";

/**
 * Which white-label site this page is. The backend owns the list (see
 * backend/src/tenancy/registry.js). The root route's beforeLoad puts it in
 * the route context through getTenant (lib/tenant-server.ts); everything
 * else reads it from there: useTenant() in components, tenantOf(match) in a
 * route's head().
 */
export type TenantBrand = {
  name: string;
  tagline?: string;
  description?: string;
  logoUrl?: string | null;
  faviconUrl?: string | null;
  /** CSS custom properties without the leading "--", e.g. { primary: "oklch(0.5 0.2 150)" }. */
  colors?: Record<string, string>;
  darkColors?: Record<string, string>;
  analytics?: { gaId?: string; adsClient?: string };
  social?: { instagram?: string; facebook?: string; x?: string; youtube?: string; tiktok?: string };
};

export type Tenant = {
  id: string;
  name: string;
  siteUrl: string;
  brand: TenantBrand;
  contactEmail?: string | null;
  googleClientId?: string | null;
  features: { blog?: boolean };
};

/** The original site, as it was before white-labelling. Used when the backend can't be asked. */
export const DEFAULT_TENANT: Tenant = {
  id: "egxpert",
  name: "EGXpert",
  siteUrl: "https://egxpert.com",
  brand: {
    name: "EGXpert",
    tagline: "خبير البورصة المصرية",
    description:
      "مكتب تحليل وإدارة محفظة البورصة المصرية: مراكزك، وقف الخسارة، الأهداف والتوصيات اليومية.",
    logoUrl: null,
    faviconUrl: "/favicon.svg",
    colors: {},
    analytics: { gaId: "G-789W810GMB", adsClient: "ca-pub-8353018708854851" },
    social: {
      instagram: "https://www.instagram.com/egxpertapp/",
      facebook: "https://www.facebook.com/egxpertapp/",
    },
  },
  features: { blog: true },
};

type MatchLike = { context?: unknown };

/**
 * The tenant from a match's route context, which the root route's beforeLoad
 * fills and every child route inherits. For a route's head(): use its
 * `match`, not `matches` — the router hands head() the match list as it was
 * before loading started, so only `match` is guaranteed current.
 */
export function tenantOf(match: MatchLike | undefined): Tenant {
  return (match?.context as { tenant?: Tenant } | undefined)?.tenant ?? DEFAULT_TENANT;
}

/** The tenant this page belongs to, in any component under the router. */
export function useTenant(): Tenant {
  return useRouterState({ select: (state) => tenantOf(state.matches[0]) });
}

/**
 * The brand's colors as a stylesheet. Specificity is raised above
 * styles.css's own :root and .dark blocks so the brand wins regardless of
 * which comes first in <head>. Light colors apply only outside dark mode, so
 * a brand that sets only light colors still gets the stock dark theme.
 * Values are checked by the backend (see sanitizeBrand in api/platform.js);
 * the filter here is a second guard since this text lands in a <style> tag.
 */
export function brandCss(brand: TenantBrand): string {
  const safe = (colors: Record<string, string> | undefined) =>
    Object.entries(colors ?? {})
      .filter(
        ([name, value]) =>
          /^[a-z][a-z0-9-]{0,39}$/.test(name) && /^[#a-z0-9(),.%\s/-]{1,64}$/i.test(value),
      )
      .map(([name, value]) => `--${name}:${value};`)
      .join("");
  const light = safe(brand.colors);
  const dark = safe(brand.darkColors);
  return [light && `:root:root:not(.dark){${light}}`, dark && `:root:root.dark{${dark}}`]
    .filter(Boolean)
    .join("");
}

/**
 * Site copy written before white-labelling says "EGXpert" wherever it means
 * "this site". Rather than rewrite every sentence, text that may be shown on
 * a client's site goes through this at render time.
 */
export const withBrand = (text: string, name: string) => text.replace(/EGXpert/g, name);
