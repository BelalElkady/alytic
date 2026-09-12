import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { BlogCard, type BlogPostSummary } from "@/components/marketing/blog-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";

const COUNT = 3;

/**
 * The three newest articles at the foot of the landing page. Renders nothing
 * at all when there are none or the request fails — an empty or broken strip
 * at the bottom of a marketing page is worse than no strip.
 */
export function LatestPosts() {
  const [posts, setPosts] = useState<BlogPostSummary[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api(`/api/blog?limit=${COUNT}`)
      .then((result) => setPosts(result.posts ?? []))
      .catch(() => setFailed(true));
  }, []);

  if (failed || posts?.length === 0) return null;

  return (
    <section className="border-t">
      <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:py-16">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">آخر أخبار البورصة</h2>
            <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">
              تحليل يومي لأخبار السوق والشركات الكبرى.
            </p>
          </div>
          <Button asChild variant="outline">
            <Link to="/blog">كل المقالات</Link>
          </Button>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {posts
            ? posts.map((post) => <BlogCard key={post.slug} post={post} />)
            : Array.from({ length: COUNT }).map((_, index) => (
                <Skeleton key={index} className="h-52 rounded-2xl" />
              ))}
        </div>
      </div>
    </section>
  );
}
