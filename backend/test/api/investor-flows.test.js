import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';

import '../helpers/env.js';
import { startServer, request, registerUser } from '../helpers/server.js';
import { currentSession } from '../../src/investorFlows.js';

let srv;
let cookie;

before(async () => {
  srv = await startServer();
  ({ cookie } = await registerUser(srv.baseUrl));
});

after(async () => {
  await srv?.close();
});

test('GET /api/indices/investor-flows requires sign-in', async () => {
  const res = await request(srv.baseUrl, 'GET', '/api/indices/investor-flows');
  assert.equal(res.status, 401);
});

test('GET /api/indices/investor-flows never serves an older session', async () => {
  const res = await request(srv.baseUrl, 'GET', '/api/indices/investor-flows', { cookie });
  assert.equal(res.status, 200, res.text);
  assert.ok('flows' in res.body);
  if (res.body.flows !== null) {
    assert.equal(res.body.flows.sessionDate, currentSession());
    assert.ok(Array.isArray(res.body.flows.groups));
    assert.match(res.body.flows.sourceUrl, /^https?:\/\//);
  }
});

test('POST /api/cron/investor-flows refuses a request with no secret', async () => {
  const res = await request(srv.baseUrl, 'POST', '/api/cron/investor-flows', { body: {} });
  assert.equal(res.status, 403);
});
