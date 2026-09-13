import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { EmptyState, ErrorState, LoadingBlock } from "@/components/desk/state-blocks";
import { BlogCard, type BlogPostSummary } from "@/components/marketing/blog-card";
import { api } from "@/lib/api";
import { SITE_URL } from "@/lib/seo";

export const Route = createFileRoute("/blog/")({
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
  }),
  component: BlogIndexPage,
});

function BlogIndexPage() {
  const [posts, setPosts] = useState<BlogPostSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api("/api/blog?limit=30")
      .then((result) => {
        setPosts(result.posts);
        setError(null);
      })
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : "تعذر تحميل المقالات"),
      );
  }, []);

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
        {!error && !posts && <LoadingBlock rows={4} />}
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
