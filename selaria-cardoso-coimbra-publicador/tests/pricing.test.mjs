import test from 'node:test';
import assert from 'node:assert/strict';
import { roundSellingPrice, solvePrice, profitability } from '../netlify/lib/pricing.mjs';

test('roundSellingPrice final 90 never rounds below requested price', () => {
  assert.equal(roundSellingPrice(90.21, '90'), 90.9);
  assert.equal(roundSellingPrice(90.95, '90'), 91.9);
});

test('solvePrice includes marketplace percentage, fixed fee and shipping', () => {
  const r = solvePrice({ cost: 50, packaging: 5, fixed: 10, shipping: 12, marketplaceFixed: 6, taxPct: 8, marginPct: 20, marketplacePct: 14, round: 'none' });
  assert.equal(r.base, 65);
  assert.equal(r.price, 143.11);
});

test('profitability subtracts exact ML fee and shipping', () => {
  const r = profitability({ price: 100, cost: 40, packaging: 5, fixed: 5, shipping: 10, taxPct: 8, saleFeeAmount: 15 });
  assert.equal(r.taxAmount, 8);
  assert.equal(r.profit, 17);
  assert.equal(r.margin, 17);
});
