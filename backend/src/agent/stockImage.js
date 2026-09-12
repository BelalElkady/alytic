/**
 * Real stock photo per blog post via Unsplash's Search API.
 *
 * The article-writing model in blogGenerator.js is text-only — it can
 * describe the image it wants (image.concept/alt/caption) but can never
 * produce an actual photo, so published posts had that spec sitting unused
 * and no image at all. This fills the gap with a real, on-topic photo
 * matched against image.searchQuery (English keywords the model writes
 * alongside the Arabic spec — Unsplash's search barely understands Arabic).
 *
 * Best-effort throughout: a missing key, no results, or a network error all
 * return null rather than throwing, so a stock-photo hiccup never blocks an
 * otherwise-good article from being stored — same philosophy as
 * reviewBlogPost's failure handling in blogGenerator.js.
 */

const UNSPLASH_ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY;

export function stockImageAvailable() {
  return Boolean(UNSPLASH_ACCESS_KEY);
}

/**
 * @param {string} query - English keywords, e.g. "stock market chart finance"
 * @returns {Promise<{url:string, thumbUrl:string, sourceUrl:string, creditName:string, creditUrl:string}|null>}
 */
export async function searchStockImage(query) {
  if (!UNSPLASH_ACCESS_KEY || !query) return null;
  try {
    const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=1&orientation=landscape&content_filter=high`;
    const res = await fetch(url, {
      headers: { Authorization: `Client-ID ${UNSPLASH_ACCESS_KEY}`, 'Accept-Version': 'v1' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const photo = data.results?.[0];
    if (!photo) return null;

    // Required by Unsplash's API guidelines: a "download" is counted by
    // pinging this endpoint whenever a photo is actually used, not merely
    // searched. Fire-and-forget — a tracking hiccup must never block storing
    // the post.
    if (photo.links?.download_location) {
      fetch(photo.links.download_location, { headers: { Authorization: `Client-ID ${UNSPLASH_ACCESS_KEY}` } }).catch(() => {});
    }

    const utm = 'utm_source=egxpert&utm_medium=referral';
    return {
      url: photo.urls?.regular ?? null,
      thumbUrl: photo.urls?.small ?? null,
      sourceUrl: photo.links?.html ? `${photo.links.html}?${utm}` : null,
      creditName: photo.user?.name ?? null,
      creditUrl: photo.user?.links?.html ? `${photo.user.links.html}?${utm}` : null,
    };
  } catch (err) {
    console.error('searchStockImage failed — post will be stored without an image:', err);
    return null;
  }
}
