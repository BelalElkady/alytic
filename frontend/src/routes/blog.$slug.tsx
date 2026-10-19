import { createFileRoute, Link, notFound, redirect, useNavigate } from "@tanstack/react-router";

import { ErrorState } from "@/components/desk/state-blocks";
import { RelatedPosts } from "@/components/marketing/related-posts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getBlogPost, type BlogContentBlock, type BlogImage, type BlogPost } from "@/lib/blog";
import { arPublishedDate } from "@/lib/format";
import { canonical, ogLogoUrl, siteUrl, siteName } from "@/lib/seo";

// Posts whose slug was corrected after publishing: the old URL is already
// indexed and linked, so it answers a permanent redirect to the new one.
const RENAMED_SLUGS: Record<string, string> = {
  // The slug said "sixth"; 24 Sep 2026 was the sixth MPC meeting but the fifth hold in a row.
  "egypt-central-bank-holds-interest-rates-sixth-time-2026":
    "egypt-central-bank-holds-interest-rates-fifth-time-2026",
};

export const Route = createFileRoute("/blog/$slug")({
  loader: async ({ params }) => {
    // Old articles linked to the bare domain, which resolved to /blog/egxpert.com.
    if (params.slug === "egxpert.com") throw redirect({ to: "/", statusCode: 301 });
    const renamed = RENAMED_SLUGS[params.slug];
    if (renamed) throw redirect({ to: "/blog/$slug", params: { slug: renamed }, statusCode: 301 });
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

/** schema.org Article, so Google can read the headline, date and image without guessing. */
function articleJsonLd(
  post: BlogPost,
  url: string,
  description: string | null,
  publisherName: string,
  logoUrl: string,
) {
  const data = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    author: { "@type": "Organization", name: "EGXpert", url: new URL("/about", url).href },
    dateModified: post.publishedAt,
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
    <div className="space-y-4 font-article">
      {blocks.map((block, index) => {
        if (block.type === "heading") {
          const Heading = block.level === 3 ? "h3" : "h2";
          return (
            <Heading
              key={index}
              className={
                block.level === 3
                  ? "text-[19px] font-bold tracking-tight"
                  : "text-[22px] font-bold tracking-tight"
              }
            >
              {block.text}
            </Heading>
          );
        }
        if (block.type === "html") {
          // Sanitized by the backend (backend/src/blogHtml.js) before it is stored.
          // Older stored posts have href="egxpert.com" (no protocol), which the
          // browser resolves under /blog/ — make any bare-domain href absolute.
          const html = block.html.replace(
            /href=(["'])(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:[/?#][^"']*)?)\1/gi,
            (_m, quote: string, rest: string) => `href=${quote}https://${rest}${quote}`,
          );
          return <div key={index} className="blog-html" dangerouslySetInnerHTML={{ __html: html }} />;
        }
        if (block.type === "list") {
          return (
            <ul key={index} className="list-disc space-y-1.5 ps-5 text-[17px] leading-[1.85]">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{item}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={index} className="text-[17px] leading-[1.85] text-foreground">
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
  const { post, related, error } = Route.useLoaderData();
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
            <Link to="/about" className="underline-offset-2 hover:underline">
              فريق EGXpert التحريري
            </Link>
            {" · "}
            {arPublishedDate(post.publishedAt)}
          </p>
          <div className="mt-8">
            <BlogContent blocks={post.content} />
          </div>
          {post.sources && post.sources.length > 0 && (
            <section className="mt-8 border-t pt-6">
              <h2 className="text-[17px] font-bold tracking-tight">المصادر</h2>
              <ul className="mt-2 list-disc space-y-1 ps-5 text-[14px]">
                {post.sources.map((source) => (
                  <li key={source.url}>
                    <a href={source.url} target="_blank" rel="noopener noreferrer nofollow" className="underline">
                      {source.name}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}
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
          <RelatedPosts posts={related} />
        </>
      )}
    </article>
  );
}
