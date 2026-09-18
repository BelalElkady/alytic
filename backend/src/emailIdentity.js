import { DISPOSABLE_EMAIL_DOMAINS } from './config/disposableEmails.js';

const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com']);

const splitEmail = (email) => {
  const value = String(email ?? '').trim().toLowerCase();
  const at = value.lastIndexOf('@');
  return { local: value.slice(0, at), domain: value.slice(at + 1) };
};

/**
 * Collapses the addresses that reach the same mailbox into one string, so
 * `me@gmail.com`, `m.e@gmail.com`, `me+trial2@gmail.com` and
 * `me@googlemail.com` are all "the same person" for the one-trial-per-person
 * rule. Gmail ignores dots and treats googlemail.com as an alias; every
 * provider that supports `+tag` subaddressing (Gmail, Outlook, iCloud, ...)
 * delivers `name+anything` to `name`, so the tag is dropped everywhere.
 *
 * Only ever used for uniqueness — mail is still sent to the address the
 * user typed. The same rule is mirrored in the email_canonical backfill in
 * supabase/schema.sql; change both together.
 */
export function canonicalEmail(email) {
  const { local, domain } = splitEmail(email);
  const base = local.split('+')[0] || local;
  if (GMAIL_DOMAINS.has(domain)) return `${base.replace(/\./g, '')}@gmail.com`;
  return `${base}@${domain}`;
}

export function isDisposableEmail(email) {
  return DISPOSABLE_EMAIL_DOMAINS.has(splitEmail(email).domain);
}
