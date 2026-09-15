import { createServerFn } from "@tanstack/react-start";

import type { BlogPostSummary } from "@/components/marketing/blog-card";

export type BlogContentBlock =
  | { type: "heading"; level: 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] };

export type BlogImage = {
  url: string;
  sourceUrl: string | null;
  creditName: string | null;
  creditUrl: string | null;
};

export type BlogPost = {
  slug: string;
  title: string;
  metaDescription: string | null;
  dek: string | null;
  content: BlogContentBlock[];
  tags: string[];
  image: BlogImage | null;
  publishedAt: string;
};

// The blog pages load through these server functions from their route
// loaders, so the articles are in the server-rendered HTML — fetching them in
// a useEffect left Googlebot and AdSense's crawler with empty pages. They call
// the backend directly, the same way routes/sitemap[.]xml.ts does, rather than
// going through the /api/public proxy, which only exists for the browser.
async function fromBackend<T>(
  path: string,
  fallbackError: string,
): Promise<{ data: T | null; error: string | null; status: number }> {
  const target = process.env["ALYTIC_API_URL"] ?? "http://localhost:3000";
  try {
    const res = await fetch(`${target}${path}`);
    const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
    if (!res.ok || !body) return { data: null, error: body?.error ?? fallbackError, status: res.status };
    return { data: body, error: null, status: res.status };
  } catch {
    return { data: null, error: fallbackError, status: 0 };
  }
}

export const getBlogPosts = createServerFn({ method: "GET" }).handler(async () => {
  const { data, error } = await fromBackend<{ posts: BlogPostSummary[] }>(
    "/api/blog?limit=30",
    "تعذر تحميل المقالات",
  );
  return { posts: data?.posts ?? null, error };
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
