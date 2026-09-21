import { tenantOf } from "@/lib/tenant";

// Every absolute URL and brand word in a page's <head> is the site being
// served: each white-label client has its own domain and name. Route head()
// functions pass their `matches` so these can read the tenant the root route
// loaded (see lib/tenant.ts).
type Matches = Parameters<typeof tenantOf>[0];

export const siteUrl = (matches: Matches) => tenantOf(matches).siteUrl.replace(/\/+$/, "");

export const siteName = (matches: Matches) => tenantOf(matches).name;

// Used as the default og:image (the site logo) for pages that don't have a
// more specific image of their own (e.g. a blog post's cover photo).
export function ogLogoUrl(matches: Matches) {
  const { brand } = tenantOf(matches);
  const logo = brand.logoUrl ?? brand.faviconUrl ?? "/favicon.svg";
  return logo.startsWith("/") ? `${siteUrl(matches)}${logo}` : logo;
}

// One canonical URL per public page, always on the bare domain, so the www
// host and any tracking query strings don't read as duplicates.
// Set per route, never in __root.tsx: head links aren't de-duplicated, so a
// root canonical would sit alongside every page's own.
export const canonical = (matches: Matches, path: string) => ({
  rel: "canonical",
  href: `${siteUrl(matches)}${path}`,
});
