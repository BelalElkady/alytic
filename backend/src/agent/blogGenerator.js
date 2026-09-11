/**
 * Auto-generated blog posts: Egyptian stock market news, big EGX-listed
 * companies, and technical analysis — written twice a day (see
 * /api/cron/blog-generate in server.js, triggered by
 * .github/workflows/blog-cron.yml) and held as a draft until an admin
 * approves it (see /api/admin/blog-drafts).
 *
 * Mirrors marketAnalysis.js's cache-or-generate shape: one generation per
 * (post_date, slot), read afterward by every visitor rather than
 * regenerated per request. See getOrGenerateBlogPost, which callers should
 * use instead of generateBlogPost/reviewBlogPost directly.
 */

import { z } from 'zod';
import { requestStructuredOR } from './clientOpenRouter.js';
import { getBlogPostBySlot, insertBlogPostDraft } from '../db.js';

// Pinned independently of ALYTIC_MODEL: the blog generator always wants a
// model with real web-search tool support, regardless of what the
// portfolio-analysis features are configured to use.
const BLOG_MODEL = process.env.BLOG_MODEL ?? 'qwen/qwen3-235b-a22b:free';
// Second, independent model that reviews each draft before it reaches the
// admin approval queue — see reviewBlogPost.
const BLOG_REVIEW_MODEL = process.env.BLOG_REVIEW_MODEL ?? 'google/gemma-4-31b-it:free';

const ContentBlockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('heading'), text: z.string() }),
  z.object({ type: z.literal('paragraph'), text: z.string() }),
  z.object({ type: z.literal('list'), items: z.array(z.string()) }),
]);

export const BlogPostSchema = z.object({
  title: z.string().describe('Egyptian Arabic headline, specific and newsy — not generic'),
  slug: z
    .string()
    .describe('URL slug: lowercase Latin letters, numbers and hyphens only, transliterated/English (e.g. "comi-q3-earnings-egx30"), no Arabic script'),
  dek: z.string().describe('One-sentence Egyptian Arabic subheading/summary for list pages and social previews'),
  content: z.array(ContentBlockSchema).min(4).describe('The article body as a sequence of blocks — headings, paragraphs, lists'),
  tags: z.array(z.string()).max(6).describe('Short Arabic topic tags, e.g. company names, sectors, EGX30'),
  sources: z
    .array(z.object({ title: z.string(), url: z.string() }))
    .describe('Real sources actually found via web search — never invented'),
});

const ReviewSchema = z.object({
  verdict: z.enum(['pass', 'flag']).describe('"flag" if the draft has factual, sourcing, or quality problems worth a human look'),
  notes: z.string().describe('Egyptian Arabic — what an admin reviewer should check before approving, or why it looks fine'),
});

const SLOT_LABEL = { morning: 'صباحية', evening: 'مسائية' };

function buildSystemPrompt() {
  return `أنت كاتب محتوى مالي لموقع Alytic، متخصص في البورصة المصرية (EGX). اكتب مقالة إخبارية/تحليلية بالعربية المصرية عن آخر أخبار البورصة المصرية والشركات الكبرى المقيدة فيها (زي كومي، طلعت مصطفى، الحديد والصلب، البنك التجاري الدولي، فوري، إلخ)، وتحليل فني لحركة السوق أو لسهم أو قطاع بعينه.

قواعد:
- استخدم أداة البحث على الإنترنت للوصول لأخبار ومعلومات حديثة فعلاً — ما تخترعش أرقام أو أحداث.
- كل رقم أو خبر تذكره لازم يكون مبني على مصدر حقيقي رجعت له بالبحث؛ اذكر مصادرك في حقل sources.
- المقالة موجهة لمستثمر مصري عادي — واضحة ومباشرة، من غير مبالغة أو نصايح استثمارية قاطعة (ده محتوى تحليلي مش توصية).
- لو معندكش خبر أو رقم مؤكد، قول كده صراحة بدل ما تخترعه.`;
}

/**
 * Runs one generation + review pass. Expensive and uncached — callers should
 * use getOrGenerateBlogPost instead, which checks storage first.
 */
export async function generateBlogPost({ slot, postDate }) {
  const userMessage = `اكتب مقالة ${SLOT_LABEL[slot] ?? slot} جديدة عن البورصة المصرية ليوم ${postDate}. ابحث عن آخر الأخبار والتحركات في EGX30 والشركات الكبرى، واختار زاوية واحدة محددة (خبر شركة، تحليل فني لمؤشر أو سهم، أو ملخص جلسة تداول) بدل ما تحاول تغطي كل حاجة.`;

  const { data, raw } = await requestStructuredOR({
    model: BLOG_MODEL,
    schema: BlogPostSchema,
    schemaName: 'blog_post',
    maxTokens: 6000,
    system: buildSystemPrompt(),
    messages: [{ role: 'user', content: userMessage }],
    webSearch: { engine: 'auto', max_results: 6, max_uses: 8 },
  });

  return { post: data, raw };
}

/** Independent model review of a freshly generated draft — a second opinion before a human sees it. */
export async function reviewBlogPost(post) {
  const userMessage = `راجع المقالة دي قبل ما توصل لمراجعة بشرية. تأكد إن المصادر منطقية ومرتبطة بالمحتوى، وإن مفيش أرقام أو أحداث شكلها مُختلقة، وإن المحتوى مفيدة وليست عامة جدًا.

العنوان: ${post.title}
الملخص: ${post.dek}
المحتوى: ${post.content.map((b) => (b.type === 'list' ? b.items.join(' / ') : b.text)).join('\n')}
المصادر: ${post.sources.map((s) => `${s.title} (${s.url})`).join(', ') || 'لا يوجد'}`;

  const { data, raw } = await requestStructuredOR({
    model: BLOG_REVIEW_MODEL,
    schema: ReviewSchema,
    schemaName: 'blog_review',
    maxTokens: 1000,
    system: 'أنت مراجع محتوى مالي دقيق. مهمتك تقييم مسودة مقالة قبل نشرها — لاحظ أي مشكلة في الدقة أو المصادر أو الجودة.',
    messages: [{ role: 'user', content: userMessage }],
  });

  return { review: data, raw };
}

// One in-flight generation per (day, slot) within this process — same
// reasoning as marketAnalysis.js's inFlight map: stops two racing cron/admin
// calls from each paying for their own generation before the first's insert
// lands.
const inFlight = new Map();

/**
 * The entry point every route should use. Returns today's draft/post for
 * this slot — from storage if already generated, otherwise generates,
 * reviews, and stores it as a draft. Only ever calls the model when nothing
 * is stored yet for this (day, slot).
 */
export async function getOrGenerateBlogPost({ slot, postDate = new Date().toISOString().slice(0, 10) }) {
  const existing = await getBlogPostBySlot(postDate, slot);
  if (existing) return existing;

  const key = `${postDate}:${slot}`;
  if (inFlight.has(key)) return inFlight.get(key);

  const task = (async () => {
    const { post, raw: genRaw } = await generateBlogPost({ slot, postDate });
    const { review, raw: reviewRaw } = await reviewBlogPost(post);

    const slug = `${post.slug.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'egx-update'}-${postDate}-${slot === 'morning' ? 'm' : 'e'}`;

    const inserted = await insertBlogPostDraft({
      postDate,
      slot,
      slug,
      title: post.title,
      dek: post.dek,
      content: post.content,
      tags: post.tags,
      sources: post.sources,
      generationModel: genRaw.model,
      generationUsage: genRaw.usage,
      reviewModel: reviewRaw.model,
      review,
    });
    // Someone else's insert may have won the race — re-read either way so
    // every caller sees exactly what ended up stored.
    return inserted ?? (await getBlogPostBySlot(postDate, slot));
  })();
  inFlight.set(key, task);
  try {
    return await task;
  } finally {
    inFlight.delete(key);
  }
}
