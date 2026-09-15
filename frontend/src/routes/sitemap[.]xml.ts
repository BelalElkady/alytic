import { createFileRoute } from "@tanstack/react-router";

// Public sitemap for search engines. Built fresh on every request from the
// backend's published blog posts (see /api/public/$.ts for the same
// backend-forwarding pattern) instead of a cron-written static file: every
// push to main rebuilds frontend/.output from scratch and redeploys it (see
// .github/workflows/deploy.yml), which would wipe any file written to disk at
// runtime. Generating it on request means it can never go stale either way.
const SITE_URL = "https://egxpert.com";

// Mirrors the public marketing nav and footer in
// components/marketing/site-shell.tsx — update both if a marketing page is
// added or removed. The authenticated app routes (/portfolio, /cash, /admin,
// ...) are deliberately absent: a search engine can't sign in to see them.
const STATIC_PATHS = ["/", "/blog", "/how-to-use", "/pricing", "/contact", "/privacy"];

function escapeXml(value: string): string {
  const map: Record<string, string> = { "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" };
  return value.replace(/[<>&'"]/g, (c) => map[c]!);
}

async function fetchBlogUrls(): Promise<{ slug: string; publishedAt: string }[]> {
  const target = process.env["ALYTIC_API_URL"] ?? "http://localhost:3000";
  try {
    const res = await fetch(`${target}/api/sitemap-urls`);
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
  const posts = await fetchBlogUrls();

  const entries = [
    ...STATIC_PATHS.map((path) => `  <url>\n    <loc>${escapeXml(`${SITE_URL}${path}`)}</loc>\n  </url>`),
    ...posts.map((p) => {
      const lastmod = new Date(p.publishedAt).toISOString().slice(0, 10);
      return `  <url>\n    <loc>${escapeXml(`${SITE_URL}/blog/${p.slug}`)}</loc>\n    <lastmod>${lastmod}</lastmod>\n  </url>`;
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
            // New posts land at most every 2h (blog-cron.yml), so a cached
            // copy is never stale by more than that.
            "Cache-Control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
