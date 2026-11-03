/* Chopsticks & Chaat — customer ordering app.
   Talks to Supabase only through two public RPCs: get_public_menu() and place_customer_order(). */
'use strict';
const CFG = {
  url: 'https://sjjesqyqaikivonjuxfs.supabase.co',
  key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNqamVzcXlxYWlraXZvbmp1eGZzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM2NTE0MTUsImV4cCI6MjEwOTIyNzQxNX0.5lN5mz2px5dqUUfvu2hr1kzDN_vMzafsZ5hN13cU0Ds',
  tz: 'Pacific/Auckland',
  open: [11, 0],      // first pickup slot (NZ time)
  close: [21, 30],    // last pickup slot (NZ time)
  leadMins: 20,       // earliest pickup = now + lead, rounded up to the next 15 min
  stepMins: 15,
  days: 14,           // server accepts pickups up to 14 days ahead
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
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>'
};

/* ---------- food illustrations (original inline SVG, no external images) ---------- */
const G = (id, a, b) => `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`;
function dumpling(x, y, s, fill, pleat) {
  return `<g transform="translate(${x} ${y}) scale(${s})"><path d="M-34 10C-34-12-18-30 0-30S34-12 34 10c0 8-6 12-14 12h-40c-8 0-14-4-14-12Z" fill="${fill}"/>
  <path d="M0-30c-2 8-2 14 0 22M-12-26c2 8 6 13 10 18M12-26c-2 8-6 13-10 18M-22-18c4 6 9 9 14 11M22-18c-4 6-9 9-14 11" stroke="${pleat}" stroke-width="2.4" fill="none" stroke-linecap="round"/>
  <ellipse cx="-14" cy="0" rx="8" ry="5" fill="#fff" opacity=".35"/></g>`;
}
const FOOD = {
  steamed: uid => `<svg class="food" viewBox="0 0 240 170" aria-hidden="true"><defs>${G(uid + 'b', '#D9A35B', '#9C6526')}${G(uid + 'd', '#FFFBF1', '#EBDCC0')}</defs>
    <path d="M96 30c-6-8 6-12 0-20M120 26c-6-8 6-12 0-20M144 30c-6-8 6-12 0-20" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round" opacity=".75"/>
    <ellipse cx="120" cy="118" rx="98" ry="30" fill="url(#${uid}b)"/><path d="M22 112v14c0 17 44 30 98 30s98-13 98-30v-14" fill="#8A5620"/>
    <path d="M30 128c20 12 54 18 90 18s70-6 90-18" stroke="#C98E45" stroke-width="3" fill="none"/>
    <ellipse cx="120" cy="112" rx="90" ry="24" fill="#E7C891"/>
    ${dumpling(78, 92, 1, 'url(#' + uid + 'd)', '#D2BD97')}${dumpling(162, 92, 1, 'url(#' + uid + 'd)', '#D2BD97')}${dumpling(120, 104, 1.05, 'url(#' + uid + 'd)', '#D2BD97')}
    <circle cx="200" cy="140" r="14" fill="#C4321D"/><circle cx="200" cy="140" r="9" fill="#E2552F"/></svg>`,
  fried: uid => `<svg class="food" viewBox="0 0 240 170" aria-hidden="true"><defs>${G(uid + 'd', '#F7C66E', '#C67A22')}${G(uid + 'p', '#FFFDF8', '#EADCC8')}</defs>
    <ellipse cx="120" cy="128" rx="104" ry="32" fill="url(#${uid}p)"/><ellipse cx="120" cy="124" rx="86" ry="24" fill="#F4EBDD"/>
    ${dumpling(72, 104, .95, 'url(#' + uid + 'd)', '#A85F18')}${dumpling(168, 104, .95, 'url(#' + uid + 'd)', '#A85F18')}${dumpling(120, 112, 1.05, 'url(#' + uid + 'd)', '#A85F18')}
    <circle cx="58" cy="132" r="3" fill="#3E7A2E"/><circle cx="182" cy="134" r="3" fill="#3E7A2E"/><circle cx="150" cy="140" r="2.5" fill="#C4321D"/><circle cx="92" cy="140" r="2.5" fill="#C4321D"/></svg>`,
  puff: uid => `<svg class="food" viewBox="0 0 240 170" aria-hidden="true"><defs>${G(uid + 'a', '#F9D387', '#D08B2C')}${G(uid + 'p', '#FFFDF8', '#EADCC8')}</defs>
    <ellipse cx="120" cy="132" rx="104" ry="28" fill="url(#${uid}p)"/>
    <g><path d="M40 128 92 40l52 88Z" fill="url(#${uid}a)"/><path d="M52 120l40-68 40 68" stroke="#B2701E" stroke-width="3" fill="none" opacity=".55"/><path d="M64 112l28-48 28 48" stroke="#FCE7B5" stroke-width="3" fill="none" opacity=".8"/></g>
    <g transform="translate(64 6)"><path d="M60 124 112 44l52 80Z" fill="url(#${uid}a)"/><path d="M72 116l40-60 40 60" stroke="#B2701E" stroke-width="3" fill="none" opacity=".55"/><path d="M84 108l28-42 28 42" stroke="#FCE7B5" stroke-width="3" fill="none" opacity=".8"/></g>
    <circle cx="74" cy="92" r="2" fill="#7A4A12"/><circle cx="182" cy="96" r="2" fill="#7A4A12"/></svg>`,
  manchurian: uid => `<svg class="food" viewBox="0 0 240 170" aria-hidden="true"><defs>${G(uid + 'w', '#FFFDF8', '#E3D3BD')}${G(uid + 's', '#B5452B', '#6E1D10')}</defs>
    <path d="M28 92h184c0 40-41 66-92 66S28 132 28 92Z" fill="url(#${uid}w)"/><ellipse cx="120" cy="92" rx="92" ry="20" fill="url(#${uid}s)"/>
    ${[[80, 86], [112, 80], [146, 84], [96, 98], [132, 98], [164, 94], [70, 98]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="15" fill="#8F3418"/><circle cx="${x - 5}" cy="${y - 5}" r="4.5" fill="#E9875F" opacity=".7"/>`).join('')}
    ${[[90, 76], [128, 72], [154, 78], [108, 94]].map(([x, y]) => `<rect x="${x}" y="${y}" width="9" height="5" rx="2.5" fill="#5DA33B" transform="rotate(-20 ${x} ${y})"/>`).join('')}
    <path d="M104 50c-6-8 6-12 0-20M132 50c-6-8 6-12 0-20" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round" opacity=".7"/></svg>`,
  roll: uid => `<svg class="food" viewBox="0 0 240 170" aria-hidden="true"><defs>${G(uid + 'r', '#F8CF7E', '#C27A25')}${G(uid + 'p', '#FFFDF8', '#EADCC8')}</defs>
    <ellipse cx="120" cy="130" rx="104" ry="30" fill="url(#${uid}p)"/>
    <g transform="rotate(-14 120 100)"><rect x="34" y="82" width="150" height="34" rx="17" fill="url(#${uid}r)"/><ellipse cx="184" cy="99" rx="10" ry="17" fill="#E8B061"/><path d="M60 86l-6 26M90 86l-6 26M120 86l-6 26M150 86l-6 26" stroke="#A9631A" stroke-width="2.4" opacity=".5"/></g>
    <g transform="rotate(10 120 110)"><rect x="56" y="98" width="150" height="34" rx="17" fill="url(#${uid}r)"/><ellipse cx="206" cy="115" rx="10" ry="17" fill="#E8B061"/><circle cx="206" cy="115" r="5" fill="#6FA845"/><path d="M82 102l-6 26M112 102l-6 26M142 102l-6 26M172 102l-6 26" stroke="#A9631A" stroke-width="2.4" opacity=".5"/></g>
    <ellipse cx="46" cy="136" rx="20" ry="9" fill="#C4321D"/></svg>`,
  bowl: uid => `<svg class="food" viewBox="0 0 240 170" aria-hidden="true"><defs>${G(uid + 'w', '#F1D27A', '#C99A3A')}</defs>
    <path d="M100 50c-6-8 6-12 0-20M124 46c-6-8 6-12 0-20M148 50c-6-8 6-12 0-20" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round" opacity=".75"/>
    <path d="M30 86h180c0 40-40 66-90 66S30 126 30 86Z" fill="url(#${uid}w)"/><ellipse cx="120" cy="86" rx="90" ry="18" fill="#8E1F2F"/>
    <circle cx="96" cy="84" r="5" fill="#F1D27A"/><circle cx="122" cy="80" r="4" fill="#F1D27A"/><circle cx="146" cy="86" r="5" fill="#F1D27A"/></svg>`
};
function foodFor(name) {
  const n = name.toLowerCase();
  if (/fried|kothey|crispy/.test(n) && /momo|dumpling/.test(n)) return ['fried', 't-fried'];
  if (/momo|dumpling|dim sum/.test(n)) return ['steamed', 't-momos'];
  if (/puff|patt|samosa/.test(n)) return ['puff', 't-snacks'];
  if (/manchurian|chilli|chili|gobi/.test(n)) return ['manchurian', 't-hot'];
  if (/roll/.test(n)) return ['roll', 't-snacks'];
  return ['bowl', 't-maroon'];
}
function blurb(name) {
  const n = name.toLowerCase();
  if (/fried/.test(n) && /momo/.test(n)) return 'Golden, crispy veg momos with house chutney.';
  if (/momo/.test(n)) return 'Soft, hand-folded veg dumplings, steamed fresh.';
  if (/puff|patt/.test(n)) return 'Flaky pastry, spiced veg filling, baked golden.';
  if (/manchurian/.test(n)) return 'Crispy veg balls tossed in a zingy Indo-Chinese sauce.';
  if (/spring roll/.test(n)) return 'Crunchy rolls packed with stir-fried veg.';
  return 'Made fresh to order.';
}
let artN = 0;
const art = (name, cls = '') => { const [k, t] = foodFor(name); return { svg: FOOD[k]('f' + (artN++)), tile: t }; };

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
function pickupDays() {
  const now = new Date(), p = nzParts(now), earliest = now.getTime() + CFG.leadMins * 6e4, latest = now.getTime() + CFG.days * 864e5 - 30 * 6e4, out = [];
  for (let i = 0; i < CFG.days; i++) {
    const [y, m, d] = addDays(p, i), slots = [];
    for (let mins = CFG.open[0] * 60 + CFG.open[1]; mins <= CFG.close[0] * 60 + CFG.close[1]; mins += CFG.stepMins) {
      const at = nzToDate(y, m, d, Math.floor(mins / 60), mins % 60);
      if (at.getTime() >= earliest && at.getTime() <= latest) slots.push(at);
    }
    const noon = nzToDate(y, m, d, 12, 0);
    out.push({ key: `${y}-${m}-${d}`, label: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : noon.toLocaleDateString('en-NZ', { timeZone: CFG.tz, weekday: 'short' }),
      sub: noon.toLocaleDateString('en-NZ', { timeZone: CFG.tz, day: 'numeric', month: 'short' }), slots });
  }
  return out;
}

/* ---------- state ---------- */
const S = { menu: null, cart: load('cc_cart_v1', []), form: load('cc_form_v1', { name: '', phone: '' }), sheet: null, item: null, ck: null, submitting: false };
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
    '<div class="sk-card" aria-hidden="true"><div class="sk a"></div><div class="sk l"></div><div class="sk l2"></div></div>').join('')}</div></div>`;
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
  artN = 0;
  m.innerHTML = cs.map(c => {
    const ps = S.menu.filter(p => p.category === c);
    return `<section class="sec" id="${esc(slug(c))}" aria-labelledby="${esc(slug(c))}-h"><h2 id="${esc(slug(c))}-h">${esc(c)}</h2><div class="grid">${ps.map(cardHTML).join('')}</div></section>`;
  }).join('');
  spy();
}
function cardHTML(p, i) {
  const a = art(p.name), avail = p.variants.filter(v => v.available), from = Math.min(...(avail.length ? avail : p.variants).map(v => v.price));
  const inCart = S.cart.filter(l => l.pid === p.id).reduce((s, l) => s + l.qty, 0), so = !p.in_stock;
  return `<button class="card ${so ? 'soldout' : ''}" type="button" data-a="item" data-id="${p.id}" style="animation-delay:${i * 40}ms"
      aria-label="${esc(p.name)}${so ? ', sold out' : `, from ${money(from)}`}${inCart ? `, ${inCart} in cart` : ''}">
    <div class="art ${a.tile}">${a.svg}${so ? '<span class="badge-so">Sold out</span>' : ''}${inCart ? `<span class="incart">${inCart} in cart</span>` : ''}</div>
    <div class="info"><span class="nm">${esc(p.name)}</span><span class="ds">${esc(blurb(p.name))}</span>
      <span class="row"><span class="from">${so ? '<small>Sold out today</small>' : `<small>${p.variants.length > 1 ? 'from' : ''}</small>${money(from)}`}</span>
      <span class="add" aria-hidden="true">${I.plus}</span></span></div></button>`;
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
function saveCart() { save('cc_cart_v1', S.cart); }
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
  const a = art(p.name), v = p.variants.find(x => x.index === S.item.vidx);
  if (v && !v.available) { const f = p.variants.find(x => x.available); S.item.vidx = f ? f.index : null; }
  const sel = p.variants.find(x => x.index === S.item.vidx);
  $('sheet-body').innerHTML = `<div class="sh-art ${a.tile}">${a.svg}</div>
    <h2 class="sh-title" id="sh-title">${esc(p.name)}</h2><p class="sh-sub">${esc(blurb(p.name))}</p>
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
  artN = 100;
  $('sheet-body').innerHTML = `<h2 class="sh-title" id="sh-title">Your cart</h2><p class="sh-sub">Pickup order · Chopsticks &amp; Chaat</p>
    <div class="lines">${S.cart.map((l, i) => { const p = prod(l.pid), v = lineVar(l), a = art(p.name); return `<div class="line">
      <div class="th ${a.tile}">${a.svg}</div><div class="ln"><b>${esc(p.name)}</b><small>${esc(v.label)} · ${money(v.price)} each</small><div class="lp">${money(v.price * l.qty)}</div></div>
      ${stepper(l.qty, 0, CFG.maxQty, 'lq', `data-i="${i}"`, `Quantity of ${esc(p.name)} ${esc(v.label)}`)}</div>`; }).join('')}</div>
    <button class="linkbtn" type="button" data-a="close" style="margin-top:8px">+ Add more items</button>
    <div class="totals"><div><span>Subtotal</span><span class="num">${money(cartTotal())}</span></div><div class="g"><span>Total</span><span class="num">${money(cartTotal())}</span></div></div>
    <div class="note">${I.card}<span><b>Pay at pickup.</b> No payment needed now — pay when you collect your order.</span></div>`;
  $('sheet-foot').innerHTML = `<button class="btn split" type="button" data-a="checkout"><span>Go to checkout</span><span class="num">${money(cartTotal())}</span></button>`;
}

/* checkout sheet */
function checkoutSheet() {
  const days = pickupDays().filter(d => d.slots.length);
  if (!S.ck) S.ck = {};
  if (!days.find(d => d.key === S.ck.day)) S.ck.day = days[0] && days[0].key;
  const day = days.find(d => d.key === S.ck.day);
  if (day && !day.slots.some(s => s.toISOString() === S.ck.slot)) S.ck.slot = day.slots[0].toISOString();
  const f = S.form;
  $('sheet').setAttribute('aria-labelledby', 'sh-title');
  $('sheet-body').innerHTML = `<button class="linkbtn" type="button" data-a="cart" style="margin:6px 0 -6px -6px;display:inline-flex;align-items:center;gap:4px">${I.back}Cart</button>
    <h2 class="sh-title" id="sh-title">Checkout</h2><p class="sh-sub">${cartCount()} item${cartCount() === 1 ? '' : 's'} · ${money(cartTotal())} · pay at pickup</p>
    <form id="ck" novalidate>
      <div class="f"><label for="ck-name">Your name</label><input id="ck-name" name="name" autocomplete="name" maxlength="80" required value="${esc(f.name)}" placeholder="So we can call you at the counter"></div>
      <div class="f"><label for="ck-phone">Phone <small>(optional)</small></label><input id="ck-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" maxlength="20" value="${esc(f.phone)}" placeholder="e.g. 021 123 4567"></div>
      <div class="hp" aria-hidden="true"><label for="ck-web">Leave this empty</label><input id="ck-web" name="website" tabindex="-1" autocomplete="off"></div>
      <div class="f"><label id="day-l">Pickup time <small>(NZ time)</small></label>
        ${days.length ? `<div class="days" style="display:flex;overflow-x:auto;gap:8px;scrollbar-width:none" role="radiogroup" aria-labelledby="day-l">${days.map(d => `<button type="button" class="day ${d.key === S.ck.day ? 'on' : ''}" role="radio" aria-checked="${d.key === S.ck.day}" data-a="day" data-k="${d.key}" style="flex:none;min-width:92px;padding:0 12px">${d.label}<small>${d.sub}</small></button>`).join('')}</div>
        <div class="slots" role="radiogroup" aria-label="Pickup time on ${esc(day.label)}">${day.slots.map((s, i) => `<button type="button" class="slot ${s.toISOString() === S.ck.slot ? 'on' : ''}" role="radio" aria-checked="${s.toISOString() === S.ck.slot}" data-a="slot" data-t="${s.toISOString()}">${i === 0 && day.label === 'Today' ? '<span class="asap">Earliest</span>' : ''}${fmtTime(s)}</button>`).join('')}</div>`
        : '<div class="note">No pickup times are available right now.</div>'}</div>
      <div class="f"><label for="ck-notes">Notes <small>(optional)</small></label><textarea id="ck-notes" name="notes" maxlength="300" placeholder="Allergies, extra chutney, etc.">${esc(S.ck.notes || '')}</textarea></div>
      <div class="note">${I.card}<span><b>Pay at pickup.</b> Your order is confirmed straight away; just pay when you collect.</span></div>
    </form>`;
  $('sheet-foot').innerHTML = `<button class="btn split" type="button" data-a="place" id="place" ${S.submitting || !days.length ? 'disabled' : ''}>${S.submitting ? '<span class="spin" aria-hidden="true"></span><span>Placing order…</span><span></span>' : `<span>Place order</span><span class="num">${money(cartTotal())}</span>`}</button>`;
  const keep = () => { S.form.name = $('ck-name').value; S.form.phone = $('ck-phone').value; S.ck.notes = $('ck-notes').value; save('cc_form_v1', S.form); };
  ['ck-name', 'ck-phone', 'ck-notes'].forEach(id => $(id).addEventListener('input', e => { keep(); e.target.removeAttribute('aria-invalid'); }));
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
  const last = Number(localStorage.getItem('cc_last_order_at') || 0), wait = Math.ceil((last + CFG.cooldownSec * 1e3 - Date.now()) / 1e3);
  if (wait > 0) return toast(`You just placed an order. Please wait ${wait}s before placing another.`, true);
  S.submitting = true; checkoutSheet();
  try {
    const items = S.cart.map(l => ({ product_id: l.pid, variant: l.label, variant_index: l.vidx, qty: l.qty }));
    const { data, error } = await sb.rpc('place_customer_order', { p_customer_name: name, p_customer_phone: phone || null, p_pickup_time: S.ck.slot, p_items: items, p_notes: notes || null });
    if (error) throw error;
    localStorage.setItem('cc_last_order_at', String(Date.now()));
    const summary = { ...data, name, count: cartCount() };
    save('cc_last_order', summary);
    S.cart = []; saveCart(); S.ck = null; S.submitting = false;
    closeSheet(); showDone(summary); loadMenu(true);
  } catch (e) {
    S.submitting = false; checkoutSheet(); const msg = friendly(e); toast(msg, true);
    if (/not enough|not available|sold out/i.test(msg)) loadMenu(true);
  }
}

/* confirmation */
function showDone(o) {
  const d = new Date(o.pickup_time), el = $('done');
  el.innerHTML = `<div class="tick">${I.check}</div><h2 tabindex="-1" id="done-h">Order placed!</h2>
    <p class="lead">Thanks ${esc(o.name)} — we've got it and we'll have it hot &amp; ready for you.</p>
    <div class="ticket" role="group" aria-label="Order summary"><div class="no">Order number</div><div class="big num">#${esc(o.order_no)}</div>
      <div class="kv"><span>Pickup</span><b>${esc(relDay(d))} · ${esc(fmtTime(d))}<br><small style="font-weight:500;color:var(--ink2)">${esc(fmtDayLong(d))}</small></b></div>
      <div class="kv"><span>Items</span><b>${o.count}</b></div>
      <div class="kv"><span>Total</span><b class="num" style="font-size:20px">${money(o.total)}</b></div>
      <div class="pay">${I.card}<span>Pay at pickup — please show this order number at the counter.</span></div></div>
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
  else if (a === 'checkout') { S.ck = S.ck || {}; openSheet('checkout'); }
  else if (a === 'cart') openSheet('cart');
  else if (a === 'day') { S.ck.day = t.dataset.k; S.ck.slot = null; checkoutSheet(); }
  else if (a === 'slot') { S.ck.slot = t.dataset.t; buzz(); document.querySelectorAll('.slot').forEach(s => { const on = s === t; s.classList.toggle('on', on); s.setAttribute('aria-checked', on); }); }
  else if (a === 'place') placeOrder();
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
document.addEventListener('submit', e => { e.preventDefault(); placeOrder(); });
// swipe the sheet down to close
(() => {
  let y0 = null, dy = 0; const sh = $('sheet');
  sh.addEventListener('touchstart', e => { if ($('sheet-body').scrollTop > 0 && !e.target.closest('.grab')) return; y0 = e.touches[0].clientY; dy = 0; }, { passive: true });
  sh.addEventListener('touchmove', e => { if (y0 === null) return; dy = e.touches[0].clientY - y0; if (dy > 0) { sh.style.transition = 'none'; sh.style.transform = `translateY(${dy}px)`; } }, { passive: true });
  sh.addEventListener('touchend', () => { if (y0 === null) return; sh.style.transition = ''; sh.style.transform = ''; if (dy > 110) closeSheet(); y0 = null; });
})();
window.addEventListener('scroll', () => $('chips').classList.toggle('stuck', $('chips').getBoundingClientRect().top <= 1), { passive: true });
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.menu) loadMenu(true); });
setInterval(() => { if (!document.hidden && !S.submitting) loadMenu(true); }, 60e3);
setInterval(() => { if (S.sheet === 'checkout' && !S.submitting) { const y = $('sheet-body').scrollTop; checkoutSheet(); $('sheet-body').scrollTop = y; } }, 5 * 60e3);

skeleton(); updateBar(); loadMenu();
