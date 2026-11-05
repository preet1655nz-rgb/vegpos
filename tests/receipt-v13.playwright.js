// Visual check of v13 receipts. Staff: renders order #36 into the Receipt sheet + order detail (no login needed, fixture only).
// Customer: cart / checkout (real menu, nothing placed) and the thank-you ticket restored from rasoi_last_order.
const pw = require('playwright');
const STAFF = process.env.STAFF || 'http://localhost:8831/', CUST = process.env.CUST || 'http://localhost:8832/', OUT = process.env.OUT || '/workspace/receipt-v13';
const O36 = { id: 'fixture-36', order_no: 36, customer_name: 'Rajvir', customer_phone: null, created_at: new Date().toISOString(),
  pickup_time: new Date(Date.now() + 864e5).toISOString(), status: 'completed', paid: true, payment_method: 'cash', cash_received: 200, change_given: 0, tip: 0,
  subtotal: 200, total: 200, discount: 0, notes: null, items: [
    { productId: 'a', variantIndex: 2, qty: 3, name: 'Veg Momos Steamed', variant: '16pcs', price: 20, pieces: 16 },
    { productId: 'b', variantIndex: 1, qty: 10, name: 'Veg Puff Patties', variant: '3pcs', price: 10, pieces: 3 },
    { productId: 'c', variantIndex: 0, qty: 4, name: 'Veg Spring Roll', variant: '1 plate', price: 10, pieces: 2 }] };
const CART = [{ pid: '796893eb-c6ff-43c2-9178-abcb56da8d33', vidx: 2, label: '16pcs', qty: 3 }, { pid: '786a8721-9eeb-4185-87eb-cd14f2cb8575', vidx: 1, label: '3pcs', qty: 10 },
  { pid: '49ef95c1-f181-450c-8388-273cc6022c14', vidx: 0, label: '1 plate', qty: 4 }, { pid: '81442ca7-4813-40b1-b506-1feabcb64960', vidx: 0, label: 'Half', qty: 2 }];
(async () => {
  const b = await pw.chromium.launch({ executablePath: '/usr/bin/google-chrome' }), R = { errs: [] };
  const dev = (({ defaultBrowserType, ...o }) => o)(pw.devices['iPhone 13']);
  // staff
  let ctx = await b.newContext({ ...dev, timezoneId: 'Pacific/Auckland', locale: 'en-NZ' }), p = await ctx.newPage();
  p.on('pageerror', e => R.errs.push('staff: ' + e.message));
  await p.goto(STAFF, { waitUntil: 'networkidle' }); await p.waitForTimeout(800);
  R.staffText = await p.evaluate(o => { S.orders = [o]; openReceipt(o.id); return receiptText(o); }, O36);
  await p.waitForTimeout(900); await p.screenshot({ path: `${OUT}/staff-receipt-iphone.png` });
  await p.evaluate(() => { const b = document.getElementById('sheet-body'); b.scrollTop = b.scrollHeight; }); await p.waitForTimeout(300);
  await p.screenshot({ path: `${OUT}/staff-receipt-iphone-bottom.png` });
  R.staffReceipt = (await p.locator('.rx-items').innerText()).replace(/\n+/g, ' | ');
  R.logo = await p.$$eval('.rx-head img', ims => ims.map(i => [i.getAttribute('src'), i.naturalWidth]));
  await p.evaluate(o => openOrder(o.id), O36); await p.waitForTimeout(700);
  await p.evaluate(() => { const h = [...document.querySelectorAll('#sheet-body .form-h')].find(x => x.textContent === 'Items'); h && h.scrollIntoView(); });
  await p.screenshot({ path: `${OUT}/staff-order-detail-iphone.png` });
  R.staffDetail = (await p.locator('#sheet-body .list').first().innerText()).replace(/\n+/g, ' | ');
  await p.evaluate(o => { document.getElementById('print-area').innerHTML = receiptHTML(o); }, O36);
  await p.emulateMedia({ media: 'print' }); await p.waitForTimeout(400);
  await p.pdf ? null : null; await p.screenshot({ path: `${OUT}/staff-print.png`, fullPage: true });
  await ctx.close();
  // customer
  ctx = await b.newContext({ ...dev, timezoneId: 'Pacific/Auckland', locale: 'en-NZ' }); p = await ctx.newPage();
  p.on('pageerror', e => R.errs.push('customer: ' + e.message));
  await ctx.addInitScript(c => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', 1); localStorage.setItem('rasoi_cart_v1', JSON.stringify(c)); localStorage.removeItem('rasoi_last_order'); } }, CART);
  await p.goto(CUST, { waitUntil: 'networkidle' }); await p.waitForSelector('.card[data-a="item"]'); await p.waitForTimeout(500);
  await p.click('#cartbar'); await p.waitForSelector('[data-a="checkout"]'); await p.waitForTimeout(500);
  R.custCart = (await p.locator('.lines').innerText()).replace(/\n+/g, ' | ');
  await p.screenshot({ path: `${OUT}/customer-cart-iphone.png` });
  await p.click('[data-a="checkout"]'); await p.waitForSelector('.ck-items'); await p.waitForTimeout(500);
  await p.locator('.ck-items').scrollIntoViewIfNeeded(); await p.screenshot({ path: `${OUT}/customer-checkout-iphone.png` });
  R.custCheckout = (await p.locator('.ck-items').innerText()).replace(/\n+/g, ' | ');
  // simulate the summary placeOrder now saves (no real order is placed)
  R.summaryItems = await p.evaluate(() => S.cart.map(l => { const pr = prod(l.pid), v = lineVar(l), k = linePack(l); return { pid: l.pid, label: l.label, qty: l.qty, name: pr.name, price: v.price, pieces: v.pieces != null ? Number(v.pieces) : null, per: k.per, total: k.total }; }));
  await p.evaluate(items => localStorage.setItem('rasoi_last_order', JSON.stringify({ order_no: 36, total: 220, subtotal: 220, discount: 0, pickup_time: new Date(Date.now() + 864e5).toISOString(), name: 'Rajvir', count: 19, items, open: true })), R.summaryItems);
  await p.reload({ waitUntil: 'networkidle' }); await p.waitForSelector('.tk-items'); await p.waitForTimeout(700);
  await p.screenshot({ path: `${OUT}/customer-done-iphone.png`, fullPage: false });
  await p.evaluate(() => document.getElementById('done').scrollTop = 400); await p.waitForTimeout(200);
  await p.screenshot({ path: `${OUT}/customer-done-iphone-2.png` });
  R.custDone = (await p.locator('.tk-items').innerText()).replace(/\n+/g, ' | ');
  await p.click('[data-a="again"]'); R.afterAgain = await p.evaluate(() => JSON.parse(localStorage.getItem('rasoi_last_order')).open);
  await b.close(); console.log(JSON.stringify(R, null, 1));
})();
