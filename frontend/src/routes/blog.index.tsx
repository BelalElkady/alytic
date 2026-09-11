import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { EmptyState, ErrorState, LoadingBlock } from "@/components/desk/state-blocks";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";

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
    ],
  }),
  component: BlogIndexPage,
});

type BlogPostSummary = {
  slug: string;
  title: string;
  dek: string | null;
  tags: string[];
  publishedAt: string;
};

function BlogIndexPage() {
  const [posts, setPosts] = useState<BlogPostSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api("/api/blog?limit=30")
      .then((result) => {
        setPosts(result.posts);
        setError(null);
      })
      .catch((caught: any) => setError(caught?.message ?? "تعذر تحميل المقالات"));
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
              <Link
                key={post.slug}
                to="/blog/$slug"
                params={{ slug: post.slug }}
                className="flex flex-col rounded-2xl border bg-card p-5 shadow-sm transition-colors hover:border-primary/40"
              >
                {post.tags?.[0] && (
                  <Badge variant="outline" className="w-fit">
                    {post.tags[0]}
                  </Badge>
                )}
                <h2 className="mt-3 text-[16px] font-semibold leading-snug">{post.title}</h2>
                {post.dek && (
                  <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">{post.dek}</p>
                )}
                <p className="num mt-4 text-[11.5px] text-muted-foreground">
                  {new Date(post.publishedAt).toLocaleDateString("ar-EG")}
                </p>
              </Link>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
