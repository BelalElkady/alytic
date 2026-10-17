import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";

import { ErrorState } from "@/components/desk/state-blocks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getBlogPost, type BlogContentBlock, type BlogImage, type BlogPost } from "@/lib/blog";
import { arPublishedDate } from "@/lib/format";
import { canonical, ogLogoUrl, siteUrl, siteName } from "@/lib/seo";

export const Route = createFileRoute("/blog/$slug")({
  loader: async ({ params }) => {
    const result = await getBlogPost({ data: params.slug });
    // A deleted or unpublished post must answer HTTP 404, not a 200 page that
    // says "not found" — search engines keep those indexed as empty pages.
    if (result.notFound) throw notFound();
    return result;
  },
  notFoundComponent: BlogPostNotFound,
  head: ({ params, loaderData, match }) => {
    const post = loaderData?.post ?? null;
    const url = `${siteUrl(match)}/blog/${params.slug}`;
    const title = post
      ? `${post.metaTitle || post.title} — ${siteName(match)}`
      : `مقالة — ${siteName(match)}`;
    const description = post?.metaDescription || post?.dek || null;
    return {
      meta: [
        { title },
        { property: "og:title", content: title },
        { property: "og:type", content: "article" },
        { property: "og:url", content: url },
        ...(description
          ? [
              { name: "description", content: description },
              { property: "og:description", content: description },
            ]
          : []),
        ...(post?.image ? [{ property: "og:image", content: post.image.url }] : []),
        ...(post ? [{ property: "article:published_time", content: post.publishedAt }] : []),
      ],
      links: [canonical(match, `/blog/${params.slug}`)],
      scripts: post
        ? [articleJsonLd(post, url, description, siteName(match), ogLogoUrl(match))]
        : [],
    };
  },
  component: BlogPostPage,
});

/** schema.org NewsArticle, so Google can read the headline, date and image without guessing. */
function articleJsonLd(
  post: BlogPost,
  url: string,
  description: string | null,
  publisherName: string,
  logoUrl: string,
) {
  const data = {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: post.title,
    ...(description ? { description } : {}),
    ...(post.image ? { image: [post.image.url] } : {}),
    datePublished: post.publishedAt,
    inLanguage: "ar",
    mainEntityOfPage: url,
    publisher: {
      "@type": "Organization",
      name: publisherName,
      logo: { "@type": "ImageObject", url: logoUrl },
    },
  };
  // "<" escaped so article text can never close the script tag early.
  return { type: "application/ld+json", children: JSON.stringify(data).replace(/</g, "\\u003c") };
}

function BlogHeroImage({ image, alt }: { image: BlogImage; alt: string }) {
  return (
    <figure className="mt-4">
      <img
        src={image.url}
        alt={alt}
        className="aspect-[16/9] w-full rounded-2xl border object-cover"
        loading="eager"
      />
      {image.creditName && (
        <figcaption className="mt-1.5 text-[11px] text-muted-foreground">
          Photo by{" "}
          {image.creditUrl ? (
            <a href={image.creditUrl} target="_blank" rel="noreferrer" className="underline">
              {image.creditName}
            </a>
          ) : (
            image.creditName
          )}{" "}
          on{" "}
          <a
            href="https://unsplash.com/?utm_source=egxpert&utm_medium=referral"
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            Unsplash
          </a>
        </figcaption>
      )}
    </figure>
  );
}

function BlogContent({ blocks }: { blocks: BlogContentBlock[] }) {
  return (
    <div className="space-y-4">
      {blocks.map((block, index) => {
        if (block.type === "heading") {
          const Heading = block.level === 3 ? "h3" : "h2";
          return (
            <Heading
              key={index}
              className={
                block.level === 3
                  ? "text-[16px] font-semibold tracking-tight"
                  : "text-[18px] font-semibold tracking-tight"
              }
            >
              {block.text}
            </Heading>
          );
        }
        if (block.type === "html") {
          // Sanitized by the backend (backend/src/blogHtml.js) before it is stored.
          return <div key={index} className="blog-html" dangerouslySetInnerHTML={{ __html: block.html }} />;
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

function BlogPostNotFound() {
  return (
    <article className="mx-auto w-full max-w-3xl px-4 py-14 sm:py-16">
      <ErrorState message="المقالة غير موجودة أو اتشالت." />
      <Link
        to="/blog"
        className="mt-4 inline-block text-[13px] text-muted-foreground hover:text-foreground"
      >
        ← كل المقالات
      </Link>
    </article>
  );
}

function BlogPostPage() {
  const { post, error } = Route.useLoaderData();
  const navigate = useNavigate();

  return (
    <article className="mx-auto w-full max-w-3xl px-4 py-14 sm:py-16">
      <div
        role="button"
        tabIndex={0}
        onClick={() => void navigate({ to: "/blog" })}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            void navigate({ to: "/blog" });
          }
        }}
        className="cursor-pointer text-[13px] text-muted-foreground hover:text-foreground"
      >
        ← كل المقالات
      </div>

      {(error || !post) && <ErrorState message={error ?? "تعذر تحميل المقالة"} />}
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
          {post.image && <BlogHeroImage image={post.image} alt={post.title} />}
          {post.dek && (
            <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">{post.dek}</p>
          )}
          <p className="mt-2 text-[11.5px] text-muted-foreground">
            {arPublishedDate(post.publishedAt)}
          </p>
          <div className="mt-8">
            <BlogContent blocks={post.content} />
          </div>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-3 border-t pt-8">
            <Button asChild size="lg">
              <Link to="/login" search={{ mode: "register" }}>
                ابدأ التجربة المجانية
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to="/login" search={{ mode: "register" }}>
                احصل على شهرين مجانا
              </Link>
            </Button>
          </div>
        </>
      )}
    </article>
  );
}
