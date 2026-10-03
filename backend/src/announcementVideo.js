/**
 * The single gate deciding what's safe to put in an <iframe src> elsewhere in the app — only a YouTube or Vimeo watch URL survives; everything else returns null.
 */
export function normalizeAnnouncementVideoUrl(value) {
  // Guard non-string input
  if (typeof value !== 'string') {
    return null;
  }

  // Parse and validate the URL
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  // Only HTTPS URLs are allowed
  if (url.protocol !== 'https:') {
    return null;
  }

  // YouTube watch URL: https://(www.)?youtube.com/watch?v=<11-char-id>
  if ((url.hostname === 'youtube.com' || url.hostname === 'www.youtube.com') && url.pathname === '/watch') {
    const id = url.searchParams.get('v');
    if (id && /^[A-Za-z0-9_-]{11}$/.test(id)) {
      return `https://www.youtube-nocookie.com/embed/${id}`;
    }
  }

  // youtu.be short URL: https://youtu.be/<11-char-id>
  if (url.hostname === 'youtu.be') {
    const id = url.pathname.slice(1);
    if (id && /^[A-Za-z0-9_-]{11}$/.test(id)) {
      return `https://www.youtube-nocookie.com/embed/${id}`;
    }
  }

  // Vimeo URL: https://(www.)?vimeo.com/<numeric-id>
  if ((url.hostname === 'vimeo.com' || url.hostname === 'www.vimeo.com') && url.pathname.startsWith('/')) {
    const id = url.pathname.slice(1);
    if (id && /^\d+$/.test(id)) {
      return `https://player.vimeo.com/video/${id}`;
    }
  }

  return null;
}
