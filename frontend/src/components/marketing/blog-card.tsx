import { Link } from "@tanstack/react-router";

import { Badge } from "@/components/ui/badge";
import { arPublishedDate } from "@/lib/format";

export type BlogPostSummary = {
  slug: string;
  title: string;
  dek: string | null;
  tags: string[];
  imageUrl?: string | null;
  publishedAt: string;
};

/** One article card, shared by the blog index and the landing page's latest-posts strip so the two can't drift apart. */
export function BlogCard({ post }: { post: BlogPostSummary }) {
  return (
    <Link
      to="/blog/$slug"
      params={{ slug: post.slug }}
      className="flex flex-col overflow-hidden rounded-2xl border bg-card shadow-sm transition-colors hover:border-primary/40"
    >
      {post.imageUrl && (
        <img
          src={post.imageUrl}
          alt={post.title}
          className="aspect-[16/9] w-full object-cover"
          loading="lazy"
        />
      )}
      <div className="flex flex-1 flex-col p-5">
        {post.tags?.[0] && (
          <Badge variant="outline" className="w-fit">
            {post.tags[0]}
          </Badge>
        )}
        <h2 className="mt-3 text-[16px] font-semibold leading-snug">{post.title}</h2>
        {post.dek && (
          <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">{post.dek}</p>
        )}
        <p className="mt-4 text-[11.5px] text-muted-foreground">{arPublishedDate(post.publishedAt)}</p>
      </div>
    </Link>
  );
}
