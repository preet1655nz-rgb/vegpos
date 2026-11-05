// v14 check: staff + customer receipts render, Share produces a real PDF (files share, or download when files can't be shared),
// customer menu is one section and Bulk orders & catering is visible. Nothing is placed or written to the database.
const pw = require('playwright'), fs = require('fs');
const STAFF = process.env.STAFF || 'http://localhost:8831/', CUST = process.env.CUST || 'http://localhost:8832/', OUT = process.env.OUT || '/workspace/receipt-v14';
const O36 = { id: 'fixture-36', order_no: 36, customer_name: 'Rajvir', customer_phone: null, created_at: new Date().toISOString(),
  pickup_time: new Date(Date.now() + 864e5).toISOString(), status: 'completed', paid: true, payment_method: 'cash', cash_received: 200, change_given: 0, tip: 0,
  subtotal: 200, total: 200, discount: 0, notes: null, items: [
    { productId: 'a', variantIndex: 2, qty: 3, name: 'Veg Momos Steamed', variant: '16pcs', price: 20, pieces: 16 },
    { productId: 'b', variantIndex: 1, qty: 10, name: 'Veg Puff Patties', variant: '3pcs', price: 10, pieces: 3 },
    { productId: 'c', variantIndex: 0, qty: 4, name: 'Veg Spring Roll', variant: '1 plate', price: 10, pieces: 2 }] };
const C36 = { order_no: 36, total: 200, subtotal: 200, discount: 0, pickup_time: new Date(Date.now() + 864e5).toISOString(), placed_at: new Date().toISOString(), name: 'Rajvir', count: 17, open: true, items: [
  { pid: '796893eb-c6ff-43c2-9178-abcb56da8d33', label: '16pcs', qty: 3, name: 'Veg Momos Steamed', price: 20, pieces: 16 },
  { pid: '786a8721-9eeb-4185-87eb-cd14f2cb8575', label: '3pcs', qty: 10, name: 'Veg Puff Patties', price: 10, pieces: 3 },
  { pid: '49ef95c1-f181-450c-8388-273cc6022c14', label: '1 plate', qty: 4, name: 'Veg Spring Roll', price: 10, pieces: 2 }] };
// stub navigator.share: mode 'files' accepts files and records them; mode 'none' = files unsupported
const shareStub = mode => { window.__shared = null; navigator.canShare = d => mode === 'files' && !!(d && d.files);
  navigator.share = async d => { if (mode !== 'files') throw new TypeError('no'); const f = d.files[0]; window.__shared = { title: d.title, text: d.text || null, name: f.name, type: f.type, size: f.size }; }; };
const b64 = async f => { const u = new Uint8Array(await f.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode(...u.subarray(i, i + 8192)); return btoa(s); };
(async () => {
  const br = await pw.chromium.launch({ executablePath: '/usr/bin/google-chrome' }), R = { errs: [] };
  const dev = (({ defaultBrowserType, ...o }) => o)(pw.devices['iPhone 13']);
  // ---- staff
  let ctx = await br.newContext({ ...dev, timezoneId: 'Pacific/Auckland', locale: 'en-NZ', acceptDownloads: true }), p = await ctx.newPage();
  p.on('pageerror', e => R.errs.push('staff: ' + e.message));
  await p.goto(STAFF, { waitUntil: 'networkidle' }); await p.waitForTimeout(800);
  await p.evaluate(o => { S.orders = [o]; openReceipt(o.id); }, O36); await p.waitForTimeout(1200);
  await p.screenshot({ path: `${OUT}/staff-receipt-sheet.png` });
  // full uncropped: make the iPhone-width viewport tall enough for the whole sheet
  const SH = await p.evaluate(() => document.getElementById('sheet-body').scrollHeight + 260);
  await p.setViewportSize({ width: 390, height: Math.max(844, SH) }); await p.waitForTimeout(500);
  await p.screenshot({ path: `${OUT}/staff-receipt-full.png` });
  await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(300);
  R.staffBtn = await p.locator('[data-a="shareReceipt"]').innerText();
  const sb = await p.evaluate(async o => { const f = await prepReceiptPdf(o); return { name: f.name, type: f.type, size: f.size, b: await (async f => { const u = new Uint8Array(await f.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode(...u.subarray(i, i + 8192)); return btoa(s); })(f) }; }, O36);
  fs.writeFileSync(`${OUT}/rasoi-order-36.pdf`, Buffer.from(sb.b, 'base64')); R.staffPdf = { name: sb.name, type: sb.type, size: sb.size };
  await p.evaluate(shareStub, 'files'); await p.click('[data-a="shareReceipt"]'); await p.waitForTimeout(600);
  R.staffShareFiles = await p.evaluate(() => window.__shared);
  await p.evaluate(shareStub, 'none');
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 8000 }), p.click('[data-a="shareReceipt"]')]);
  R.staffShareNoFiles = { download: dl.suggestedFilename() }; await dl.saveAs(`${OUT}/staff-download-fallback.pdf`);
  await ctx.close();
  // ---- customer
  ctx = await br.newContext({ ...dev, timezoneId: 'Pacific/Auckland', locale: 'en-NZ', acceptDownloads: true }); p = await ctx.newPage();
  p.on('pageerror', e => R.errs.push('customer: ' + e.message));
  await p.goto(CUST, { waitUntil: 'networkidle' }); await p.waitForSelector('.card[data-a="item"]'); await p.waitForTimeout(600);
  R.sections = await p.$$eval('.sec h2', h => h.map(x => x.textContent)); R.chipsVisible = await p.isVisible('#chips');
  R.cards = await p.$$eval('.card .nm', n => n.map(x => x.textContent));
  await p.screenshot({ path: `${OUT}/customer-menu-top.png` });
  await p.locator('#bulk').scrollIntoViewIfNeeded(); await p.waitForTimeout(400);
  R.bulk = await p.locator('#bulk').innerText();
  R.bulkTop = await p.$eval('#bulk h2', h => h.getBoundingClientRect().top);
  await p.screenshot({ path: `${OUT}/customer-bulk.png` });
  await p.evaluate(o => { localStorage.setItem('rasoi_last_order', JSON.stringify(o)); }, C36);
  await p.reload({ waitUntil: 'networkidle' }); await p.waitForSelector('#done .receipt'); await p.waitForTimeout(1200);
  await p.screenshot({ path: `${OUT}/customer-done-viewport.png` });
  // full uncropped: grow viewport to the done screen's scroll height
  const H = await p.evaluate(() => document.getElementById('done').scrollHeight);
  await p.setViewportSize({ width: 390, height: H }); await p.waitForTimeout(400);
  await p.screenshot({ path: `${OUT}/customer-done-full.png` });
  await p.locator('#done .receipt').screenshot({ path: `${OUT}/customer-ticket-full.png` });
  R.custTicket = (await p.locator('#done .receipt').innerText()).replace(/\n+/g, ' | ');
  const cb = await p.evaluate(async () => { const f = await ticketPdf(S.done); const u = new Uint8Array(await f.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode(...u.subarray(i, i + 8192)); return { name: f.name, size: f.size, b: btoa(s) }; });
  fs.writeFileSync(`${OUT}/customer-rasoi-order-36.pdf`, Buffer.from(cb.b, 'base64')); R.custPdf = { name: cb.name, size: cb.size };
  await p.evaluate(shareStub, 'files'); await p.click('[data-a="sharePdf"]'); await p.waitForTimeout(600); R.custShareFiles = await p.evaluate(() => window.__shared);
  await p.evaluate(shareStub, 'none');
  const [d2] = await Promise.all([p.waitForEvent('download', { timeout: 8000 }), p.click('[data-a="sharePdf"]')]); R.custShareNoFiles = { download: d2.suggestedFilename() };
  await br.close(); console.log(JSON.stringify(R, null, 1));
})();
