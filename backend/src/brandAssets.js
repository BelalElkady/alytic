import { randomUUID } from 'node:crypto';
import { browserStorageUrl, currentDb, supabase } from './supabaseClient.js';
import { sniffImageType } from './security.js';

// A client's logo and favicon, uploaded from the platform panel. Public
// bucket: both are rendered on that client's public pages (header, favicon,
// og:image), so they need a stable public URL — same reasoning as blogImages.js.
// Uploads always happen on the main site, so these live in the platform
// project's storage whichever client they belong to; only the URL is stored on
// the tenant.
const BUCKET = 'brand-assets';

const EXT_BY_MEDIA_TYPE = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

export const BRAND_ASSET_TYPES = Object.keys(EXT_BY_MEDIA_TYPE);
export const BRAND_ASSET_KINDS = ['logo', 'favicon'];
export const BRAND_ASSET_MAX_BYTES = 2 * 1024 * 1024;
export const NOT_A_BRAND_IMAGE_MESSAGE = 'الملف ده مش صورة صالحة — ارفع PNG أو JPEG أو WebP أو SVG (لحد 2 ميجا).';

const SVG_START = /^\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE[^>[]*>\s*)?<svg[\s>]/i;
// An SVG is a document, not just pixels: refuse anything that can run code or
// declare entities. It is only ever shown through <img>/<link>, where scripts
// don't run, but the file is also reachable by its own URL.
const SVG_FORBIDDEN = /<script|<foreignObject|<iframe|<embed|<object|<!ENTITY|javascript:|\son[a-z]+\s*=/i;

function looksLikeSafeSvg(buffer) {
  const text = buffer.toString('utf8');
  return SVG_START.test(text) && !SVG_FORBIDDEN.test(text);
}

/**
 * The upload's real type, accepted only when its bytes are the type the client
 * declared — the Content-Type header alone is attacker-controlled. Null if not.
 */
export function verifiedBrandAssetType(buffer, declaredType) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > BRAND_ASSET_MAX_BYTES) return null;
  if (declaredType === 'image/svg+xml') return looksLikeSafeSvg(buffer) ? declaredType : null;
  const actual = sniffImageType(buffer);
  return actual && actual === declaredType ? actual : null;
}

// Per database client — each project has its own storage.
const bucketReady = new WeakMap();
// Lazy + memoized, and self-healing on first use in a fresh Supabase project,
// exactly as in blogImages.js.
async function ensureBucket() {
  const db = currentDb();
  if (bucketReady.has(db)) return bucketReady.get(db);
  const ready = (async () => {
    const { data: existing } = await supabase.storage.getBucket(BUCKET);
    if (existing) return;
    const { error } = await supabase.storage.createBucket(BUCKET, {
      public: true,
      fileSizeLimit: BRAND_ASSET_MAX_BYTES,
      allowedMimeTypes: BRAND_ASSET_TYPES,
    });
    if (error && !/already exists/i.test(error.message)) throw new Error(`createBucket: ${error.message}`);
  })();
  bucketReady.set(db, ready);
  ready.catch(() => bucketReady.delete(db));
  return ready;
}

/** Stores a verified logo/favicon and returns its public URL. The name is random, so the URL never changes meaning and can be cached for good. */
export async function uploadBrandAsset({ kind, mediaType, buffer }) {
  await ensureBucket();
  const path = `${kind}/${randomUUID()}.${EXT_BY_MEDIA_TYPE[mediaType]}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, buffer, {
    contentType: mediaType,
    cacheControl: '31536000',
    upsert: false,
  });
  if (error) throw new Error(`uploadBrandAsset: ${error.message}`);
  return browserStorageUrl(supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl);
}
