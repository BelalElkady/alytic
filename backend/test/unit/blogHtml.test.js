import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeBlogContent, sanitizeBlogHtml } from '../../src/blogHtml.js';

test('keeps formatting the editor produces: headings, font size, tables', () => {
  const html =
    '<h2 style="text-align:center">T</h2><p><span style="font-size:24px;color:#ff0000">big</span></p>' +
    '<table><tbody><tr><th colspan="2">h</th></tr><tr><td>a</td><td>b</td></tr></tbody></table>';
  assert.equal(sanitizeBlogHtml(html), html);
});

test('strips scripts, handlers, unsafe styles and javascript: links', () => {
  const out = sanitizeBlogHtml(
    '<p onclick="x()" style="position:fixed;font-size:20px">a</p><script>alert(1)</script>' +
      '<a href="javascript:alert(1)">l</a><iframe src="https://e.com"></iframe><img src="http://e.com/a.png" onerror="x()">',
  );
  assert.ok(!/script|onclick|onerror|javascript:|iframe|position|http:/.test(out), out);
  assert.match(out, /font-size:20px/);
});

test('normalizeBlogContent sanitizes html blocks, passes legacy blocks, rejects malformed ones', () => {
  const ok = normalizeBlogContent([
    { type: 'paragraph', text: 'x' },
    { type: 'html', html: '<p>hi<script>1</script></p>' },
    { type: 'html', html: '<script>1</script>' },
  ]);
  assert.deepEqual(ok, [{ type: 'paragraph', text: 'x' }, { type: 'html', html: '<p>hi</p>' }]);
  assert.equal(normalizeBlogContent([{ type: 'html', html: 5 }]), null);
  assert.equal(normalizeBlogContent([null]), null);
});
