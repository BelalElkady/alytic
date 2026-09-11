import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { ErrorState, LoadingBlock } from "@/components/desk/state-blocks";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";

export const Route = createFileRoute("/blog/$slug")({
  head: () => ({
    meta: [{ title: "مقالة — EGXpert" }],
  }),
  component: BlogPostPage,
});

type ContentBlock =
  | { type: "heading"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] };

type BlogPost = {
  slug: string;
  title: string;
  dek: string | null;
  content: ContentBlock[];
  tags: string[];
  publishedAt: string;
};

function BlogContent({ blocks }: { blocks: ContentBlock[] }) {
  return (
    <div className="space-y-4">
      {blocks.map((block, index) => {
        if (block.type === "heading") {
          return (
            <h2 key={index} className="text-[18px] font-semibold tracking-tight">
              {block.text}
            </h2>
          );
        }
        if (block.type === "list") {
          return (
            <ul key={index} className="list-disc space-y-1.5 ps-5 text-[14px] leading-relaxed">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{item}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={index} className="text-[14px] leading-relaxed text-foreground">
            {block.text}
          </p>
        );
      })}
    </div>
  );
}

function BlogPostPage() {
  const { slug } = Route.useParams();
  const [post, setPost] = useState<BlogPost | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPost(null);
    setError(null);
    api(`/api/blog/${slug}`)
      .then((result) => setPost(result.post))
      .catch((caught: any) => setError(caught?.message ?? "تعذر تحميل المقالة"));
  }, [slug]);

  return (
    <article className="mx-auto w-full max-w-3xl px-4 py-14 sm:py-16">
      <Link to="/blog" className="text-[13px] text-muted-foreground hover:text-foreground">
        ← كل المقالات
      </Link>

      {error && <ErrorState message={error} />}
      {!error && !post && <LoadingBlock rows={5} />}
      {!error && post && (
        <>
          <div className="mt-4 flex flex-wrap gap-1.5">
            {post.tags?.map((tag) => (
              <Badge key={tag} variant="outline">
                {tag}
              </Badge>
            ))}
          </div>
          <h1 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">{post.title}</h1>
          {post.dek && (
            <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">{post.dek}</p>
          )}
          <p className="num mt-2 text-[11.5px] text-muted-foreground">
            {new Date(post.publishedAt).toLocaleDateString("ar-EG")}
          </p>
          <div className="mt-8">
            <BlogContent blocks={post.content} />
          </div>
        </>
      )}
    </article>
  );
}
