import test from 'node:test';
import assert from 'node:assert/strict';

import { buildHeatmap, OTHER_SECTOR } from '../../src/marketHeatmap.js';

const stocks = [
  { code: 'COMI', ar: 'التجاري الدولي', en: 'CIB', sector: 'banks', marketCapEgp: 400e9, avgTurnoverEgp: 300e6 },
  { code: 'SWDY', ar: 'السويدي إليكتريك', en: 'Elsewedy', sector: 'industrials', marketCapEgp: 200e9, avgTurnoverEgp: 150e6 },
  { code: 'XNEW', ar: null, en: 'New Co', sector: null, marketCapEgp: 1e9, avgTurnoverEgp: 2e6 },
  { code: 'NOQT', ar: 'بلا سعر', en: 'No quote', sector: 'banks', marketCapEgp: 5e9, avgTurnoverEgp: 1e6 },
  { code: 'NOSZ', ar: 'بلا حجم', en: 'No size', sector: 'banks', marketCapEgp: null, avgTurnoverEgp: null },
];
const quotes = new Map([
  ['COMI', { price: 75.4, changePct: 0.07 }],
  ['SWDY', { price: 120, changePct: 8.29 }],
  ['XNEW', { price: 3.1, changePct: -1.5 }],
  ['NOSZ', { price: 10, changePct: 1 }],
]);

test('buildHeatmap: one row per quoted stock with a size, named, sectored and index-tagged', () => {
  const { stocks: rows } = buildHeatmap({ stocks, quotes, membership: { EGX30: ['COMI', 'SWDY'], EGX100: ['comi'] } });
  assert.deepEqual(rows.map((r) => r.code), ['COMI', 'SWDY', 'XNEW']); // NOQT has no quote, NOSZ no size
  const comi = rows[0];
  assert.equal(comi.name, 'التجاري الدولي');
  assert.equal(comi.sectorAr, 'بنوك');
  assert.equal(comi.price, 75.4);
  assert.equal(comi.changePct, 0.07);
  assert.deepEqual(comi.indices, ['EGX30', 'EGX100']);
  assert.deepEqual(rows[1].indices, ['EGX30']);
  assert.deepEqual(rows[2].indices, []);
});

test('buildHeatmap: the screener\'s live size wins over the universe snapshot, which fills the gaps', () => {
  const screener = [{ code: 'COMI', marketCapEgp: 420e9, turnoverEgp: 510e6 }, { code: 'SWDY', marketCapEgp: null, turnoverEgp: 0 }];
  const { stocks: rows } = buildHeatmap({ stocks, quotes, screener });
  assert.equal(rows[0].marketCapEgp, 420e9);
  assert.equal(rows[0].turnoverEgp, 510e6);
  assert.equal(rows[1].marketCapEgp, 200e9);
  assert.equal(rows[1].turnoverEgp, 150e6);
});

test('buildHeatmap: a stock with no sector goes under أخرى, and sectors are counted', () => {
  const { stocks: rows, sectors } = buildHeatmap({ stocks, quotes });
  const other = rows.find((r) => r.code === 'XNEW');
  assert.equal(other.sector, OTHER_SECTOR);
  assert.equal(other.sectorAr, 'أخرى');
  assert.equal(other.name, 'New Co');
  assert.deepEqual(sectors.map((s) => s.key).sort(), ['banks', 'industrials', OTHER_SECTOR].sort());
  assert.ok(sectors.every((s) => s.count === 1));
});

test('buildHeatmap: nothing quoted gives an empty map, not an error', () => {
  assert.deepEqual(buildHeatmap({ stocks, quotes: new Map() }), { stocks: [], sectors: [] });
});
