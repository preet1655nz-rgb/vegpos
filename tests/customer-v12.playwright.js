const pw = require('playwright');
const PLACE = process.env.PLACE === '1', URL = process.env.URL || 'http://localhost:8820/', OUT = '/workspace/batch-v12', SUF = process.env.SUF || '';
const MAN = '81442ca7-4813-40b1-b506-1feabcb64960';
(async () => {
  const b = await pw.chromium.launch({ executablePath: '/usr/bin/google-chrome' }); const R = {};
  for (const name of (process.env.SIZES || 'iphone,desktop').split(',')) {
    const opts = name === 'iphone' ? (({ defaultBrowserType, ...o }) => o)(pw.devices['iPhone 13']) : { viewport: { width: 1280, height: 900 } };
    const ctx = await b.newContext({ ...opts, timezoneId: 'Pacific/Auckland', locale: 'en-NZ' });
    // a cart saved before the rename (old label "8pcs" for Manchurian)
    await ctx.addInitScript(m => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', 1); localStorage.setItem('rasoi_cart_v1', JSON.stringify([{ pid: m, vidx: 0, label: '8pcs', qty: 1 }])); } }, MAN);
    const p = await ctx.newPage(), r = R[name] = { errs: [], rpc: [] };
    p.on('pageerror', e => r.errs.push(e.message)); p.on('console', m => m.type() === 'error' && r.errs.push(m.text()));
    p.on('response', async x => { if (x.url().includes('/rpc/place_customer_order')) r.rpc.push([x.status(), (await x.text().catch(() => '')).slice(0, 200)]); });
    await p.goto(URL, { waitUntil: 'networkidle' }); await p.waitForSelector('.card[data-a="item"]', { timeout: 15000 }); await p.waitForTimeout(600);
    r.menu = await p.$$eval('.card[data-a="item"]', cs => cs.map(c => c.querySelector('.nm').childNodes[0].textContent.trim() + ': ' + c.querySelector('.vs').innerText.replace(/\s+/g, ' ')));
    r.soldOutText = (await p.locator('body').innerText()).match(/sold out/ig) || [];
    r.soldoutEls = await p.locator('.soldout, .badge-so, .so-tag, .vs .x, input[disabled][name=var]').count();
    r.cartAfterLoad = await p.evaluate(() => JSON.parse(localStorage.getItem('rasoi_cart_v1')));
    await p.screenshot({ path: `${OUT}/customer-${name}-menu${SUF}.png`, fullPage: name === 'iphone' });
    await p.click(`.card[data-id="${MAN}"]`); await p.waitForSelector('[data-a="addItem"]'); await p.waitForTimeout(400);
    r.manOptions = (await p.locator('.opts').innerText()).replace(/\s+/g, ' ');
    await p.click('.opt:has-text("Full")'); await p.waitForTimeout(200);
    await p.screenshot({ path: `${OUT}/customer-${name}-manchurian-sizes${SUF}.png` });
    await p.click('[data-a="addItem"]'); await p.waitForTimeout(700);
    await p.click('#cartbar'); await p.waitForSelector('[data-a="checkout"]'); await p.waitForTimeout(400);
    r.cart = (await p.locator('#sheet-body').innerText()).replace(/\s+/g, ' ').slice(0, 200);
    await p.click('[data-a="checkout"]'); await p.waitForSelector('#ck-name'); await p.waitForTimeout(800);
    r.phoneLabel = (await p.locator('label[for=ck-phone]').innerText()).trim(); r.phoneRequired = await p.$eval('#ck-phone', e => e.required);
    await p.fill('#ck-name', 'ZZTEST v12 push'); await p.fill('#ck-phone', '');
    await p.click('#place'); await p.waitForTimeout(500);
    r.noPhone = { toast: (await p.textContent('#toast')).trim(), help: (await p.textContent('#ck-phone-h')).trim(), invalid: await p.$eval('#ck-phone', e => e.getAttribute('aria-invalid')) };
    await p.screenshot({ path: `${OUT}/customer-${name}-phone-required${SUF}.png` });
    await p.fill('#ck-phone', '12 34'); await p.click('#place'); await p.waitForTimeout(500);
    r.badPhone = (await p.textContent('#ck-phone-h')).trim();
    await p.fill('#ck-phone', '021 168 0000'); await p.waitForTimeout(1500);
    r.helpAfterFix = (await p.textContent('#ck-phone-h')).trim(); r.total = (await p.locator('#place').innerText()).replace(/\s+/g, ' ');
    await p.screenshot({ path: `${OUT}/customer-${name}-checkout${SUF}.png` });
    if (PLACE && name === 'iphone') {
      await p.click('#place'); await p.waitForTimeout(6000);
      r.done = (await p.textContent('#done')).replace(/\s+/g, ' ').slice(0, 300); r.toast = (await p.textContent('#toast')).trim();
      await p.screenshot({ path: `${OUT}/customer-${name}-confirmation${SUF}.png` });
    }
    await ctx.close();
  }
  console.log(JSON.stringify(R, null, 1)); await b.close();
})().catch(e => { console.log('SCRIPT ERROR', e.message); process.exit(1); });
