import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_TIER_SETTINGS,
  TIERS,
  isLocked,
  portfolioCapFor,
  resolveTiers,
  sanitizeTierSettings,
  tiersFor,
} from '../../src/billing/plans.js';
import { lockableFeatureFor } from '../../src/billing/features.js';

test('with no overrides the resolved tiers are exactly what shipped before settings existed', () => {
  const tiers = resolveTiers();
  for (const key of ['free', 'long', 'trader']) {
    for (const kind of ['screenshots', 'recommendations', 'cashScans', 'marketAnalysis']) {
      assert.equal(tiers[key][kind], TIERS[key][kind], `${key}.${kind}`);
    }
    assert.equal(tiers[key].label, TIERS[key].label);
    assert.deepEqual(tiers[key].locked, { pages: [], panels: [] });
  }
  assert.equal(tiers.trader.portfolios, 3);
  assert.equal(tiers.long.portfolios, 1);
});

test('a site override beats the platform-wide setting, which beats the defaults, field by field', () => {
  const tiers = resolveTiers(
    { long: { caps: { cashScans: 12, screenshots: 9 }, portfolios: 2 } },
    { long: { caps: { cashScans: 15 } } },
  );
  assert.equal(tiers.long.cashScans, 15);
  assert.equal(tiers.long.screenshots, 9);
  assert.equal(tiers.long.recommendations, TIERS.long.recommendations);
  assert.equal(tiers.long.portfolios, 2);
  assert.equal(tiers.trader.cashScans, TIERS.trader.cashScans);
});

test('a layer replaces lock lists and bullets whole, so a site can unlock what the platform locks', () => {
  const tiers = resolveTiers(
    { free: { locked: { pages: ['charts', 'cash'], panels: ['heatmap'] }, card: { bullets: ['أ', 'ب'] } } },
    { free: { locked: { pages: ['charts'] }, card: { bullets: ['ج'] } } },
  );
  assert.deepEqual(tiers.free.locked.pages, ['charts']);
  assert.deepEqual(tiers.free.locked.panels, ['heatmap']);
  assert.deepEqual(tiers.free.card.bullets, ['ج']);
});

test('an invalid layer is skipped whole instead of taking caps away', () => {
  const tiers = resolveTiers({ long: { caps: { cashScans: 99, screenshots: -1 } } });
  assert.equal(tiers.long.cashScans, TIERS.long.cashScans);
  assert.equal(tiers.long.screenshots, TIERS.long.screenshots);
});

test('a cap of 0 is allowed (it locks the feature) but a negative or fractional one is not', () => {
  assert.deepEqual(sanitizeTierSettings({ free: { caps: { cashScans: 0 } } }), { free: { caps: { cashScans: 0 } } });
  assert.throws(() => sanitizeTierSettings({ free: { caps: { cashScans: -1 } } }), /cashScans/);
  assert.throws(() => sanitizeTierSettings({ free: { caps: { cashScans: 1.5 } } }), /cashScans/);
  assert.throws(() => sanitizeTierSettings({ free: { caps: { cashScans: '' } } }), /cashScans/);
  assert.throws(() => sanitizeTierSettings({ free: { caps: { cashScans: 100_001 } } }), /cashScans/);
});

test('validation refuses unknown tiers, caps, lock keys and over-long text instead of dropping them', () => {
  assert.throws(() => sanitizeTierSettings({ gold: {} }), /gold/);
  assert.throws(() => sanitizeTierSettings({ free: { caps: { widgets: 1 } } }), /widgets/);
  assert.throws(() => sanitizeTierSettings({ free: { locked: { pages: ['portfolio'] } } }), /portfolio/);
  assert.throws(() => sanitizeTierSettings({ free: { card: { name: '' } } }), /مطلوب/);
  assert.throws(() => sanitizeTierSettings({ free: { card: { note: 'x'.repeat(161) } } }), /note/);
  assert.throws(() => sanitizeTierSettings({ free: { card: { bullets: new Array(11).fill('س') } } }), /bullets/);
  assert.throws(() => sanitizeTierSettings({ free: { portfolios: 0 } }), /portfolios/);
  assert.throws(() => sanitizeTierSettings([]), /object/);
});

test('bullets are trimmed and blank lines dropped; duplicate lock keys collapse', () => {
  const clean = sanitizeTierSettings({ long: { card: { bullets: ['  دعم  ', '   ', 'مزايا'] }, locked: { pages: ['charts', 'charts'] } } });
  assert.deepEqual(clean.long.card.bullets, ['دعم', 'مزايا']);
  assert.deepEqual(clean.long.locked.pages, ['charts']);
});

test('tiersFor and portfolioCapFor read the tenant, and fall back to the defaults without one', () => {
  const tenant = { tiers: resolveTiers({ trader: { portfolios: 5 }, free: { locked: { pages: ['cash'] } } }) };
  assert.equal(portfolioCapFor('trader', tenant), 5);
  assert.equal(portfolioCapFor('trader', null), DEFAULT_TIER_SETTINGS.trader.portfolios);
  assert.equal(portfolioCapFor(null, tenant), 1);
  assert.equal(tiersFor(null).long.cashScans, TIERS.long.cashScans);
  assert.equal(isLocked('free', 'page', 'cash', tenant), true);
  assert.equal(isLocked('long', 'page', 'cash', tenant), false);
  assert.equal(isLocked(null, 'page', 'cash', tenant), false);
});

test('lockableFeatureFor maps an API call to the one feature it serves', () => {
  assert.deepEqual(lockableFeatureFor('/indices/investor-flows'), { kind: 'panel', key: 'investorFlows', label: 'تعاملات المستثمرين' });
  assert.equal(lockableFeatureFor('/indices/heatmap').key, 'heatmap');
  assert.equal(lockableFeatureFor('/indices/performance').key, 'indices');
  assert.equal(lockableFeatureFor('/market-analysis').key, 'marketAnalysis');
});

test('a /scan call is a lockable feature only for the cash and market focuses', () => {
  assert.equal(lockableFeatureFor('/scan', { focus: 'cash' }).key, 'cash');
  assert.equal(lockableFeatureFor('/scan', { focus: 'market' }).key, 'marketAnalysis');
  assert.equal(lockableFeatureFor('/scan', {}), null);
  assert.equal(lockableFeatureFor('/scan'), null);
});

test('endpoints shared with other screens are never lockable, so a lock cannot break them', () => {
  for (const path of ['/portfolio', '/history/COMI', '/analyze/COMI', '/quotes', '/indices', '/log']) {
    assert.equal(lockableFeatureFor(path), null, path);
  }
});
