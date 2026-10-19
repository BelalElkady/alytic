import { DEFAULT_TENANT, tenantOf } from "@/lib/tenant";

// Every absolute URL and brand word in a page's <head> is the site being
// served: each white-label client has its own domain and name. Route head()
// functions pass their `match` so these can read the tenant the root route
// put in the route context (see lib/tenant.ts).
type Match = Parameters<typeof tenantOf>[0];

export const siteUrl = (match: Match) => tenantOf(match).siteUrl.replace(/\/+$/, "");

export const siteName = (match: Match) => tenantOf(match).name;

// The site logo, for white-label sites that haven't got a share image.
export function ogLogoUrl(match: Match) {
  const { brand } = tenantOf(match);
  const logo = brand.logoUrl ?? brand.faviconUrl ?? "/favicon.svg";
  return logo.startsWith("/") ? `${siteUrl(match)}${logo}` : logo;
}

// Default og:image / twitter:image for pages without a more specific one (a
// blog post's cover photo, say). Our own site has a 1200x630 card, which
// Facebook, X and WhatsApp crop properly; a client site falls back to its logo.
export const OG_DEFAULT_IMAGE = "/og-default.png";

export function ogImageUrl(match: Match) {
  return tenantOf(match).id === DEFAULT_TENANT.id
    ? `${siteUrl(match)}${OG_DEFAULT_IMAGE}`
    : ogLogoUrl(match);
}

// One canonical URL per public page, always on the bare domain, so the www
// host and any tracking query strings don't read as duplicates.
// Set per route, never in __root.tsx: head links aren't de-duplicated, so a
// root canonical would sit alongside every page's own.
export const canonical = (match: Match, path: string) => ({
  rel: "canonical",
  href: `${siteUrl(match)}${path}`,
});
