import test from 'node:test';
import assert from 'node:assert/strict';

import '../helpers/env.js';

import { currentSession, fetchAndSaveInvestorFlows, fetchSlot, validateFlows } from '../../src/investorFlows.js';

// Cairo is UTC+3 in October 2026 (summer time), so 14:30 Cairo is 11:30Z.
const cairo = (isoDate, hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(`${isoDate}T${String(h - 3).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`);
};

const DATE = '2026-10-11';
const group = (nationality, type, netEgp) => ({ nationality, type, netEgp, sharePct: null, buyEgp: null, sellEgp: null });

// Every net sums to zero: nationalities, types, and the six cells.
const groups = () => [
  group('egyptian', 'all', 120e6),
  group('arab', 'all', -30e6),
  group('foreign', 'all', -90e6),
  group('all', 'individual', -10e6),
  group('all', 'institution', 10e6),
  group('egyptian', 'individual', 70e6),
  group('egyptian', 'institution', 50e6),
  group('arab', 'individual', -20e6),
  group('arab', 'institution', -10e6),
  group('foreign', 'individual', -60e6),
  group('foreign', 'institution', -30e6),
];
const result = (over = {}) => ({ found: true, sessionDate: DATE, sourceUrl: 'https://example.com/wrap', groups: groups(), ...over });
const reasonOf = (r) => validateFlows(r, { date: DATE }).reason;

test('a clean result passes', () => {
  const out = validateFlows(result(), { date: DATE });
  assert.equal(out.ok, true);
  assert.equal(out.groups.length, 11);
  assert.equal(out.sourceUrl, 'https://example.com/wrap');
});

test('found false is rejected as not_found', () => {
  assert.equal(reasonOf(result({ found: false })), 'not_found');
});

test('a missing source is no_source; a non-http url is bad_source_url', () => {
  assert.equal(reasonOf(result({ sourceUrl: null })), 'no_source');
  assert.equal(reasonOf(result({ sourceUrl: 'javascript:alert(1)' })), 'bad_source_url');
  assert.equal(reasonOf(result({ sourceUrl: 'ftp://example.com/wrap' })), 'bad_source_url');
  assert.equal(reasonOf(result({ sourceUrl: 'not a url' })), 'bad_source_url');
});

test('a different session date is wrong_date', () => {
  assert.equal(reasonOf(result({ sessionDate: '2026-10-08' })), 'wrong_date');
});

test('a missing foreign total is missing_nationality', () => {
  const list = groups().filter((g) => !(g.nationality === 'foreign' && g.type === 'all'));
  assert.equal(reasonOf(result({ groups: list })), 'missing_nationality');
});

test('a flipped arab sign is nets_do_not_balance', () => {
  const list = groups().map((g) => (g.nationality === 'arab' && g.type === 'all' ? { ...g, netEgp: 30e6 } : g));
  assert.equal(reasonOf(result({ groups: list })), 'nets_do_not_balance');
});

test('rounding noise passes, a 4 % gap fails', () => {
  const totals = (foreign) => [group('egyptian', 'all', 120e6), group('arab', 'all', -30e6), group('foreign', 'all', foreign)];
  assert.equal(validateFlows(result({ groups: totals(-89e6) }), { date: DATE }).ok, true);
  assert.equal(reasonOf(result({ groups: totals(-85e6) })), 'nets_do_not_balance');
});

test('all-zero nets and nets left in millions are implausible_scale', () => {
  const totals = (egyptian, arab, foreign) => [group('egyptian', 'all', egyptian), group('arab', 'all', arab), group('foreign', 'all', foreign)];
  assert.equal(reasonOf(result({ groups: totals(0, 0, 0) })), 'implausible_scale');
  assert.equal(reasonOf(result({ groups: totals(120, -30, -90) })), 'implausible_scale');
});

test('share and gross figures survive only when consistent with the net', () => {
  const list = [
    { ...group('egyptian', 'all', 120e6), sharePct: 70, buyEgp: 500e6, sellEgp: 380e6 }, // net = buy - sell
    { ...group('arab', 'all', -30e6), sharePct: 700, buyEgp: 300, sellEgp: 330 }, // share out of range, gross in millions
    { ...group('foreign', 'all', -90e6), sharePct: 10, buyEgp: 100e6, sellEgp: null }, // only one side stated
  ];
  const out = validateFlows(result({ groups: list }), { date: DATE });
  assert.equal(out.ok, true);
  const [egyptian, arab, foreign] = out.groups;
  assert.deepEqual([egyptian.sharePct, egyptian.buyEgp, egyptian.sellEgp], [70, 500e6, 380e6]);
  assert.deepEqual([arab.sharePct, arab.buyEgp, arab.sellEgp], [null, null, null]);
  assert.deepEqual([foreign.sharePct, foreign.buyEgp, foreign.sellEgp], [10, null, null]);
});

test('the same group twice is duplicate_group', () => {
  const list = [...groups(), group('egyptian', 'all', 120e6)];
  assert.equal(reasonOf(result({ groups: list })), 'duplicate_group');
});

test('a total that disagrees with its cells is total_mismatch', () => {
  const list = [
    group('egyptian', 'all', 120e6),
    group('arab', 'all', -60e6),
    group('foreign', 'all', -60e6),
    group('egyptian', 'individual', 150e6),
    group('egyptian', 'institution', 50e6),
  ];
  assert.equal(reasonOf(result({ groups: list })), 'total_mismatch');
});

test('currentSession: today only once the close has passed', () => {
  assert.equal(currentSession(cairo('2026-10-11', '14:29')), '2026-10-08');
  assert.equal(currentSession(cairo('2026-10-11', '14:30')), '2026-10-11');
  assert.equal(currentSession(cairo('2026-10-09', '12:00')), '2026-10-08'); // Friday
  assert.equal(currentSession(cairo('2026-10-10', '12:00')), '2026-10-08'); // Saturday
  assert.equal(currentSession(cairo('2026-10-08', '18:00')), '2026-10-08');
});

test('fetchSlot: hourly from 15:30 to 20:30 on trading days only', () => {
  assert.equal(fetchSlot(cairo('2026-10-11', '15:29')), null);
  assert.deepEqual(fetchSlot(cairo('2026-10-11', '15:30')), { date: '2026-10-11', slot: 0 });
  assert.deepEqual(fetchSlot(cairo('2026-10-11', '20:45')), { date: '2026-10-11', slot: 5 });
  assert.equal(fetchSlot(cairo('2026-10-11', '21:30')), null);
  assert.equal(fetchSlot(cairo('2026-10-09', '16:00')), null); // Friday
});

// ---- fetchAndSaveInvestorFlows ----------------------------------------------

const fakes = ({ existing = null, data = result(), throws = false } = {}) => {
  const calls = { request: 0, saved: [] };
  return {
    calls,
    request: async () => {
      calls.request += 1;
      if (throws) throw new Error('boom');
      return { data };
    },
    store: { get: async () => existing, save: async (row) => calls.saved.push(row) },
  };
};
const run = (f, extra = {}) => fetchAndSaveInvestorFlows({ date: DATE, request: f.request, store: f.store, ...extra });

test('saves a valid result once', async () => {
  const f = fakes();
  assert.deepEqual(await run(f), { status: 'saved' });
  assert.equal(f.calls.request, 1);
  assert.equal(f.calls.saved.length, 1);
  assert.equal(f.calls.saved[0].sessionDate, DATE);
  assert.equal(f.calls.saved[0].sourceUrl, 'https://example.com/wrap');
  assert.equal(f.calls.saved[0].groups.length, 11);
});

test('an existing row costs no AI call', async () => {
  const f = fakes({ existing: { sessionDate: DATE } });
  assert.deepEqual(await run(f), { status: 'exists' });
  assert.equal(f.calls.request, 0);
  assert.equal(f.calls.saved.length, 0);
});

test('force replaces an existing row', async () => {
  const f = fakes({ existing: { sessionDate: DATE } });
  assert.deepEqual(await run(f, { force: true }), { status: 'saved' });
  assert.equal(f.calls.request, 1);
  assert.equal(f.calls.saved.length, 1);
});

test('an invalid result is rejected and not saved', async () => {
  const flipped = groups().map((g) => (g.nationality === 'arab' && g.type === 'all' ? { ...g, netEgp: 30e6 } : g));
  const f = fakes({ data: result({ groups: flipped }) });
  assert.deepEqual(await run(f), { status: 'rejected', reason: 'nets_do_not_balance' });
  assert.equal(f.calls.saved.length, 0);
});

test('found false is not_found and a throwing request is error, neither saves', async () => {
  const missing = fakes({ data: result({ found: false }) });
  assert.deepEqual(await run(missing), { status: 'not_found' });
  const broken = fakes({ throws: true });
  assert.deepEqual(await run(broken), { status: 'error' });
  assert.equal(missing.calls.saved.length + broken.calls.saved.length, 0);
});
