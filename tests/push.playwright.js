const { chromium } = require('playwright'); const fs = require('fs');
const PAGE = process.env.URL || 'http://localhost:8821/', OUT = '/workspace/batch-v12', WANT = +(process.env.WANT || 2), WAITMS = +(process.env.WAITMS || 420000);
const now = Date.now(), iso = t => new Date(t).toISOString(), ME = 'tester@example.com';
const settings = { id: 1, business_name: 'rasoi', low_stock_default: 10, open_time: '12:00:00', close_time: '21:00:00', min_notice_minutes: 60, slot_minutes: 15, max_days_ahead: 14, open_days: [1,2,3,4,5,6,7], loyalty_enabled: true, loyalty_earn_per_dollar: 1, loyalty_redeem_points: 100, loyalty_redeem_value: 10, staff_whatsapp: null, updated_at: iso(now) };
const ORD = { id: '00000000-0000-4000-8000-000000000091', order_no: 91, customer_name: 'ZZTEST push', customer_phone: '021 168 0000', pickup_time: iso(Math.ceil((now + 2 * 3600e3) / 900e3) * 900e3), status: 'pending', created_by: 'customer-app', created_at: iso(now - 60e3), paid: false, locked: false, discount: 0,
  items: [{ name: 'Veg Manchurian', variant: 'Full', qty: 1, price: 15 }, { name: 'Veg Manchurian', variant: '8pcs', qty: 1, price: 10 }], subtotal: 25, total: 25 };
const fx = { settings: [settings], staff: [{ email: ME, name: 'Tester', role: 'owner', created_at: iso(now) }], products: [], stock_movements: [], stock_items: [], customers: [], promotions: [], orders: [ORD] };
async function mock(ctx, log) {
  await ctx.addInitScript(me => { const exp = Math.floor(Date.now() / 1000) + 86400;
    localStorage.setItem('sb-sjjesqyqaikivonjuxfs-auth-token', JSON.stringify({ access_token: 'x.' + btoa(JSON.stringify({ exp, sub: 'u1', email: me, role: 'authenticated' })) + '.y', token_type: 'bearer', expires_in: 86400, expires_at: exp, refresh_token: 'r', user: { id: 'u1', email: me, aud: 'authenticated', role: 'authenticated' } }));
    window.__pushes = []; if (navigator.serviceWorker) navigator.serviceWorker.addEventListener('message', e => { if (e.data && e.data.type === 'push') window.__pushes.push(e.data.data); }); }, ME);
  await ctx.route('https://sjjesqyqaikivonjuxfs.supabase.co/**', async r => {
    const u = new URL(r.request().url()), rp = u.pathname.match(/rest\/v1\/rpc\/([a-z_]+)/);
    if (rp) { const a = JSON.parse(r.request().postData() || '{}'); log.push(rp[1]);
      if (rp[1] === 'register_push_subscription') { fs.writeFileSync('/tmp/pushsub.json', JSON.stringify(a)); return r.fulfill({ status: 200, contentType: 'application/json', body: '{"id":"t","active":1}' }); }
      return r.fulfill({ status: 200, contentType: 'application/json', body: 'null' }); }
    const m = u.pathname.match(/rest\/v1\/([a-z_]+)/);
    if (m) { const d = fx[m[1]] || [], single = (r.request().headers()['accept'] || '').includes('vnd.pgrst.object'); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(single ? d[0] || null : d) }); }
    if (u.pathname.includes('/auth/v1/user')) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'u1', email: ME }) });
    return r.fulfill({ status: 404, body: '{}' });
  });
}
(async () => {
  const R = { page: PAGE }; const log = [];
  // 1) iPhone Safari-like (not on Home Screen): hint visible
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
  const ictx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, timezoneId: 'Pacific/Auckland',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
  await mock(ictx, []); const ip = await ictx.newPage();
  await ip.goto(PAGE); await ip.waitForSelector('#shell:not([hidden])', { timeout: 20000 }); await ip.waitForTimeout(800);
  R.iosHint = (await ip.locator('.ios-hint').innerText().catch(() => '')).replace(/\s+/g, ' ');
  await ip.screenshot({ path: `${OUT}/staff-iphone-home-screen-hint.png` });
  // deep link from a notification tap
  await ip.goto(PAGE + '?order=' + ORD.id); await ip.waitForSelector('#shell:not([hidden])'); await ip.waitForTimeout(1200);
  R.deepLink = { sheetTitle: (await ip.locator('#sheet .sh-title, #sheet h2').first().innerText().catch(() => '')).trim(), url: ip.url() };
  R.oldLabelShown = (await ip.locator('#sheet-body').innerText().catch(() => '')).includes('8pcs');
  await ip.screenshot({ path: `${OUT}/staff-iphone-open-from-notification.png` }); await b.close();
  // 2) real Chrome (headed) + real service worker + real push service (FCM)
  fs.rmSync('/tmp/pushsub.json', { force: true });
  const ctx = await chromium.launchPersistentContext('/tmp/pw/prof-push', { executablePath: '/usr/bin/google-chrome', headless: false, viewport: { width: 1280, height: 860 }, timezoneId: 'Pacific/Auckland', args: ['--no-first-run'] });
  await ctx.grantPermissions(['notifications'], { origin: new URL(PAGE).origin });
  await mock(ctx, log); const p = ctx.pages()[0] || await ctx.newPage(), errs = [];
  p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && !/WebSocket|realtime|404/.test(m.text()) && errs.push(m.text()));
  await p.goto(PAGE); await p.waitForSelector('#shell:not([hidden])', { timeout: 20000 }); await p.waitForTimeout(1500);
  R.manifest = await p.evaluate(() => fetch('manifest.webmanifest').then(r => r.json()).then(j => ({ display: j.display, icons: j.icons.map(i => i.src) })));
  if (await p.locator('[data-a=enableAlerts]').count()) await p.click('[data-a=enableAlerts]');
  for (let i = 0; i < 40 && !fs.existsSync('/tmp/pushsub.json'); i++) await p.waitForTimeout(500);
  R.subscribed = fs.existsSync('/tmp/pushsub.json'); R.sw = await p.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return r && r.active && r.active.scriptURL; });
  await p.waitForTimeout(1200); R.alertsBtn = (await p.locator('#o-head').innerText()).replace(/\s+/g, ' ').slice(0, 120);
  await p.screenshot({ path: `${OUT}/staff-desktop-alerts-enabled.png` });
  console.log('SUBSCRIBED', R.subscribed, R.sw); 
  const t0 = Date.now(); let n = 0;
  while (Date.now() - t0 < WAITMS) { const ps = await p.evaluate(() => window.__pushes.slice()); if (ps.length > n) { n = ps.length; console.log('PUSH', JSON.stringify(ps[n - 1])); await p.waitForTimeout(800); await p.screenshot({ path: `${OUT}/staff-desktop-push-${n}.png` }); } if (n >= WANT) break; await p.waitForTimeout(1000); }
  R.pushes = await p.evaluate(() => window.__pushes);
  R.notifications = await p.evaluate(async () => (await (await navigator.serviceWorker.getRegistration()).getNotifications()).map(x => ({ title: x.title, body: x.body, data: x.data })));
  R.rpcs = log; R.errs = errs; console.log('RESULT ' + JSON.stringify(R)); await ctx.close();
})().catch(e => { console.error(e); process.exit(1); });
