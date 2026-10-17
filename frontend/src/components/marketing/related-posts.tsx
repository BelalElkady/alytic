import { useEffect, useState } from "react";

import { BlogCard, type BlogPostSummary } from "@/components/marketing/blog-card";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";

const COUNT = 3;

/**
 * The newest articles other than the one being read, under each article. One
 * extra is fetched so the current article can be dropped and still leave
 * COUNT. Renders nothing when there are none or the request fails.
 */
export function RelatedPosts({ currentSlug }: { currentSlug: string }) {
  const [posts, setPosts] = useState<BlogPostSummary[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setPosts(null);
    setFailed(false);
    api(`/api/blog?limit=${COUNT + 1}`)
      .then((result) => {
        if (!active) return;
        const others = (result.posts ?? []) as BlogPostSummary[];
        setPosts(others.filter((post) => post.slug !== currentSlug).slice(0, COUNT));
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [currentSlug]);

  if (failed || posts?.length === 0) return null;

  return (
    <section className="mt-12 border-t pt-8">
      <h2 className="text-xl font-bold tracking-tight">مقالات ذات صلة</h2>
      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {posts
          ? posts.map((post) => <BlogCard key={post.slug} post={post} />)
          : Array.from({ length: COUNT }).map((_, index) => (
              <Skeleton key={index} className="h-52 rounded-2xl" />
            ))}
      </div>
    </section>
  );
}
