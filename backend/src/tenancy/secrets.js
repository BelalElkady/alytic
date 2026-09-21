import crypto from 'node:crypto';

/**
 * Encrypts tenant database keys before they are stored in the platform
 * database's `tenants` row, and decrypts them when the registry builds that
 * tenant's client. A tenant's service_role key opens its whole database, so a
 * leaked platform backup or a stray `select *` must not hand those keys out in
 * plain text.
 *
 * TENANT_SECRETS_KEY is 32 random bytes as hex (openssl rand -hex 32). Lose it
 * and every stored tenant key has to be entered again; change it and the same.
 * Format: v1.<iv>.<tag>.<ciphertext>, each part base64url.
 */
function masterKey() {
  const hex = process.env.TENANT_SECRETS_KEY ?? '';
  if (!/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error('TENANT_SECRETS_KEY لازم يكون 64 حرف hex (openssl rand -hex 32) عشان نقدر نحفظ مفاتيح قواعد بيانات العملاء');
  }
  return Buffer.from(hex, 'hex');
}

export function encryptSecret(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', masterKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return ['v1', iv, cipher.getAuthTag(), ciphertext].map((part) => (typeof part === 'string' ? part : part.toString('base64url'))).join('.');
}

export function decryptSecret(sealed) {
  const [version, iv, tag, ciphertext] = String(sealed ?? '').split('.');
  if (version !== 'v1' || !iv || !tag || !ciphertext) throw new Error('decryptSecret: unrecognized format');
  const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
}
