// Pack maths used on receipts (staff) and the order ticket / cart / checkout (customer).
// Extracts the identical packOf block from both app.js files and checks order #36 + other item types.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const load = f => {
  const src = readFileSync(new URL(f, import.meta.url), 'utf8');
  const a = src.indexOf('const PACK_UNIT'), b = src.indexOf('\n}\n', src.indexOf('function packOf')) + 3;
  assert.ok(a > 0 && b > a, `packOf block in ${f}`);
  return { block: src.slice(a, b), fns: new Function(src.slice(a, b) + '\nreturn { packOf, packNum };')() };
};
const staff = load('../app.js'), cust = load('../customer/app.js');
assert.equal(staff.block, cust.block, 'staff and customer pack maths are identical');
const money = n => '$' + Number(n).toFixed(2);
for (const [who, { packOf, packNum }] of [['staff', staff.fns], ['customer', cust.fns]]) {
  const line = i => { const k = packOf(i.variant, i.pieces, i.qty); return `${i.name}: ${packNum(k.qty)} × ${k.per} (${money(i.price)} each) = ${k.total}    ${money(i.price * i.qty)}`; };
  // order #36 (stock pieces as stored on the order: 16pcs=16, 3pcs=3, "1 plate" uses 2 stock rolls)
  const o36 = [
    { qty: 3, name: 'Veg Momos Steamed', variant: '16pcs', price: 20, pieces: 16 },
    { qty: 10, name: 'Veg Puff Patties', variant: '3pcs', price: 10, pieces: 3 },
    { qty: 4, name: 'Veg Spring Roll', variant: '1 plate', price: 10, pieces: 2 }];
  assert.equal(packOf('16pcs', 16, 3).total, '48 pcs');
  assert.equal(packOf('3pcs', 3, 10).total, '30 pcs');
  assert.equal(packOf('1 plate', 2, 4).total, '4 plates');
  assert.equal(o36.reduce((a, i) => a + i.price * i.qty, 0), 200);
  assert.equal(line(o36[0]), 'Veg Momos Steamed: 3 × 16 pcs ($20.00 each) = 48 pcs    $60.00');
  assert.equal(line(o36[1]), 'Veg Puff Patties: 10 × 3 pcs ($10.00 each) = 30 pcs    $100.00');
  assert.equal(line(o36[2]), 'Veg Spring Roll: 4 × 1 plate ($10.00 each) = 4 plates    $40.00');
  // the user's example: one $20 pack = 16 pcs, two = 32 pcs
  assert.equal(packOf('16pcs', 16, 1).text, '1 × 16 pcs = 16 pcs');
  assert.equal(packOf('16pcs', 16, 2).text, '2 × 16 pcs = 32 pcs');
  // Half / Full: no invented piece count (stock pieces 8/12 ignored)
  assert.equal(packOf('Half', 8, 2).text, '2 × Half = 2 Half');
  assert.equal(packOf('Full', 12, 1).text, '1 × Full = 1 Full');
  // singular / plural
  assert.equal(packOf('1pc', 1, 1).text, '1 × 1 pc = 1 pc');
  assert.equal(packOf('1pc', 1, 3).text, '3 × 1 pc = 3 pcs');
  assert.equal(packOf('1 plate', 2, 1).text, '1 × 1 plate = 1 plate');
  assert.equal(packOf('8pcs', 8, 2).total, '16 pcs');
  assert.equal(packOf('12 pcs', 12, 2).total, '24 pcs');
  // customer menu has no `pieces`: label alone gives the same answer
  assert.equal(packOf('16pcs', undefined, 3).total, '48 pcs');
  // no number in label and no name: fall back to stock pieces
  assert.equal(packOf('', 6, 2).text, '2 × 6 pcs = 12 pcs');
  for (const i of o36) console.log(`[${who}] ${line(i)}`);
}
console.log('receipt pack maths: all assertions passed');
