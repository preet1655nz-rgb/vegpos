const { chromium } = require('playwright');
const PAGE = process.env.URL || 'http://localhost:8821/', OUT = '/workspace/staff-fix', SUF = process.env.SUF || '';
const now = Date.now(), iso = t => new Date(t).toISOString(), ME = 'tester@example.com';
const settings = { id: 1, business_name: 'rasoi', low_stock_default: 10, open_time: '12:00:00', close_time: '21:00:00', min_notice_minutes: 60, slot_minutes: 15, max_days_ahead: 14, open_days: [1,2,3,4,5,6,7], loyalty_enabled: true, loyalty_earn_per_dollar: 1, loyalty_redeem_points: 100, loyalty_redeem_value: 10, staff_whatsapp: '021 555 0123', updated_at: iso(now) };
const mk = (n, o) => ({ id: `00000000-0000-4000-8000-0000000000${n}`, order_no: n, customer_phone: null, discount: 0, paid: false, locked: false, created_at: iso(now - 3600e3), created_by: ME, items: [{ name: 'Veg Spring Roll', variant: '4pcs', qty: 1, price: 8 }], subtotal: 8, total: 8, ...o });
const INS0 = mk(91, { customer_name: 'ZZTEST stages', customer_phone: '021 168 0000', pickup_time: iso(Math.ceil((now + 2 * 3600e3) / 900e3) * 900e3), status: 'pending', created_by: 'customer-app', created_at: iso(now),
  items: [{ name: 'Veg Momos Steamed', variant: '8pcs', qty: 2, price: 10 }, { name: 'Veg Puff Patties', variant: '3pcs', qty: 1, price: 10 }], subtotal: 30, total: 30 });
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
  const out = {};
  for (const [name, opts] of [['iphone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }], ['desktop', { viewport: { width: 1366, height: 900 } }]]) {
    const fx = { settings: [settings], staff: [{ email: ME, name: 'Tester', role: 'owner', created_at: iso(now) }], products: [], stock_movements: [], stock_items: [], customers: [], promotions: [],
      orders: [mk(90, { customer_name: 'ZZTEST legacy ready', pickup_time: iso(now + 3600e3), status: 'ready' }), mk(7, { customer_name: 'Locked legacy', pickup_time: iso(now - 86400e3), status: 'preparing', locked: true, paid: true, payment_method: 'cash' }),
        mk(22, { customer_name: 'Real done', pickup_time: iso(now - 7200e3), status: 'completed', paid: true, payment_method: 'cash' })] };
    const calls = [], ins = JSON.parse(JSON.stringify(INS0));
    const ctx = await b.newContext({ ...opts, timezoneId: 'Pacific/Auckland' });
    await ctx.addInitScript(me => { const exp = Math.floor(Date.now() / 1000) + 86400;
      localStorage.setItem('sb-sjjesqyqaikivonjuxfs-auth-token', JSON.stringify({ access_token: 'x.' + btoa(JSON.stringify({ exp, sub: 'u1', email: me, role: 'authenticated' })) + '.y', token_type: 'bearer', expires_in: 86400, expires_at: exp, refresh_token: 'r', user: { id: 'u1', email: me, aud: 'authenticated', role: 'authenticated' } }));
      window.confirm = () => true; }, ME);
    await ctx.route('https://sjjesqyqaikivonjuxfs.supabase.co/**', async r => {
      const u = new globalThis.URL(r.request().url());
      const rp = u.pathname.match(/rest\/v1\/rpc\/([a-z_]+)/);
      if (rp) { const a = JSON.parse(r.request().postData() || '{}'); calls.push([rp[1], a]); const o = fx.orders.find(x => x.id === a.p_order_id) || ins;
        if (rp[1] === 'set_order_status') o.status = a.p_status;
        if (rp[1] === 'complete_order') { if (!o.paid) { const rec = a.p_cash_received ?? o.total, ex = +(rec - o.total).toFixed(2); Object.assign(o, { paid: true, payment_method: 'cash', cash_received: rec, tip: a.p_keep_tip ? ex : 0, change_given: a.p_keep_tip ? 0 : ex }); } o.status = 'completed'; }
        await new Promise(z => setTimeout(z, 250));
        return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) }); }
      const m = u.pathname.match(/rest\/v1\/([a-z_]+)/);
      if (m) { const d = fx[m[1]] || []; const single = (r.request().headers()['accept'] || '').includes('vnd.pgrst.object'); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(single ? d[0] || null : d) }); }
      if (u.pathname.includes('/auth/v1/user')) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'u1', email: ME }) });
      return r.fulfill({ status: 404, body: '{}' });
    });
    const p = await ctx.newPage(), errs = [];
    p.on('pageerror', e => errs.push('pageerror ' + e.message)); p.on('console', m => m.type() === 'error' && !/WebSocket|realtime|404/.test(m.text()) && errs.push(m.text()));
    const segs = () => p.locator('#o-seg').innerText().then(t => t.replace(/\s+/g, ' ').trim());
    const list = () => p.locator('#o-list').innerText().then(t => t.replace(/\s+/g, ' ').trim());
    const shot = n => p.screenshot({ path: `${OUT}/stages-${name}-${n}${SUF}.png` });
    const R = out[name] = { steps: [] }, step = async (k, extra = {}) => R.steps.push({ k, segs: await segs(), list: (await list()).slice(0, 260), ...extra });
    await p.goto(PAGE); await p.waitForSelector('#shell:not([hidden])', { timeout: 15000 }); await p.waitForTimeout(800);
    await step('load'); await shot('1-accepted');
    // a customer order arrives (realtime INSERT, the handler the live channel calls)
    fx.orders.push(ins); await p.evaluate(o => onChange({ table: 'orders', eventType: 'INSERT', new: o }), ins);
    await p.waitForSelector('#neworder.on'); await p.click('#neworder [data-a=dismissAlert]'); await p.waitForTimeout(400);
    await p.click('#o-seg [data-k=new]'); await p.waitForTimeout(300); await step('new arrived'); await shot('2-new');
    await p.click('#o-list [data-a=accept]'); await p.waitForTimeout(900); await step('accepted'); await shot('3-accepted');
    await p.click(`#o-list [data-a=openOrder][data-id="${ins.id}"]`); await p.waitForTimeout(500);
    R.detailFoot = (await p.locator('#sheet-foot').innerText()).trim(); R.detailHasStatusSeg = await p.locator('#sheet-body [data-a=setStatus]').count();
    R.progress = (await p.locator('#sheet-body .progress-l').innerText()).replace(/\s+/g, ' ');
    await shot('4-detail');
    await p.click('#sheet-foot [data-a=complete]');
    await p.waitForSelector('#donetick.on', { timeout: 3000 }); await p.waitForTimeout(650);
    R.tickVisible = await p.locator('#donetick.on svg').isVisible(); R.tickLabel = await p.locator('#donetick .dt-l').innerText();
    await p.screenshot({ path: `${OUT}/stages-${name}-5-green-tick${SUF}.png` });
    await p.waitForTimeout(1500); R.tickGone = (await p.locator('#donetick.on').count()) === 0;
    await step('after complete'); await p.click('#o-seg [data-k=completed]'); await p.waitForTimeout(300); await step('completed tab'); await shot('6-completed');
    R.inCompleted = (await list()).includes('ZZTEST stages');
    // optional cash / tip path on the legacy "ready" order (shows as Accepted)
    await p.click('#o-seg [data-k=accepted]'); await p.waitForTimeout(200);
    await p.click(`#o-list [data-a=cashSheet][data-id="${fx.orders[0].id}"]`); await p.waitForTimeout(300);
    await p.click('[data-a=cashPick][data-n="20"]'); await p.waitForTimeout(100); await p.click('.tiprow'); await p.waitForTimeout(200);
    R.cashFoot = (await p.locator('#sheet-foot').innerText()).trim(); await shot('7-cash-tip');
    await p.click('[data-a=cashConfirm]'); await p.waitForSelector('#donetick.on'); await p.waitForTimeout(1800);
    // clean up: cancel the test order (staff function), from the Completed list
    await p.click('#o-seg [data-k=completed]'); await p.waitForTimeout(200);
    await p.click(`#o-list [data-a=openOrder][data-id="${ins.id}"]`); await p.waitForTimeout(400);
    R.cancelBtn = await p.locator('#sheet-body [data-a=cancelOrder]').evaluate(e => [e.className, e.innerText.trim(), getComputedStyle(e).backgroundColor]);
    await p.click('#sheet-body [data-a=cancelOrder]'); await p.waitForTimeout(700);
    await p.click('[data-a=closeSheet]').catch(() => { }); await p.waitForTimeout(200);
    await p.click('#o-seg [data-k=cancelled]'); await p.waitForTimeout(300); await step('cancelled tab'); await shot('8-cancelled');
    R.calls = calls; R.errs = errs; await ctx.close();
  }
  console.log(JSON.stringify(out, null, 1)); await b.close();
})().catch(e => { console.error(e); process.exit(1); });
