import { createFileRoute } from "@tanstack/react-router";

import { backendFetch } from "@/lib/backend";
import { DEFAULT_TENANT, type Tenant } from "@/lib/tenant";

// Public sitemap for search engines. Built fresh on every request from the
// backend's published blog posts (see /api/public/$.ts for the same
// backend-forwarding pattern) instead of a cron-written static file: every
// push to main rebuilds frontend/.output from scratch and redeploys it (see
// .github/workflows/deploy.yml), which would wipe any file written to disk at
// runtime. Generating it on request means it can never go stale either way.
// Each white-label site gets its own: its own domain and its own posts, both
// from the backend for the host this request came in on.

// Mirrors the public marketing nav and footer in
// components/marketing/site-shell.tsx — update both if a marketing page is
// added or removed. The authenticated app routes (/portfolio, /cash, /admin,
// ...) are deliberately absent: a search engine can't sign in to see them.
const STATIC_PATHS = ["/", "/blog", "/how-to-use", "/pricing", "/free-tools", "/about", "/contact", "/privacy"];

function escapeXml(value: string): string {
  const map: Record<string, string> = {
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    "'": "&apos;",
    '"': "&quot;",
  };
  return value.replace(/[<>&'"]/g, (c) => map[c]!);
}

async function fetchSiteUrl(): Promise<string> {
  try {
    const res = await backendFetch("/api/tenant");
    if (res.ok) return ((await res.json()) as Tenant).siteUrl.replace(/\/+$/, "");
  } catch {
    // Fall through.
  }
  return DEFAULT_TENANT.siteUrl;
}

async function fetchBlogUrls(): Promise<{ slug: string; publishedAt: string }[]> {
  try {
    const res = await backendFetch("/api/sitemap-urls");
    if (!res.ok) return [];
    const data = (await res.json()) as { posts?: { slug: string; publishedAt: string }[] };
    return data.posts ?? [];
  } catch {
    // Backend unreachable — still serve the static pages below rather than a
    // 502; the next request tries the blog posts again.
    return [];
  }
}

async function buildSitemap(): Promise<string> {
  const [siteUrl, posts] = await Promise.all([fetchSiteUrl(), fetchBlogUrls()]);

  const entries = [
    ...STATIC_PATHS.map(
      (path) => `  <url>\n    <loc>${escapeXml(`${siteUrl}${path}`)}</loc>\n  </url>`,
    ),
    ...posts.map((p) => {
      const lastmod = new Date(p.publishedAt).toISOString().slice(0, 10);
      return `  <url>\n    <loc>${escapeXml(`${siteUrl}/blog/${p.slug}`)}</loc>\n    <lastmod>${lastmod}</lastmod>\n  </url>`;
    }),
  ];

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join("\n")}\n</urlset>\n`;
}

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const xml = await buildSitemap();
        return new Response(xml, {
          headers: {
            "Content-Type": "application/xml; charset=utf-8",
            // An hour-old copy can miss a post published in the meantime;
            // posts are rare, so that is fine.
            "Cache-Control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
