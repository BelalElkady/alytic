// Kept in sync manually with the SITE_URL in routes/sitemap[.]xml.ts.
export const SITE_URL = "https://egxpert.com";

// Used as the default og:image (the site logo) for pages that don't have a
// more specific image of their own (e.g. a blog post's cover photo).
export const OG_LOGO_URL = `${SITE_URL}/favicon.svg`;

// One canonical URL per public page, always on the bare domain, so
// www.egxpert.com and any tracking query strings don't read as duplicates.
// Set per route, never in __root.tsx: head links aren't de-duplicated, so a
// root canonical would sit alongside every page's own.
export const canonical = (path: string) => ({ rel: "canonical", href: `${SITE_URL}${path}` });
