import { createFileRoute } from "@tanstack/react-router";

import { EmptyState, ErrorState } from "@/components/desk/state-blocks";
import { BlogCard } from "@/components/marketing/blog-card";
import { getBlogPosts } from "@/lib/blog";
import { canonical, SITE_URL } from "@/lib/seo";

export const Route = createFileRoute("/blog/")({
  loader: () => getBlogPosts(),
  head: () => ({
    meta: [
      { title: "تابع اخبار البورصة — EGXpert" },
      {
        name: "description",
        content: "آخر أخبار البورصة المصرية والشركات الكبرى وتحليل فني يومي.",
      },
      { property: "og:title", content: "تابع اخبار البورصة — EGXpert" },
      {
        property: "og:description",
        content: "آخر أخبار البورصة المصرية والشركات الكبرى وتحليل فني يومي.",
      },
      { property: "og:url", content: `${SITE_URL}/blog` },
    ],
    links: [canonical("/blog")],
  }),
  component: BlogIndexPage,
});

function BlogIndexPage() {
  const { posts, error } = Route.useLoaderData();

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
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {posts.map((post) => (
              <BlogCard key={post.slug} post={post} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
