import { BlogCard, type BlogPostSummary } from "@/components/marketing/blog-card";

/**
 * Posts related to the one being read (picked by the backend and delivered with
 * the article, so they are in the server-rendered HTML). Renders nothing — not
 * even the heading — when there are none.
 */
export function RelatedPosts({ posts }: { posts: BlogPostSummary[] }) {
  if (posts.length === 0) return null;

  return (
    <section className="mt-12 border-t pt-8">
      <h2 className="text-xl font-bold tracking-tight">مقالات ذات صلة</h2>
      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {posts.map((post) => (
          <BlogCard key={post.slug} post={post} />
        ))}
      </div>
    </section>
  );
}
