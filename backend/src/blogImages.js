import { randomUUID } from 'node:crypto';
import { supabase } from './supabaseClient.js';

// Public bucket: a blog post's feature image is rendered on the public site
// (hero image, og:image, schema.org, sitemap) so it needs a stable public
// URL — unlike supportAttachments.js's private signed URLs.
const BUCKET = 'blog-images';

const EXT_BY_MEDIA_TYPE = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export const BLOG_IMAGE_TYPES = Object.keys(EXT_BY_MEDIA_TYPE);

let bucketReady = null;
// Lazy + memoized: avoids a storage round trip on every upload once the
// bucket is confirmed to exist, while still self-healing on first use in a
// freshly created Supabase project rather than needing a manual dashboard step.
async function ensureBucket() {
  if (bucketReady) return bucketReady;
  bucketReady = (async () => {
    const { data: existing } = await supabase.storage.getBucket(BUCKET);
    if (existing) return;
    const { error } = await supabase.storage.createBucket(BUCKET, {
      public: true,
      fileSizeLimit: '8MB',
      allowedMimeTypes: BLOG_IMAGE_TYPES,
    });
    if (error && !/already exists/i.test(error.message)) throw new Error(`createBucket: ${error.message}`);
  })();
  return bucketReady;
}

/** Uploads an admin-picked feature image and returns its public URL. */
export async function uploadBlogImage({ mediaType, buffer }) {
  await ensureBucket();
  const ext = EXT_BY_MEDIA_TYPE[mediaType];
  const path = `${randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, buffer, {
    contentType: mediaType,
    upsert: false,
  });
  if (error) throw new Error(`uploadBlogImage: ${error.message}`);
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}
