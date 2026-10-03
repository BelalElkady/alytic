export function normalizeAnnouncementVideoUrl(value) {
  // Guard non-string input
  if (typeof value !== 'string' || value === '') {
    return null;
  }

  // Try YouTube watch URL: https://(www.)?youtube.com/watch?...v=<id>...
  let match = value.match(/^https:\/\/(?:www\.)?youtube\.com\/watch\?.*v=([A-Za-z0-9_-]{11})/);
  if (match) {
    return `https://www.youtube-nocookie.com/embed/${match[1]}`;
  }

  // Try youtu.be short URL: https://youtu.be/<id>
  match = value.match(/^https:\/\/youtu\.be\/([A-Za-z0-9_-]{11})/);
  if (match) {
    return `https://www.youtube-nocookie.com/embed/${match[1]}`;
  }

  // Try Vimeo URL: https://(www.)?vimeo.com/<id>
  match = value.match(/^https:\/\/(?:www\.)?vimeo\.com\/(\d+)/);
  if (match) {
    return `https://player.vimeo.com/video/${match[1]}`;
  }

  return null;
}
