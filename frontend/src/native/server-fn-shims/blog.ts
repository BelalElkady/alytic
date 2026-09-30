import { api } from "@/lib/api";
import type { BlogPostSummary } from "@/components/marketing/blog-card";

export type {
  BlogContentBlock,
  BlogImage,
  BlogPost,
} from "@/lib/blog.types";
import type { BlogPost } from "@/lib/blog.types";

export const BLOG_PAGE_SIZE = 9;

const message = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

export const getBlogPosts = async ({ data: page }: { data: number }) => {
  try {
    const body = await api<{ posts: BlogPostSummary[]; total: number }>(
      `/api/blog?limit=${BLOG_PAGE_SIZE}&page=${page}`,
    );
    return { posts: body.posts, total: body.total, error: null as string | null };
  } catch (err) {
    return { posts: null, total: 0, error: message(err, "تعذر تحميل المقالات") as string | null };
  }
};

export const getBlogPost = async ({ data: slug }: { data: string }) => {
  try {
    const body = await api<{ post: BlogPost }>(`/api/blog/${encodeURIComponent(slug)}`);
    return { post: body.post, error: null as string | null, notFound: false };
  } catch (err) {
    const status = (err as { status?: number }).status;
    return { post: null, error: message(err, "تعذر تحميل المقالة") as string | null, notFound: status === 404 };
  }
};
