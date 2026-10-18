import { createServerFn } from "@tanstack/react-start";

import { backendFetch } from "@/lib/backend";

import type { BlogPostSummary } from "@/components/marketing/blog-card";

export type BlogContentBlock =
  | { type: "heading"; level: 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] }
  | { type: "html"; html: string };

export type BlogImage = {
  url: string;
  sourceUrl: string | null;
  creditName: string | null;
  creditUrl: string | null;
};

export type BlogPost = {
  slug: string;
  title: string;
  metaTitle: string | null;
  metaDescription: string | null;
  dek: string | null;
  content: BlogContentBlock[];
  tags: string[];
  image: BlogImage | null;
  publishedAt: string;
  sources?: { name: string; url: string }[];
};

// The blog pages load through these server functions from their route
// loaders, so the articles are in the server-rendered HTML — fetching them in
// a useEffect left Googlebot and AdSense's crawler with empty pages. They call
// the backend directly, the same way routes/sitemap[.]xml.ts does, rather than
// going through the /api/public proxy, which only exists for the browser.
// backendFetch passes the request's host along, so a client site's blog
// lists that site's posts.
async function fromBackend<T>(
  path: string,
  fallbackError: string,
): Promise<{ data: T | null; error: string | null; status: number }> {
  try {
    const res = await backendFetch(path);
    const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
    if (!res.ok || !body) return { data: null, error: body?.error ?? fallbackError, status: res.status };
    return { data: body, error: null, status: res.status };
  } catch {
    return { data: null, error: fallbackError, status: 0 };
  }
}

/** Articles per page on /blog — three full rows of the three-column grid. */
export const BLOG_PAGE_SIZE = 9;

/** One page (1-based) of the published posts, plus how many exist in total so the route can build the pager. */
export const getBlogPosts = createServerFn({ method: "GET" })
  .inputValidator((page: number) => page)
  .handler(async ({ data: page }) => {
    const { data, error } = await fromBackend<{ posts: BlogPostSummary[]; total: number }>(
      `/api/blog?limit=${BLOG_PAGE_SIZE}&page=${page}`,
      "تعذر تحميل المقالات",
    );
    return { posts: data?.posts ?? null, total: data?.total ?? 0, error };
  });

export const getBlogPost = createServerFn({ method: "GET" })
  .inputValidator((slug: string) => slug)
  .handler(async ({ data: slug }) => {
    const { data, error, status } = await fromBackend<{ post: BlogPost }>(
      `/api/blog/${encodeURIComponent(slug)}`,
      "تعذر تحميل المقالة",
    );
    // Told apart from a backend outage so the route can answer a real 404.
    return { post: data?.post ?? null, error, notFound: status === 404 };
  });
