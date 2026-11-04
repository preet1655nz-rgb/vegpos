/* rasoi · deli + kitchen — customer pickup ordering app.
   Talks to Supabase only through public RPCs: get_public_menu(), get_public_info(), get_checkout_quote(), get_points_balance(), place_customer_order().
   Opening hours, notice, contact and loyalty rules come from the staff-editable settings table (get_public_info). */
'use strict';
const BRAND = { name: 'rasoi', sub: 'deli + kitchen' };
const CFG = {
  url: 'https://sjjesqyqaikivonjuxfs.supabase.co',
  key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNqamVzcXlxYWlraXZvbmp1eGZzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM2NTE0MTUsImV4cCI6MjEwOTIyNzQxNX0.5lN5mz2px5dqUUfvu2hr1kzDN_vMzafsZ5hN13cU0Ds',
  tz: 'Pacific/Auckland',
  // defaults; replaced by settings from get_public_info()
  open: [12, 0], close: [21, 0], noticeMins: 60, stepMins: 15, days: 14, openDays: [1, 2, 3, 4, 5, 6, 7],
  cooldownSec: 60,    // one order per device per minute
  maxQty: 50
};
const sb = supabase.createClient(CFG.url, CFG.key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => '$' + Number(n || 0).toFixed(2);
const I = {
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  minus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg>',
  trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  alert: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.01"/></svg>',
  card: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10h18"/></svg>',
  cash: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6 9.5v.01M18 14.5v.01"/></svg>',
  bag: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14l-1 12H6L5 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>',
  clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9 6.8 19.6l1-5.8-4.3-4.1 5.9-.9L12 3.5Z"/></svg>',
  tag: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 12.5V4h8.5l8.5 8.5-8.5 8.5-8.5-8.5Z"/><circle cx="8" cy="8.5" r="1.4"/></svg>',
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>'
};

function blurb(name) {
  const n = name.toLowerCase();
  if (/fried/.test(n) && /momo/.test(n)) return 'Golden, crispy veg momos with house chutney.';
  if (/momo/.test(n)) return 'Soft, hand-folded veg dumplings, steamed fresh.';
  if (/puff|patt/.test(n)) return 'Flaky pastry, spiced veg filling, baked golden.';
  if (/manchurian/.test(n)) return 'Crispy veg balls tossed in a zingy Indo-Chinese sauce.';
  if (/spring roll/.test(n)) return 'Crunchy rolls packed with stir-fried veg.';
  return 'Made fresh to order.';
}
/* ---------- NZ time helpers ---------- */
const nzFmt = new Intl.DateTimeFormat('en-NZ', { timeZone: CFG.tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
function nzParts(d) { const o = {}; for (const p of nzFmt.formatToParts(d)) o[p.type] = p.value; return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute }; }
function nzToDate(y, m, d, h, mi) { // NZ wall clock -> real instant (DST-safe)
  const want = Date.UTC(y, m - 1, d, h, mi); let t = want;
  for (let i = 0; i < 3; i++) { const p = nzParts(new Date(t)); t = want - (Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi) - t); }
  return new Date(t);
}
const fmtTime = d => d.toLocaleTimeString('en-NZ', { timeZone: CFG.tz, hour: 'numeric', minute: '2-digit' }).replace(/\s?([ap])\.?m\.?/i, ' $1m').toLowerCase();
const fmtDayLong = d => d.toLocaleDateString('en-NZ', { timeZone: CFG.tz, weekday: 'long', day: 'numeric', month: 'long' });
function dayKey(d) { const p = nzParts(d); return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`; }
function relDay(d) {
  const k = dayKey(d), now = new Date();
  if (k === dayKey(now)) return 'Today';
  if (k === dayKey(nzToDate(...addDays(nzParts(now), 1), 12, 0))) return 'Tomorrow';
  return d.toLocaleDateString('en-NZ', { timeZone: CFG.tz, weekday: 'short', day: 'numeric', month: 'short' });
}
function addDays(p, n) { const u = new Date(Date.UTC(p.y, p.m - 1, p.d + n)); return [u.getUTCFullYear(), u.getUTCMonth() + 1, u.getUTCDate()]; }
function isoDow(y, m, d) { const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); return w || 7; }
function pickupDays() {
  const now = new Date(), p = nzParts(now), step = CFG.stepMins * 6e4;
  const earliest = Math.ceil((now.getTime() + CFG.noticeMins * 6e4) / step) * step, latest = now.getTime() + CFG.days * 864e5 - 30 * 6e4, out = [];
  for (let i = 0; i < CFG.days; i++) {
    const [y, m, d] = addDays(p, i), slots = [];
    if (CFG.openDays.includes(isoDow(y, m, d))) {
      for (let mins = CFG.open[0] * 60 + CFG.open[1]; mins <= CFG.close[0] * 60 + CFG.close[1]; mins += CFG.stepMins) {
        const at = nzToDate(y, m, d, Math.floor(mins / 60), mins % 60);
        if (at.getTime() >= earliest && at.getTime() <= latest) slots.push(at);
      }
    }
    const noon = nzToDate(y, m, d, 12, 0);
    out.push({ key: `${y}-${m}-${d}`, label: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : noon.toLocaleDateString('en-NZ', { timeZone: CFG.tz, weekday: 'short' }),
      sub: noon.toLocaleDateString('en-NZ', { timeZone: CFG.tz, day: 'numeric', month: 'short' }), slots });
  }
  return out;
}
const hm12 = ([h, mi]) => fmtTime(nzToDate(2026, 1, 15, h, mi));
const hoursText = () => `${hm12(CFG.open)} – ${hm12(CFG.close)}`;

/* ---------- shop info (settings) ---------- */
async function loadInfo() {
  try {
    const { data, error } = await sb.rpc('get_public_info'); if (error) throw error;
    const tm = t => String(t || '').split(':').map(Number);
    S.info = data;
    if (data.open_time) CFG.open = tm(data.open_time); if (data.close_time) CFG.close = tm(data.close_time);
    CFG.noticeMins = Number(data.min_notice_minutes ?? CFG.noticeMins); CFG.stepMins = Number(data.slot_minutes || CFG.stepMins);
    CFG.days = Number(data.max_days_ahead || CFG.days); if (Array.isArray(data.open_days) && data.open_days.length) CFG.openDays = data.open_days.map(Number);
  } catch (e) { S.info = S.info || null; }
  renderInfo();
  if (S.sheet === 'checkout') checkoutSheet();
}
function renderInfo() {
  const i = S.info || {};
  $('hours').textContent = hoursText();
  const promos = (i.promotions || []);
  $('promos').innerHTML = promos.map(p => `<div class="promo" role="note">${I.tag}<div><b>${esc(p.name)}</b><span>${esc(p.description || (p.kind === 'percent' ? `${Number(p.value)}% off` : `${money(p.value)} off`) + (Number(p.min_order) ? ` orders over ${money(p.min_order)}` : ''))}</span></div>${p.code ? `<button class="code" type="button" data-a="usecode" data-code="${esc(p.code)}" aria-label="Use code ${esc(p.code)} at checkout">${esc(p.code)}</button>` : ''}</div>`).join('');
  const L = i.loyalty;
  $('points').hidden = !(L && L.enabled);
  if (L && L.enabled && !$('points').dataset.ready) {
    $('points').dataset.ready = '1';
    $('points').innerHTML = `<div class="bulk-in"><h2 class="script">Loyalty points</h2><p>Earn ${Number(L.earn_per_dollar)} point${Number(L.earn_per_dollar) === 1 ? '' : 's'} per $1 when you pay. ${Number(L.redeem_points)} points = ${money(L.redeem_value)} off, just ask us at pickup.</p>
      <form class="coderow" id="pts-form" novalidate><label class="sr" for="pts-phone">Your phone number</label><input id="pts-phone" type="tel" inputmode="tel" autocomplete="tel" maxlength="20" placeholder="Your phone number" value="${esc(S.form.phone || '')}"><button class="btn ghost sm" type="submit">Check points</button></form>
      <p class="pts-out" id="pts-out" aria-live="polite"></p></div>`;
  }
  const ph = i.contact_phone, em = i.contact_email;
  $('bulk').innerHTML = `<div class="bulk-in"><h2 class="script">Bulk orders</h2><p>${esc(i.bulk_note || 'Bulk orders accepted. Contact us for enquiries.')}</p>
    ${ph || em ? `<p class="contact">${ph ? `<a href="tel:${esc(ph.replace(/[^0-9+]/g, ''))}">${esc(ph)}</a>` : ''}${ph && em ? '<span aria-hidden="true"> · </span>' : ''}${em ? `<a href="mailto:${esc(em)}?subject=${encodeURIComponent('Bulk order enquiry')}">${esc(em)}</a>` : ''}</p>` : ''}</div>`;
}

/* ---------- state ---------- */
const S = { info: null, quote: null, menu: null, cart: load('rasoi_cart_v1', []), form: load('rasoi_form_v1', { name: '', phone: '' }), sheet: null, item: null, ck: null, submitting: false };
function load(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } }
function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }
const prod = id => S.menu && S.menu.find(p => p.id === id);
const lineVar = l => { const p = prod(l.pid); return p && p.variants.find(v => v.index === l.vidx); };
const cartCount = () => S.cart.reduce((a, l) => a + l.qty, 0);
const cartTotal = () => S.cart.reduce((a, l) => { const v = lineVar(l); return a + (v ? v.price * l.qty : 0); }, 0);

/* ---------- feedback ---------- */
let toastT;
function toast(msg, err) {
  const t = $('toast'); t.innerHTML = (err ? I.alert : I.check) + `<span>${esc(msg)}</span>`;
  t.className = 'toast on' + (err ? ' err' : ''); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), err ? 4200 : 2400);
}
const buzz = () => { try { navigator.vibrate && navigator.vibrate(10); } catch (e) { } };
function friendly(e) {
  const m = (e && (e.message || e.error_description)) || String(e || '');
  if (/Failed to fetch|NetworkError|Load failed|network/i.test(m)) return "Can't reach us right now. Check your connection and try again.";
  if (/permission denied|JWT|apikey/i.test(m)) return 'Ordering is temporarily unavailable. Please call us to order.';
  return m || 'Something went wrong. Please try again.';
}

/* ---------- menu ---------- */
function skeleton() {
  $('chips').innerHTML = Array.from({ length: 3 }, () => '<span class="chip sk" aria-hidden="true"></span>').join('');
  $('menu').innerHTML = `<div class="sec"><div class="sk" style="height:24px;width:140px;margin:10px 2px 16px"></div><div class="grid">${Array.from({ length: 4 }, () =>
    '<div class="sk-card" aria-hidden="true"><div class="sk l"></div><div class="sk l2"></div></div>').join('')}</div></div>`;
}
async function loadMenu(quiet) {
  try {
    const { data, error } = await sb.rpc('get_public_menu');
    if (error) throw error;
    S.menu = (data || []).map(p => ({ ...p, variants: (p.variants || []).map(v => ({ ...v, price: Number(v.price) })) }));
    reconcileCart(quiet); renderMenu(); updateBar(); if (S.sheet) refreshSheet();
  } catch (e) {
    if (quiet) return;
    $('menu').setAttribute('aria-busy', 'false');
    $('menu').innerHTML = `<div class="status-banner">${I.alert}<div><b>Couldn't load the menu</b><div style="color:var(--ink2);font-size:14px">${esc(friendly(e))}</div></div><button class="btn" data-a="retry">Retry</button></div>`;
  }
}
function reconcileCart(quiet) {
  const before = S.cart.length;
  S.cart = S.cart.filter(l => { const v = lineVar(l); return v && v.available; });
  if (S.cart.length !== before) { saveCart(); if (!quiet || S.sheet === 'cart' || S.sheet === 'checkout') toast('Some items just sold out and were removed from your cart', true); }
}
function cats() { const out = []; for (const p of S.menu) if (!out.includes(p.category)) out.push(p.category); return out; }
const slug = s => 'c-' + String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-');
function renderMenu() {
  const m = $('menu'); m.setAttribute('aria-busy', 'false');
  if (!S.menu.length) { $('chips').innerHTML = ''; m.innerHTML = '<div class="empty"><b>The menu is being updated</b>Please check back soon.</div>'; return; }
  const cs = cats();
  $('chips').innerHTML = cs.map((c, i) => `<button class="chip ${i === 0 ? 'on' : ''}" type="button" data-a="cat" data-c="${esc(slug(c))}">${esc(c)}</button>`).join('');
  m.innerHTML = cs.map(c => {
    const ps = S.menu.filter(p => p.category === c);
    return `<section class="sec" id="${esc(slug(c))}" aria-labelledby="${esc(slug(c))}-h"><h2 class="script" id="${esc(slug(c))}-h">${esc(c)}</h2><div class="grid">${ps.map(cardHTML).join('')}</div></section>`;
  }).join('');
  spy();
}
function cardHTML(p, i) {
  const avail = p.variants.filter(v => v.available), from = Math.min(...(avail.length ? avail : p.variants).map(v => v.price));
  const inCart = S.cart.filter(l => l.pid === p.id).reduce((s, l) => s + l.qty, 0), so = !p.in_stock;
  return `<button class="card ${so ? 'soldout' : ''}" type="button" data-a="item" data-id="${p.id}" style="animation-delay:${i * 40}ms"
      aria-label="${esc(p.name)}${so ? ', sold out' : `, from ${money(from)}`}${inCart ? `, ${inCart} in cart` : ''}">
    <span class="info"><span class="nm">${esc(p.name)}${inCart ? `<span class="incart">${inCart} in cart</span>` : ''}</span><span class="ds">${esc(blurb(p.name))}</span>
      <span class="vs">${p.variants.map(v => `<span class="${v.available ? '' : 'x'}">${esc(v.label)} ${money(v.price)}</span>`).join('')}</span></span>
    <span class="end">${so ? '<span class="badge-so">Sold out</span>' : `<span class="from">${p.variants.length > 1 ? '<small>from</small>' : ''}${money(from)}</span><span class="add" aria-hidden="true">${I.plus}</span>`}</span></button>`;
}
let spyObs;
function spy() {
  if (spyObs) spyObs.disconnect();
  spyObs = new IntersectionObserver(es => {
    for (const e of es) if (e.isIntersecting) setChip(e.target.id);
  }, { rootMargin: '-90px 0px -65% 0px' });
  document.querySelectorAll('.sec').forEach(s => spyObs.observe(s));
}
function setChip(id) {
  document.querySelectorAll('.chip').forEach(c => { const on = c.dataset.c === id; c.classList.toggle('on', on); if (on) c.setAttribute('aria-current', 'true'); else c.removeAttribute('aria-current'); if (on) c.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' }); });
}

/* ---------- cart bar ---------- */
function updateBar() {
  const n = cartCount(), b = $('cartbar');
  b.hidden = !n || !!S.sheet || !$('done').hidden;
  $('cb-n').textContent = n; $('cb-a').textContent = money(cartTotal());
  b.setAttribute('aria-label', `View cart, ${n} item${n === 1 ? '' : 's'}, ${money(cartTotal())}`);
  b.querySelector('.cb-l').textContent = `View cart · ${n} item${n === 1 ? '' : 's'}`;
}
function saveCart() { save('rasoi_cart_v1', S.cart); }
function bump() { const b = $('cartbar'); b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump'); }

/* ---------- sheet ---------- */
let lastFocus;
function openSheet(kind) {
  const wasOpen = !!S.sheet; S.sheet = kind; lastFocus = wasOpen ? lastFocus : document.activeElement;
  refreshSheet();
  const sh = $('sheet'), bd = $('backdrop');
  sh.hidden = false; bd.hidden = false; document.body.classList.add('locked');
  requestAnimationFrame(() => { sh.classList.add('on'); bd.classList.add('on'); });
  $('sheet-body').scrollTop = 0; updateBar();
  setTimeout(() => { const f = sh.querySelector('[data-autofocus]') || sh.querySelector('.sheet-body button:not([disabled]), .sheet-body input:not(.hp input)'); f && f.focus({ preventScroll: true }); }, 60);
}
function closeSheet() {
  if (!S.sheet) return; S.sheet = null;
  const sh = $('sheet'), bd = $('backdrop'); sh.classList.remove('on'); bd.classList.remove('on'); document.body.classList.remove('locked');
  setTimeout(() => { if (!S.sheet) { sh.hidden = true; bd.hidden = true; } }, 380);
  updateBar(); renderMenu(); if (lastFocus && lastFocus.focus) try { lastFocus.focus({ preventScroll: true }); } catch (e) { }
}
function refreshSheet() {
  if (S.sheet === 'item') itemSheet(); else if (S.sheet === 'cart') cartSheet(); else if (S.sheet === 'checkout') checkoutSheet();
}
function stepper(val, min, max, a, extra = '', label = 'Quantity') {
  return `<div class="stepper" role="group" aria-label="${label}"><button type="button" data-a="${a}" data-d="-1" ${extra} ${val <= min ? 'disabled' : ''} aria-label="Decrease ${label.toLowerCase()}">${val <= 1 && a === 'lq' ? I.trash : I.minus}</button>
    <output aria-live="polite">${val}</output><button type="button" data-a="${a}" data-d="1" ${extra} ${val >= max ? 'disabled' : ''} aria-label="Increase ${label.toLowerCase()}">${I.plus}</button></div>`;
}

/* item sheet */
function openItem(id) {
  const p = prod(id); if (!p) return;
  if (!p.in_stock) { toast(`${p.name} is sold out right now`, true); return; }
  const first = p.variants.find(v => v.available);
  S.item = { id, vidx: first ? first.index : null, qty: 1 };
  $('sheet').setAttribute('aria-labelledby', 'sh-title'); openSheet('item');
}
function itemSheet() {
  const p = prod(S.item.id); if (!p) return closeSheet();
  const v = p.variants.find(x => x.index === S.item.vidx);
  if (v && !v.available) { const f = p.variants.find(x => x.available); S.item.vidx = f ? f.index : null; }
  const sel = p.variants.find(x => x.index === S.item.vidx);
  $('sheet-body').innerHTML = `<h2 class="sh-title" id="sh-title">${esc(p.name)}</h2><p class="sh-sub">${esc(blurb(p.name))}</p>
    <div class="sh-h" id="opt-h">Choose a size <small>Required</small></div>
    <div class="opts" role="radiogroup" aria-labelledby="opt-h">${p.variants.map(x => `<label class="opt ${x.index === S.item.vidx ? 'on' : ''} ${x.available ? '' : 'so'}">
      <input type="radio" name="var" value="${x.index}" ${x.index === S.item.vidx ? 'checked' : ''} ${x.available ? '' : 'disabled'} data-a="var">
      <span class="rd" aria-hidden="true"></span><span class="ol">${esc(x.label)}${x.available ? '' : ' <small class="so-tag">Sold out</small>'}</span><span class="op">${money(x.price)}</span></label>`).join('')}</div>
    <div class="sh-h">Quantity</div><div class="qtyrow">${stepper(S.item.qty, 1, CFG.maxQty, 'iq')}<span style="color:var(--ink2);font-size:14px">${sel ? `${money(sel.price)} each` : ''}</span></div>`;
  $('sheet-foot').innerHTML = `<button class="btn split" type="button" data-a="addItem" ${sel ? '' : 'disabled'}><span>Add ${S.item.qty} to cart</span><span class="num">${sel ? money(sel.price * S.item.qty) : ''}</span></button>`;
}
function addItem() {
  const p = prod(S.item.id), v = p && p.variants.find(x => x.index === S.item.vidx);
  if (!v || !v.available) return toast('Please choose an available size', true);
  const ex = S.cart.find(l => l.pid === p.id && l.vidx === v.index);
  if (ex) ex.qty = Math.min(CFG.maxQty, ex.qty + S.item.qty); else S.cart.push({ pid: p.id, vidx: v.index, label: v.label, qty: S.item.qty });
  saveCart(); buzz(); closeSheet(); bump(); toast(`Added ${S.item.qty} × ${p.name} (${v.label})`);
}

/* cart sheet */
function cartSheet() {
  $('sheet').setAttribute('aria-labelledby', 'sh-title');
  if (!S.cart.length) {
    $('sheet-body').innerHTML = `<h2 class="sh-title" id="sh-title">Your cart</h2><div class="empty"><b>Your cart is empty</b>Add something tasty from the menu.</div>`;
    $('sheet-foot').innerHTML = `<button class="btn ghost" type="button" data-a="close">Browse the menu</button>`; return;
  }
  $('sheet-body').innerHTML = `<h2 class="sh-title" id="sh-title">Your cart</h2><p class="sh-sub">Pickup order · rasoi deli + kitchen</p>
    <div class="lines">${S.cart.map((l, i) => { const p = prod(l.pid), v = lineVar(l); return `<div class="line">
      <div class="ln"><b>${esc(p.name)}</b><small>${esc(v.label)} · ${money(v.price)} each</small><div class="lp">${money(v.price * l.qty)}</div></div>
      ${stepper(l.qty, 0, CFG.maxQty, 'lq', `data-i="${i}"`, `Quantity of ${esc(p.name)} ${esc(v.label)}`)}</div>`; }).join('')}</div>
    <button class="linkbtn" type="button" data-a="close" style="margin-top:8px">+ Add more items</button>
    <div class="totals"><div><span>Subtotal</span><span class="num">${money(cartTotal())}</span></div><div class="g"><span>Total</span><span class="num">${money(cartTotal())}</span></div></div>
    ${cashNote()}`;
  $('sheet-foot').innerHTML = `<button class="btn split" type="button" data-a="checkout"><span>Go to checkout</span><span class="num">${money(cartTotal())}</span></button>`;
}

const cashNote = () => `<div class="note">${I.cash}<span><b>Cash only · pay at pickup.</b> Pickup only, no delivery. Please order 1–2 hours ahead.</span></div>`;
/* checkout sheet */
const quoteTotal = () => S.quote && S.quote.promo && S.quote.promo.ok ? Math.max(cartTotal() - Number(S.quote.promo.discount || 0), 0) : cartTotal();
function quoteHTML() {
  const q = S.quote, pr = q && q.promo, L = S.info && S.info.loyalty, n = S.pts;
  const pts = n != null && L && L.enabled ? `<div class="pts">${I.star}<span>You have <b>${Number(n)}</b> point${Number(n) === 1 ? '' : 's'}${q && Number(q.earn) ? ` · earn about ${Number(q.earn)} more when you pay for this order` : ''}. ${Number(L.redeem_points)} points = ${money(L.redeem_value)} off (ask us at pickup).</span></div>` : '';
  return `${pr ? `<div class="promo-msg ${pr.ok ? 'ok' : 'bad'}" role="status">${pr.ok ? `${I.check}<span><b>${esc(pr.code)}</b> applied · ${esc(pr.name)} · −${money(pr.discount)}</span>` : `${I.alert}<span>${esc(pr.message)}</span>`}</div>` : ''}
    <div class="totals"><div><span>Subtotal</span><span class="num">${money(cartTotal())}</span></div>
      ${pr && pr.ok ? `<div><span>Promo ${esc(pr.code)}</span><span class="num">−${money(pr.discount)}</span></div>` : ''}
      <div class="g"><span>Total · cash at pickup</span><span class="num">${money(quoteTotal())}</span></div></div>${pts}`;
}
let quoteT, quoteSeq = 0;
async function refreshQuote(now) {
  clearTimeout(quoteT);
  const run = async () => {
    const code = (S.ck && S.ck.code || '').trim(), phone = (S.form.phone || '').trim(), seq = ++quoteSeq, okPhone = /^\+?[0-9 ()-]{6,20}$/.test(phone);
    if (!code && !okPhone) { S.quote = null; S.pts = null; const z = $('quote'); if (z) z.innerHTML = quoteHTML(); updatePlace(); return; }
    try {
      const [qr, pr] = await Promise.all([
        sb.rpc('get_checkout_quote', { p_items: S.cart.map(l => ({ product_id: l.pid, variant: l.label, qty: l.qty })), p_promo_code: code || null }),
        okPhone ? sb.rpc('get_points_balance', { p_phone: phone }) : Promise.resolve({ data: null })]);
      if (qr.error) throw qr.error; if (seq !== quoteSeq) return;
      S.quote = qr.data; S.pts = pr && !pr.error ? pr.data : null; const z = $('quote'); if (z) z.innerHTML = quoteHTML(); updatePlace();
    } catch (e) { }
  };
  if (now) return run(); quoteT = setTimeout(run, 600);
}
function updatePlace() { const n = document.querySelector('#place .num'); if (n) n.textContent = money(quoteTotal()); }
function checkoutSheet() {
  const days = pickupDays().filter(d => d.slots.length);
  if (!S.ck) S.ck = {};
  if (!days.find(d => d.key === S.ck.day)) S.ck.day = days[0] && days[0].key;
  const day = days.find(d => d.key === S.ck.day);
  if (day && !day.slots.some(s => s.toISOString() === S.ck.slot)) S.ck.slot = day.slots[0].toISOString();
  const f = S.form;
  $('sheet').setAttribute('aria-labelledby', 'sh-title');
  $('sheet-body').innerHTML = `<button class="linkbtn" type="button" data-a="cart" style="margin:6px 0 -6px -6px;display:inline-flex;align-items:center;gap:4px">${I.back}Cart</button>
    <h2 class="sh-title" id="sh-title">Checkout</h2><p class="sh-sub">${cartCount()} item${cartCount() === 1 ? '' : 's'} · pickup only · cash at pickup</p>
    <form id="ck" novalidate>
      <div class="f"><label for="ck-name">Your name</label><input id="ck-name" name="name" autocomplete="name" maxlength="80" required value="${esc(f.name)}" placeholder="So we can call you at the counter"></div>
      <div class="f"><label for="ck-phone">Phone <small>(optional · for loyalty points)</small></label><input id="ck-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" maxlength="20" value="${esc(f.phone)}" placeholder="e.g. 021 123 4567"></div>
      <div class="hp" aria-hidden="true"><label for="ck-web">Leave this empty</label><input id="ck-web" name="website" tabindex="-1" autocomplete="off"></div>
      <div class="f"><label id="day-l">Pickup time <small>(NZ time · ${esc(hoursText())})</small></label>
        <p class="hint">${I.clock}<span>Please order 1–2 hours ahead. The earliest pickup is ${CFG.noticeMins >= 60 && CFG.noticeMins % 60 === 0 ? `${CFG.noticeMins / 60} hour${CFG.noticeMins === 60 ? '' : 's'}` : `${CFG.noticeMins} minutes`} from now.</span></p>
        ${days.length ? `<div class="days" role="radiogroup" aria-labelledby="day-l">${days.map(d => `<button type="button" class="day ${d.key === S.ck.day ? 'on' : ''}" role="radio" aria-checked="${d.key === S.ck.day}" data-a="day" data-k="${d.key}">${d.label}<small>${d.sub}</small></button>`).join('')}</div>
        <div class="slots" role="radiogroup" aria-label="Pickup time on ${esc(day.label)}">${day.slots.map((s, i) => `<button type="button" class="slot ${s.toISOString() === S.ck.slot ? 'on' : ''}" role="radio" aria-checked="${s.toISOString() === S.ck.slot}" data-a="slot" data-t="${s.toISOString()}">${i === 0 ? '<span class="asap">Earliest</span>' : ''}${fmtTime(s)}</button>`).join('')}</div>`
        : '<div class="note">No pickup times are available right now.</div>'}</div>
      <div class="f"><label for="ck-code">Promo code <small>(optional)</small></label><div class="coderow"><input id="ck-code" name="code" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="24" value="${esc(S.ck.code || '')}" placeholder="e.g. WELCOME10"><button class="btn ghost sm" type="button" data-a="applycode">Apply</button></div></div>
      <div class="f"><label for="ck-notes">Notes <small>(optional)</small></label><textarea id="ck-notes" name="notes" maxlength="300" placeholder="Allergies, extra chutney, etc.">${esc(S.ck.notes || '')}</textarea></div>
      <div id="quote" aria-live="polite">${quoteHTML()}</div>
      <div class="note">${I.cash}<span><b>Cash only · pay at pickup.</b> We'll confirm your order shortly. Pickup only, no delivery.</span></div>
    </form>`;
  $('sheet-foot').innerHTML = `<button class="btn split" type="button" data-a="place" id="place" ${S.submitting || !days.length ? 'disabled' : ''}>${S.submitting ? '<span class="spin" aria-hidden="true"></span><span>Placing order…</span><span></span>' : `<span>Place pickup order</span><span class="num">${money(quoteTotal())}</span>`}</button>`;
  const keep = () => { S.form.name = $('ck-name').value; S.form.phone = $('ck-phone').value; S.ck.notes = $('ck-notes').value; save('rasoi_form_v1', S.form); };
  ['ck-name', 'ck-phone', 'ck-notes'].forEach(id => $(id).addEventListener('input', e => { keep(); e.target.removeAttribute('aria-invalid'); if (id === 'ck-phone') refreshQuote(); }));
  $('ck-code').addEventListener('input', e => { S.ck.code = e.target.value.toUpperCase(); if (!S.ck.code) { if (S.quote) S.quote.promo = null; $('quote').innerHTML = quoteHTML(); updatePlace(); } });
  $('ck-code').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); refreshQuote(true); } });
  const sel = $('sheet-body').querySelector('.slot.on'); if (sel) sel.scrollIntoView({ block: 'nearest' });
}

async function placeOrder() {
  if (S.submitting) return;
  const name = $('ck-name').value.trim(), phone = $('ck-phone').value.trim(), notes = $('ck-notes').value.trim();
  if ($('ck-web').value) { toast('Something went wrong. Please try again.', true); return; } // honeypot: bots fill hidden fields
  if (!name) { $('ck-name').setAttribute('aria-invalid', 'true'); $('ck-name').focus(); return toast('Please enter your name', true); }
  if (phone && !/^\+?[0-9 ()-]{6,20}$/.test(phone)) { $('ck-phone').setAttribute('aria-invalid', 'true'); $('ck-phone').focus(); return toast('Phone number looks invalid', true); }
  if (!S.ck.slot) return toast('Please choose a pickup time', true);
  if (new Date(S.ck.slot).getTime() < Date.now() - 60e3) { checkoutSheet(); return toast('That pickup time has passed — please pick another', true); }
  const last = Number(localStorage.getItem('rasoi_last_order_at') || 0), wait = Math.ceil((last + CFG.cooldownSec * 1e3 - Date.now()) / 1e3);
  if (wait > 0) return toast(`You just placed an order. Please wait ${wait}s before placing another.`, true);
  S.submitting = true; checkoutSheet();
  try {
    const items = S.cart.map(l => ({ product_id: l.pid, variant: l.label, variant_index: l.vidx, qty: l.qty }));
    const code = (S.ck.code || '').trim().toUpperCase();
    const { data, error } = await sb.rpc('place_customer_order', { p_customer_name: name, p_customer_phone: phone || null, p_pickup_time: S.ck.slot, p_items: items, p_notes: notes || null, p_promo_code: code || null });
    if (error) throw error;
    localStorage.setItem('rasoi_last_order_at', String(Date.now()));
    const summary = { ...data, name, count: cartCount() };
    save('rasoi_last_order', summary);
    S.cart = []; saveCart(); S.ck = null; S.quote = null; S.submitting = false;
    closeSheet(); showDone(summary); loadMenu(true);
  } catch (e) {
    S.submitting = false; checkoutSheet(); const msg = friendly(e); toast(msg, true);
    if (/not enough|not available|sold out/i.test(msg)) loadMenu(true);
    if (/ahead|opening hours|closed on/i.test(msg)) loadInfo();
  }
}

/* confirmation */
function showDone(o) {
  const d = new Date(o.pickup_time), el = $('done');
  el.innerHTML = `<img class="done-logo" src="brand/rasoi/rasoi-mark.png" alt="" width="96" height="96"><h2 class="script" tabindex="-1" id="done-h">Thank you!</h2>
    <p class="lead">Thanks ${esc(o.name)}, we've received your order. We'll confirm your order shortly. Pay cash at pickup.</p>
    <div class="ticket" role="group" aria-label="Order summary"><div class="no">Order number</div><div class="big num">#${esc(o.order_no)}</div>
      <div class="kv"><span>Pickup</span><b>${esc(relDay(d))} · ${esc(fmtTime(d))}<br><small>${esc(fmtDayLong(d))}</small></b></div>
      <div class="kv"><span>Items</span><b>${o.count}</b></div>
      ${Number(o.discount) ? `<div class="kv"><span>Promo ${esc(o.promo_code || '')}</span><b class="num">−${money(o.discount)}</b></div>` : ''}
      <div class="kv"><span>Total</span><b class="num big2">${money(o.total)}</b></div>
      <div class="pay">${I.cash}<span><b>Cash only · pay at pickup.</b> Please show this order number at the counter. Pickup only, no delivery.</span></div></div>
    <div class="again"><button class="btn ghost" type="button" data-a="again">Start a new order</button></div>`;
  el.hidden = false; document.body.classList.add('locked'); updateBar(); buzz();
  setTimeout(() => $('done-h').focus({ preventScroll: true }), 50);
}

/* ---------- events ---------- */
document.addEventListener('click', e => {
  const t = e.target.closest('[data-a]'); if (!t || t.disabled) return;
  const a = t.dataset.a;
  if (a === 'retry') { skeleton(); loadMenu(); }
  else if (a === 'cat') { const s = document.getElementById(t.dataset.c); if (s) { setChip(t.dataset.c); s.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }
  else if (a === 'item') openItem(t.dataset.id);
  else if (a === 'close') closeSheet();
  else if (a === 'iq') { S.item.qty = Math.max(1, Math.min(CFG.maxQty, S.item.qty + +t.dataset.d)); buzz(); itemSheet(); }
  else if (a === 'addItem') addItem();
  else if (a === 'lq') { const l = S.cart[+t.dataset.i]; if (!l) return; l.qty += +t.dataset.d; if (l.qty <= 0) S.cart.splice(+t.dataset.i, 1); else l.qty = Math.min(CFG.maxQty, l.qty); saveCart(); buzz(); cartSheet(); updateBar(); }
  else if (a === 'checkout') { S.ck = S.ck || {}; openSheet('checkout'); refreshQuote(true); }
  else if (a === 'cart') openSheet('cart');
  else if (a === 'day') { S.ck.day = t.dataset.k; S.ck.slot = null; checkoutSheet(); }
  else if (a === 'slot') { S.ck.slot = t.dataset.t; buzz(); document.querySelectorAll('.slot').forEach(s => { const on = s === t; s.classList.toggle('on', on); s.setAttribute('aria-checked', on); }); }
  else if (a === 'place') placeOrder();
  else if (a === 'applycode') { S.ck.code = ($('ck-code').value || '').trim().toUpperCase(); if (!S.ck.code) return toast('Enter a promo code', true); refreshQuote(true); }
  else if (a === 'usecode') { try { navigator.clipboard && navigator.clipboard.writeText(t.dataset.code); } catch (x) { } S.ck = S.ck || {}; S.ck.code = t.dataset.code; toast(`Code ${t.dataset.code} will be applied at checkout`); }
  else if (a === 'again') { $('done').hidden = true; document.body.classList.remove('locked'); updateBar(); window.scrollTo({ top: 0 }); }
});
document.addEventListener('change', e => { if (e.target.dataset.a === 'var') { S.item.vidx = +e.target.value; itemSheet(); const r = document.querySelector('.opt input:checked'); r && r.focus(); } });
$('cartbar').addEventListener('click', () => openSheet('cart'));
$('backdrop').addEventListener('click', closeSheet);
document.addEventListener('keydown', e => {
  if (!S.sheet) return;
  if (e.key === 'Escape') { e.preventDefault(); closeSheet(); }
  if (e.key === 'Tab') { // keep focus inside the sheet
    const f = [...$('sheet').querySelectorAll('button:not([disabled]),input:not([disabled]):not([tabindex="-1"]),textarea,select,[href]')].filter(x => x.offsetParent);
    if (!f.length) return; const i = f.indexOf(document.activeElement);
    if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
  }
});
document.addEventListener('submit', e => { e.preventDefault(); if (e.target.id === 'pts-form') checkPoints(); else placeOrder(); });
async function checkPoints() {
  const ph = ($('pts-phone').value || '').trim(), out = $('pts-out');
  if (!/^\+?[0-9 ()-]{6,20}$/.test(ph)) { out.textContent = 'Please enter a valid phone number.'; return; }
  out.textContent = 'Checking…';
  try {
    const { data, error } = await sb.rpc('get_points_balance', { p_phone: ph }); if (error) throw error;
    const L = (S.info && S.info.loyalty) || {}, n = Number(data || 0);
    out.innerHTML = `You have <b>${n}</b> point${n === 1 ? '' : 's'}.${n >= Number(L.redeem_points || 100) ? ` That's ${money(Math.floor(n / Number(L.redeem_points)) * Number(L.redeem_value))} off. Ask us at pickup.` : ''}`;
  } catch (e) { out.textContent = friendly(e); }
}
// swipe the sheet down to close
(() => {
  let y0 = null, dy = 0; const sh = $('sheet');
  sh.addEventListener('touchstart', e => { if ($('sheet-body').scrollTop > 0 && !e.target.closest('.grab')) return; y0 = e.touches[0].clientY; dy = 0; }, { passive: true });
  sh.addEventListener('touchmove', e => { if (y0 === null) return; dy = e.touches[0].clientY - y0; if (dy > 0) { sh.style.transition = 'none'; sh.style.transform = `translateY(${dy}px)`; } }, { passive: true });
  sh.addEventListener('touchend', () => { if (y0 === null) return; sh.style.transition = ''; sh.style.transform = ''; if (dy > 110) closeSheet(); y0 = null; });
})();
window.addEventListener('scroll', () => $('chips').classList.toggle('stuck', $('chips').getBoundingClientRect().top <= 1), { passive: true });
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.menu) { loadMenu(true); loadInfo(); } });
setInterval(() => { if (!document.hidden && !S.submitting) loadMenu(true); }, 60e3);
setInterval(() => { if (S.sheet === 'checkout' && !S.submitting) { const y = $('sheet-body').scrollTop; checkoutSheet(); $('sheet-body').scrollTop = y; } }, 5 * 60e3);

renderInfo(); skeleton(); updateBar(); loadInfo(); loadMenu();
setInterval(() => { if (!document.hidden) loadInfo(); }, 5 * 60e3);
