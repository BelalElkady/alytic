import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { api } from "@/lib/api";

type TickerPost = { slug: string; title: string };

/** Horizontally scrolling strip of recent blog titles, shown under the header on every marketing page. Renders nothing if there are no published posts yet. */
export function BlogTicker() {
  const [posts, setPosts] = useState<TickerPost[]>([]);

  useEffect(() => {
    api("/api/blog?limit=10")
      .then((result) => setPosts(result.posts ?? []))
      .catch(() => setPosts([]));
  }, []);

  if (posts.length === 0) return null;

  const items = (
    <>
      {posts.map((post, index) => (
        <span key={`${post.slug}-${index}`} className="flex shrink-0 items-center gap-3">
          <Link
            to="/blog/$slug"
            params={{ slug: post.slug }}
            className="text-[12.5px] font-medium text-foreground/80 transition-colors hover:text-foreground"
          >
            {post.title}
          </Link>
          <span className="text-muted-foreground/50">•</span>
        </span>
      ))}
    </>
  );

  return (
    <div className="border-b bg-surface">
      <div className="group relative flex overflow-hidden py-2">
        <div className="flex shrink-0 items-center gap-3 ps-3 [animation:marquee_40s_linear_infinite] group-hover:[animation-play-state:paused]">
          {items}
        </div>
        <div
          className="flex shrink-0 items-center gap-3 ps-3 [animation:marquee_40s_linear_infinite] group-hover:[animation-play-state:paused]"
          aria-hidden="true"
        >
          {items}
        </div>
      </div>
    </div>
  );
}
