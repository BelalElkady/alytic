import { createFileRoute, redirect } from "@tanstack/react-router";

import { EmptyState, ErrorState } from "@/components/desk/state-blocks";
import { BlogCard } from "@/components/marketing/blog-card";
import { BlogPagination } from "@/components/marketing/blog-pagination";
import { BLOG_PAGE_SIZE, getBlogPosts } from "@/lib/blog";
import { canonical, SITE_URL } from "@/lib/seo";

type BlogSearch = { page?: number };

const description = "آخر أخبار البورصة المصرية والشركات الكبرى وتحليل فني يومي.";

export const Route = createFileRoute("/blog/")({
  // Page 1 is the bare /blog (no ?page=1), so a missing, malformed or
  // non-positive value all mean "the first page".
  validateSearch: (search: Record<string, unknown>): BlogSearch => {
    const page = Math.floor(Number(search["page"]));
    return { page: Number.isFinite(page) && page > 1 ? page : undefined };
  },
  loaderDeps: ({ search }) => ({ page: search.page ?? 1 }),
  loader: async ({ deps }) => {
    const result = await getBlogPosts({ data: deps.page });
    const lastPage = Math.max(1, Math.ceil(result.total / BLOG_PAGE_SIZE));
    // A stale bookmark or hand-typed ?page=99 after posts were removed: land on
    // the real last page instead of an empty one.
    if (!result.error && deps.page > lastPage) {
      throw redirect({ to: "/blog", search: { page: lastPage > 1 ? lastPage : undefined }, replace: true });
    }
    return { ...result, page: deps.page, lastPage };
  },
  head: ({ loaderData }) => {
    const page = loaderData?.page ?? 1;
    // Each page is its own indexable URL with its own title and canonical, so
    // page 2 isn't read as a duplicate of page 1.
    const title = page > 1 ? `تابع اخبار البورصة — الصفحة ${page} — EGXpert` : "تابع اخبار البورصة — EGXpert";
    const path = page > 1 ? `/blog?page=${page}` : "/blog";
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:url", content: `${SITE_URL}${path}` },
      ],
      links: [canonical(path)],
    };
  },
  component: BlogIndexPage,
});

function BlogIndexPage() {
  const { posts, error, page, lastPage } = Route.useLoaderData();

  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-14 sm:py-16">
      <div className="max-w-2xl">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">تابع اخبار البورصة</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
          آخر أخبار البورصة المصرية والشركات الكبرى، وتحليل فني للسوق — بيتحدث أول بأول.
        </p>
      </div>

      <div className="mt-10">
        {error && <ErrorState message={error} />}
        {!error && posts && posts.length === 0 && (
          <EmptyState title="لسه مفيش مقالات منشورة" hint="تابعنا هنا أول ما ننشر أول مقالة." />
        )}
        {!error && posts && posts.length > 0 && (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {posts.map((post) => (
                <BlogCard key={post.slug} post={post} />
              ))}
            </div>
            {lastPage > 1 && <BlogPagination page={page} lastPage={lastPage} />}
          </>
        )}
      </div>
    </section>
  );
}
