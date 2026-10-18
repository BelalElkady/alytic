import sanitizeHtml from 'sanitize-html';

// Rich articles written in the admin editor are stored as a single
// { type: 'html', html } block. The HTML is sanitized here, once, on the way in
// — the public blog renders it as-is, so nothing outside this allow-list (no
// scripts, event handlers, iframes or javascript: links) can ever reach readers.

const COLOR = [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d\s.,%]+\)$/i, /^[a-z]+$/i];
const SIZE = [/^\d{1,3}(\.\d+)?(px|rem|em|%)$/];
const STYLES = {
  'font-size': SIZE,
  color: COLOR,
  'background-color': COLOR,
  'text-align': [/^(left|right|center|justify)$/],
  width: SIZE,
  'min-width': SIZE,
};

/** A href that starts with a bare domain ("egxpert.com", "www.egxpert.com/x") becomes an absolute https link. */
export function withHttps(href) {
  const value = String(href).trim();
  return /^(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:[/?#]|$)/i.test(value) ? `https://${value}` : value;
}

const OPTIONS = {
  allowedTags: [
    'p', 'h2', 'h3', 'h4', 'br', 'hr', 'strong', 'b', 'em', 'i', 'u', 's', 'span', 'mark', 'code', 'pre',
    'blockquote', 'ul', 'ol', 'li', 'a', 'img', 'table', 'colgroup', 'col', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  ],
  allowedAttributes: {
    a: ['href', 'target', 'rel'],
    img: ['src', 'alt'],
    th: ['colspan', 'rowspan', 'colwidth', 'style'],
    td: ['colspan', 'rowspan', 'colwidth', 'style'],
    col: ['style'],
    p: ['style'],
    h2: ['style'],
    h3: ['style'],
    h4: ['style'],
    span: ['style'],
    mark: ['style'],
  },
  allowedStyles: { '*': STYLES },
  allowedSchemes: ['https', 'http', 'mailto'],
  allowedSchemesByTag: { img: ['https'] },
  transformTags: {
    a: (tagName, attribs) => ({
      tagName,
      attribs: { ...attribs, ...(attribs.href ? { href: withHttps(attribs.href) } : {}), rel: 'noopener noreferrer nofollow', ...(attribs.target ? { target: '_blank' } : {}) },
    }),
  },
};

export function sanitizeBlogHtml(html) {
  return sanitizeHtml(String(html ?? ''), OPTIONS).trim();
}

/** Returns the blocks with every html block sanitized, or null when a block is malformed. */
export function normalizeBlogContent(content) {
  const out = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') return null;
    if (block.type === 'html') {
      if (typeof block.html !== 'string') return null;
      const html = sanitizeBlogHtml(block.html);
      if (html) out.push({ type: 'html', html });
    } else {
      out.push(block);
    }
  }
  return out;
}
