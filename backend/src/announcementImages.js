import { randomUUID } from 'node:crypto';
import { currentDb, supabase } from './supabaseClient.js';
import { BLOG_IMAGE_TYPES } from './blogImages.js';

// Public bucket: an announcement's images are rendered in the popup every
// signed-in user sees, so they need a stable public URL — same reasoning as
// blogImages.js's BUCKET.
const BUCKET = 'announcement-images';

const EXT_BY_MEDIA_TYPE = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

// Per database client — each tenant's project has its own storage.
const bucketReady = new WeakMap();
// Lazy + memoized: avoids a storage round trip on every upload once the
// bucket is confirmed to exist, while still self-healing on first use in a
// freshly created Supabase project rather than needing a manual dashboard step.
async function ensureBucket() {
  const db = currentDb();
  if (bucketReady.has(db)) return bucketReady.get(db);
  const ready = (async () => {
    const { data: existing } = await supabase.storage.getBucket(BUCKET);
    if (existing) return;
    const { error } = await supabase.storage.createBucket(BUCKET, {
      public: true,
      fileSizeLimit: '8MB',
      allowedMimeTypes: BLOG_IMAGE_TYPES,
    });
    if (error && !/already exists/i.test(error.message)) throw new Error(`createBucket: ${error.message}`);
  })();
  bucketReady.set(db, ready);
  ready.catch(() => bucketReady.delete(db));
  return ready;
}

/** Uploads an admin-picked announcement image and returns its public URL. */
export async function uploadAnnouncementImage({ mediaType, buffer }) {
  await ensureBucket();
  const ext = EXT_BY_MEDIA_TYPE[mediaType];
  const path = `${randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, buffer, {
    contentType: mediaType,
    upsert: false,
  });
  if (error) throw new Error(`uploadAnnouncementImage: ${error.message}`);
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}
