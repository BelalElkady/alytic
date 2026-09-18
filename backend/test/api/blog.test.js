/**
 * The public blog list. The database is the real Supabase project (see
 * helpers/env.js), so these assert how paging behaves for however many posts
 * happen to be published, not a fixed count.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import '../helpers/env.js';

import { startServer, request } from '../helpers/server.js';

const ctx = await startServer();
const { baseUrl } = ctx;

test.after(() => ctx.close());

const list = (query) => request(baseUrl, 'GET', `/api/blog?${query}`);

test('/api/blog reports the page, the page size and the total', async () => {
  const res = await list('limit=2&page=1');
  assert.equal(res.status, 200);
  assert.equal(res.body.page, 1);
  assert.equal(res.body.pageSize, 2);
  assert.equal(typeof res.body.total, 'number');
  assert.ok(res.body.posts.length <= 2);
  assert.ok(res.body.total >= res.body.posts.length);
});

test('/api/blog without a page is the first page — the landing strip and ticker keep working', async () => {
  const bare = await list('limit=3');
  const first = await list('limit=3&page=1');
  assert.equal(bare.status, 200);
  assert.equal(bare.body.page, 1);
  assert.deepEqual(bare.body.posts.map((p) => p.slug), first.body.posts.map((p) => p.slug));
});

test('/api/blog pages never repeat or skip a post', async () => {
  const size = 2;
  const first = await list(`limit=${size}&page=1`);
  const { total } = first.body;
  const seen = [];
  for (let page = 1; page <= Math.ceil(total / size); page++) {
    seen.push(...(await list(`limit=${size}&page=${page}`)).body.posts.map((p) => p.slug));
  }
  assert.equal(seen.length, total, 'every published post is on exactly one page');
  assert.equal(new Set(seen).size, seen.length, 'no post appears on two pages');
});

test('/api/blog past the last page is an empty page that still carries the total', async () => {
  const { total } = (await list('limit=2&page=1')).body;
  const beyond = await list(`limit=2&page=${Math.ceil(total / 2) + 5}`);
  assert.equal(beyond.status, 200);
  assert.deepEqual(beyond.body.posts, []);
  assert.equal(beyond.body.total, total, 'the caller needs the total to find the real last page');
});

test('/api/blog treats a junk page as the first page', async () => {
  for (const page of ['abc', '0', '-3', '']) {
    const res = await list(`limit=2&page=${page}`);
    assert.equal(res.status, 200, `page=${JSON.stringify(page)}`);
    assert.equal(res.body.page, 1, `page=${JSON.stringify(page)}`);
  }
});

test('/api/blog gives every card an excerpt when the post has a description', async () => {
  const { posts } = (await list('limit=50')).body;
  for (const post of posts) {
    assert.ok(post.dek, `${post.slug} has neither a dek nor a meta description to show`);
  }
});
