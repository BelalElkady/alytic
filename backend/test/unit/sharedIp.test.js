import test from 'node:test';
import assert from 'node:assert/strict';

import { sharedIpAccounts } from '../../src/sharedIp.js';

const user = (id, signup_ip, last_login_ip, extra = {}) => ({ id, email: `${id}@x.com`, name: id, signup_ip, last_login_ip, ...extra });

test('sharedIpAccounts: links accounts whose signup or last-login IPs match', () => {
  const shared = sharedIpAccounts([
    user('a', '41.1.1.1', '41.1.1.1'),
    // Signed up elsewhere, last logged in from a's address.
    user('b', '41.2.2.2', '41.1.1.1'),
    user('c', '41.3.3.3', '41.3.3.3'),
  ]);
  assert.deepEqual(shared.get('a'), [{ id: 'b', email: 'b@x.com', name: 'b', ips: ['41.1.1.1'] }]);
  assert.deepEqual(shared.get('b'), [{ id: 'a', email: 'a@x.com', name: 'a', ips: ['41.1.1.1'] }]);
  assert.equal(shared.has('c'), false);
});

test('sharedIpAccounts: lists every shared address once per pair', () => {
  const shared = sharedIpAccounts([user('a', '41.1.1.1', '41.9.9.9'), user('b', '41.9.9.9', '41.1.1.1')]);
  assert.deepEqual(shared.get('a')[0].ips.sort(), ['41.1.1.1', '41.9.9.9']);
});

test('sharedIpAccounts: leaves out staff, excluded ids, loopback and missing IPs', () => {
  const shared = sharedIpAccounts(
    [
      user('a', '41.1.1.1', null),
      user('admin', '41.1.1.1', null, { is_admin: true }),
      user('marketer', '41.1.1.1', null, { is_marketer: true }),
      user('local', '41.1.1.1', null),
      user('d', '127.0.0.1', null),
      user('e', '127.0.0.1', null),
      user('f', null, null),
      user('g', null, null),
    ],
    { excludeIds: ['local'] },
  );
  assert.equal(shared.size, 0);
});
