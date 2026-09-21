import { randomUUID } from 'node:crypto';
import { currentDb, supabase } from './supabaseClient.js';

// Private bucket: a support attachment (often an InstaPay receipt) can carry a
// phone number or account name, so it's never served from a public/guessable
// URL — only from a signed URL minted per read, see signedUrlsFor below.
const BUCKET = 'support-attachments';
const SIGNED_URL_TTL_SECONDS = 60 * 60;

const EXT_BY_MEDIA_TYPE = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export const SUPPORT_IMAGE_TYPES = Object.keys(EXT_BY_MEDIA_TYPE);

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
      public: false,
      fileSizeLimit: '8MB',
      allowedMimeTypes: SUPPORT_IMAGE_TYPES,
    });
    if (error && !/already exists/i.test(error.message)) throw new Error(`createBucket: ${error.message}`);
  })();
  bucketReady.set(db, ready);
  ready.catch(() => bucketReady.delete(db));
  return ready;
}

export async function uploadSupportImage({ userId, mediaType, buffer }) {
  await ensureBucket();
  const ext = EXT_BY_MEDIA_TYPE[mediaType];
  const path = `${userId}/${randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, buffer, {
    contentType: mediaType,
    upsert: false,
  });
  if (error) throw new Error(`uploadSupportImage: ${error.message}`);
  return path;
}

/** Removes every attachment a user uploaded (their `<userId>/` folder) — deleting the user row only cascades the messages, not the files. */
export async function removeSupportImagesFor(userId) {
  const bucket = supabase.storage.from(BUCKET);
  const { data, error } = await bucket.list(userId, { limit: 1000 });
  if (error) {
    if (/not found/i.test(error.message)) return 0; // bucket never created — nothing uploaded
    throw new Error(`removeSupportImagesFor: ${error.message}`);
  }
  if (!data?.length) return 0;
  const { error: removeError } = await bucket.remove(data.map((file) => `${userId}/${file.name}`));
  if (removeError) throw new Error(`removeSupportImagesFor: ${removeError.message}`);
  return data.length;
}

/** Batch-signs every path in one call — used to turn a page of messages into short-lived, viewable URLs. */
export async function signedUrlsFor(paths) {
  const unique = [...new Set(paths.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(unique, SIGNED_URL_TTL_SECONDS);
  if (error) throw new Error(`signedUrlsFor: ${error.message}`);
  return new Map(data.map((entry) => [entry.path, entry.signedUrl]));
}
