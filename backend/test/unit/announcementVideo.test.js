import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAnnouncementVideoUrl } from '../../src/announcementVideo.js';

test('normalizeAnnouncementVideoUrl embeds a youtube.com watch URL', () => {
  assert.equal(
    normalizeAnnouncementVideoUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s'),
    'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
  );
});

test('normalizeAnnouncementVideoUrl embeds a youtu.be short URL', () => {
  assert.equal(
    normalizeAnnouncementVideoUrl('https://youtu.be/dQw4w9WgXcQ'),
    'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
  );
});

test('normalizeAnnouncementVideoUrl embeds a vimeo.com URL', () => {
  assert.equal(
    normalizeAnnouncementVideoUrl('https://vimeo.com/76979871'),
    'https://player.vimeo.com/video/76979871',
  );
});

test('normalizeAnnouncementVideoUrl rejects a non-https URL', () => {
  assert.equal(normalizeAnnouncementVideoUrl('http://www.youtube.com/watch?v=dQw4w9WgXcQ'), null);
});

test('normalizeAnnouncementVideoUrl rejects an unrelated host', () => {
  assert.equal(normalizeAnnouncementVideoUrl('https://evil.example.com/watch?v=dQw4w9WgXcQ'), null);
});

test('normalizeAnnouncementVideoUrl rejects non-string and empty input', () => {
  assert.equal(normalizeAnnouncementVideoUrl(''), null);
  assert.equal(normalizeAnnouncementVideoUrl(undefined), null);
  assert.equal(normalizeAnnouncementVideoUrl(null), null);
});
