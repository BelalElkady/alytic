import test from 'node:test';
import assert from 'node:assert/strict';

import '../helpers/env.js';

import { billingPeriod, createLiveQuotePool, liveQuotesConfigFromEnv } from '../../src/data/live-quote-pool.js';
import { OanorError, classifyOanorStatus, fetchOanorQuotes } from '../../src/data/oanor.js';

const quote = (price) => ({ price, change: 0.1, changePct: 1, time: 1_700_000_000 });

/**
 * A pool with fake feeds and a hand-driven clock. `oanor` answers with price
 * 100 for every code unless a test replaces it; `tv` answers 50. Every oanor
 * call's codes are recorded in `h.oanorCalls`.
 */
function harness({ config = {}, stored = null, oanor, sessionOpen = true, ...overrides } = {}) {
  const h = {
    t: Date.UTC(2026, 8, 15, 9, 0), // 2026-09-15, inside the Sep billing period
    oanorCalls: [],
    tvCalls: [],
    saved: [],
    stored,
  };
  h.pool = createLiveQuotePool({
    config: { enabled: true, userIds: null, monthlyQuota: null, billingDay: 1, compare: false, ratePerSec: 1000, ...config },
    fetchOanor: async (codes) => {
      h.oanorCalls.push(codes);
      if (oanor) return oanor(codes);
      return new Map(codes.map((code) => [code, quote(100)]));
    },
    fetchTv: async (codes) => {
      h.tvCalls.push(codes);
      return new Map(codes.map((code) => [code, quote(50)]));
    },
    sessionOpen: () => sessionOpen,
    usageStore: {
      load: async (periodStart) => (h.stored?.periodStart === periodStart ? h.stored : null),
      save: async (periodStart, state) => {
        h.saved.push({ periodStart, ...state });
      },
    },
    now: () => h.t,
    coalesceMs: 5,
    ...overrides,
  });
  return h;
}

const subscriber = { subscribed: true, userId: 'u1' };

test('non-subscribers get TradingView and oanor is never called', async () => {
  const h = harness();
  const quotes = await h.pool.fetchLiveQuotes(['comi', 'EGX:SWDY'], { subscribed: false, userId: 'u1' });
  assert.deepEqual([...quotes.keys()].sort(), ['COMI', 'SWDY']);
  assert.equal(quotes.get('COMI').price, 50);
  assert.equal(h.oanorCalls.length, 0);
});

test('oanor stays off when disabled, and outside the EGX session', async () => {
  const off = harness({ config: { enabled: false } });
  assert.equal((await off.pool.fetchLiveQuotes(['COMI'], subscriber)).get('COMI').price, 50);
  assert.equal(off.oanorCalls.length, 0);

  const closed = harness({ sessionOpen: false });
  assert.equal((await closed.pool.fetchLiveQuotes(['COMI'], subscriber)).get('COMI').price, 50);
  assert.equal(closed.oanorCalls.length, 0);
});

test('subscribers get oanor, with no invented timestamp', async () => {
  const h = harness();
  const quotes = await h.pool.fetchLiveQuotes(['COMI'], subscriber);
  assert.equal(quotes.get('COMI').price, 100);
  assert.equal(quotes.get('COMI').time, null);
  assert.equal(h.tvCalls.length, 0);
});

test('a code oanor does not answer for comes from TradingView in the same call', async () => {
  const h = harness({ oanor: async () => new Map([['COMI', quote(100)]]) });
  const quotes = await h.pool.fetchLiveQuotes(['COMI', 'SWDY'], subscriber);
  assert.equal(quotes.get('COMI').price, 100);
  assert.equal(quotes.get('SWDY').price, 50);
  assert.deepEqual(h.tvCalls, [['SWDY']]);
});

test('concurrent subscribers share one oanor call, chunked 20 codes at a time', async () => {
  const h = harness();
  const a = Array.from({ length: 30 }, (_, i) => `A${i}`);
  const b = [...a.slice(0, 10), ...Array.from({ length: 15 }, (_, i) => `B${i}`)];
  await Promise.all([
    h.pool.fetchLiveQuotes(a, { subscribed: true, userId: 'u1' }),
    h.pool.fetchLiveQuotes(b, { subscribed: true, userId: 'u2' }),
  ]);
  const requested = h.oanorCalls.flat();
  assert.equal(requested.length, 45, 'each distinct code requested once');
  assert.equal(new Set(requested).size, 45);
  assert.equal(h.oanorCalls.length, 3);
  assert.ok(h.oanorCalls.every((chunk) => chunk.length <= 20));
});

test('a cached quote serves every subscriber until it is 15s old', async () => {
  const h = harness();
  await h.pool.fetchLiveQuotes(['COMI'], subscriber);
  h.t += 14_000;
  await h.pool.fetchLiveQuotes(['COMI'], { subscribed: true, userId: 'u2' });
  assert.equal(h.oanorCalls.length, 1);
  h.t += 2_000;
  await h.pool.fetchLiveQuotes(['COMI'], subscriber);
  assert.equal(h.oanorCalls.length, 2);
});

test('a rate limit opens the breaker: TradingView for 60s, then oanor again', async () => {
  let fail = true;
  const h = harness({
    oanor: async (codes) => {
      if (fail) throw new OanorError('429', { kind: 'transient', status: 429 });
      return new Map(codes.map((code) => [code, quote(100)]));
    },
  });
  assert.equal((await h.pool.fetchLiveQuotes(['COMI'], subscriber)).get('COMI').price, 50);
  fail = false;
  h.t += 30_000;
  assert.equal((await h.pool.fetchLiveQuotes(['COMI'], subscriber)).get('COMI').price, 50);
  assert.equal(h.oanorCalls.length, 1, 'no call while the breaker is open');
  h.t += 31_000;
  assert.equal((await h.pool.fetchLiveQuotes(['COMI'], subscriber)).get('COMI').price, 100);
  const status = await h.pool.status();
  assert.equal(status.period.rolledBack, false, 'a rate limit is not a quota rollback');
  assert.equal(status.counters.breakerOpens, 1);
  assert.equal(status.events[0].type, 'breaker');
});

test('a slow oanor falls back to TradingView after the timeout', async () => {
  const h = harness({ oanor: () => new Promise(() => {}), timeoutMs: 20 });
  const quotes = await h.pool.fetchLiveQuotes(['COMI'], subscriber);
  assert.equal(quotes.get('COMI').price, 50);
});

test('oanor saying the quota is used up rolls back to TradingView until the reset', async () => {
  const h = harness({ oanor: async () => { throw new OanorError('402', { kind: 'quota', status: 402 }); } });
  assert.equal((await h.pool.fetchLiveQuotes(['COMI'], subscriber)).get('COMI').price, 50);
  assert.ok(h.saved.at(-1).exhaustedAt, 'the rollback is persisted');
  let status = await h.pool.status();
  assert.equal(status.state, 'rolled_back');
  assert.equal(status.period.reason, 'oanor');
  assert.equal(status.period.resetsOn, '2026-10-01');
  assert.equal(status.events.filter((e) => e.type === 'rollback').length, 1);

  // Days later in the same period: no more oanor calls, still one rollback.
  h.t += 5 * 86_400_000;
  assert.equal((await h.pool.fetchLiveQuotes(['SWDY'], subscriber)).get('SWDY').price, 50);
  assert.equal(h.oanorCalls.length, 1);
  status = await h.pool.status();
  assert.equal(status.counters.rollbacks, 1);
});

test('our own count stops at 95% of OANOR_MONTHLY_QUOTA', async () => {
  const h = harness({ config: { monthlyQuota: 100 }, stored: { periodStart: '2026-09-01', calls: 94 } });
  await h.pool.fetchLiveQuotes(['COMI'], subscriber); // call 95: allowed
  assert.equal(h.oanorCalls.length, 1);
  h.t += 20_000;
  const quotes = await h.pool.fetchLiveQuotes(['COMI'], subscriber); // call 96 would pass 95
  assert.equal(quotes.get('COMI').price, 50);
  assert.equal(h.oanorCalls.length, 1);
  const status = await h.pool.status();
  assert.equal(status.state, 'rolled_back');
  assert.equal(status.period.reason, 'count');
  assert.equal(status.period.stopAt, 95);
  assert.equal(h.saved.at(-1).calls, 95);
});

test('a rollback stored before a restart still holds, and a new period resets it', async () => {
  const stored = { periodStart: '2026-09-01', calls: 95, quota: 100, reason: 'count', exhaustedAt: '2026-09-10T10:00:00Z' };
  const h = harness({ config: { monthlyQuota: 100 }, stored });
  assert.equal((await h.pool.fetchLiveQuotes(['COMI'], subscriber)).get('COMI').price, 50);
  assert.equal(h.oanorCalls.length, 0);
  const status = await h.pool.status();
  assert.equal(status.state, 'rolled_back', 'the admin tab still shows it after a restart');
  assert.equal(status.period.since, '2026-09-10T10:00:00Z');

  h.t = Date.UTC(2026, 9, 1, 9, 0); // 2026-10-01: the next period
  assert.equal((await h.pool.fetchLiveQuotes(['COMI'], subscriber)).get('COMI').price, 100);
  assert.equal(h.oanorCalls.length, 1);
});

test('raising OANOR_MONTHLY_QUOTA after an upgrade lifts the rollback at once', async () => {
  const stored = { periodStart: '2026-09-01', calls: 95, quota: 100, reason: 'count', exhaustedAt: '2026-09-10T10:00:00Z' };
  const h = harness({ config: { monthlyQuota: 1000 }, stored });
  assert.equal((await h.pool.fetchLiveQuotes(['COMI'], subscriber)).get('COMI').price, 100);
});

test('the allowlist narrows subscribers; it never lets a non-subscriber in', async () => {
  const h = harness({ config: { userIds: new Set(['owner']) } });
  assert.equal((await h.pool.fetchLiveQuotes(['COMI'], { subscribed: true, userId: 'u1' })).get('COMI').price, 50);
  assert.equal((await h.pool.fetchLiveQuotes(['COMI'], { subscribed: false, userId: 'owner' })).get('COMI').price, 50);
  assert.equal(h.oanorCalls.length, 0);
  assert.equal((await h.pool.fetchLiveQuotes(['COMI'], { subscribed: true, userId: 'owner' })).get('COMI').price, 100);
});

test('outside the EGX session even a subscriber gets TradingView, and oanor is never called', async () => {
  const h = harness({ sessionOpen: false, config: { compare: true } });
  for (const userId of ['u1', 'u2', 'u3']) {
    assert.equal((await h.pool.fetchLiveQuotes(['COMI', 'SWDY'], { subscribed: true, userId })).get('COMI').price, 50);
  }
  assert.equal(h.oanorCalls.length, 0);
  assert.equal((await h.pool.status()).counters.oanorCalls, 0);
});

test('billingPeriod: periods start on the billing day and run a month', () => {
  assert.deepEqual(billingPeriod(Date.UTC(2026, 8, 15), 1), { start: '2026-09-01', next: '2026-10-01' });
  assert.deepEqual(billingPeriod(Date.UTC(2026, 8, 3), 10), { start: '2026-08-10', next: '2026-09-10' });
  assert.deepEqual(billingPeriod(Date.UTC(2026, 0, 5), 10), { start: '2025-12-10', next: '2026-01-10' });
  assert.deepEqual(billingPeriod(Date.UTC(2026, 1, 28), 31), { start: '2026-02-28', next: '2026-03-28' }, 'capped at 28');
});

test('liveQuotesConfigFromEnv: oanor needs the flag, a key and a written client', () => {
  const env = { OANOR_ENABLED: '1', OANOR_API_KEY: 'k', OANOR_MONTHLY_QUOTA: '50000', OANOR_USER_IDS: 'a, b' };
  const ready = liveQuotesConfigFromEnv(env, true);
  assert.equal(ready.enabled, true);
  assert.equal(ready.monthlyQuota, 50000);
  assert.deepEqual([...ready.userIds], ['a', 'b']);
  assert.equal(liveQuotesConfigFromEnv(env, false).enabled, false);
  assert.equal(liveQuotesConfigFromEnv({ ...env, OANOR_API_KEY: '' }, true).enabled, false);
  assert.equal(liveQuotesConfigFromEnv({ ...env, OANOR_ENABLED: '' }, true).enabled, false);
  assert.equal(liveQuotesConfigFromEnv({}, true).userIds, null);
});

test('falling back is silent: nothing is written to the server log', async () => {
  const written = [];
  const saved = { ...console };
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) console[level] = (...args) => written.push(args);
  try {
    const failing = harness({ oanor: async () => { throw new OanorError('429', { kind: 'transient', status: 429 }); } });
    await failing.pool.fetchLiveQuotes(['COMI'], subscriber);
    const quota = harness({ oanor: async () => { throw new OanorError('402', { kind: 'quota', status: 402 }); } });
    await quota.pool.fetchLiveQuotes(['COMI'], subscriber);
    const counted = harness({ config: { monthlyQuota: 10 }, stored: { periodStart: '2026-09-01', calls: 9 } });
    await counted.pool.fetchLiveQuotes(['COMI'], subscriber);
    const slow = harness({ oanor: () => new Promise(() => {}), timeoutMs: 20 });
    await slow.pool.fetchLiveQuotes(['COMI'], subscriber);
    const brokenStore = harness({ usageStore: { load: async () => { throw new Error('db down'); }, save: async () => { throw new Error('db down'); } } });
    await brokenStore.pool.fetchLiveQuotes(['COMI'], subscriber);
    await new Promise((resolve) => setTimeout(resolve, 20));
  } finally {
    Object.assign(console, saved);
  }
  assert.deepEqual(written, []);
});

test('status: off when disabled, ok with counters and gaps otherwise', async () => {
  const off = harness({ config: { enabled: false } });
  assert.equal((await off.pool.status()).state, 'off');

  const h = harness({ config: { compare: true, monthlyQuota: 1000 } });
  await h.pool.fetchLiveQuotes(['COMI', 'SWDY'], subscriber);
  await new Promise((resolve) => setTimeout(resolve, 5));
  const status = await h.pool.status();
  assert.equal(status.state, 'ok');
  assert.equal(status.period.calls, 1);
  assert.equal(status.period.quota, 1000);
  assert.equal(status.counters.fromOanor, 2);
  assert.deepEqual(status.gaps.map((g) => g.code).sort(), ['COMI', 'SWDY']);
  assert.equal(Math.round(status.gaps[0].pct), 100, 'oanor 100 vs TradingView 50');
});

test('calls start no faster than the plan allows per second', async () => {
  const starts = [];
  const h = harness({
    config: { ratePerSec: 10 },
    now: () => Date.now(),
    oanor: async (codes) => {
      starts.push(Date.now());
      return new Map(codes.map((code) => [code, quote(100)]));
    },
  });
  await h.pool.fetchLiveQuotes(Array.from({ length: 60 }, (_, i) => `C${i}`), subscriber);
  assert.equal(starts.length, 3);
  assert.ok(starts[2] - starts[0] >= 180, `3 calls at 10/s span at least ~200ms, got ${starts[2] - starts[0]}ms`);
});

// ---------------------------------------------------------------------------
// The oanor client itself, against a fake fetch shaped like its documented API.
// ---------------------------------------------------------------------------

function fakeFetch(status, body) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return { ok: status >= 200 && status < 300, status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
  };
  return { impl, calls };
}

test('fetchOanorQuotes: sends the key and codes, reads price/change/change_percent', async () => {
  const { impl, calls } = fakeFetch(200, {
    success: true,
    status: 'ok',
    data: {
      count: 3,
      quotes: [
        { ticker: 'COMI', price: 134.76, change: 3.07, change_percent: 2.33 },
        { ticker: 'TMGH', price: 95.68, change: 2.77, change_percent: 2.98 },
        { ticker: 'XXXX', price: 1, change: 0, change_percent: 0 },
      ],
    },
  });
  const quotes = await fetchOanorQuotes(['comi', 'TMGH', 'SWDY'], { apiKey: 'oanor_live_x', fetchImpl: impl });
  assert.equal(calls[0].url, 'https://api.oanor.com/egx-api/v1/quote?codes=COMI%2CTMGH%2CSWDY');
  assert.equal(calls[0].init.headers['x-oanor-key'], 'oanor_live_x');
  assert.deepEqual(quotes.get('COMI'), { price: 134.76, change: 3.07, changePct: 2.33 });
  assert.equal(quotes.get('TMGH').price, 95.68);
  assert.equal(quotes.has('SWDY'), false, 'a code oanor skipped is just missing');
  assert.equal(quotes.has('XXXX'), false, 'a code we did not ask for is ignored');
});

test('fetchOanorQuotes: 402 and a quota-worded 429 are quota; other failures are transient', async () => {
  const kindOf = async (status, body) => {
    try {
      await fetchOanorQuotes(['COMI'], { apiKey: 'k', fetchImpl: fakeFetch(status, body).impl });
    } catch (err) {
      return err.kind;
    }
    return 'no error';
  };
  assert.equal(await kindOf(402, { success: false, message: 'subscription_required' }), 'quota');
  assert.equal(await kindOf(429, { message: 'Monthly quota exceeded' }), 'quota');
  assert.equal(await kindOf(429, { message: 'Too many requests' }), 'transient');
  assert.equal(await kindOf(503, 'upstream down'), 'transient');
  assert.equal(await kindOf(200, 'not json'), 'transient');
  assert.equal(await kindOf(200, { success: false, message: 'monthly quota reached' }), 'quota');
  assert.equal(classifyOanorStatus(500), 'transient');
});

test('fetchOanorQuotes: a network failure or timeout is transient', async () => {
  const down = async () => { throw new TypeError('fetch failed'); };
  await assert.rejects(fetchOanorQuotes(['COMI'], { apiKey: 'k', fetchImpl: down }), (err) => err.kind === 'transient');
  const hang = (_url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
  await assert.rejects(
    fetchOanorQuotes(['COMI'], { apiKey: 'k', timeoutMs: 20, fetchImpl: hang }),
    (err) => err.kind === 'transient' && /timed out/.test(err.message),
  );
});
