/* rasoi · deli + kitchen staff app (internal name: VegPOS) — live-synced orders, inventory & sales. Static, no build step. */
'use strict';
const SB_URL = 'https://sjjesqyqaikivonjuxfs.supabase.co';
// Public "anon" key — safe in the browser. Row Level Security only lets signed-in, allowlisted staff read/write.
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNqamVzcXlxYWlraXZvbmp1eGZzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM2NTE0MTUsImV4cCI6MjEwOTIyNzQxNX0.5lN5mz2px5dqUUfvu2hr1kzDN_vMzafsZ5hN13cU0Ds';
const TZ = 'Pacific/Auckland';
/* Brand: Preet's final logo file, unmodified, plus straight pixel crops of it (see brand/rasoi/README.md). */
const BRAND = { name: 'rasoi', tagline: 'DELI + KITCHEN', logo: 'brand/rasoi/rasoi-mark.png', word: 'brand/rasoi/rasoi-wordmark.png' };

/* "Remember me": the Supabase session lives in localStorage (stays signed in across visits/tabs, tokens auto-refresh)
   or, when unticked, in sessionStorage (this tab only). We never store the password — the browser's password manager
   (iCloud Keychain etc.) handles that via autocomplete="username"/"current-password". Only the email is remembered. */
const TAB_ONLY_KEY = 'cc.tabOnly', EMAIL_KEY = 'cc.lastEmail'; // tab-only flag lives in sessionStorage, so other tabs are unaffected
const ls = (() => { try { return window.localStorage; } catch (e) { return null; } })(), ss = (() => { try { return window.sessionStorage; } catch (e) { return null; } })();
const remembering = () => !!ls && !(ss && ss.getItem(TAB_ONLY_KEY) === '1'); // default on
const authStore = {
  getItem: k => remembering() ? ((ls && ls.getItem(k)) ?? (ss && ss.getItem(k)) ?? null) : ((ss && ss.getItem(k)) ?? null),
  setItem: (k, v) => { const [a, b] = remembering() ? [ls, ss] : [ss, ls]; a && a.setItem(k, v); b && b.removeItem(k); },
  removeItem: k => { ls && ls.removeItem(k); ss && ss.removeItem(k); }
};
function setRemember(on, email) {
  if (on) { ss && ss.removeItem(TAB_ONLY_KEY); if (ls && email) ls.setItem(EMAIL_KEY, email); }
  else { ss && ss.setItem(TAB_ONLY_KEY, '1'); ls && ls.removeItem(EMAIL_KEY); }
}
function clearAuthStorage() { for (const st of [ls, ss]) { if (!st) continue; for (let i = st.length - 1; i >= 0; i--) { const k = st.key(i); if (k && /^sb-.*-auth-token/.test(k)) st.removeItem(k); } } }
const sb = supabase.createClient(SB_URL, SB_KEY, { auth: { storage: authStore, persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });

/* ---------- tiny helpers ---------- */
const $ = id => document.getElementById(id);
/* shown business name: the Settings value, unless it is still the old internal default */
const bizName = () => { const n = (S.settings.business_name || '').trim(); return n && !/^vegpos$/i.test(n) ? n : BRAND.name; };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const IC = {
  orders: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  plusc: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
  chart: '<path d="M4 20h16"/><rect x="5" y="11" width="3" height="6" rx="1"/><rect x="10.5" y="6" width="3" height="11" rx="1"/><rect x="16" y="9" width="3" height="8" rx="1"/>',
  sliders: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  chev: '<path d="m9 6 6 6-6 6"/>', back: '<path d="m15 6-6 6 6 6"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>', plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>',
  leaf: '<path d="M5 19c0-8 6-14 15-15 0 9-6 15-15 15Z"/><path d="M5 19c4-5 8-8 11-10"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13 7 4 4"/>',
  share: '<path d="M12 3v12M8 7l4-4 4 4"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>',
  print: '<path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  check: '<path d="m5 12 5 5 9-10"/>', xc: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>', alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>',
  logout: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/>', bag: '<path d="M5 8h14l-1 12H6z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>', cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>', arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  star: '<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9 6.8 19.6l1-5.8-4.3-4.1 5.9-.9z"/>', tag: '<path d="M3.5 12.5V4h8.5l8.5 8.5-8.5 8.5z"/><circle cx="8" cy="8.5" r="1.4"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>', lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'
};
const icon = (n, c = '') => `<svg class="i ${c}" viewBox="0 0 24 24" aria-hidden="true">${IC[n] || ''}</svg>`;
const NZD = new Intl.NumberFormat('en-NZ', { style: 'currency', currency: 'NZD' });
const money = v => NZD.format(Number(v) || 0);
const num = v => new Intl.NumberFormat('en-NZ').format(Number(v) || 0);
const pad = n => String(n).padStart(2, '0');
const r2 = v => Math.round((Number(v) || 0) * 100) / 100;

/* ---------- NZ time (Pacific/Auckland) ---------- */
const DTF = new Intl.DateTimeFormat('en-NZ', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const TF = new Intl.DateTimeFormat('en-NZ', { timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true });
function nzParts(d) { const o = {}; for (const p of DTF.formatToParts(new Date(d))) o[p.type] = p.value; return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute }; }
function dayKey(d) { const p = nzParts(d); return `${p.y}-${pad(p.m)}-${pad(p.d)}`; }
function hm(d) { const p = nzParts(d); return `${pad(p.h)}:${pad(p.mi)}`; }
function nzHour(d) { return nzParts(d).h; }
function nzToISO(key, time = '00:00') {
  const [y, m, d] = key.split('-').map(Number), [h, mi] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const off = t => { const p = nzParts(t); return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi) - Math.floor(t / 60000) * 60000; };
  let t = guess - off(guess); t = guess - off(t);
  return new Date(t).toISOString();
}
function addDays(key, n) { const [y, m, d] = key.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); }
const today = () => dayKey(Date.now());
const keyDate = k => new Date(k + 'T12:00:00Z');
function fmtDay(k, long) {
  const t = today();
  if (k === t) return 'Today'; if (k === addDays(t, 1)) return 'Tomorrow'; if (k === addDays(t, -1)) return 'Yesterday';
  return keyDate(k).toLocaleDateString('en-NZ', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', ...(long ? { year: 'numeric' } : {}) });
}
const fmtTime = d => TF.format(new Date(d)).replace(/\s?([ap])\.?m\.?/i, (_, a) => ' ' + a.toLowerCase() + 'm');
const fmtDT = d => `${fmtDay(dayKey(d))}, ${fmtTime(d)}`;
const weekday = k => keyDate(k).getUTCDay(); // 0 = Sun
function relMins(d) { return Math.round((new Date(d).getTime() - Date.now()) / 60000); }
function relLabel(m) { const a = Math.abs(m); const s = a < 60 ? `${a} min` : a < 1440 ? `${Math.floor(a / 60)}h ${a % 60 ? (a % 60) + 'm' : ''}`.trim() : `${Math.round(a / 1440)}d`; return m >= 0 ? `in ${s}` : `${s} late`; }

/* ---------- state ---------- */
const STATUSES = ['pending', 'preparing', 'ready', 'completed'];
const ST_LABEL = { pending: 'Pending', preparing: 'Preparing', ready: 'Ready', completed: 'Completed', cancelled: 'Cancelled' };
const NEXT = { pending: 'preparing', preparing: 'ready', ready: 'completed' };
const NEXT_LABEL = { pending: 'Accept order', preparing: 'Mark ready', ready: 'Complete order' };
const PAY = { cash: 'Cash', card: 'Card', online: 'Online' };
const REASON = { order: 'Order', order_edit: 'Order edited', order_cancel: 'Order cancelled', order_restore: 'Order restored', restock: 'Restock', waste: 'Waste', correction: 'Correction', set: 'Set', initial: 'Opening stock' };
const S = {
  session: null, me: null, started: false, recovery: false,
  products: [], pools: [], orders: [], moves: [], staff: [], customers: [], promos: [], settings: { business_name: BRAND.name, low_stock_default: 10 },
  tab: 'orders', live: 'connecting',
  of: { seg: 'active', q: '', date: '' }, inv: { seg: 'all', q: '', mode: 'items' }, ins: { range: 'today', from: '', to: '' },
  cart: null, cat: 'All', sheet: null
};
function newCart() {
  const t = Math.ceil(Date.now() / 300000) * 300000; // walk-in: now (rounded to 5 min); change with the quick buttons
  return { id: null, no: null, items: [], customer: '', phone: '', date: dayKey(t), time: hm(t), notes: '', payment: 'cash', paid: false, discount: '', promo: '', points: 0 };
}
/* loyalty + promotions helpers */
const normPhone = p => { const d = String(p || '').replace(/[^0-9]/g, ''); if (d.length < 6) return null; return d.startsWith('64') && d.length >= 9 ? '0' + d.slice(2) : d; };
const custByPhone = p => { const n = normPhone(p); return n ? S.customers.find(c => c.phone === n) || null : null; };
const L = () => ({ on: S.settings.loyalty_enabled !== false, earn: Number(S.settings.loyalty_earn_per_dollar ?? 1), blk: Number(S.settings.loyalty_redeem_points || 100), val: Number(S.settings.loyalty_redeem_value ?? 10) });
const promoByCode = c => S.promos.find(p => !p.archived && p.code === String(c || '').trim().toUpperCase()) || null;
function promoProblem(p, amount) {
  if (!p) return "Sorry, that promo code isn't recognised";
  if (!p.active) return "Sorry, that promo code isn't active right now";
  if (p.starts_at && new Date(p.starts_at) > new Date()) return `That promo code starts on ${fmtDay(dayKey(p.starts_at))}`;
  if (p.ends_at && new Date(p.ends_at) <= new Date()) return 'Sorry, that promo code has expired';
  if (p.usage_limit != null && p.used_count >= p.usage_limit) return 'Sorry, that promo code has been fully used';
  if (amount < Number(p.min_order || 0)) return `Spend at least ${money(p.min_order)} to use this code`;
  return null;
}
const promoAmt = (p, a) => !p || a <= 0 ? 0 : p.kind === 'percent' ? Math.min(r2(a * Number(p.value) / 100), a) : Math.min(Number(p.value), a);
const promoLabel = p => p.kind === 'percent' ? `${Number(p.value)}% off` : `${money(p.value)} off`;
const cashKept = o => Number(o.total || 0) + Number(o.tip || 0);
S.cart = newCart();
const isOwner = () => S.me && S.me.role === 'owner';
const prodById = id => S.products.find(p => p.id === id);
const threshold = p => (p.low_stock_threshold ?? S.settings.low_stock_default ?? 10);
/* shared stock pools (stock_items): products with stock_item_id draw from one pooled level */
const poolById = id => S.pools.find(s => s.id === id);
const poolOf = p => (p && p.stock_item_id ? poolById(p.stock_item_id) : null) || null;
const fac = p => Number(p && p.stock_factor) || 1;
const poolThr = s => s.low_stock_threshold ?? S.settings.low_stock_default ?? 10;
const poolLow = s => !s.archived && s.stock <= poolThr(s);
const poolUsers = s => S.products.filter(p => p.stock_item_id === s.id && !p.archived);
const effStock = p => { const s = poolOf(p); return s ? Math.floor(s.stock / fac(p)) : p.stock; };
const isLow = p => !p.archived && (poolOf(p) ? poolLow(poolOf(p)) : p.stock <= threshold(p));
/* ---- inventory aggregates: one entry per real stock source ----
   A shared stock_item is counted exactly once; products linked to it never contribute their own
   (legacy, unused) products.stock. Unlinked products count as before. */
const ppCost = p => { const c = (p.variants || []).filter(v => v.cost != null && Number(v.pieces) > 0).map(v => Number(v.cost) / Number(v.pieces)); return c.length ? c.reduce((a, b) => a + b, 0) / c.length : null; };
function stockSources() {
  const out = [];
  for (const s of S.pools) { if (s.archived) continue; const us = poolUsers(s), cs = us.map(ppCost).filter(c => c != null);
    out.push({ kind: 'pool', id: s.id, name: s.name, stock: Number(s.stock) || 0, thr: poolThr(s), alert: us.length > 0, cpp: cs.length ? cs.reduce((a, b) => a + b, 0) / cs.length : null }); }
  for (const p of S.products) { if (p.archived || poolOf(p)) continue;
    out.push({ kind: 'product', id: p.id, name: p.name, stock: Number(p.stock) || 0, thr: threshold(p), alert: true, cpp: ppCost(p) }); }
  return out;
}
function invTotals() {
  const src = stockSources(), al = src.filter(x => x.alert), low = al.filter(x => x.stock <= x.thr), out = al.filter(x => x.stock <= 0), costed = src.filter(x => x.cpp != null);
  return { src, pieces: src.reduce((a, x) => a + Math.max(x.stock, 0), 0), low, out,
    value: costed.length ? costed.reduce((a, x) => a + Math.max(x.stock, 0) * x.cpp, 0) : null, costed: costed.length };
}
const lowCount = () => invTotals().low.length;
/* list filter "low": linked products are represented by their shared-stock row, so they are not repeated */
const lowRow = p => !p.archived && !poolOf(p) && isLow(p);
const isActive = o => ['pending', 'preparing', 'ready'].includes(o.status);
const itemsCount = o => (o.items || []).reduce((a, i) => a + (Number(i.qty) || 0), 0);
const itemsText = o => (o.items || []).map(i => `${i.qty}× ${i.name}${i.variant ? ' ' + i.variant : ''}`).join(', ');
function dueTag(o) {
  if (!isActive(o)) return '';
  const m = relMins(o.pickup_time);
  if (m < 0) return `<span class="chip tag-overdue">${relLabel(m)}</span>`;
  if (m <= 30) return `<span class="chip tag-soon">Due ${relLabel(m)}</span>`;
  return '';
}
const chip = s => `<span class="chip st-${s}">${ST_LABEL[s] || s}</span>`;

/* ---------- feedback ---------- */
let toastT;
function toast(msg, err) {
  const t = $('toast'); t.innerHTML = icon(err ? 'alert' : 'check', 'sm') + `<span>${esc(msg)}</span>`;
  t.className = 'toast on' + (err ? ' err' : ''); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2600);
}
const buzz = () => { try { navigator.vibrate && navigator.vibrate(8); } catch (e) { } };
function errMsg(e) {
  const m = (e && (e.message || e.error_description || e.msg)) || String(e);
  if (/VEGPOS_NOT_STAFF|Database error saving new user/i.test(m)) return "This email isn't on the staff list. Ask the owner to add it in Settings.";
  if (/Invalid login credentials/i.test(m)) return 'Wrong email or password.';
  if (/Email not confirmed/i.test(m)) return 'Please confirm your email first — tap the link we sent you.';
  if (/Failed to fetch|NetworkError/i.test(m)) return "You're offline. Check your connection and try again.";
  if (/rate limit/i.test(m)) return 'Too many attempts. Please wait a minute and try again.';
  return m;
}
async function rpc(name, args) { const { data, error } = await sb.rpc(name, args); if (error) throw error; return data; }
async function busy(btn, fn) {
  if (btn) { btn.disabled = true; btn.dataset.l = btn.innerHTML; btn.innerHTML = '…'; }
  try { return await fn(); } catch (e) { toast(errMsg(e), true); throw e; }
  finally { if (btn && btn.isConnected) { btn.disabled = false; btn.innerHTML = btn.dataset.l; } }
}

/* ---------- sheet ---------- */
function openSheet(o) {
  S.sheet = o; $('sheet-title').textContent = o.title || '';
  $('sheet-left').innerHTML = o.left ?? `<button class="btn plain" data-a="closeSheet">Close</button>`;
  $('sheet-right').innerHTML = o.right ?? '<span style="min-width:70px;display:inline-block"></span>';
  $('sheet-body').innerHTML = o.body || ''; $('sheet-body').scrollTop = 0;
  const f = $('sheet-foot'); f.hidden = !o.foot; f.innerHTML = o.foot || '';
  $('backdrop').classList.add('on'); $('sheet').classList.add('on'); document.body.style.overflow = 'hidden';
  o.after && o.after();
}
function closeSheet() {
  const o = S.sheet; S.sheet = null; $('backdrop').classList.remove('on'); $('sheet').classList.remove('on'); document.body.style.overflow = '';
  o && o.onClose && o.onClose();
}
function refreshSheet() {
  const o = S.sheet; if (!o || !o.refresh) return;
  if ($('sheet').contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
  const st = $('sheet-body').scrollTop; o.refresh(); $('sheet-body').scrollTop = st;
}

/* ---------- auth ---------- */
const appURL = () => location.origin + location.pathname;
function showAuth(mode, msg, ok) {
  $('boot').hidden = true; $('shell').hidden = true; $('auth').hidden = false; closeSheet();
  const m = msg ? `<div class="msg ${ok ? 'ok' : 'err'}">${msg}</div>` : '';
  const head = (t, s) => `<div class="brand-hero"><img class="brand-logo" src="${BRAND.logo}" alt="" width="120" height="120"><img class="brand-word" src="${BRAND.word}" alt="rasoi deli + kitchen" width="569" height="247"><div class="brand-sub">Staff</div></div>${t ? `<h1>${t}</h1>` : ''}<p class="lead">${s}</p>${m}`;
  if (S.remember === undefined) S.remember = true; // ticked by default on every fresh sign-in screen
  if (!S.authEmail && ls) S.authEmail = ls.getItem(EMAIL_KEY) || ''; // only saved when the last sign-in was remembered
  const email = `<div class="field"><label for="a-email">Email</label><input id="a-email" name="username" type="email" autocomplete="username" autocapitalize="off" autocorrect="off" spellcheck="false" inputmode="email" placeholder="you@example.com" value="${esc(S.authEmail || '')}" required></div>`;
  let h = '';
  if (mode === 'signin') h = head('', 'Staff sign in — orders, stock and sales.') +
    `<form id="a-form" data-mode="signin" method="post" action="#" autocomplete="on"><div class="form">${email}<div class="field"><label for="a-pass">Password</label><input id="a-pass" name="password" type="password" autocomplete="current-password" placeholder="Required" required></div></div>
     <label class="remember"><input type="checkbox" id="a-remember" name="remember" ${S.remember ? 'checked' : ''}><span class="box" aria-hidden="true"></span><span><b>Remember me</b><small>Stay signed in on this device</small></span></label>
     <button class="btn primary lg block" type="submit">Sign in</button></form>
     <div class="links"><button class="btn plain" data-a="authMode" data-m="signup">First time here? Create your password</button><button class="btn plain" data-a="authMode" data-m="forgot">Forgot password?</button>
     ${S.unconfirmed ? '<button class="btn plain" data-a="resend">Resend confirmation email</button>' : ''}</div>`;
  else if (mode === 'signup') h = head('Create your password', 'Staff only. Use the email the owner added to the staff list.') +
    `<form id="a-form" data-mode="signup"><div class="form">${email}<div class="field"><label for="a-pass">Password</label><input id="a-pass" type="password" autocomplete="new-password" placeholder="At least 8 characters"></div>
     <div class="field"><label for="a-pass2">Confirm</label><input id="a-pass2" type="password" autocomplete="new-password" placeholder="Repeat password"></div></div>
     <button class="btn primary lg block" type="submit">Create account</button></form><div class="links"><button class="btn plain" data-a="authMode" data-m="signin">I already have a password</button></div>`;
  else if (mode === 'forgot') h = head('Reset password', "We'll email you a link to set a new password.") +
    `<form id="a-form" data-mode="forgot"><div class="form">${email}</div><button class="btn primary lg block" type="submit">Send reset link</button></form>
     <div class="links"><button class="btn plain" data-a="authMode" data-m="signin">Back to sign in</button></div>`;
  else if (mode === 'recovery') h = head('Set a new password', 'Choose a new password for your staff account.') +
    `<form id="a-form" data-mode="recovery"><div class="form"><div class="field"><label for="a-pass">New</label><input id="a-pass" type="password" autocomplete="new-password" placeholder="At least 8 characters"></div>
     <div class="field"><label for="a-pass2">Confirm</label><input id="a-pass2" type="password" autocomplete="new-password" placeholder="Repeat password"></div></div>
     <button class="btn primary lg block" type="submit">Save password</button></form>`;
  else if (mode === 'notstaff') h = head('No access yet', `${esc(S.session?.user?.email || '')} isn't on the staff list. Ask the owner to add you in Settings → Staff.`) +
    `<button class="btn lg block" data-a="signOut">Sign out</button>`;
  $('auth-box').innerHTML = h; S.authMode = mode;
}
async function authSubmit(form) {
  const mode = form.dataset.mode, btn = form.querySelector('button[type=submit]');
  const email = ($('a-email')?.value || '').trim().toLowerCase(), p1 = $('a-pass')?.value || '', p2 = $('a-pass2')?.value || '';
  if (email) S.authEmail = email;
  if (mode !== 'recovery' && !/^\S+@\S+\.\S+$/.test(email)) return showAuth(mode, 'Enter a valid email address.');
  if ((mode === 'signup' || mode === 'recovery') && (p1.length < 8 || p1 !== p2)) return showAuth(mode, p1.length < 8 ? 'Password must be at least 8 characters.' : "Passwords don't match.");
  btn.disabled = true; btn.textContent = 'Please wait…';
  try {
    if (mode === 'signin') {
      S.remember = !!$('a-remember')?.checked; setRemember(S.remember, email); // decides where the session is stored
      const { error } = await sb.auth.signInWithPassword({ email, password: p1 });
      if (error) { S.unconfirmed = /not confirmed/i.test(error.message); return showAuth('signin', esc(errMsg(error))); }
    } else if (mode === 'signup') {
      const { data, error } = await sb.auth.signUp({ email, password: p1, options: { emailRedirectTo: appURL() } });
      if (error) return showAuth('signup', esc(errMsg(error)));
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) return showAuth('signin', 'An account already exists for this email. Sign in, or use “Forgot password?”.');
      if (!data.session) { S.unconfirmed = true; return showAuth('signin', `Almost done — we emailed <b>${esc(email)}</b>. Tap the confirmation link, then come back here and sign in.`, true); }
    } else if (mode === 'forgot') {
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: appURL() });
      if (error) return showAuth('forgot', esc(errMsg(error)));
      return showAuth('signin', `If ${esc(email)} has an account, a reset link is on its way.`, true);
    } else if (mode === 'recovery') {
      const { error } = await sb.auth.updateUser({ password: p1 });
      if (error) return showAuth('recovery', esc(errMsg(error)));
      S.recovery = false; toast('Password updated');
      const { data } = await sb.auth.getSession(); if (data.session) start(data.session);
    }
  } finally { if (btn.isConnected) { btn.disabled = false; } }
}

/* ---------- data ---------- */
async function q(p) { const { data, error } = await p; if (error) throw error; return data; }
async function loadAll() {
  const [products, orders, moves, settings, staff, pools, customers, promos] = await Promise.all([
    q(sb.from('products').select('*').order('sort_order').order('product_no')),
    q(sb.from('orders').select('*').order('pickup_time', { ascending: false }).limit(5000)),
    q(sb.from('stock_movements').select('*').order('created_at', { ascending: false }).limit(400)),
    q(sb.from('settings').select('*').eq('id', 1).maybeSingle()),
    q(sb.from('staff').select('*').order('created_at')),
    q(sb.from('stock_items').select('*').order('sort_order').order('name')),
    q(sb.from('customers').select('*').order('last_order_at', { ascending: false, nullsFirst: false }).limit(5000)),
    q(sb.from('promotions').select('*').order('created_at', { ascending: false }))
  ]);
  Object.assign(S, { products, orders, moves, staff, pools, customers, promos }); if (settings) S.settings = settings;
  S.me = staff.find(s => s.email === (S.session?.user?.email || '').toLowerCase()) || null;
}
const KEY = { orders: 'id', products: 'id', stock_movements: 'id', staff: 'email', settings: 'id', stock_items: 'id', customers: 'id', promotions: 'id' };
const LIST = { orders: 'orders', products: 'products', stock_movements: 'moves', staff: 'staff', stock_items: 'pools', customers: 'customers', promotions: 'promos' };
function applyRow(table, row, del) {
  if (table === 'settings') { if (!del && row) S.settings = row; return; }
  const k = KEY[table], arr = S[LIST[table]], i = arr.findIndex(x => x[k] === row[k]);
  if (del) { if (i >= 0) arr.splice(i, 1); return; }
  if (i >= 0) arr[i] = { ...arr[i], ...row };
  else if (table === 'stock_movements') { arr.unshift(row); if (arr.length > 600) arr.length = 600; }
  else arr.push(row);
  if (table === 'products') arr.sort((a, b) => (a.sort_order - b.sort_order) || (a.product_no - b.product_no));
  if (table === 'staff' && S.session && row.email === S.session.user.email.toLowerCase()) S.me = row;
}
function onChange(p) {
  const del = p.eventType === 'DELETE';
  if (p.table === 'orders' && p.eventType === 'INSERT' && p.new) newOrderAlert(p.new);
  applyRow(p.table, del ? p.old : p.new, del);
  // one transaction can update a shared pool row several times (e.g. Steamed + Fried in one order); re-read the pools so the level is always the committed one
  if (['stock_movements', 'stock_items', 'orders'].includes(p.table)) refreshPools();
  if (p.table === 'staff' && del && S.session && p.old.email === S.session.user.email.toLowerCase()) { S.me = null; return showAuth('notstaff'); }
  rerender();
}
/* ---------- new-order alert (banner + chime + vibrate) ---------- */
const isCustApp = o => o && o.created_by === 'customer-app';
const custBadge = o => isCustApp(o) ? `<span class="chip src-app">${icon('orders', 'xs')}Customer app</span>` : '';
const alerted = new Set();
let audioCtx = null, alertT;
function unlockAudio() {
  try { if (!audioCtx) { const AC = window.AudioContext || window.webkitAudioContext; if (AC) audioCtx = new AC(); } if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume(); } catch (e) { }
}
['pointerdown', 'keydown', 'touchstart'].forEach(ev => document.addEventListener(ev, unlockAudio, { passive: true }));
function chime() {
  try {
    unlockAudio(); const c = audioCtx; if (!c || c.state !== 'running') return;
    const t0 = c.currentTime;
    [[880, 0], [1318.5, 0.16], [1760, 0.32]].forEach(([f, d]) => {
      const o = c.createOscillator(), g = c.createGain(); o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + d); g.gain.exponentialRampToValueAtTime(0.35, t0 + d + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.5);
      o.connect(g).connect(c.destination); o.start(t0 + d); o.stop(t0 + d + 0.55);
    });
  } catch (e) { }
}
function newOrderAlert(o) {
  if (!S.started || !o.id || alerted.has(o.id)) return; alerted.add(o.id);
  // only live, fresh inserts: never on initial load / resync, and not for orders this device just entered itself
  if (o.created_at && Date.now() - new Date(o.created_at).getTime() > 10 * 60000) return;
  const mine = S.session && o.created_by && o.created_by.toLowerCase() === (S.session.user.email || '').toLowerCase();
  if (mine) return;
  let b = $('neworder');
  if (!b) { b = document.createElement('div'); b.id = 'neworder'; b.className = 'neworder'; b.setAttribute('role', 'alert'); b.setAttribute('aria-live', 'assertive'); document.body.appendChild(b); }
  b.innerHTML = `<button class="no-main" data-a="openOrder" data-id="${o.id}"><span class="no-ic">${icon('orders', 'sm')}</span><span class="grow"><b>New order #${o.order_no}${isCustApp(o) ? ' · Customer app' : ''}</b>
    <small>${esc(o.customer_name || '')} · pickup ${fmtDT(o.pickup_time)} · ${money(o.total)}</small></span><span class="no-view">View</span></button>
    ${o.status === 'pending' ? `<button class="no-accept" data-a="acceptAlert" data-id="${o.id}">${icon('check', 'sm')}Accept</button>` : ''}
    <button class="no-x" data-a="dismissAlert" aria-label="Dismiss">${icon('xc', 'sm')}</button>`;
  b.classList.toggle('app', isCustApp(o)); requestAnimationFrame(() => b.classList.add('on'));
  clearTimeout(alertT); alertT = setTimeout(() => b.classList.remove('on'), 15000);
  chime(); try { navigator.vibrate && navigator.vibrate([180, 90, 180]); } catch (e) { }
  if (document.hidden) { const t0 = document.title; document.title = `● New order #${o.order_no}`; const back = () => { if (!document.hidden) { document.title = t0; document.removeEventListener('visibilitychange', back); } }; document.addEventListener('visibilitychange', back); }
}
let poolT;
function refreshPools() { clearTimeout(poolT); poolT = setTimeout(async () => { if (!S.started) return; const { data } = await sb.from('stock_items').select('*').order('sort_order').order('name'); if (data) { S.pools = data; rerender(); } }, 350); }
function setLive(s) {
  const was = S.live; S.live = s;
  document.querySelectorAll('.live').forEach(el => { el.className = 'live ' + (s === 'ok' ? 'ok' : s === 'bad' ? 'bad' : ''); el.lastChild.textContent = s === 'ok' ? 'Live' : s === 'bad' ? 'Offline' : 'Connecting'; });
  if (s === 'ok' && was === 'bad') resync();
}
const liveHTML = () => `<span class="live ${S.live === 'ok' ? 'ok' : S.live === 'bad' ? 'bad' : ''}"><i></i>${S.live === 'ok' ? 'Live' : S.live === 'bad' ? 'Offline' : 'Connecting'}</span>`;
function subscribe() {
  if (S.ch) sb.removeChannel(S.ch);
  let ch = sb.channel('vegpos-live');
  for (const t of ['orders', 'products', 'stock_items', 'stock_movements', 'settings', 'staff', 'customers', 'promotions']) ch = ch.on('postgres_changes', { event: '*', schema: 'public', table: t }, onChange);
  S.ch = ch.subscribe(st => {
    setLive(st === 'SUBSCRIBED' ? 'ok' : ['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(st) ? 'bad' : 'connecting');
    // Realtime starts streaming a moment after SUBSCRIBED; re-read once so nothing written in that gap is missed.
    if (st === 'SUBSCRIBED') { setTimeout(resync, 2500); }
  });
}
let resyncT;
function resync() { clearTimeout(resyncT); resyncT = setTimeout(async () => { if (!S.started) return; try { await loadAll(); rerender(); } catch (e) { } }, 300); }

async function start(session) {
  S.session = session; S.authEmail = session.user.email;
  if (S.started) return; S.started = true;
  try { await loadAll(); } catch (e) { S.started = false; return showAuth('signin', esc(errMsg(e))); }
  if (!S.me) { S.started = false; return showAuth('notstaff'); }
  $('boot').hidden = true; $('auth').hidden = true; $('shell').hidden = false;
  buildViews(); go(S.tab); subscribe();
}
function stop() { S.started = false; S.me = null; if (S.ch) { sb.removeChannel(S.ch); S.ch = null; } Object.values(charts).forEach(c => c.destroy()); for (const k in charts) delete charts[k]; }

/* ---------- tabs ---------- */
const TABS = [['orders', 'Orders', 'orders'], ['new', 'New Order', 'plusc'], ['inventory', 'Inventory', 'box'], ['insights', 'Insights', 'chart'], ['settings', 'Settings', 'sliders']];
function renderTabbar() {
  const overdue = S.orders.filter(o => isActive(o) && relMins(o.pickup_time) < 0).length;
  const low = lowCount();
  const badge = { orders: overdue, inventory: low };
  $('tabbar').innerHTML = `<div class="side-brand"><img src="${BRAND.logo}" alt="" width="44" height="44"><div class="sb-t">${esc(bizName())}<em>${esc(BRAND.tagline)}</em></div><small>${esc(S.me?.name || S.me?.email || '')}</small></div>` +
    TABS.map(([k, l, ic]) => `<button class="tab ${S.tab === k ? 'on' : ''}" data-a="go" data-t="${k}" aria-label="${l}">${icon(ic)}<span>${l}</span>${badge[k] ? `<span class="badge">${badge[k]}</span>` : ''}</button>`).join('');
}
function go(t) {
  S.tab = t; document.querySelectorAll('.view').forEach(v => v.classList.toggle('on', v.id === 'v-' + t));
  renderTabbar(); renderTab(t); updateCartbar(); window.scrollTo({ top: 0 });
}
function renderTab(t) { ({ orders: renderOrders, new: renderMenu, inventory: renderInventory, insights: renderInsights, settings: renderSettings })[t](); }
let rq = 0;
function rerender() { if (rq) return; rq = requestAnimationFrame(() => { rq = 0; if (!S.started || !S.me) return; renderTab(S.tab); renderTabbar(); refreshSheet(); updateCartbar(); }); }
function header(title, sub, right = '') {
  return `<div class="tb-brand"><img src="${BRAND.logo}" alt="" width="30" height="30"><span class="n">${esc(bizName())}</span><span class="tg">${esc(BRAND.tagline)}</span></div><div class="topbar"><div class="left">${liveHTML()}</div><div>${right}</div></div><h1 class="largetitle">${title}</h1>${sub ? `<p class="subtitle">${sub}</p>` : ''}`;
}
function buildViews() {
  $('v-orders').innerHTML = `<div id="o-head"></div>
    <div class="strip" id="o-stats"></div>
    <div class="toolbar mt"><label class="search">${icon('search', 'sm')}<input id="o-q" type="search" placeholder="Search name, phone, #" autocomplete="off"></label>
      <label class="datepick pill">${icon('clock', 'xs')}<span id="o-date-l">Any day</span><input id="o-date" type="date" aria-label="Filter by pickup date"></label><button class="iconbtn filled" id="o-date-x" data-a="clearDate" aria-label="Clear date" hidden style="width:36px;height:36px">${icon('x', 'xs')}</button></div>
    <div class="seg scroll" id="o-seg"></div><div id="o-list"></div>`;
  $('v-new').innerHTML = `<div id="n-head"></div><div class="pos"><div><div id="n-banner"></div><div class="seg scroll cats" id="n-cats"></div><div class="menu-grid" id="n-grid"></div></div>
    <aside class="cartcol"><div class="card" id="n-cart"></div></aside></div>`;
  $('v-inventory').innerHTML = `<div id="i-head"></div><div class="stats" id="i-stats"></div>
    <div class="seg mt" id="i-mode"></div><div id="i-tools"></div><div id="i-list"></div>`;
  $('v-insights').innerHTML = `<div id="s-head"></div><div class="seg" id="s-range"></div><div id="s-custom"></div><div id="s-body"></div>`;
  $('v-settings').innerHTML = `<div id="g-body"></div>`;
  $('o-q').addEventListener('input', e => { S.of.q = e.target.value; renderOrderList(); });
  $('o-date').addEventListener('change', e => { S.of.date = e.target.value; renderOrders(); });
  $('o-date').addEventListener('click', e => { try { e.target.showPicker(); } catch (x) { } });
}

/* ---------- Orders ---------- */
const revenueOf = list => list.filter(o => o.status !== 'cancelled').reduce((a, o) => a + Number(o.total || 0), 0);
function renderOrders() {
  const t = today(), long = keyDate(t).toLocaleDateString('en-NZ', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' });
  $('o-head').innerHTML = header('Orders', long, `<button class="btn primary sm" data-a="go" data-t="new">${icon('plus', 'xs')} New order</button>`);
  const tod = S.orders.filter(o => dayKey(o.pickup_time) === t);
  const active = S.orders.filter(isActive);
  const next = active.slice().sort((a, b) => new Date(a.pickup_time) - new Date(b.pickup_time))[0];
  const overdue = active.filter(o => relMins(o.pickup_time) < 0).length;
  $('o-stats').innerHTML = [
    ['Today’s sales', money(revenueOf(tod)), `${tod.filter(o => o.status !== 'cancelled').length} orders`],
    ['In progress', num(active.length), overdue ? `<span style="color:var(--red)">${overdue} overdue</span>` : 'All on time'],
    ['Next pickup', next ? fmtTime(next.pickup_time) : '—', next ? esc(next.customer_name) : 'Nothing queued'],
    ['Unpaid', money(S.orders.filter(o => !o.paid && o.status !== 'cancelled').reduce((a, o) => a + Number(o.total), 0)), 'Awaiting payment']
  ].map(([k, v, d]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div><div class="d">${d}</div></div>`).join('');
  $('o-date').value = S.of.date || ''; $('o-date-l').textContent = S.of.date ? fmtDay(S.of.date) : 'Any day'; $('o-date-x').hidden = !S.of.date;
  const cnt = s => S.orders.filter(o => (s === 'active' ? isActive(o) : s === 'all' ? true : o.status === s) && (!S.of.date || dayKey(o.pickup_time) === S.of.date)).length;
  $('o-seg').innerHTML = [['active', 'Active'], ['completed', 'Completed'], ['cancelled', 'Cancelled'], ['all', 'All']]
    .map(([k, l]) => `<button class="${S.of.seg === k ? 'on' : ''}" data-a="oseg" data-k="${k}">${l} <span class="muted num">${cnt(k)}</span></button>`).join('');
  renderOrderList();
}
function filteredOrders() {
  const qq = S.of.q.trim().toLowerCase();
  let list = S.orders.filter(o => S.of.seg === 'active' ? isActive(o) : S.of.seg === 'all' ? true : o.status === S.of.seg);
  if (S.of.date) list = list.filter(o => dayKey(o.pickup_time) === S.of.date);
  if (qq) list = list.filter(o => (`#${o.order_no} ${o.customer_name} ${o.customer_phone || ''} ${o.notes || ''} ${itemsText(o)}`).toLowerCase().includes(qq.replace(/^#/, '#')));
  const asc = S.of.seg === 'active';
  return list.sort((a, b) => asc ? new Date(a.pickup_time) - new Date(b.pickup_time) : new Date(b.pickup_time) - new Date(a.pickup_time));
}
function orderRow(o) {
  const [tm, ap] = fmtTime(o.pickup_time).split(' ');
  const nx = NEXT[o.status];
  const acts = o.status === 'cancelled' ? '' :
    (nx ? `<button style="background:var(--accent)" data-a="advance" data-id="${o.id}">${icon('check', 'sm')}${o.status === 'pending' ? 'Accept' : ST_LABEL[nx]}</button>` : '') +
    (o.locked ? '' : `<button style="background:var(--red)" data-a="cancelOrder" data-id="${o.id}">${icon('xc', 'sm')}Cancel</button>`);
  const w = o.status === 'cancelled' ? 0 : (nx ? 84 : 0) + (o.locked ? 0 : 84);
  return `<div class="row-wrap" data-w="${w}">${w ? `<div class="swipe-actions">${acts}</div>` : ''}
    <button class="row" data-a="openOrder" data-id="${o.id}">
      <div class="o-time"><b>${tm}</b><small>${ap || ''}</small></div>
      <div class="grow"><div class="t">${esc(o.customer_name)} <span class="muted small num">#${o.order_no}</span>${o.locked ? `<span class="lockmark" title="Locked" aria-label="Locked">${icon('lock', 'xs')}</span>` : ''}</div>
        <div class="s">${esc(itemsText(o))}</div>
        <div class="o-meta">${chip(o.status)}${custBadge(o)}${dueTag(o)}</div></div>
      <div class="end"><div class="o-total">${money(o.total)}</div><div class="s small">${o.status !== 'cancelled' && !o.paid ? '<span style="color:var(--orange)">Unpaid</span>' : o.payment_method ? PAY[o.payment_method] : ''}</div></div>
    </button></div>${quickActs(o)}`;
}
function quickActs(o) {
  if (o.status === 'cancelled' || (o.paid && o.status !== 'pending')) return '';
  return `<div class="qacts">${o.status === 'pending' ? `<button class="btn primary sm" data-a="accept" data-id="${o.id}">${icon('check', 'xs')}Accept</button>` : ''}
    ${o.paid ? '' : `<button class="btn sm cashbtn" data-a="paidCash" data-id="${o.id}">${icon('cash', 'xs')}Paid cash · ${money(o.total)}</button><button class="btn sm plainish" data-a="cashSheet" data-id="${o.id}" aria-label="Cash received for order ${o.order_no}">Cash received…</button>`}</div>`;
}
function renderOrderList() {
  const list = filteredOrders();
  if (!list.length) {
    $('o-list').innerHTML = `<div class="empty">${icon('orders')}<b>${S.of.q || S.of.date ? 'No matching orders' : S.of.seg === 'active' ? 'No active orders' : 'No orders yet'}</b>${S.of.seg === 'active' && !S.of.q ? 'New orders appear here instantly on every device.' : 'Try a different filter.'}</div>`;
    return;
  }
  const groups = new Map();
  for (const o of list) { const k = dayKey(o.pickup_time); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(o); }
  let h = '';
  for (const [k, os] of groups) h += `<div class="day-h"><span>${fmtDay(k)}</span><span class="num">${os.length} · ${money(revenueOf(os))}</span></div><div class="list">${os.map(orderRow).join('')}</div>`;
  $('o-list').innerHTML = h;
}

/* swipe-to-act rows */
(function swipe() {
  let wrap = null, x0 = 0, y0 = 0, dx = 0, base = 0, horiz = null;
  const closeAll = except => document.querySelectorAll('.row-wrap.open').forEach(w => { if (w !== except) { w.classList.remove('open'); w.querySelector('.row').style.transform = ''; } });
  document.addEventListener('touchstart', e => {
    const w = e.target.closest('.row-wrap'); if (!w || !+w.dataset.w || e.target.closest('.swipe-actions')) { if (!e.target.closest('.swipe-actions')) closeAll(); return; }
    wrap = w; x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; dx = 0; horiz = null; base = w.classList.contains('open') ? -w.dataset.w : 0; closeAll(w);
  }, { passive: true });
  document.addEventListener('touchmove', e => {
    if (!wrap) return; const mx = e.touches[0].clientX - x0, my = e.touches[0].clientY - y0;
    if (horiz === null && (Math.abs(mx) > 8 || Math.abs(my) > 8)) horiz = Math.abs(mx) > Math.abs(my);
    if (!horiz) return; dx = mx; wrap.classList.add('dragging');
    const x = Math.min(0, Math.max(-wrap.dataset.w - 40, base + dx)); wrap.querySelector('.row').style.transform = `translateX(${x}px)`;
  }, { passive: true });
  document.addEventListener('touchend', () => {
    if (!wrap) return; const w = wrap; wrap = null; w.classList.remove('dragging'); if (!horiz) return;
    const open = base + dx < -w.dataset.w / 2; w.classList.toggle('open', open);
    w.querySelector('.row').style.transform = open ? `translateX(${-w.dataset.w}px)` : '';
    if (Math.abs(dx) > 8) { w.dataset.swiped = '1'; setTimeout(() => delete w.dataset.swiped, 350); }
  });
})();

/* order detail */
function orderBody(o) {
  const by = isCustApp(o) ? ' · via Customer app' : o.created_by ? ` · by ${esc(o.created_by.split('@')[0])}` : '';
  const m = relMins(o.pickup_time);
  const step = STATUSES.indexOf(o.status);
  return `<div class="detail-hero"><div class="no num">Order #${o.order_no} · placed ${fmtDT(o.created_at)}${by}</div>
    <h3>${esc(o.customer_name)}</h3><div class="when">${icon('clock', 'xs')} Pickup ${fmtDT(o.pickup_time)}${isActive(o) ? ` · ${relLabel(m)}` : ''}</div>
    <div class="o-meta" style="justify-content:center;margin-top:8px">${chip(o.status)}${custBadge(o)}${dueTag(o)}${o.locked ? `<span class="chip tag-muted">${icon('lock', 'xs')} Locked</span>` : ''}</div></div>
    ${o.status !== 'cancelled' ? `<div class="progress">${STATUSES.map((s, i) => `<div class="${i <= step ? 'on' : ''}"></div>`).join('')}</div>
    <div class="progress-l">${STATUSES.map(s => `<span>${ST_LABEL[s]}</span>`).join('')}</div>
    <div class="seg mt">${STATUSES.map(s => `<button class="${o.status === s ? 'on' : ''}" data-a="setStatus" data-id="${o.id}" data-s="${s}">${ST_LABEL[s]}</button>`).join('')}</div>` : ''}
    <div class="form-h">Items</div><div class="list">${(o.items || []).map(i => `<div class="line"><div class="grow"><div class="t">${esc(i.name)}</div><div class="s">${esc(i.variant || '')} · ${money(i.price)} each</div></div><div class="muted num">×${i.qty}</div><div class="p">${money(i.price * i.qty)}</div></div>`).join('')}</div>
    <div class="list totals mt">
      <div class="row static"><div class="grow t">Subtotal</div><div class="end num">${money(o.subtotal || o.total)}</div></div>
      ${discRows(o)}
      <div class="row static grand"><div class="grow t">Total</div><div class="end num">${money(o.total)}</div></div>
      <div class="row static"><div class="grow"><div class="t">${o.paid ? 'Paid' : 'Not paid yet'}</div><div class="s">${o.payment_method ? PAY[o.payment_method] : 'No payment method'}${o.paid && o.paid_at ? ` · ${fmtDT(o.paid_at)}${o.paid_by ? ' by ' + esc(String(o.paid_by).split('@')[0]) : ''}` : ''}</div></div>
        <label class="switch"><input type="checkbox" ${o.paid ? 'checked' : ''} data-a="togglePaid" data-id="${o.id}" aria-label="Paid"><span></span></label></div>
      ${o.paid && o.cash_received != null ? `<div class="row static"><div class="grow"><div class="t">Cash received ${money(o.cash_received)}</div><div class="s">Change given ${money(o.change_given)}${Number(o.tip) ? ` · <b>Tip ${money(o.tip)}</b>` : ''}</div></div></div>` : ''}
    </div>
    ${o.status !== 'cancelled' && !o.paid ? `<div class="paybar mt"><button class="btn primary lg" data-a="paidCash" data-id="${o.id}">${icon('cash', 'sm')}Paid cash · ${money(o.total)}</button><button class="btn lg" data-a="cashSheet" data-id="${o.id}">Cash received…</button></div>` : ''}
    ${loyaltyBlock(o)}
    ${o.customer_phone || o.notes ? `<div class="list mt">${o.customer_phone ? `<a class="row" href="tel:${esc(o.customer_phone)}" style="color:inherit;text-decoration:none">${icon('phone', 'sm')}<div class="grow t">${esc(o.customer_phone)}</div><span class="chev">${icon('chev', 'sm')}</span></a>` : ''}
      ${o.notes ? `<div class="row static"><div class="grow"><div class="s">Notes</div><div style="white-space:pre-wrap">${esc(o.notes)}</div></div></div>` : ''}</div>` : ''}
    ${o.locked ? `<p class="form-note" style="text-align:center">${icon('lock', 'xs')} This order is locked. Status and payment can still be updated; items, customer, times and cancelling are protected.</p>` : ''}
    <div class="actions-grid">
      ${o.locked ? '' : `<button class="btn" data-a="editOrder" data-id="${o.id}">${icon('edit')}Edit</button>`}
      <button class="btn" data-a="receipt" data-id="${o.id}">${icon('share')}Receipt</button>
      ${o.locked ? '' : o.status === 'cancelled' ? `<button class="btn" data-a="setStatus" data-id="${o.id}" data-s="pending">${icon('undo')}Restore</button>` : `<button class="btn danger" data-a="cancelOrder" data-id="${o.id}">${icon('xc')}Cancel</button>`}
      ${isOwner() ? `<button class="btn" data-a="toggleLock" data-id="${o.id}">${icon('lock')}${o.locked ? 'Unlock' : 'Lock'}</button>` : ''}
    </div>
    <p class="small muted mt" style="text-align:center">${o.completed_at ? `Completed ${fmtDT(o.completed_at)}` : o.cancelled_at ? `Cancelled ${fmtDT(o.cancelled_at)} · stock returned` : `Updated ${fmtDT(o.updated_at || o.created_at)}`}</p>`;
}
function orderFoot(o) { const nx = NEXT[o.status]; return nx ? `<button class="btn primary lg block" data-a="advance" data-id="${o.id}">${o.status === 'pending' ? icon('check', 'sm') : ''}${NEXT_LABEL[o.status]}</button>` : ''; }
function discRows(o) {
  const man = r2(Number(o.discount || 0) - Number(o.promo_discount || 0) - Number(o.points_discount || 0));
  return (man > 0 ? `<div class="row static"><div class="grow t">Discount</div><div class="end num">−${money(man)}</div></div>` : '') +
    (Number(o.promo_discount) ? `<div class="row static"><div class="grow t">Promo <b>${esc(o.promo_code || '')}</b></div><div class="end num">−${money(o.promo_discount)}</div></div>` : '') +
    (Number(o.points_discount) ? `<div class="row static"><div class="grow t">${num(o.points_redeemed)} points redeemed</div><div class="end num">−${money(o.points_discount)}</div></div>` : '');
}
function loyaltyBlock(o) {
  if (o.status === 'cancelled') return '';
  const c = custByPhone(o.customer_phone), l = L(), locked = o.locked;
  const avail = c ? c.points + Number(o.points_redeemed || 0) : 0;
  const maxBlocks = c && l.on ? Math.min(Math.floor(avail / l.blk), Math.floor((Number(o.total) + Number(o.points_discount || 0)) / l.val)) : 0;
  const chips = [0, ...Array.from({ length: Math.min(maxBlocks, 5) }, (_, i) => (i + 1) * l.blk)];
  return `<div class="form-h">Loyalty &amp; promo</div><div class="list">
    <div class="row static">${icon('star', 'sm')}<div class="grow"><div class="t">${c ? `${num(c.points)} points` : o.customer_phone ? 'New loyalty customer' : 'No phone on this order'}</div>
      <div class="s">${c ? `${esc(c.name || o.customer_name)} · ${num(c.paid_orders)} paid orders · ${money(c.total_spent)} spent` : o.customer_phone ? `Points are added when the order is paid (${l.earn} per $1)` : 'Add a phone (Edit) to earn and use points'}</div></div>
      ${c ? `<button class="btn sm" data-a="openCustomer" data-id="${c.id}">History</button>` : ''}</div>
    ${c && l.on && !locked && (maxBlocks > 0 || Number(o.points_redeemed)) ? `<div class="row static col"><div class="s" style="margin-bottom:6px">Redeem points · ${l.blk} points = ${money(l.val)} off</div><div class="chipsrow">${chips.map(n => `<button class="btn sm ${Number(o.points_redeemed || 0) === n ? 'primary' : ''}" data-a="redeem" data-id="${o.id}" data-n="${n}">${n ? `${num(n)} pts · −${money(n / l.blk * l.val)}` : 'None'}</button>`).join('')}</div></div>` : ''}
    ${locked ? '' : `<div class="row static col"><div class="s" style="margin-bottom:6px">Promo code${o.promo_code ? ` · applied <b>${esc(o.promo_code)}</b>` : ''}</div><div class="chipsrow"><input class="codein" id="od-code" value="${esc(o.promo_code || '')}" placeholder="CODE" autocapitalize="characters" autocomplete="off" maxlength="24">
      <button class="btn sm primary" data-a="applyPromo" data-id="${o.id}">Apply</button>${o.promo_code ? `<button class="btn sm" data-a="removePromo" data-id="${o.id}">Remove</button>` : ''}</div>
      ${activePromos().length ? `<div class="chipsrow mt">${activePromos().slice(0, 4).map(p => `<button class="btn sm" data-a="pickPromo" data-code="${esc(p.code)}">${esc(p.code)} · ${esc(promoLabel(p))}</button>`).join('')}</div>` : ''}</div>`}
  </div>`;
}
const activePromos = () => S.promos.filter(p => !p.archived && !promoProblem(p, 1e9));
function openOrder(id) {
  const o = S.orders.find(x => x.id === id); if (!o) return;
  openSheet({ title: `Order #${o.order_no}`, body: orderBody(o), foot: orderFoot(o), key: id,
    refresh() { const x = S.orders.find(y => y.id === id); if (!x) return closeSheet(); $('sheet-body').innerHTML = orderBody(x); const f = orderFoot(x); $('sheet-foot').hidden = !f; $('sheet-foot').innerHTML = f; } });
}
async function setStatus(id, s, btn) {
  const o = S.orders.find(x => x.id === id); if (!o || o.status === s) return;
  if (s === 'cancelled' && !confirm(`Cancel order #${o.order_no} for ${o.customer_name}? Stock will be returned.`)) return;
  await busy(btn, async () => { const r = await rpc('set_order_status', { p_order_id: id, p_status: s }); applyRow('orders', r); buzz(); });
  toast(s === 'cancelled' ? `Order #${o.order_no} cancelled · stock returned` : o.status === 'cancelled' ? `Order #${o.order_no} restored` : `#${o.order_no} · ${ST_LABEL[s]}`);
  rerender();
}
function receiptHTML(o) {
  return `<div class="receipt"><h3>${esc(bizName())}</h3><div class="c">Order #${o.order_no} · ${fmtDT(o.created_at)}</div><hr>
    <div class="r"><span>Customer</span><span>${esc(o.customer_name)}</span></div>${o.customer_phone ? `<div class="r"><span>Phone</span><span>${esc(o.customer_phone)}</span></div>` : ''}
    <div class="r"><span>Pickup</span><span>${fmtDT(o.pickup_time)}</span></div><hr>
    ${(o.items || []).map(i => `<div class="r"><span>${i.qty}× ${esc(i.name)} ${esc(i.variant || '')}</span><span>${money(i.price * i.qty)}</span></div>`).join('')}<hr>
    <div class="r"><span>Subtotal</span><span>${money(o.subtotal || o.total)}</span></div>${Number(o.discount) ? `<div class="r"><span>Discount${o.promo_code ? ' (' + esc(o.promo_code) + ')' : ''}${Number(o.points_redeemed) ? ' · ' + num(o.points_redeemed) + ' pts' : ''}</span><span>−${money(o.discount)}</span></div>` : ''}
    <div class="r b"><span>Total</span><span>${money(o.total)}</span></div>
    <div class="r"><span>${o.paid ? 'Paid' : 'To pay'}</span><span>${o.payment_method ? PAY[o.payment_method] : ''}</span></div>
    ${o.paid && o.cash_received != null ? `<div class="r"><span>Cash received</span><span>${money(o.cash_received)}</span></div><div class="r"><span>${Number(o.tip) ? 'Tip (kept)' : 'Change'}</span><span>${money(Number(o.tip) ? o.tip : o.change_given)}</span></div>` : ''}
    ${o.notes ? `<hr><div>${esc(o.notes)}</div>` : ''}<hr><div class="c">Thank you!</div></div>`;
}
function receiptText(o) {
  return [`${bizName()} — Order #${o.order_no}`, `Customer: ${o.customer_name}`, `Pickup: ${fmtDT(o.pickup_time)}`, '',
    ...(o.items || []).map(i => `${i.qty}× ${i.name} ${i.variant || ''} — ${money(i.price * i.qty)}`), '',
    ...(Number(o.discount) ? [`Discount: −${money(o.discount)}`] : []), `Total: ${money(o.total)}`, `${o.paid ? 'Paid' : 'To pay'}${o.payment_method ? ' (' + PAY[o.payment_method] + ')' : ''}`].join('\n');
}
function openReceipt(id) {
  const o = S.orders.find(x => x.id === id); if (!o) return;
  openSheet({ title: 'Receipt', left: `<button class="btn plain" data-a="openOrder" data-id="${id}">${icon('back', 'sm')}Order</button>`, body: receiptHTML(o),
    foot: `<div style="display:flex;gap:10px"><button class="btn lg" style="flex:1" data-a="printReceipt" data-id="${id}">${icon('print', 'sm')} Print</button><button class="btn primary lg" style="flex:1" data-a="shareReceipt" data-id="${id}">${icon('share', 'sm')} Share</button></div>` });
}

/* ---------- New / edit order ---------- */
const cartSub = () => r2(S.cart.items.reduce((a, i) => a + i.price * i.qty, 0));
const cartDisc = () => Math.min(Math.max(Number(S.cart.discount) || 0, 0), cartSub());
const cartPromo = () => { const p = S.cart.promo ? promoByCode(S.cart.promo) : null; const left = cartSub() - cartDisc(); return p && !promoProblem(p, left) ? promoAmt(p, left) : 0; };
const cartPtsDisc = () => { const l = L(); return S.cart.points ? (S.cart.points / l.blk) * l.val : 0; };
const cartTotal = () => r2(Math.max(cartSub() - cartDisc() - cartPromo() - cartPtsDisc(), 0));
const cartCount = () => S.cart.items.reduce((a, i) => a + i.qty, 0);
function cartPieces(pid) { return S.cart.items.filter(i => i.productId === pid).reduce((a, i) => a + i.pieces * i.qty, 0); }
function origPieces(pid) { const o = S.cart.id && S.orders.find(x => x.id === S.cart.id); return o && o.status !== 'cancelled' ? (o.items || []).filter(i => i.productId === pid).reduce((a, i) => a + (i.pieces || 0) * (i.qty || 0), 0) : 0; }
function availPieces(p) {
  const s = poolOf(p); if (!s) return p.stock + origPieces(p.id) - cartPieces(p.id);
  const used = S.products.filter(x => x.stock_item_id === s.id).reduce((a, x) => a + (cartPieces(x.id) - origPieces(x.id)) * fac(x), 0);
  return Math.floor((s.stock - used) / fac(p));
}
function renderMenu() {
  const c = S.cart, editing = !!c.id;
  $('n-head').innerHTML = header(editing ? `Edit #${c.no}` : 'New Order', 'Tap a size to add it to the order.', c.items.length ? `<button class="btn plain" data-a="clearCart">${editing ? 'Discard' : 'Clear'}</button>` : '');
  $('n-banner').innerHTML = editing ? `<div class="editing-banner">${icon('edit', 'sm')}<span class="grow">Editing order #${c.no}. Stock adjusts automatically for any changes.</span><button class="btn sm" data-a="clearCart">Discard</button></div>` : '';
  const prods = S.products.filter(p => p.active && !p.archived);
  const cats = ['All', ...new Set(prods.map(p => p.category || 'Menu'))];
  if (!cats.includes(S.cat)) S.cat = 'All';
  $('n-cats').hidden = cats.length < 3;
  $('n-cats').innerHTML = cats.map(k => `<button class="${S.cat === k ? 'on' : ''}" data-a="cat" data-k="${esc(k)}">${esc(k)}</button>`).join('');
  const shown = prods.filter(p => S.cat === 'All' || (p.category || 'Menu') === S.cat);
  $('n-grid').innerHTML = shown.length ? shown.map(p => {
    const av = availPieces(p), pl = poolOf(p), cls = av <= 0 ? 'out' : isLow(p) ? 'low' : '';
    return `<div class="mcard"><h4>${esc(p.name)}</h4><div class="stockline ${cls}"><i></i>${av <= 0 ? (pl ? `${esc(pl.name)} out of stock` : 'Out of stock') : pl ? `${num(av)} pcs · ${esc(pl.name)}` : `${num(av)} pcs available`}</div>
      <div class="vars">${(p.variants || []).map((v, vi) => { const ln = c.items.find(i => i.productId === p.id && i.variantIndex === vi);
        return `<button class="var ${ln ? 'in' : ''}" data-a="addVar" data-p="${p.id}" data-v="${vi}"><span>${ln ? `<span class="q">${ln.qty}</span>` : ''}${esc(v.label)}</span><b>${money(v.price)}</b></button>`; }).join('')}</div></div>`;
  }).join('') : `<div class="empty" style="grid-column:1/-1">${icon('box')}<b>No items on the menu</b>Add items in Inventory, or switch them on.</div>`;
  const panel = $('n-cart');
  if (!panel.contains(document.activeElement) || !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) panel.innerHTML = `<h3>${editing ? `Order #${c.no}` : 'Current order'}</h3>` + cartHTML() + `<div style="padding:0 16px 16px">${placeBtn()}</div>`;
  else updateCartTotals();
}
function placeBtn() {
  const c = S.cart, o = c.id && S.orders.find(x => x.id === c.id), dis = c.items.length ? '' : 'disabled', paidAlready = o && o.paid;
  return `<div class="placebar">${paidAlready ? '' : `<button class="btn primary lg block" data-a="placePaidCash" ${dis}>${icon('cash', 'sm')}${c.id ? 'Save · paid cash' : 'Paid cash'} · <span class="num" data-ct="total">${money(cartTotal())}</span></button>`}
    <div class="placebar2">${paidAlready ? '' : `<button class="btn lg" data-a="cashSheet" data-id="cart" ${dis}>Cash received…</button>`}<button class="btn lg ${paidAlready ? 'primary block' : ''}" data-a="placeOrder" ${dis}>${c.id ? 'Save changes' : 'Save · pay later'}</button></div></div>`;
}
function cartHTML() {
  const c = S.cart;
  const lines = c.items.length ? c.items.map((i, ix) => `<div class="line"><div class="grow"><div class="t">${esc(i.name)}</div><div class="s">${esc(i.variant)} · ${money(i.price)}</div></div>
    <div class="stepper"><button data-a="qty" data-i="${ix}" data-d="-1" aria-label="Less">${icon('minus', 'xs')}</button><span>${i.qty}</span><button data-a="qty" data-i="${ix}" data-d="1" aria-label="More">${icon('plus', 'xs')}</button></div>
    <div class="p">${money(i.price * i.qty)}</div></div>`).join('') : `<div class="empty" style="padding:24px">${icon('bag')}<b>No items yet</b>Tap a size on the menu.</div>`;
  const pay = ['cash', 'card', 'online'].map(k => `<button class="${c.payment === k ? 'on' : ''}" data-a="pay" data-k="${k}">${PAY[k]}</button>`).join('');
  const cu = custByPhone(c.phone), l = L(), left = cartSub() - cartDisc() - cartPromo();
  const orig = c.id ? Number((S.orders.find(x => x.id === c.id) || {}).points_redeemed || 0) : 0, have = cu ? cu.points + orig : 0;
  const blocks = cu && l.on ? Math.min(Math.floor(have / l.blk), Math.floor((left) / l.val) + (c.points / l.blk)) : 0;
  const pr = c.promo ? promoByCode(c.promo) : null, prMsg = c.promo ? promoProblem(pr, cartSub() - cartDisc()) : null;
  return `<div class="list" style="box-shadow:none">${lines}</div>
  <div style="padding:0 0 4px"><div class="form-h">Customer</div><div class="form">
    <div class="field"><label>Name</label><input data-c="customer" value="${esc(c.customer)}" placeholder="Walk-in" autocomplete="off" maxlength="80" enterkeyhint="next"></div>
    <div class="field"><label>Phone</label><input data-c="phone" type="tel" inputmode="tel" value="${esc(c.phone)}" placeholder="Optional · for points" autocomplete="off" maxlength="30"></div></div>
  <div id="cart-loyalty">${cartLoyaltyHTML()}</div>
  <div class="form-h">Pickup</div><div class="form">
    <div class="field"><label>Date</label><input data-c="date" type="date" value="${esc(c.date)}"></div>
    <div class="field"><label>Time</label><input data-c="time" type="time" step="300" value="${esc(c.time)}"></div></div>
  <div class="quick mt">${[15, 30, 60].map(m => `<button class="btn sm" data-a="quickTime" data-m="${m}">In ${m < 60 ? m + ' min' : '1 hr'}</button>`).join('')}</div>
  <div class="form-h">Promo &amp; discount</div><div class="form">
    <div class="field"><label>Promo code</label><input data-c="promo" value="${esc(c.promo)}" placeholder="Optional" autocapitalize="characters" autocomplete="off" maxlength="24"></div>
    <div class="field"><label>Discount</label><input data-c="discount" inputmode="decimal" type="text" value="${esc(c.discount)}" placeholder="$0.00"></div></div>
  <p class="form-note" data-ct="promomsg">${c.promo ? (prMsg ? `<span style="color:var(--red)">${esc(prMsg)}</span>` : `${esc(pr.name)} · ${esc(promoLabel(pr))}`) : activePromos().length ? `Active: ${activePromos().slice(0, 3).map(p => esc(p.code)).join(', ')}` : ''}</p>
  <details class="more-pay"><summary>Card / online or mark paid later</summary><div class="seg mt">${pay}</div>
  <div class="form mt"><div class="field"><label>Paid now</label><span class="grow" style="flex:1"></span><label class="switch"><input type="checkbox" data-c="paid" ${c.paid ? 'checked' : ''}><span></span></label></div></div>
  <p class="form-note">For cash, just tap <b>Paid cash</b> below. This switch is for card/online payments.</p></details>
  <div class="form-h">Notes</div><div class="form"><div class="field col"><textarea data-c="notes" placeholder="Allergies, sauces, special requests…" maxlength="500">${esc(c.notes)}</textarea></div></div>
  <div class="list totals mt" style="box-shadow:none;background:transparent">
    <div class="row static" style="background:transparent"><div class="grow t muted">Subtotal</div><div class="end num" data-ct="sub">${money(cartSub())}</div></div>
    <div class="row static" style="background:transparent"><div class="grow t muted">Discounts</div><div class="end num" data-ct="disc">−${money(cartDisc() + cartPromo() + cartPtsDisc())}</div></div>
    <div class="row static grand" style="background:transparent"><div class="grow t">Total</div><div class="end num" data-ct="total">${money(cartTotal())}</div></div></div></div>`;
}
function updateCartTotals() {
  document.querySelectorAll('[data-ct=sub]').forEach(e => e.textContent = money(cartSub()));
  document.querySelectorAll('[data-ct=disc]').forEach(e => e.textContent = '−' + money(cartDisc() + cartPromo() + cartPtsDisc()));
  document.querySelectorAll('#cart-loyalty').forEach(e => e.innerHTML = cartLoyaltyHTML());
  const c = S.cart, pr = c.promo ? promoByCode(c.promo) : null, m = c.promo ? promoProblem(pr, cartSub() - cartDisc()) : null;
  document.querySelectorAll('[data-ct=promomsg]').forEach(e => e.innerHTML = c.promo ? (m ? `<span style="color:var(--red)">${esc(m)}</span>` : `${esc(pr.name)} · ${esc(promoLabel(pr))} · −${money(cartPromo())}`) : '');
  document.querySelectorAll('[data-ct=total]').forEach(e => e.textContent = money(cartTotal()));
  updateCartbar();
}
function cartLoyaltyHTML() {
  const c = S.cart, cu = custByPhone(c.phone), l = L();
  if (!normPhone(c.phone) || !l.on) return '';
  if (!cu) return `<p class="form-note">${icon('star', 'xs')} New loyalty customer · earns ${num(Math.floor(cartTotal() * l.earn))} points when paid</p>`;
  const orig = c.id ? Number((S.orders.find(x => x.id === c.id) || {}).points_redeemed || 0) : 0, have = cu.points + orig;
  const room = cartSub() - cartDisc() - cartPromo();
  const max = Math.min(Math.floor(have / l.blk), Math.floor(room / l.val));
  if (c.points > max * l.blk) c.points = max * l.blk;
  return `<div class="loy">${icon('star', 'sm')}<div class="grow"><b>${esc(cu.name || 'Customer')} · ${num(cu.points)} points</b><small>${num(cu.paid_orders)} paid orders · ${l.blk} pts = ${money(l.val)} off</small>
    ${max > 0 ? `<div class="chipsrow mt">${[0, ...Array.from({ length: Math.min(max, 5) }, (_, i) => (i + 1) * l.blk)].map(n => `<button class="btn sm ${c.points === n ? 'primary' : ''}" data-a="cartPts" data-n="${n}">${n ? `Use ${num(n)} · −${money(n / l.blk * l.val)}` : 'No points'}</button>`).join('')}</div>` : ''}</div></div>`;
}
function updateCartbar() {
  const n = cartCount(), on = S.tab === 'new' && n > 0 && !S.sheet;
  $('cartbar').classList.toggle('on', on); document.body.classList.toggle('has-cart', S.tab === 'new' && n > 0);
  $('cartbar-cnt').textContent = n; $('cartbar-amt').textContent = money(cartTotal());
  $('cartbar-lbl').textContent = S.cart.id ? `Review #${S.cart.no}` : 'Review order';
}
function cartChanged() {
  if (S.tab === 'new') renderMenu();
  if (S.sheet && S.sheet.key === 'checkout') { if (!S.cart.items.length) closeSheet(); else S.sheet.refresh(); }
  updateCartbar();
}
function openCheckout() {
  const foot = () => placeBtn();
  openSheet({ title: S.cart.id ? `Edit order #${S.cart.no}` : 'Review order', key: 'checkout', body: cartHTML(), foot: foot(), onClose: updateCartbar,
    refresh() { $('sheet-body').innerHTML = cartHTML(); $('sheet-foot').innerHTML = foot(); } });
  updateCartbar();
}
function addVar(pid, vi) {
  const p = prodById(pid), v = p && p.variants[vi]; if (!v) return;
  const ln = S.cart.items.find(i => i.productId === pid && i.variantIndex === vi);
  if (ln) ln.qty++; else S.cart.items.push({ productId: pid, variantIndex: vi, name: p.name, variant: v.label, price: Number(v.price) || 0, pieces: Number(v.pieces) || 1, qty: 1 });
  buzz(); if (availPieces(p) < 0) toast(`Heads up: ${p.name} stock will go below zero`, true);
  cartChanged();
}
async function placeOrder(btn, cash) {
  const c = S.cart;
  if (!c.items.length) return toast('Add at least one item', true);
  if (!c.date || !c.time) return toast('Choose a pickup date and time', true);
  if (c.discount && !(Number(c.discount) >= 0)) return toast('Discount must be a number', true);
  if (c.promo) { const m = promoProblem(promoByCode(c.promo), cartSub() - cartDisc()); const o = c.id && S.orders.find(x => x.id === c.id); if (m && !(o && o.promo_code === c.promo.trim().toUpperCase())) return toast(m, true); }
  const r = await busy(btn, () => rpc('save_order_full', { p_order_id: c.id, p_customer_name: c.customer.trim() || 'Walk-in', p_customer_phone: c.phone.trim() || null,
    p_pickup_time: nzToISO(c.date, c.time), p_items: c.items, p_notes: c.notes.trim() || null, p_payment_method: cash ? 'cash' : c.payment, p_paid: !!c.paid, p_discount: cartDisc(),
    p_promo_code: (c.promo || '').trim().toUpperCase(), p_redeem_points: c.points || 0, p_paid_cash: !!cash, p_cash_received: cash ? cash.received : null, p_keep_tip: !!(cash && cash.tip) }));
  applyRow('orders', r); buzz();
  const extra = r.cash_received != null && cash ? (Number(r.tip) ? ` · tip ${money(r.tip)}` : Number(r.change_given) ? ` · change ${money(r.change_given)}` : '') : '';
  toast(cash ? `#${r.order_no} paid cash · ${money(r.total)}${extra}` : c.id ? `Order #${r.order_no} updated` : `Order #${r.order_no} saved · ${money(r.total)} to pay`);
  if (S.sheet) closeSheet();
  S.cart = newCart(); if (S.sheet) closeSheet();
  S.of.seg = 'active'; go('orders');
  sb.from('products').select('*').then(({ data }) => { if (data) { S.products = data.sort((a, b) => (a.sort_order - b.sort_order) || (a.product_no - b.product_no)); rerender(); } });
  sb.from('stock_items').select('*').order('sort_order').order('name').then(({ data }) => { if (data) { S.pools = data; rerender(); } });
}
function editOrder(id) {
  const o = S.orders.find(x => x.id === id); if (!o) return; if (o.locked) { toast('This order is locked', true); return; }
  S.cart = { id: o.id, no: o.order_no, items: (o.items || []).map(i => ({ ...i, qty: Number(i.qty) || 1, price: Number(i.price) || 0, pieces: Number(i.pieces) || 1 })),
    customer: o.customer_name || '', phone: o.customer_phone || '', date: dayKey(o.pickup_time), time: hm(o.pickup_time), notes: o.notes || '',
    payment: o.payment_method || 'cash', paid: !!o.paid, promo: o.promo_code || '', points: Number(o.points_redeemed) || 0,
    discount: r2(Number(o.discount || 0) - Number(o.promo_discount || 0) - Number(o.points_discount || 0)) > 0 ? String(r2(Number(o.discount || 0) - Number(o.promo_discount || 0) - Number(o.points_discount || 0))) : '' };
  closeSheet(); go('new');
  if (matchMedia('(max-width:1099px)').matches) openCheckout();
}

/* ---------- Cash payment ---------- */
async function accept(id, btn) { const o = S.orders.find(x => x.id === id); if (!o || o.status !== 'pending') return; await setStatus(id, 'preparing', btn); }
async function paidCash(id, btn, received, tip) {
  const o = S.orders.find(x => x.id === id); if (!o) return;
  const r = await busy(btn, () => rpc('mark_order_paid_cash', { p_order_id: id, p_cash_received: received ?? null, p_keep_tip: !!tip }));
  applyRow('orders', r); buzz();
  toast(`#${r.order_no} paid cash · ${money(r.total)}${Number(r.tip) ? ` · tip ${money(r.tip)}` : Number(r.change_given) ? ` · change ${money(r.change_given)}` : ''}`);
  rerender(); return r;
}
function cashTotal() { const c = S.cash; if (!c) return 0; if (c.id === 'cart') return cartTotal(); const o = S.orders.find(x => x.id === c.id); return o ? Number(o.total) : 0; }
function cashRecv() { const c = S.cash, t = cashTotal(); if (c.custom !== '' && c.custom != null) return r2(Number(c.custom)); return c.received == null ? t : c.received; }
function cashBody() {
  const c = S.cash, t = cashTotal(), rec = cashRecv(), ok = rec >= t - 0.001, extra = ok ? r2(rec - t) : 0;
  const o = c.id !== 'cart' && S.orders.find(x => x.id === c.id);
  const notes = [20, 50, 100];
  return `<div class="cash-hero"><div class="k">${o ? `Order #${o.order_no} · ${esc(o.customer_name)}` : 'New order'}</div><div class="v num">${money(t)}</div><div class="k">to pay in cash</div></div>
    <div class="form-h">Cash received</div>
    <div class="cashgrid"><button class="btn lg ${c.received == null && c.custom === '' ? 'primary' : ''}" data-a="cashPick" data-n="exact">Exact</button>${notes.map(n => `<button class="btn lg ${c.received === n && c.custom === '' ? 'primary' : ''}" data-a="cashPick" data-n="${n}" ${n < t - 0.001 ? 'disabled aria-label="$' + n + ' (less than the total)"' : ''}>$${n}</button>`).join('')}</div>
    <div class="form mt"><div class="field"><label>Other amount</label><input id="cash-custom" inputmode="decimal" placeholder="$0.00" value="${esc(c.custom)}" autocomplete="off"></div></div>
    <div class="change ${ok ? '' : 'bad'}" id="cash-change">${cashChangeHTML()}</div>
    <label class="tiprow ${extra > 0 ? '' : 'dim'}"><input type="checkbox" id="cash-tip" ${c.tip ? 'checked' : ''} ${extra > 0 ? '' : 'disabled'}><span class="grow"><b>Keep as tip</b><small>Customer says keep the change — record ${money(extra)} as a tip</small></span><span class="switch"><span></span></span></label>`;
}
function cashChangeHTML() {
  const c = S.cash, t = cashTotal(), rec = cashRecv(), ok = rec >= t - 0.001, extra = ok ? r2(rec - t) : 0;
  if (!ok) return `<div class="k">Cash received ${money(rec)} is less than ${money(t)}</div>`;
  return c.tip && extra > 0 ? `<div class="k">Tip kept</div><div class="v num">${money(extra)}</div><div class="k">No change to give</div>` : `<div class="k">Change due</div><div class="v num">${money(extra)}</div><div class="k">Received ${money(rec)}</div>`;
}
function cashFoot() { const t = cashTotal(), rec = cashRecv(); return `<button class="btn primary lg block" data-a="cashConfirm" ${rec >= t - 0.001 ? '' : 'disabled'}>${icon('cash', 'sm')}Confirm paid cash · ${money(t)}</button>`; }
function openCash(id) {
  if (id === 'cart' && !S.cart.items.length) return toast('Add at least one item', true);
  S.cash = { id, received: null, custom: '', tip: false };
  openSheet({ title: 'Cash received', key: 'cash', body: cashBody(), foot: cashFoot(), left: id === 'cart' ? `<button class="btn plain" data-a="backToCart">${icon('back', 'sm')}Order</button>` : `<button class="btn plain" data-a="openOrder" data-id="${id}">${icon('back', 'sm')}Order</button>`,
    refresh() { $('sheet-body').innerHTML = cashBody(); $('sheet-foot').innerHTML = cashFoot(); } });
}
function cashUpdate() { const ch = $('cash-change'); if (!ch) return; const t = cashTotal(), rec = cashRecv(), ok = rec >= t - 0.001; ch.className = 'change ' + (ok ? '' : 'bad'); ch.innerHTML = cashChangeHTML();
  const tp = $('cash-tip'), extra = ok ? r2(rec - t) : 0; if (tp) { tp.disabled = !(extra > 0); if (!(extra > 0)) { tp.checked = false; S.cash.tip = false; } tp.closest('.tiprow').classList.toggle('dim', !(extra > 0)); tp.closest('.tiprow').querySelector('small').textContent = `Customer says keep the change — record ${money(extra)} as a tip`; }
  $('sheet-foot').innerHTML = cashFoot(); }
async function cashConfirm(btn) {
  const c = S.cash, rec = cashRecv(), t = cashTotal(); if (!(rec >= t - 0.001)) return toast('Cash received is less than the total', true);
  if (c.id === 'cart') { await placeOrder(btn, { received: rec, tip: c.tip }); S.cash = null; return; }
  const id = c.id; await paidCash(id, btn, rec, c.tip); S.cash = null; openOrder(id);
}

/* ---------- Promotions (staff) ---------- */
const pstatus = p => p.archived ? ['Archived', 'tag-muted'] : !p.active ? ['Off', 'tag-muted'] : promoProblem(p, 1e9) ? [promoProblem(p, 1e9).replace(/^Sorry, that promo code (has |isn't )?/, '').replace(/^That promo code /, ''), 'st-pending'] : ['Live', 'st-completed'];
function promosBody() {
  const list = S.promos.filter(p => S.pf === 'archived' ? p.archived : !p.archived);
  return `<p class="form-note">Customers type the code at checkout, or staff apply it to an order. Codes are never deleted — archive them instead.</p>
    <div class="seg mt">${[['live', 'Current'], ['archived', 'Archived']].map(([k, l]) => `<button class="${(S.pf || 'live') === k ? 'on' : ''}" data-a="pf" data-k="${k}">${l}</button>`).join('')}</div>
    <div class="list mt">${list.length ? list.map(p => { const [st, cls] = pstatus(p); return `<div class="row static promo-row"><div class="grow"><div class="t"><b class="code">${esc(p.code)}</b> ${esc(p.name)}</div>
      <div class="s">${esc(promoLabel(p))}${Number(p.min_order) ? ` · min ${money(p.min_order)}` : ''} · used ${num(p.used_count)}${p.usage_limit != null ? ` / ${num(p.usage_limit)}` : ''}${p.ends_at ? ` · ends ${fmtDay(dayKey(p.ends_at))}` : ''}${p.show_on_menu ? ' · on menu' : ''}</div>
      <div class="o-meta"><span class="chip ${cls}">${esc(st)}</span></div></div>
      ${p.archived ? `<button class="btn sm" data-a="unarchivePromo" data-id="${p.id}">Restore</button>` : `<label class="switch" aria-label="Active"><input type="checkbox" data-a="togglePromo" data-id="${p.id}" ${p.active ? 'checked' : ''}><span></span></label><button class="btn sm" data-a="editPromo" data-id="${p.id}">Edit</button>`}</div>`; }).join('')
      : `<div class="empty" style="padding:28px">${icon('tag')}<b>${S.pf === 'archived' ? 'No archived promotions' : 'No promotions yet'}</b>${S.pf === 'archived' ? '' : 'Create one to offer a discount code.'}</div>`}</div>`;
}
function openPromos() { S.pf = S.pf || 'live'; openSheet({ title: 'Promotions', key: 'promos', body: promosBody(), right: `<button class="btn plain" data-a="editPromo">${icon('plus', 'xs')} New</button>`, refresh() { $('sheet-body').innerHTML = promosBody(); } }); }
const toLocalDT = iso => iso ? `${dayKey(iso)}T${hm(iso)}` : '';
function promoEditorBody() {
  const e = S.pe;
  return `<div class="form">
    <div class="field"><label>Code</label><input data-pe2="code" value="${esc(e.code)}" placeholder="e.g. WELCOME10" autocapitalize="characters" autocomplete="off" maxlength="24"></div>
    <div class="field"><label>Name</label><input data-pe2="name" value="${esc(e.name)}" placeholder="e.g. Welcome offer" maxlength="60"></div>
    <div class="field col"><label>Description</label><input data-pe2="description" value="${esc(e.description)}" placeholder="Optional, shown on the menu banner" maxlength="140"></div></div>
  <div class="form-h">Discount</div><div class="seg">${[['percent', 'Percent %'], ['fixed', 'Fixed $']].map(([k, l]) => `<button class="${e.kind === k ? 'on' : ''}" data-a="peKind" data-k="${k}">${l}</button>`).join('')}</div>
  <div class="form mt"><div class="field"><label>Value</label><input data-pe2="value" inputmode="decimal" value="${esc(e.value)}" placeholder="${e.kind === 'percent' ? '10' : '5.00'}"><span class="unit">${e.kind === 'percent' ? '%' : '$'}</span></div>
    <div class="field"><label>Min order</label><input data-pe2="min_order" inputmode="decimal" value="${esc(e.min_order)}" placeholder="0.00"><span class="unit">$</span></div>
    <div class="field"><label>Usage limit</label><input data-pe2="usage_limit" inputmode="numeric" value="${esc(e.usage_limit)}" placeholder="Unlimited"></div></div>
  <div class="form-h">Dates (NZ time, optional)</div><div class="form">
    <div class="field"><label>Starts</label><input data-pe2="starts_at" type="datetime-local" value="${esc(e.starts_at)}"></div>
    <div class="field"><label>Ends</label><input data-pe2="ends_at" type="datetime-local" value="${esc(e.ends_at)}"></div></div>
  <div class="form mt"><div class="field"><label>Active</label><span class="grow" style="flex:1"></span><label class="switch"><input type="checkbox" data-pe2="active" ${e.active ? 'checked' : ''}><span></span></label></div>
    <div class="field"><label>Show on menu</label><span class="grow" style="flex:1"></span><label class="switch"><input type="checkbox" data-pe2="show_on_menu" ${e.show_on_menu ? 'checked' : ''}><span></span></label></div></div>
  ${e.id ? `<p class="form-note">Used ${num(e.used_count)} time${e.used_count === 1 ? '' : 's'}.</p><div style="padding:10px 0 0"><button class="btn block danger" data-a="archivePromo" data-id="${e.id}">Archive promotion</button></div>` : ''}`;
}
function openPromoEditor(id) {
  const p = id ? S.promos.find(x => x.id === id) : null;
  S.pe = p ? { id: p.id, code: p.code, name: p.name, description: p.description || '', kind: p.kind, value: String(Number(p.value)), min_order: Number(p.min_order) ? String(Number(p.min_order)) : '', usage_limit: p.usage_limit ?? '', starts_at: toLocalDT(p.starts_at), ends_at: toLocalDT(p.ends_at), active: p.active, show_on_menu: p.show_on_menu, used_count: p.used_count }
    : { id: null, code: '', name: '', description: '', kind: 'percent', value: '', min_order: '', usage_limit: '', starts_at: '', ends_at: '', active: true, show_on_menu: false };
  openSheet({ title: p ? `Edit ${p.code}` : 'New promotion', key: 'promoEd', body: promoEditorBody(), left: `<button class="btn plain" data-a="openPromos">${icon('back', 'sm')}Promotions</button>`, foot: `<button class="btn primary lg block" data-a="savePromo">Save promotion</button>` });
}
async function savePromo(btn) {
  const e = S.pe, code = String(e.code || '').trim().toUpperCase(), val = Number(e.value), min = e.min_order === '' ? 0 : Number(e.min_order), lim = e.usage_limit === '' ? null : parseInt(e.usage_limit, 10);
  if (!/^[A-Z0-9_-]{2,24}$/.test(code)) return toast('Code: 2–24 letters, numbers, - or _', true);
  if (!String(e.name || '').trim()) return toast('Give the promotion a name', true);
  if (!(val > 0) || (e.kind === 'percent' && val > 100)) return toast(e.kind === 'percent' ? 'Percent must be between 1 and 100' : 'Value must be more than $0', true);
  if (!(min >= 0)) return toast('Min order must be 0 or more', true);
  if (lim !== null && !(lim >= 1)) return toast('Usage limit must be 1 or more (or blank)', true);
  const toISO = v => v ? nzToISO(v.slice(0, 10), v.slice(11, 16)) : null;
  const row = { code, name: e.name.trim(), description: String(e.description || '').trim() || null, kind: e.kind, value: val, min_order: min, usage_limit: lim, starts_at: toISO(e.starts_at), ends_at: toISO(e.ends_at), active: !!e.active, show_on_menu: !!e.show_on_menu, updated_at: new Date().toISOString() };
  if (row.starts_at && row.ends_at && row.ends_at <= row.starts_at) return toast('End must be after start', true);
  const r = await busy(btn, () => e.id ? q(sb.from('promotions').update(row).eq('id', e.id).select().single()) : q(sb.from('promotions').insert({ ...row, created_by: S.session.user.email }).select().single()));
  applyRow('promotions', r); toast(`${r.code} saved`); openPromos();
}

/* ---------- Loyalty customers (staff) ---------- */
function loyaltyBody() {
  const qq = (S.lq || '').trim().toLowerCase(), l = L();
  const list = S.customers.filter(c => !qq || `${c.name || ''} ${c.display_phone || ''} ${c.phone}`.toLowerCase().includes(qq)).sort((a, b) => b.points - a.points || new Date(b.last_order_at || 0) - new Date(a.last_order_at || 0));
  return `<p class="form-note">${l.on ? `${l.earn} point per $1 paid · ${l.blk} points = ${money(l.val)} off. Points are added when an order is marked paid and reversed if it is cancelled.` : 'Loyalty is switched off in Settings.'}</p>
    <div class="toolbar mt"><label class="search">${icon('search', 'sm')}<input id="lq" type="search" placeholder="Search name or phone" value="${esc(S.lq || '')}" autocomplete="off"></label></div>
    <div class="list mt">${list.length ? list.slice(0, 200).map(c => `<button class="row" data-a="openCustomer" data-id="${c.id}">${icon('user', 'sm')}<div class="grow"><div class="t">${esc(c.name || 'Customer')} <span class="muted small">${esc(c.display_phone || c.phone)}</span></div><div class="s">${num(c.paid_orders)} paid orders · ${money(c.total_spent)} spent</div></div><div class="end"><b class="num">${num(c.points)}</b><div class="s small">points</div></div></button>`).join('')
      : `<div class="empty" style="padding:28px">${icon('star')}<b>No loyalty customers yet</b>Customers are added automatically from the phone number on an order.</div>`}</div>`;
}
function openLoyalty() { openSheet({ title: 'Loyalty', key: 'loyalty', body: loyaltyBody(), refresh() { $('sheet-body').innerHTML = loyaltyBody(); }, after() { const i = $('lq'); i && i.addEventListener('input', () => { S.lq = i.value; const st = i.selectionStart; $('sheet-body').innerHTML = loyaltyBody(); const j = $('lq'); j.focus(); try { j.setSelectionRange(st, st); } catch (e) { } }); } }); }
const LK = { earn: 'Earned', earn_reversal: 'Earn reversed', earn_adjust: 'Earn adjusted', redeem: 'Redeemed', redeem_reversal: 'Redeem reversed', manual: 'Manual' };
async function openCustomer(id) {
  const c = S.customers.find(x => x.id === id); if (!c) return;
  openSheet({ title: c.name || 'Customer', key: 'cust', left: `<button class="btn plain" data-a="openLoyalty">${icon('back', 'sm')}Loyalty</button>`, body: `<div class="cash-hero"><div class="k">${esc(c.display_phone || c.phone)}</div><div class="v num">${num(c.points)}</div><div class="k">points · ${num(c.lifetime_points)} earned · ${num(c.redeemed_points)} redeemed</div></div><div class="list mt" id="cust-led"><div class="empty" style="padding:20px">Loading history…</div></div>` });
  try {
    const rows = await q(sb.from('loyalty_ledger').select('*').eq('customer_id', id).order('id', { ascending: false }).limit(200));
    const el = $('cust-led'); if (!el) return;
    el.innerHTML = rows.length ? rows.map(r => `<div class="row static"><div class="grow"><div class="t">${LK[r.kind] || r.kind}${r.order_no ? ` · #${r.order_no}` : ''}</div><div class="s">${fmtDT(r.created_at)}${r.note ? ' · ' + esc(r.note) : ''}</div></div><div class="end"><b class="num" style="color:${r.points >= 0 ? 'var(--accent)' : 'var(--red)'}">${r.points >= 0 ? '+' : ''}${num(r.points)}</b><div class="s small">bal ${num(r.balance_after)}</div></div></div>`).join('') : '<div class="empty" style="padding:20px">No points history yet</div>';
  } catch (e) { const el = $('cust-led'); if (el) el.innerHTML = `<div class="empty" style="padding:20px">${esc(errMsg(e))}</div>`; }
}

/* ---------- Inventory ---------- */
const varSummary = p => (p.variants || []).map(v => `${v.label} ${money(v.price)}`).join(' · ');
function renderInventory() {
  const live = S.products.filter(p => !p.archived), T = invTotals(), lowN = T.low.length;
  const lowNames = T.low.map(x => x.name), outNames = T.out.map(x => x.name);
  $('i-head').innerHTML = header('Inventory', `${live.length} items · ${lowN ? `<span style="color:var(--red)">${lowN} low on stock</span>` : 'stock levels healthy'}`,
    `<button class="btn primary sm" data-a="newItem">${icon('plus', 'xs')} Add item</button>`);
  const wk = Date.now() - 7 * 864e5;
  // agent test rows are kept (no deletes) but not counted; own-stock movements of products now linked to shared stock
  // hit their legacy, unused products.stock, so they are excluded too (the shared stock's own movements are counted once)
  const legacy = m => !m.stock_item_id && m.product_id && !!poolOf(prodById(m.product_id));
  const recent = S.moves.filter(m => new Date(m.created_at).getTime() >= wk && !/^ZZTEST/.test(m.note || '') && !legacy(m));
  $('i-stats').innerHTML = [
    ['Stock on hand', `${num(T.pieces)}<small class="u"> pcs</small>`, T.value != null ? `Value ${money(T.value)}${T.costed < T.src.length ? ' (costed items)' : ''}` : `${T.src.length} stock sources · shared counted once`],
    ['Low stock', num(lowN), lowN ? esc(lowNames.slice(0, 2).join(', ')) : 'All good'],
    ['Out of stock', num(T.out.length), T.out.length ? esc(outNames.slice(0, 2).join(', ')) : 'Nothing sold out'],
    ['On menu', num(live.filter(p => p.active).length), `${live.filter(p => !p.active).length} hidden`],
    ['Restocked · 7d', num(recent.filter(m => m.reason === 'restock').reduce((a, m) => a + m.delta, 0)), 'pieces added'],
    ['Waste · 7d', num(-recent.filter(m => m.reason === 'waste').reduce((a, m) => a + m.delta, 0)), 'pieces written off']
  ].map(([k, v, d]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div><div class="d">${d}</div></div>`).join('');
  $('i-mode').innerHTML = [['items', 'Items'], ['history', 'Stock history']].map(([k, l]) => `<button class="${S.inv.mode === k ? 'on' : ''}" data-a="invMode" data-k="${k}">${l}</button>`).join('');
  if (S.inv.mode === 'items') {
    if (!$('i-q')) $('i-tools').innerHTML = `<div class="toolbar mt"><label class="search">${icon('search', 'sm')}<input id="i-q" type="search" placeholder="Search items" autocomplete="off"></label></div><div class="seg scroll" id="i-seg"></div>`;
    $('i-q').oninput = e => { S.inv.q = e.target.value; renderInvList(); }; if ($('i-q').value !== S.inv.q && document.activeElement !== $('i-q')) $('i-q').value = S.inv.q;
    const c = k => k === 'low' ? lowN : S.products.filter(p => k === 'all' ? !p.archived : k === 'hidden' ? !p.active && !p.archived : p.archived).length;
    $('i-seg').innerHTML = [['all', 'All'], ['low', 'Low stock'], ['hidden', 'Hidden'], ['archived', 'Archived']].map(([k, l]) => `<button class="${S.inv.seg === k ? 'on' : ''}" data-a="invSeg" data-k="${k}">${l} <span class="muted num">${c(k)}</span></button>`).join('');
  } else $('i-tools').innerHTML = '<div style="height:12px"></div>';
  renderInvList();
}
function renderInvList() {
  if (S.inv.mode === 'history') {
    const mv = S.moves.slice(0, 200);
    $('i-list').innerHTML = mv.length ? `<div class="list">${mv.map(moveRow).join('')}</div>` : `<div class="empty">${icon('history')}<b>No stock changes yet</b>Restocks, waste and order deductions are logged here.</div>`;
    return;
  }
  const qq = S.inv.q.trim().toLowerCase(), k = S.inv.seg;
  const pools = S.pools.filter(s => (k === 'archived' ? s.archived : !s.archived && (k !== 'low' || (poolLow(s) && poolUsers(s).length > 0)) && k !== 'hidden')
    && (!qq || `${s.name} ${poolUsers(s).map(p => p.name).join(' ')}`.toLowerCase().includes(qq)));
  const poolHTML = pools.length ? `<div class="day-h"><span>Shared stock</span><button class="btn plain sm" data-a="newPool">${icon('plus', 'xs')} New</button></div><div class="list pools">${pools.map(s => { const us = poolUsers(s);
    return `<div class="row inv-row pool-row"><button class="inv-main" data-a="openPool" data-id="${s.id}"><span class="pool-ic">${icon('box', 'sm')}</span><div class="grow"><div class="t">${esc(s.name)}</div>
      <div class="s">${us.length ? 'Used by ' + esc(us.map(p => p.name).join(' & ')) : 'Not linked to any item yet'}</div>${s.archived ? '<div class="o-meta"><span class="chip tag-muted">Archived</span></div>' : ''}</div>
      <span class="stockpill ${poolLow(s) ? 'low' : 'ok'}">${num(s.stock)}<small> ${esc(s.unit || 'pcs')}</small></span></button>
      <button class="btn sm edit-btn" data-a="editPool" data-id="${s.id}" aria-label="Edit ${esc(s.name)}">${icon('edit', 'xs')} Edit</button></div>`; }).join('')}</div>` : '';
  const list = S.products.filter(p => (k === 'all' ? !p.archived : k === 'low' ? lowRow(p) : k === 'hidden' ? !p.active && !p.archived : p.archived) && (!qq || `${p.name} ${p.category}`.toLowerCase().includes(qq)));
  if (!list.length) { $('i-list').innerHTML = poolHTML + `<div class="empty">${icon('box')}<b>Nothing here</b>${k === 'all' && !qq ? 'Add your first item to start tracking stock.' : 'Try another filter.'}</div>`; return; }
  const groups = new Map(); for (const p of list) { const c = p.category || 'Menu'; if (!groups.has(c)) groups.set(c, []); groups.get(c).push(p); }
  let h = poolHTML; for (const [c, ps] of groups) h += `<div class="day-h"><span>${esc(c)}</span><span>${ps.length}</span></div><div class="list">${ps.map(p => { const pl = poolOf(p);
    return `<div class="row inv-row"><button class="inv-main" data-a="openItem" data-id="${p.id}"><div class="grow"><div class="t">${esc(p.name)}</div><div class="s">${esc(varSummary(p))}</div>
      ${pl || !p.active || p.archived ? `<div class="o-meta">${pl ? `<span class="chip tag-shared ${pl.stock <= 0 ? 'out' : poolLow(pl) ? 'low' : ''}">${icon('box', 'xs')} Uses ${esc(pl.name)}: ${num(pl.stock)} ${esc(pl.unit || 'pcs')}</span>` : ''}${p.archived ? '<span class="chip tag-muted">Archived</span>' : !p.active ? '<span class="chip tag-muted">Hidden from menu</span>' : ''}</div>` : ''}</div>
      ${pl ? `<span class="stockpill linked" title="Counted once under ${esc(pl.name)}">Shared</span>` : `<span class="stockpill ${isLow(p) ? 'low' : 'ok'}">${num(p.stock)}</span>`}</button>
      <button class="btn sm edit-btn" data-a="editItem" data-id="${p.id}" aria-label="Edit ${esc(p.name)}">${icon('edit', 'xs')} Edit</button></div>`; }).join('')}</div>`;
  $('i-list').innerHTML = h;
}
function moveRow(m) {
  const title = m.stock_item_name ? (m.product_id ? `${esc(m.stock_item_name)} <span class="muted small">via ${esc(m.product_name)}</span>` : esc(m.stock_item_name)) : esc(m.product_name);
  return `<div class="row static"><div class="grow"><div class="t">${title}</div>
    <div class="s">${REASON[m.reason] || m.reason}${m.order_no ? ` #${m.order_no}` : ''}${m.note ? ' · ' + esc(m.note) : ''} · ${fmtDT(m.created_at)}${m.created_by ? ' · ' + esc(m.created_by.split('@')[0]) : ''}</div></div>
    <div class="end"><div class="mv-delta ${m.delta > 0 ? 'pos' : 'neg'}">${m.delta > 0 ? '+' : '−'}${num(Math.abs(m.delta))}</div><div class="s small num">→ ${m.stock_after ?? ''}</div></div></div>`;
}
/* stock adjust sheet — target is a product (own stock) or a shared pool; linked products adjust their pool */
function adjT() {
  const a = S.adj; if (!a) return null;
  if (a.kind === 'pool') { const s = poolById(a.id); return s && { kind: 'pool', pool: s, name: s.name, stock: s.stock, thr: poolThr(s), unit: s.unit || 'pcs',
    hist: S.moves.filter(m => m.stock_item_id === s.id) }; }
  const p = prodById(a.id); if (!p) return null; const s = poolOf(p);
  return s ? { kind: 'pool', pool: s, p, name: p.name, stock: s.stock, thr: poolThr(s), unit: s.unit || 'pcs', hist: S.moves.filter(m => m.stock_item_id === s.id) }
    : { kind: 'product', p, name: p.name, stock: p.stock, thr: threshold(p), unit: 'pcs', hist: S.moves.filter(m => m.product_id === p.id) };
}
function adjLine(t) {
  const n = parseInt(S.adj.amt, 10), m = S.adj.mode;
  const pv = Number.isFinite(n) ? (m === 'add' ? t.stock + n : m === 'remove' ? t.stock - n : n) : null;
  return `${esc(t.unit)} ${t.pool ? 'in ' + esc(t.pool.name) : 'in stock'} · alert at ${t.thr}${pv !== null ? ` · after: <b class="num">${num(pv)}</b>` : ''}`;
}
function itemBody() {
  const t = adjT(), a = S.adj, mode = a.mode; if (!t) return '';
  const p = t.p, s = t.pool;
  const shared = s ? `<div class="shared-note">${icon('box', 'sm')}<div class="grow">${p ? `<b>${esc(p.name)}</b> uses the shared <b>${esc(s.name)}</b> stock.` : `<b>Shared stock</b>`}
      <div class="s">Used by ${esc(poolUsers(s).map(x => x.name).join(' & ') || 'no items yet')}. Orders for any of them deduct here.</div></div></div>` : '';
  return `${shared}<div class="bigstock" id="adj-big"><b>${num(t.stock)}</b><div>${adjLine(t)}</div></div>
    <div class="seg mt">${[['add', 'Add'], ['remove', 'Remove'], ['set', 'Set to']].map(([k, l]) => `<button class="${mode === k ? 'on' : ''}" data-a="adjMode" data-k="${k}">${l}</button>`).join('')}</div>
    <div class="qty-input"><button class="iconbtn" data-a="adjStep" data-d="-1" aria-label="Less">${icon('minus')}</button>
      <input data-j="amt" inputmode="numeric" pattern="[0-9]*" value="${esc(a.amt)}" placeholder="0" aria-label="Amount"><button class="iconbtn" data-a="adjStep" data-d="1" aria-label="More">${icon('plus')}</button></div>
    <div class="quick">${(mode === 'set' ? [0, 24, 48, 96] : [8, 16, 24, 48]).map(n => `<button class="btn sm" data-a="adjQuick" data-n="${n}">${mode === 'set' ? n : (mode === 'add' ? '+' : '−') + n}</button>`).join('')}</div>
    <div class="form-h">Reason</div><div class="seg">${['restock', 'waste', 'correction'].map(k => `<button class="${a.reason === k ? 'on' : ''}" data-a="adjReason" data-k="${k}">${REASON[k]}</button>`).join('')}</div>
    <div class="form mt"><div class="field"><label>Note</label><input data-j="note" value="${esc(a.note)}" placeholder="Optional" maxlength="120"></div></div>
    <p class="form-note">Every change is logged in stock history with its reason.</p>
    <div class="list mt">
      ${p ? `<div class="row static"><div class="grow t">Show on menu</div><label class="switch"><input type="checkbox" data-a="toggleActive" data-id="${p.id}" ${p.active ? 'checked' : ''}><span></span></label></div>
      <button class="row" data-a="editItem" data-id="${p.id}"><span class="row-ic">${icon('edit', 'sm')}</span><div class="grow t">Edit name, sizes & prices</div><span class="chev">${icon('chev', 'sm')}</span></button>` : ''}
      ${s ? `<button class="row" data-a="${p ? 'openPool' : 'editPool'}" data-id="${s.id}"><span class="row-ic">${icon('box', 'sm')}</span><div class="grow t">${p ? `Open ${esc(s.name)}` : `Edit ${esc(s.name)}`}</div><span class="chev">${icon('chev', 'sm')}</span></button>` : ''}</div>
    <div class="form-h">Recent changes</div>${t.hist.length ? `<div class="list">${t.hist.slice(0, 8).map(moveRow).join('')}</div>` : '<p class="muted small" style="padding:0 20px">No changes logged yet.</p>'}`;
}
function itemFoot() {
  const a = S.adj, n = parseInt(a.amt, 10), ok = Number.isFinite(n) && n >= 0 && (a.mode === 'set' || n > 0);
  const l = !ok ? 'Enter an amount' : a.mode === 'add' ? `Add ${n} pcs` : a.mode === 'remove' ? `Remove ${n} pcs` : `Set stock to ${n}`;
  return `<button class="btn primary lg block" data-a="applyAdj" ${ok ? '' : 'disabled'}>${l}</button>`;
}
function openAdj(kind, id) {
  S.adj = { kind, id, mode: 'add', amt: '', reason: 'restock', note: '' };
  const t = adjT(); if (!t) return;
  const editBtn = kind === 'pool' ? `<button class="btn plain" data-a="editPool" data-id="${id}" style="font-weight:700">Edit</button>` : `<button class="btn plain" data-a="editItem" data-id="${id}" style="font-weight:700">Edit</button>`;
  openSheet({ title: t.name, key: (kind === 'pool' ? 'pool:' : 'item:') + id, body: itemBody(), foot: itemFoot(), right: editBtn,
    refresh() { const x = adjT(); if (!x) return closeSheet(); $('sheet-body').innerHTML = itemBody(); $('sheet-foot').innerHTML = itemFoot(); $('sheet-title').textContent = x.name; } });
}
function openItem(id) { if (prodById(id)) openAdj('product', id); }
function openPool(id) { if (poolById(id)) openAdj('pool', id); }
function adjRefresh() { const st = $('sheet-body').scrollTop; S.sheet.refresh(); $('sheet-body').scrollTop = st; }
async function applyAdj(btn) {
  const a = S.adj, t = adjT(), n = parseInt(a.amt, 10); if (!t || !Number.isFinite(n)) return;
  const d = a.mode === 'add' ? n : -n, note = a.note || null;
  const v = await busy(btn, () => t.pool
    ? (a.mode === 'set' ? rpc('set_stock_item', { p_stock_item_id: t.pool.id, p_value: n, p_reason: a.reason, p_note: note }) : rpc('adjust_stock_item', { p_stock_item_id: t.pool.id, p_delta: d, p_reason: a.reason, p_note: note }))
    : (a.mode === 'set' ? rpc('set_stock', { p_product_id: t.p.id, p_value: n, p_reason: a.reason, p_note: note }) : rpc('adjust_stock', { p_product_id: t.p.id, p_delta: d, p_reason: a.reason, p_note: note })));
  if (t.pool) t.pool.stock = v; else t.p.stock = v;
  buzz(); toast(`${t.pool ? t.pool.name : t.name}: ${num(v)} pcs in stock`);
  S.adj.amt = ''; S.adj.note = ''; adjRefresh(); rerender();
}
function adjPreview() {
  const t = adjT(), el = $('adj-big'); if (!t || !el) return;
  el.querySelector('div').innerHTML = adjLine(t);
  $('sheet-foot').innerHTML = itemFoot();
}

/* shared stock editor (name, unit, alert, archive) — never deleted */
function poolEdBody() {
  const e = S.ped, s = e.id && poolById(e.id), us = s ? poolUsers(s) : [];
  return `<div class="form"><div class="field"><label>Name</label><input data-pe="name" value="${esc(e.name)}" placeholder="e.g. Frozen Momos" maxlength="60"></div>
    <div class="field"><label>Unit</label><input data-pe="unit" value="${esc(e.unit)}" placeholder="pcs" maxlength="12"></div>
    <div class="field"><label>Low-stock alert</label><input data-pe="low" inputmode="numeric" value="${esc(e.low)}" placeholder="Default (${S.settings.low_stock_default})"></div>
    ${e.id ? '' : `<div class="field"><label>Opening stock</label><input data-pe="stock" inputmode="numeric" value="${esc(e.stock)}" placeholder="0"></div>`}</div>
    ${e.id ? `<div class="form mt"><div class="field"><label>Archived</label><span style="flex:1"></span><label class="switch"><input type="checkbox" data-pe="archived" ${e.archived ? 'checked' : ''}><span></span></label></div></div>` : ''}
    <div class="form-h">Used by</div>${us.length ? `<div class="list">${us.map(p => `<button class="row" data-a="editItem" data-id="${p.id}"><div class="grow"><div class="t">${esc(p.name)}</div><div class="s">${esc(varSummary(p))}</div></div><span class="chev">${icon('chev', 'sm')}</span></button>`).join('')}</div>`
      : '<p class="muted small" style="padding:0 20px">No items yet. Open an item’s Edit sheet and choose this under “Stock source”.</p>'}
    <p class="form-note">Stock levels change only through Add / Remove / Set with a reason, so every change is logged. Shared stock is never deleted — archive it instead.</p>`;
}
function openPoolEditor(id) {
  const s = id && poolById(id);
  S.ped = s ? { id, name: s.name, unit: s.unit || 'pcs', low: s.low_stock_threshold ?? '', archived: s.archived } : { id: null, name: '', unit: 'pcs', low: '', archived: false, stock: '' };
  openSheet({ title: s ? 'Edit shared stock' : 'New shared stock', key: 'pooled', left: s ? `<button class="btn plain" data-a="openPool" data-id="${id}">Cancel</button>` : undefined,
    right: `<button class="btn plain" data-a="savePool" style="font-weight:700">Save</button>`, body: poolEdBody(),
    foot: `<button class="btn primary lg block" data-a="savePool">${s ? 'Save changes' : 'Create shared stock'}</button>` });
}
async function savePool(btn) {
  const e = S.ped, name = e.name.trim(); if (!name) return toast('Give the shared stock a name', true);
  const low = String(e.low).trim() === '' ? null : parseInt(e.low, 10);
  if (low !== null && !(low >= 0)) return toast('Low-stock alert must be 0 or more', true);
  if (S.pools.some(s => s.id !== e.id && s.name.toLowerCase() === name.toLowerCase())) return toast('That name is already used', true);
  const row = { name, unit: e.unit.trim() || 'pcs', low_stock_threshold: low, archived: !!e.archived };
  await busy(btn, async () => {
    if (e.id) { const r = await q(sb.from('stock_items').update(row).eq('id', e.id).select().single()); applyRow('stock_items', r); toast('Shared stock saved'); openPool(e.id); }
    else {
      const r = await q(sb.from('stock_items').insert({ ...row, stock: 0, sort_order: S.pools.length + 1 }).select().single()); applyRow('stock_items', r);
      const st = parseInt(e.stock, 10); if (st > 0) r.stock = await rpc('adjust_stock_item', { p_stock_item_id: r.id, p_delta: st, p_reason: 'initial', p_note: null });
      toast(`${name} created`); openPool(r.id);
    }
  });
  rerender();
}

/* item editor */
function editorBody() {
  const e = S.ed, cats = [...new Set(S.products.map(p => p.category).filter(Boolean))];
  return `<div class="form"><div class="field"><label>Name</label><input data-e="name" value="${esc(e.name)}" placeholder="e.g. Veg Momos" maxlength="80"></div>
    <div class="field"><label>Category</label><input data-e="category" list="cat-list" value="${esc(e.category)}" placeholder="e.g. Momos" maxlength="40"></div></div>
    <datalist id="cat-list">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist>
    <div class="form-h">Sizes & prices</div><div class="form">
      <div class="vrow vhead" style="padding-top:10px"><span>Size</span><span>Price $</span><span>Pieces</span><span>Cost $</span><span></span></div>
      ${e.variants.map((v, i) => `<div class="vrow"><input data-e="v:${i}:label" value="${esc(v.label)}" placeholder="8pcs" maxlength="40" aria-label="Size">
        <input data-e="v:${i}:price" value="${esc(v.price)}" inputmode="decimal" placeholder="10" aria-label="Price">
        <input data-e="v:${i}:pieces" value="${esc(v.pieces)}" inputmode="numeric" placeholder="1" aria-label="Pieces">
        <input data-e="v:${i}:cost" value="${esc(v.cost)}" inputmode="decimal" placeholder="opt." aria-label="Cost">
        <button class="iconbtn" style="width:44px;height:44px;color:var(--red)" data-a="rmVariant" data-i="${i}" aria-label="Remove size" ${e.variants.length < 2 ? 'disabled' : ''}>${icon('minus', 'sm')}</button></div>`).join('')}
      <button class="row" data-a="addVariant" style="color:var(--accent-ink)">${icon('plus', 'sm')}<span class="grow t">Add size</span></button></div>
    <p class="form-note">Pieces = how many stock pieces one sale uses (e.g. 8pcs uses 8). Cost is optional and powers profit estimates.</p>
    <div class="form-h">Stock</div><div class="form">
      <div class="field"><label>Stock source</label><select data-e="pool" aria-label="Stock source"><option value="" ${e.pool ? '' : 'selected'}>Own stock</option>${S.pools.filter(s => !s.archived || s.id === e.pool).map(s => `<option value="${s.id}" ${e.pool === s.id ? 'selected' : ''}>Shared: ${esc(s.name)} (${num(s.stock)} ${esc(s.unit || 'pcs')})</option>`).join('')}</select></div>
      ${e.pool ? '' : `<div class="field"><label>Low-stock alert</label><input data-e="low" inputmode="numeric" value="${esc(e.low)}" placeholder="Default (${S.settings.low_stock_default})"></div>`}
      ${e.id || e.pool ? '' : `<div class="field"><label>Opening stock</label><input data-e="stock" inputmode="numeric" value="${esc(e.stock)}" placeholder="0"></div>`}</div>
    <p class="form-note">${e.pool ? 'Sales of this item deduct pieces from the shared stock. Its alert level is set on the shared stock.' : 'Shared stock lets several items draw from one level (e.g. Steamed and Fried momos share Frozen Momos).'} <a href="#" data-a="newPool">New shared stock</a></p>
    ${e.id ? `<div class="list mt"><button class="row" data-a="${e.pool ? 'openPool' : 'openItem'}" data-id="${e.pool || e.id}"><span class="row-ic">${icon('box', 'sm')}</span><div class="grow"><div class="t">Correct stock level</div><div class="s">Add, remove or set with a reason — logged in history</div></div><span class="chev">${icon('chev', 'sm')}</span></button></div>` : ''}
    <div class="form mt"><div class="field"><label>Show on menu</label><span style="flex:1"></span><label class="switch"><input type="checkbox" data-e="active" ${e.active ? 'checked' : ''}><span></span></label></div>
      ${e.id ? `<div class="field"><label>Archived</label><span style="flex:1"></span><label class="switch"><input type="checkbox" data-e="archived" ${e.archived ? 'checked' : ''}><span></span></label></div>` : ''}</div>
    ${e.id ? `<p class="form-note">Items are never deleted. Archive an item to hide it everywhere while keeping it for past orders, stock history and reports.</p>` : ''}`;
}
function openEditor(id) {
  const p = id && prodById(id);
  S.ed = p ? { id, name: p.name, category: p.category || '', low: p.low_stock_threshold ?? '', active: p.active, archived: p.archived, pool: p.stock_item_id || '',
    variants: (p.variants || []).map(v => ({ label: v.label || '', price: String(v.price ?? ''), pieces: String(v.pieces ?? 1), cost: v.cost != null ? String(v.cost) : '' })) }
    : { id: null, name: '', category: S.cat !== 'All' ? S.cat : '', low: '', active: true, archived: false, stock: '', pool: '', variants: [{ label: '', price: '', pieces: '1', cost: '' }] };
  if (!S.ed.variants.length) S.ed.variants.push({ label: '', price: '', pieces: '1', cost: '' });
  openSheet({ title: p ? 'Edit item' : 'New item', key: 'editor',
    left: p ? `<button class="btn plain" data-a="openItem" data-id="${id}">Cancel</button>` : undefined,
    right: `<button class="btn plain" data-a="saveItem" style="font-weight:700">Save</button>`, body: editorBody(),
    foot: `<button class="btn primary lg block" data-a="saveItem">${p ? 'Save changes' : 'Add item'}</button>` });
}
async function saveItem(btn) {
  const e = S.ed, name = e.name.trim();
  if (!name) return toast('Give the item a name', true);
  const vs = [];
  for (const v of e.variants) {
    if (!v.label.trim() && v.price === '') continue;
    const price = Number(v.price), pieces = parseInt(v.pieces || '1', 10), cost = v.cost === '' ? null : Number(v.cost);
    if (!v.label.trim()) return toast('Each size needs a name, e.g. 8pcs', true);
    if (!(price >= 0) || v.price === '') return toast(`Enter a price for ${v.label}`, true);
    if (!(pieces >= 1)) return toast(`Pieces for ${v.label} must be 1 or more`, true);
    if (cost !== null && !(cost >= 0)) return toast(`Cost for ${v.label} must be a number`, true);
    vs.push({ label: v.label.trim(), price: r2(price), pieces, ...(cost !== null ? { cost: r2(cost) } : {}) });
  }
  if (!vs.length) return toast('Add at least one size with a price', true);
  const low = String(e.low).trim() === '' ? null : parseInt(e.low, 10);
  if (low !== null && !(low >= 0)) return toast('Low-stock alert must be 0 or more', true);
  const row = { name, category: e.category.trim() || 'Menu', variants: vs, low_stock_threshold: low, active: !!e.active, archived: !!e.archived, stock_item_id: e.pool || null };
  const cur = e.id && prodById(e.id);
  if (cur && (cur.stock_item_id || '') !== (e.pool || '') && !confirm(e.pool ? `Switch ${name} to the shared stock? Its own stock count (${num(cur.stock)}) is kept but no longer used.` : `Switch ${name} back to its own stock (${num(cur.stock)})?`)) return;
  await busy(btn, async () => {
    if (e.id) { const r = await q(sb.from('products').update(row).eq('id', e.id).select().single()); applyRow('products', r); toast('Item saved'); openItem(e.id); }
    else {
      const so = S.products.reduce((m, p) => Math.max(m, p.sort_order || 0), 0) + 1;
      const r = await q(sb.from('products').insert({ ...row, stock: 0, sort_order: so }).select().single()); applyRow('products', r);
      const st = parseInt(e.stock, 10); if (st > 0 && !e.pool) { r.stock = await rpc('adjust_stock', { p_product_id: r.id, p_delta: st, p_reason: 'initial', p_note: null }); }
      toast(`${name} added`); closeSheet();
    }
  });
  rerender();
}

/* ---------- Insights ---------- */
const charts = {};
function rangeKeys() {
  const t = today(), r = S.ins.range;
  if (r === 'today') return [t, t];
  if (r === 'week') { const s = addDays(t, -((weekday(t) + 6) % 7)); return [s, addDays(s, 6)]; }
  if (r === 'month') { const s = t.slice(0, 8) + '01'; const [y, m] = s.split('-').map(Number); return [s, new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)]; }
  let a = S.ins.from || addDays(t, -6), b = S.ins.to || t; if (a > b) [a, b] = [b, a]; return [a, b];
}
function daysBetween(a, b) { const out = []; for (let k = a; k <= b && out.length < 400; k = addDays(k, 1)) out.push(k); return out; }
function inRange(a, b) { return S.orders.filter(o => { const k = dayKey(o.pickup_time); return k >= a && k <= b; }); }
function chartUpsert(id, type, labels, data, fmt = money) {
  const el = $(id); if (!el || typeof Chart === 'undefined') return;
  const cs = getComputedStyle(document.documentElement), acc = cs.getPropertyValue('--accent').trim() || '#34C759', grid = cs.getPropertyValue('--sep').trim(), txt = cs.getPropertyValue('--text2').trim();
  const c = charts[id];
  if (c && c.canvas === el && c.config.type === type) { c.data.labels = labels; c.data.datasets[0].data = data; c.options.plugins.tooltip.callbacks.label = x => fmt(x.parsed.y); c.data.datasets[0].pointRadius = labels.length > 14 ? 0 : 3; c.update(); return; }
  if (c) c.destroy();
  charts[id] = new Chart(el, { type, data: { labels, datasets: [{ data, borderColor: acc, borderWidth: type === 'line' ? 2.5 : 0, borderRadius: 6, maxBarThickness: 26, tension: .35, cubicInterpolationMode: 'monotone', fill: type === 'line',
      pointRadius: labels.length > 14 ? 0 : 3, pointBackgroundColor: acc, pointHoverRadius: 5,
      backgroundColor: type === 'bar' ? acc : ctx => { const a = ctx.chart.chartArea; if (!a) return 'transparent'; const g = ctx.chart.ctx.createLinearGradient(0, a.top, 0, a.bottom); g.addColorStop(0, acc + '55'); g.addColorStop(1, acc + '00'); return g; } }] },
    options: { responsive: true, maintainAspectRatio: false, animation: { duration: 450 }, interaction: { intersect: false, mode: 'index' },
      plugins: { legend: { display: false }, tooltip: { displayColors: false, padding: 10, cornerRadius: 10, callbacks: { label: x => fmt(x.parsed.y) } } },
      scales: { x: { grid: { display: false }, border: { display: false }, ticks: { color: txt, maxRotation: 0, autoSkip: true, maxTicksLimit: 8, font: { size: 11 } } },
        y: { beginAtZero: true, grid: { color: grid }, border: { display: false }, ticks: { color: txt, maxTicksLimit: 5, font: { size: 11 }, callback: v => fmt === money ? '$' + v : v } } } } });
}
const shortDay = k => keyDate(k).toLocaleDateString('en-NZ', { timeZone: 'UTC', day: 'numeric', month: 'short' });
const hourLabel = h => `${((h + 11) % 12) + 1}${h < 12 ? 'am' : 'pm'}`;
const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
function pctChip(cur, prev) {
  if (!prev) return cur ? '<span class="d">New this period</span>' : '<span class="d">No sales yet</span>';
  const p = Math.round((cur - prev) / prev * 100);
  return `<div class="d ${p >= 0 ? 'up' : 'down'}">${p >= 0 ? '▲' : '▼'} ${Math.abs(p)}% vs previous</div>`;
}
function renderInsights() {
  const [a, b] = rangeKeys(), r = S.ins.range, one = a === b;
  $('s-head').innerHTML = header('Insights', one ? `${fmtDay(a)} · ${shortDay(a)}` : `${shortDay(a)} – ${shortDay(b)} ${b.slice(0, 4)}`,
    `<button class="btn sm" data-a="exportCSV">${icon('download', 'xs')} Export CSV</button>`);
  $('s-range').innerHTML = [['today', 'Today'], ['week', 'This week'], ['month', 'This month'], ['custom', 'Custom']].map(([k, l]) => `<button class="${r === k ? 'on' : ''}" data-a="range" data-k="${k}">${l}</button>`).join('');
  if (!$('s-custom').contains(document.activeElement)) $('s-custom').innerHTML = r === 'custom' ? `<div class="custom-range"><label class="datepick">From <input type="date" id="s-from" value="${a}"></label><label class="datepick">To <input type="date" id="s-to" value="${b}"></label></div>` : '';
  if (!$('s-kpis')) $('s-body').innerHTML = `<div class="stats mt" id="s-kpis"></div>
    <div class="chartcard mt"><h4 id="s-trend-h"></h4><div class="big" id="s-trend-v"></div><div class="chartbox"><canvas id="c-trend" aria-label="Revenue trend"></canvas></div></div>
    <div class="grid2"><div class="chartcard"><h4>Orders by pickup hour</h4><div class="big" id="s-hour-v"></div><div class="chartbox" style="height:170px"><canvas id="c-hour"></canvas></div></div>
      <div class="chartcard" id="s-week-card"><h4>Sales by day of week</h4><div class="big" id="s-week-v"></div><div class="chartbox" style="height:170px"><canvas id="c-week"></canvas></div></div></div>
    <div class="section-h mt"><b>Cash</b><button class="btn sm" data-a="exportPayments">${icon('download', 'xs')} Payments CSV</button></div><div class="stats" id="s-cash"></div>
    <div class="grid2"><div><div class="section-h"><b>Top sellers</b><span id="s-top-n"></span></div><div class="list" id="s-top"></div></div>
      <div><div class="section-h"><b>Payments</b></div><div class="card" style="padding:14px 16px" id="s-pay"></div>
      <div class="section-h mt"><b>More</b></div><div class="list" id="s-more"></div></div></div>`;
  const all = inRange(a, b), valid = all.filter(o => o.status !== 'cancelled'), canc = all.filter(o => o.status === 'cancelled');
  const rev = revenueOf(valid), n = valid.length, items = valid.reduce((s, o) => s + itemsCount(o), 0);
  const len = daysBetween(a, b).length, pv = inRange(addDays(a, -len), addDays(a, -1)).filter(o => o.status !== 'cancelled');
  $('s-kpis').innerHTML = [['Revenue', money(rev), pctChip(rev, revenueOf(pv))], ['Orders', num(n), pctChip(n, pv.length)],
    ['Avg order', money(n ? rev / n : 0), `<div class="d">per order</div>`], ['Items sold', num(items), `<div class="d">${num(valid.reduce((s, o) => s + (o.items || []).reduce((x, i) => x + (i.pieces || 0) * (i.qty || 0), 0), 0))} pieces</div>`]]
    .map(([k, v, d]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div>${d}</div>`).join('');
  // trend
  if (one) {
    const hrs = Array.from({ length: 24 }, (_, h) => h), byH = hrs.map(h => r2(revenueOf(valid.filter(o => nzHour(o.pickup_time) === h))));
    const lo = Math.min(9, ...hrs.filter(h => byH[h] > 0)), hi = Math.max(21, ...hrs.filter(h => byH[h] > 0));
    $('s-trend-h').textContent = 'Revenue by hour'; $('s-trend-v').textContent = money(rev);
    chartUpsert('c-trend', 'line', hrs.slice(lo, hi + 1).map(hourLabel), byH.slice(lo, hi + 1));
  } else {
    const ks = daysBetween(a, b); $('s-trend-h').textContent = 'Revenue trend'; $('s-trend-v').textContent = money(rev);
    chartUpsert('c-trend', 'line', ks.map(k => ks.length > 10 ? shortDay(k) : `${WD[(weekday(k) + 6) % 7]} ${+k.slice(8)}`), ks.map(k => r2(revenueOf(valid.filter(o => dayKey(o.pickup_time) === k)))));
  }
  const cnt = Array(24).fill(0); valid.forEach(o => cnt[nzHour(o.pickup_time)]++);
  const used = cnt.map((c, h) => c ? h : null).filter(h => h !== null), lo = Math.min(9, ...used), hi = Math.max(21, ...used);
  const peak = cnt.indexOf(Math.max(...cnt));
  $('s-hour-v').textContent = n ? `Busiest ${hourLabel(peak)}` : '—';
  chartUpsert('c-hour', 'bar', cnt.slice(lo, hi + 1).map((_, i) => hourLabel(lo + i)), cnt.slice(lo, hi + 1), v => `${v} order${v === 1 ? '' : 's'}`);
  $('s-week-card').hidden = one;
  if (!one) { const wd = Array(7).fill(0); valid.forEach(o => wd[(weekday(dayKey(o.pickup_time)) + 6) % 7] += Number(o.total)); const best = wd.indexOf(Math.max(...wd));
    $('s-week-v').textContent = n ? `Best: ${['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][best]}` : '—'; chartUpsert('c-week', 'bar', WD, wd.map(r2)); }
  // cash (by the day the payment was taken)
  const pays = paidInRange(a, b), cashP = pays.filter(o => o.payment_method === 'cash');
  const cashIn = cashP.reduce((s, o) => s + cashKept(o), 0), tips = pays.reduce((s, o) => s + Number(o.tip || 0), 0), chg = cashP.reduce((s, o) => s + Number(o.change_given || 0), 0), recv = cashP.reduce((s, o) => s + Number(o.cash_received ?? (Number(o.total) + Number(o.tip || 0))), 0);
  $('s-cash').innerHTML = [['Cash collected', money(cashIn), `<div class="d">${cashP.length} cash payment${cashP.length === 1 ? '' : 's'} · in the till</div>`], ['Tips', money(tips), `<div class="d">${pays.filter(o => Number(o.tip) > 0).length} tipped</div>`],
    ['Change given', money(chg), `<div class="d">from ${money(recv)} handed over</div>`], ['Promo + points', money(valid.reduce((s, o) => s + Number(o.promo_discount || 0) + Number(o.points_discount || 0), 0)), `<div class="d">${valid.filter(o => o.promo_code).length} promo · ${valid.filter(o => Number(o.points_redeemed) > 0).length} points</div>`]]
    .map(([k, v, d]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div>${d}</div>`).join('');
  // top sellers
  const agg = new Map(); valid.forEach(o => (o.items || []).forEach(i => { const k = `${i.name} · ${i.variant || ''}`; const x = agg.get(k) || { k, qty: 0, rev: 0 }; x.qty += Number(i.qty) || 0; x.rev += (Number(i.price) || 0) * (Number(i.qty) || 0); agg.set(k, x); }));
  const top = [...agg.values()].sort((x, y) => y.rev - x.rev).slice(0, 6), mx = top[0]?.rev || 1;
  $('s-top-n').textContent = top.length ? `${agg.size} sold` : '';
  $('s-top').innerHTML = top.length ? top.map((t, i) => `<div class="bar-row"><span class="rank">${i + 1}</span><div><div style="display:flex;justify-content:space-between;gap:8px"><span class="t" style="font-weight:500">${esc(t.k)}</span><span class="num muted">${t.qty} sold</span></div><div class="bar"><i style="width:${Math.max(4, t.rev / mx * 100)}%"></i></div></div><b class="num">${money(t.rev)}</b></div>`).join('')
    : `<div class="empty" style="padding:28px">${icon('chart')}<b>No sales in this period</b></div>`;
  // payments
  const colors = { cash: 'var(--accent)', card: 'var(--blue)', online: 'var(--purple)', none: 'var(--gray)' };
  const pay = { cash: 0, card: 0, online: 0, none: 0 }; valid.forEach(o => pay[o.payment_method || 'none'] += Number(o.total));
  $('s-pay').innerHTML = `<div class="split">${Object.entries(pay).filter(([, v]) => v > 0).map(([k, v]) => `<i style="width:${v / (rev || 1) * 100}%;background:${colors[k]}"></i>`).join('')}</div>
    <div class="legend">${Object.entries(pay).filter(([k, v]) => k !== 'none' || v > 0).map(([k, v]) => `<span><i style="background:${colors[k]}"></i>${k === 'none' ? 'Not set' : PAY[k]} <b class="num">${money(v)}</b> <span class="muted num">${rev ? Math.round(v / rev * 100) : 0}%</span></span>`).join('')}</div>`;
  // more
  let cost = 0, costed = 0; valid.forEach(o => (o.items || []).forEach(i => { const v = prodById(i.productId)?.variants?.[i.variantIndex]; if (v && v.cost != null) { cost += v.cost * i.qty; costed += i.price * i.qty; } }));
  const unpaid = valid.filter(o => !o.paid).reduce((s, o) => s + Number(o.total), 0), disc = valid.reduce((s, o) => s + Number(o.discount || 0), 0);
  $('s-more').innerHTML = [
    ['Cancelled', `${canc.length} · ${money(canc.reduce((s, o) => s + Number(o.total), 0))}`],
    ['Unpaid', money(unpaid)], ['Discounts given', money(disc)],
    ['Est. gross profit', costed ? `${money(costed - cost)} · ${Math.round((costed - cost) / costed * 100)}%` : '<span class="muted small">Add cost prices</span>']
  ].map(([k, v]) => `<div class="row static"><div class="grow t">${k}</div><div class="end num">${v}</div></div>`).join('');
}
function paidInRange(a, b) { return S.orders.filter(o => o.paid && o.status !== 'cancelled' && (k => k >= a && k <= b)(dayKey(o.paid_at || o.pickup_time))); }
function exportPayments() {
  const [a, b] = rangeKeys(), rows = paidInRange(a, b).sort((x, y) => new Date(x.paid_at || x.pickup_time) - new Date(y.paid_at || y.pickup_time));
  if (!rows.length) return toast('No payments in this period', true);
  const head = ['Paid date', 'Paid time', 'Order #', 'Customer', 'Phone', 'Method', 'Subtotal', 'Discount', 'Promo code', 'Promo discount', 'Points redeemed', 'Points discount', 'Total', 'Cash received', 'Change given', 'Tip', 'Cash kept', 'Paid by', 'Source'];
  const body = rows.map(o => { const t = o.paid_at || o.pickup_time; return [dayKey(t), hm(t), o.order_no, o.customer_name, o.customer_phone, o.payment_method ? PAY[o.payment_method] : '', Number(o.subtotal || o.total).toFixed(2), Number(o.discount || 0).toFixed(2), o.promo_code || '', Number(o.promo_discount || 0).toFixed(2), o.points_redeemed || 0, Number(o.points_discount || 0).toFixed(2), Number(o.total).toFixed(2),
    o.cash_received != null ? Number(o.cash_received).toFixed(2) : '', o.change_given != null ? Number(o.change_given).toFixed(2) : '', Number(o.tip || 0).toFixed(2), o.payment_method === 'cash' ? cashKept(o).toFixed(2) : '', o.paid_by || '', isCustApp(o) ? 'Customer app' : 'Staff'].map(csvCell).join(','); });
  const blob = new Blob(['\ufeff' + [head.join(','), ...body].join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const el = document.createElement('a'); el.href = URL.createObjectURL(blob); el.download = `rasoi-payments_${a}_to_${b}.csv`; document.body.appendChild(el); el.click();
  setTimeout(() => { URL.revokeObjectURL(el.href); el.remove(); }, 500); toast(`Exported ${rows.length} payments`);
}
function csvCell(v) { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
function exportCSV() {
  const [a, b] = rangeKeys(), rows = inRange(a, b).sort((x, y) => new Date(x.pickup_time) - new Date(y.pickup_time));
  if (!rows.length) return toast('No orders in this period', true);
  const head = ['Order #', 'Status', 'Pickup date', 'Pickup time', 'Customer', 'Phone', 'Items', 'Item count', 'Subtotal', 'Discount', 'Promo code', 'Total', 'Payment', 'Paid', 'Cash received', 'Change', 'Tip', 'Notes', 'Placed (NZ)', 'Taken by'];
  const body = rows.map(o => [o.order_no, ST_LABEL[o.status], dayKey(o.pickup_time), hm(o.pickup_time), o.customer_name, o.customer_phone, itemsText(o), itemsCount(o),
    Number(o.subtotal || o.total).toFixed(2), Number(o.discount || 0).toFixed(2), o.promo_code || '', Number(o.total).toFixed(2), o.payment_method ? PAY[o.payment_method] : '', o.paid ? 'Yes' : 'No',
    o.cash_received != null ? Number(o.cash_received).toFixed(2) : '', o.change_given != null ? Number(o.change_given).toFixed(2) : '', Number(o.tip || 0).toFixed(2), o.notes,
    `${dayKey(o.created_at)} ${hm(o.created_at)}`, o.created_by].map(csvCell).join(','));
  const blob = new Blob(['\ufeff' + [head.join(','), ...body].join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const el = document.createElement('a'); el.href = URL.createObjectURL(blob); el.download = `rasoi-orders_${a}_to_${b}.csv`; document.body.appendChild(el); el.click();
  setTimeout(() => { URL.revokeObjectURL(el.href); el.remove(); }, 500); toast(`Exported ${rows.length} orders`);
}

/* ---------- Settings ---------- */
function renderSettings() {
  const g = $('g-body'); if (g.contains(document.activeElement) && /INPUT/.test(document.activeElement.tagName)) return;
  const me = S.session?.user?.email || '';
  g.innerHTML = header('Settings', '') + `
    <div class="form-h">Business</div><div class="form">
      <div class="field"><label>Name</label><input id="g-name" value="${esc(bizName())}" maxlength="60"></div>
      <div class="field"><label>Low-stock alert</label><input id="g-low" inputmode="numeric" value="${esc(S.settings.low_stock_default)}"><span class="unit">pcs</span></div></div>
    <p class="form-note">Default alert level for items without their own. Times are shown in NZ time (Pacific/Auckland).</p>
    <div style="padding:10px 0 0"><button class="btn block" data-a="saveSettings">Save business settings</button></div>
    ${shopSettingsHTML()}
    <div class="form-h">Promotions &amp; loyalty</div><div class="list">
      <button class="row" data-a="openPromos">${icon('tag', 'sm')}<span class="grow"><span class="t">Promotions</span><span class="s" style="display:block">${S.promos.filter(p => !p.archived && p.active).length} active · ${S.promos.filter(p => !p.archived).length} total</span></span><span class="chev">${icon('chev', 'sm')}</span></button>
      <button class="row" data-a="openLoyalty">${icon('star', 'sm')}<span class="grow"><span class="t">Loyalty customers</span><span class="s" style="display:block">${num(S.customers.length)} customers · ${num(S.customers.reduce((a, c) => a + c.points, 0))} points outstanding</span></span><span class="chev">${icon('chev', 'sm')}</span></button></div>
    <div class="form-h">Staff</div><div class="list">${S.staff.map(s => `<div class="row static">${icon('user', 'sm')}<div class="grow"><div class="t">${esc(s.name || s.email.split('@')[0])}${s.email === me.toLowerCase() ? ' <span class="muted small">(you)</span>' : ''}</div><div class="s">${esc(s.email)}</div></div>
      <span class="chip ${s.role === 'owner' ? 'st-completed' : 'tag-muted'}">${s.role === 'owner' ? 'Owner' : 'Staff'}</span>
      ${isOwner() && s.role !== 'owner' ? `<button class="iconbtn" style="color:var(--red)" data-a="rmStaff" data-em="${esc(s.email)}" aria-label="Remove ${esc(s.email)}">${icon('trash', 'sm')}</button>` : ''}</div>`).join('')}</div>
    ${isOwner() ? `<div class="form mt"><div class="field"><label>Email</label><input id="g-se" type="email" inputmode="email" placeholder="staff@example.com" autocomplete="off"></div>
      <div class="field"><label>Name</label><input id="g-sn" placeholder="Optional" autocomplete="off" maxlength="60"></div></div>
      <div style="padding:10px 0 0"><button class="btn block" data-a="addStaff">${icon('plus', 'xs')} Add staff member</button></div>
      <p class="form-note">New staff open this app, tap “First time here? Create your password”, and use this email. Removing someone blocks their access immediately.</p>` : '<p class="form-note">Only the owner can add or remove staff.</p>'}
    <div class="form-h">Account</div><div class="list">
      <div class="row static">${icon('mail', 'sm')}<div class="grow"><div class="t">${esc(me)}</div><div class="s">${isOwner() ? 'Owner' : 'Staff'} · ${liveHTML()}</div></div></div>
      <button class="row" data-a="changePw">${icon('lock', 'sm')}<span class="grow t">Change password</span><span class="chev">${icon('chev', 'sm')}</span></button>
      <button class="row" data-a="signOut" style="color:var(--red)">${icon('logout', 'sm')}<span class="grow t">Sign out</span></button></div>
    <p class="small muted mt2" style="text-align:center"><img src="${BRAND.word}" alt="rasoi deli + kitchen" width="120" style="height:auto;display:block;margin:0 auto 6px">live sync across all your devices</p>`;
}

function shopSettingsHTML() {
  const st = S.settings, t = v => String(v || '').slice(0, 5), od = st.open_days || [1, 2, 3, 4, 5, 6, 7], l = L();
  return `<div class="form-h">Customer ordering</div><div class="form">
      <div class="field"><label>Opens</label><input id="g-open" type="time" step="900" value="${esc(t(st.open_time) || '12:00')}"></div>
      <div class="field"><label>Last pickup</label><input id="g-close" type="time" step="900" value="${esc(t(st.close_time) || '21:00')}"></div>
      <div class="field"><label>Min notice</label><input id="g-notice" inputmode="numeric" value="${esc(st.min_notice_minutes ?? 60)}"><span class="unit">min</span></div>
      <div class="field"><label>Days ahead</label><input id="g-days" inputmode="numeric" value="${esc(st.max_days_ahead ?? 14)}"><span class="unit">days</span></div></div>
    <div class="daypick mt" role="group" aria-label="Open days">${WD.map((d, i) => `<button class="${od.includes(i + 1) ? 'on' : ''}" data-a="toggleDay" data-d="${i + 1}" aria-pressed="${od.includes(i + 1)}">${d}</button>`).join('')}</div>
    <p class="form-note">Customers can pick a pickup time between these hours, on these days, at least the notice period ahead (NZ time). Pickup only, cash only.</p>
    <div class="form-h">Bulk orders contact</div><div class="form">
      <div class="field"><label>Phone</label><input id="g-cphone" type="tel" inputmode="tel" value="${esc(st.contact_phone || '')}" placeholder="Not set (hidden)" maxlength="20"></div>
      <div class="field"><label>Email</label><input id="g-cemail" type="email" inputmode="email" value="${esc(st.contact_email || '')}" placeholder="Not set (hidden)" maxlength="120"></div>
      <div class="field col"><label>Bulk note</label><input id="g-bulk" value="${esc(st.bulk_note || '')}" maxlength="200"></div></div>
    <p class="form-note">Shown on the customer menu in the “Bulk orders” card. Leave phone and email blank to hide the contact line.</p>
    <div class="form-h">Loyalty rules</div><div class="form">
      <div class="field"><label>Loyalty on</label><span class="grow" style="flex:1"></span><label class="switch"><input type="checkbox" id="g-loy" ${l.on ? 'checked' : ''}><span></span></label></div>
      <div class="field"><label>Points per $1</label><input id="g-earn" inputmode="decimal" value="${esc(l.earn)}"></div>
      <div class="field"><label>Redeem</label><input id="g-rp" inputmode="numeric" value="${esc(l.blk)}"><span class="unit">points =</span><input id="g-rv" inputmode="decimal" value="${esc(l.val)}" style="max-width:70px"><span class="unit">$ off</span></div></div>
    <div style="padding:10px 0 0"><button class="btn block" data-a="saveShop">Save ordering &amp; loyalty settings</button></div>`;
}

/* ---------- events ---------- */
const A = {
  go: el => { if (el.dataset.t === 'new' && S.tab !== 'new' && !S.cart.items.length && !S.cart.id) S.cart = newCart(); go(el.dataset.t); },
  clearDate: () => { S.of.date = ''; renderOrders(); },
  closeSheet, authMode: el => showAuth(el.dataset.m),
  resend: async () => { const { error } = await sb.auth.resend({ type: 'signup', email: S.authEmail, options: { emailRedirectTo: appURL() } }); showAuth('signin', error ? esc(errMsg(error)) : `Confirmation email sent again to ${esc(S.authEmail)}.`, !error); },
  signOut: async () => { try { await sb.auth.signOut({ scope: 'local' }); } catch (e) { } clearAuthStorage(); stop(); S.session = null; showAuth('signin'); },
  oseg: el => { S.of.seg = el.dataset.k; renderOrders(); },
  openOrder: el => { const b = $('neworder'); if (b && el.closest('#neworder')) b.classList.remove('on'); openOrder(el.dataset.id); },
  dismissAlert: () => { const b = $('neworder'); if (b) b.classList.remove('on'); },
  acceptAlert: el => { const b = $('neworder'); if (b) b.classList.remove('on'); return accept(el.dataset.id, el); },
  accept: el => accept(el.dataset.id, el),
  paidCash: el => paidCash(el.dataset.id, el),
  cashSheet: el => openCash(el.dataset.id),
  cashPick: el => { S.cash.custom = ''; S.cash.received = el.dataset.n === 'exact' ? null : Number(el.dataset.n); const st = $('sheet-body').scrollTop; $('sheet-body').innerHTML = cashBody(); $('sheet-body').scrollTop = st; $('sheet-foot').innerHTML = cashFoot(); buzz(); },
  cashConfirm: el => cashConfirm(el),
  backToCart: () => openCheckout(),
  placePaidCash: el => placeOrder(el, { received: null, tip: false }).catch(() => { }),
  cartPts: el => { S.cart.points = +el.dataset.n; updateCartTotals(); buzz(); },
  redeem: async el => { const id = el.dataset.id; const r = await busy(el, () => rpc('set_order_discounts', { p_order_id: id, p_redeem_points: +el.dataset.n })); applyRow('orders', r); toast(+el.dataset.n ? `${num(el.dataset.n)} points redeemed · −${money(r.points_discount)}` : 'Points removed from order'); rerender(); },
  applyPromo: async el => { const code = ($('od-code').value || '').trim().toUpperCase(); if (!code) return toast('Enter a promo code', true); const r = await busy(el, () => rpc('set_order_discounts', { p_order_id: el.dataset.id, p_promo_code: code })); applyRow('orders', r); toast(`${r.promo_code} applied · −${money(r.promo_discount)}`); rerender(); },
  removePromo: async el => { const r = await busy(el, () => rpc('set_order_discounts', { p_order_id: el.dataset.id, p_promo_code: '' })); applyRow('orders', r); toast('Promo removed'); rerender(); },
  pickPromo: el => { const i = $('od-code'); if (i) i.value = el.dataset.code; },
  openPromos: () => openPromos(), editPromo: el => openPromoEditor(el.dataset.id || null), savePromo: el => savePromo(el).catch(() => { }), pf: el => { S.pf = el.dataset.k; $('sheet-body').innerHTML = promosBody(); },
  peKind: el => { S.pe.kind = el.dataset.k; $('sheet-body').innerHTML = promoEditorBody(); },
  archivePromo: async el => { const p = S.promos.find(x => x.id === el.dataset.id); if (!p || !confirm(`Archive ${p.code}? It stops working but its history is kept.`)) return;
    const r = await busy(el, () => q(sb.from('promotions').update({ archived: true, active: false, show_on_menu: false, updated_at: new Date().toISOString() }).eq('id', p.id).select().single())); applyRow('promotions', r); toast(`${r.code} archived`); openPromos(); },
  unarchivePromo: async el => { const r = await busy(el, () => q(sb.from('promotions').update({ archived: false, updated_at: new Date().toISOString() }).eq('id', el.dataset.id).select().single())); applyRow('promotions', r); toast(`${r.code} restored (switched off)`); refreshSheet(); },
  openLoyalty: () => openLoyalty(), openCustomer: el => openCustomer(el.dataset.id),
  exportPayments: () => exportPayments(),
  toggleDay: el => { el.classList.toggle('on'); el.setAttribute('aria-pressed', el.classList.contains('on')); },
  saveShop: async el => {
    const days = [...document.querySelectorAll('.daypick button.on')].map(b => +b.dataset.d), n = parseInt($('g-notice').value, 10), dd = parseInt($('g-days').value, 10);
    const earn = Number($('g-earn').value), rp = parseInt($('g-rp').value, 10), rv = Number($('g-rv').value);
    if (!days.length) return toast('Choose at least one open day', true);
    if (!(n >= 0 && n <= 1440)) return toast('Min notice must be 0–1440 minutes', true);
    if (!(dd >= 1 && dd <= 60)) return toast('Days ahead must be 1–60', true);
    if (!($('g-open').value < $('g-close').value)) return toast('Opening time must be before last pickup', true);
    if (!(earn >= 0) || !(rp >= 1) || !(rv > 0)) return toast('Check the loyalty numbers', true);
    const r = await busy(el, () => rpc('save_shop_settings', { p: { open_time: $('g-open').value, close_time: $('g-close').value, min_notice_minutes: n, max_days_ahead: dd, open_days: days,
      contact_phone: $('g-cphone').value.trim(), contact_email: $('g-cemail').value.trim(), bulk_note: $('g-bulk').value.trim(), loyalty_enabled: $('g-loy').checked, loyalty_earn_per_dollar: earn, loyalty_redeem_points: rp, loyalty_redeem_value: rv } }));
    S.settings = r; toast('Ordering & loyalty settings saved'); renderSettings(); },
  advance: (el) => { const o = S.orders.find(x => x.id === el.dataset.id); if (o && NEXT[o.status]) setStatus(o.id, NEXT[o.status], el); },
  cancelOrder: el => setStatus(el.dataset.id, 'cancelled', el),
  setStatus: el => setStatus(el.dataset.id, el.dataset.s, el),
  editOrder: el => editOrder(el.dataset.id), receipt: el => openReceipt(el.dataset.id),
  printReceipt: el => { const o = S.orders.find(x => x.id === el.dataset.id); $('print-area').innerHTML = receiptHTML(o); window.print(); },
  shareReceipt: async el => { const o = S.orders.find(x => x.id === el.dataset.id), text = receiptText(o);
    try { if (navigator.share) await navigator.share({ title: `Order #${o.order_no}`, text }); else { await navigator.clipboard.writeText(text); toast('Receipt copied'); } } catch (e) { } },
  toggleLock: async el => { const o = S.orders.find(x => x.id === el.dataset.id); if (!o || !isOwner()) return;
    if (o.locked && !confirm(`Unlock order #${o.order_no}? It can then be edited or cancelled.`)) return;
    await busy(el, async () => { const r = await q(sb.from('orders').update({ locked: !o.locked }).eq('id', o.id).select().single()); applyRow('orders', r); toast(r.locked ? `#${r.order_no} locked` : `#${r.order_no} unlocked`); buzz(); rerender(); }); },
  cat: el => { S.cat = el.dataset.k; renderMenu(); },
  addVar: el => addVar(el.dataset.p, +el.dataset.v),
  qty: el => { const i = +el.dataset.i, ln = S.cart.items[i]; if (!ln) return; ln.qty += +el.dataset.d; if (ln.qty <= 0) S.cart.items.splice(i, 1); buzz(); cartChanged(); },
  clearCart: () => { const was = S.cart.id; if (S.cart.items.length && !was && !confirm('Clear this order?')) return; S.cart = newCart(); cartChanged(); if (was) { toast('Edit discarded'); go('orders'); } },
  placeOrder: el => placeOrder(el).catch(() => { }),
  pay: el => { S.cart.payment = el.dataset.k; el.parentElement.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === el)); },
  quickTime: el => { const t = Math.ceil((Date.now() + el.dataset.m * 60000) / 300000) * 300000; S.cart.date = dayKey(t); S.cart.time = hm(t);
    document.querySelectorAll('[data-c=date]').forEach(i => i.value = S.cart.date); document.querySelectorAll('[data-c=time]').forEach(i => i.value = S.cart.time); buzz(); },
  invMode: el => { S.inv.mode = el.dataset.k; renderInventory(); }, invSeg: el => { S.inv.seg = el.dataset.k; renderInventory(); },
  openItem: el => openItem(el.dataset.id), newItem: () => openEditor(null), editItem: el => openEditor(el.dataset.id),
  openPool: el => openPool(el.dataset.id), editPool: el => openPoolEditor(el.dataset.id), newPool: () => openPoolEditor(null), savePool: el => savePool(el).catch(() => { }),
  adjMode: el => { S.adj.mode = el.dataset.k; S.adj.reason = { add: 'restock', remove: 'waste', set: 'correction' }[el.dataset.k]; adjRefresh(); },
  adjStep: el => { S.adj.amt = String(Math.max(0, (parseInt(S.adj.amt, 10) || 0) + +el.dataset.d)); const i = document.querySelector('[data-j=amt]'); if (i) i.value = S.adj.amt; adjPreview(); },
  adjQuick: el => { S.adj.amt = el.dataset.n; const i = document.querySelector('[data-j=amt]'); if (i) i.value = S.adj.amt; adjPreview(); buzz(); },
  adjReason: el => { S.adj.reason = el.dataset.k; el.parentElement.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === el)); },
  applyAdj: el => applyAdj(el).catch(() => { }),
  addVariant: () => { S.ed.variants.push({ label: '', price: '', pieces: '1', cost: '' }); $('sheet-body').innerHTML = editorBody(); },
  rmVariant: el => { S.ed.variants.splice(+el.dataset.i, 1); $('sheet-body').innerHTML = editorBody(); },
  saveItem: el => saveItem(el).catch(() => { }),
  range: el => { S.ins.range = el.dataset.k; renderInsights(); }, exportCSV,
  saveSettings: async el => { const name = $('g-name').value.trim(), low = parseInt($('g-low').value, 10);
    if (!name) return toast('Business name is required', true); if (!(low >= 0)) return toast('Low-stock alert must be 0 or more', true);
    const r = await busy(el, () => q(sb.from('settings').update({ business_name: name, low_stock_default: low, updated_at: new Date().toISOString() }).eq('id', 1).select().single()));
    S.settings = r; toast('Settings saved'); renderTabbar(); },
  addStaff: async el => { const email = $('g-se').value.trim().toLowerCase(), name = $('g-sn').value.trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) return toast('Enter a valid email', true);
    if (S.staff.some(s => s.email === email)) return toast('Already on the staff list', true);
    const r = await busy(el, () => q(sb.from('staff').insert({ email, name: name || null, role: 'staff', added_by: S.session.user.email }).select().single()));
    applyRow('staff', r); toast(`${email} can now create a password`); $('g-se').value = ''; $('g-sn').value = ''; renderSettings(); },
  rmStaff: async el => { const em = el.dataset.em; if (!confirm(`Remove ${em}? They lose access immediately.`)) return;
    await busy(el, () => q(sb.from('staff').delete().eq('email', em))); applyRow('staff', { email: em }, true); toast('Staff member removed'); renderSettings(); },
  changePw: () => openSheet({ title: 'Change password', body: `<div class="form"><div class="field"><label>New</label><input id="pw1" type="password" autocomplete="new-password" placeholder="At least 8 characters"></div>
      <div class="field"><label>Confirm</label><input id="pw2" type="password" autocomplete="new-password" placeholder="Repeat"></div></div>`, foot: `<button class="btn primary lg block" data-a="savePw">Update password</button>` }),
  savePw: async el => { const a = $('pw1').value, b = $('pw2').value; if (a.length < 8) return toast('At least 8 characters', true); if (a !== b) return toast("Passwords don't match", true);
    await busy(el, async () => { const { error } = await sb.auth.updateUser({ password: a }); if (error) throw error; }); closeSheet(); toast('Password updated'); }
};
document.addEventListener('click', e => {
  const el = e.target.closest('[data-a]'); if (!el || el.tagName === 'INPUT' || el.disabled) return;
  const w = el.closest('.row-wrap');
  if (w && el.classList.contains('row') && (w.dataset.swiped || w.classList.contains('open'))) { w.classList.remove('open'); el.style.transform = ''; return; }
  if (w && el.closest('.swipe-actions')) { w.classList.remove('open'); w.querySelector('.row').style.transform = ''; }
  e.preventDefault(); const f = A[el.dataset.a]; if (f) Promise.resolve(f(el, e)).catch(() => { });
});
document.addEventListener('change', async e => {
  const t = e.target, a = t.dataset.a;
  if (a === 'togglePaid') { const o = S.orders.find(x => x.id === t.dataset.id); try { const r = await q(sb.from('orders').update({ paid: t.checked }).eq('id', o.id).select().single()); applyRow('orders', r); toast(r.paid ? `#${r.order_no} marked paid` : `#${r.order_no} marked unpaid`); buzz(); rerender(); } catch (err) { t.checked = !t.checked; toast(errMsg(err), true); } }
  if (a === 'toggleActive') { const p = prodById(t.dataset.id); try { const r = await q(sb.from('products').update({ active: t.checked }).eq('id', p.id).select().single()); applyRow('products', r); toast(r.active ? `${p.name} is on the menu` : `${p.name} hidden from menu`); rerender(); } catch (err) { t.checked = !t.checked; toast(errMsg(err), true); } }
  if (t.id === 'cash-tip') { S.cash.tip = t.checked; cashUpdate(); }
  if (a === 'togglePromo') { try { const r = await q(sb.from('promotions').update({ active: t.checked, updated_at: new Date().toISOString() }).eq('id', t.dataset.id).select().single()); applyRow('promotions', r); toast(r.active ? `${r.code} is on` : `${r.code} is off`); refreshSheet(); } catch (err) { t.checked = !t.checked; toast(errMsg(err), true); } }
  if (t.dataset.pe2 && t.type === 'checkbox') S.pe[t.dataset.pe2] = t.checked;
  if (t.id === 's-from' || t.id === 's-to') { S.ins.from = $('s-from').value; S.ins.to = $('s-to').value; renderInsights(); }
});
document.addEventListener('input', e => {
  const t = e.target, d = t.dataset, val = t.type === 'checkbox' ? t.checked : t.value;
  if (t.id === 'cash-custom') { S.cash.custom = t.value.replace(/[^0-9.]/g, ''); if (S.cash.custom !== '') S.cash.received = null; document.querySelectorAll('.cashgrid .btn').forEach(b => b.classList.remove('primary')); cashUpdate(); return; }
  if (d.pe2) { S.pe[d.pe2] = val; return; }
  if (d.c) { S.cart[d.c] = val; if (['discount', 'promo', 'phone'].includes(d.c)) { if (d.c === 'phone' && !custByPhone(val)) S.cart.points = 0; updateCartTotals(); } }
  else if (d.j) { S.adj[d.j] = val; if (d.j === 'amt') adjPreview(); }
  else if (d.pe) { S.ped[d.pe] = val; }
  else if (d.e) { if (d.e === 'pool') { S.ed.pool = val; const st = $('sheet-body').scrollTop; $('sheet-body').innerHTML = editorBody(); $('sheet-body').scrollTop = st; return; } if (d.e.startsWith('v:')) { const [, i, f] = d.e.split(':'); S.ed.variants[+i][f] = val; } else S.ed[d.e] = val; }
});
document.addEventListener('submit', e => { if (e.target.id === 'a-form') { e.preventDefault(); authSubmit(e.target); } });
$('backdrop').addEventListener('click', closeSheet);
$('cartbar').addEventListener('click', openCheckout);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && S.sheet) closeSheet(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.started) resync(); });
window.addEventListener('online', () => S.started && resync());
setInterval(() => { if (S.started && S.me && (S.tab === 'orders')) rerender(); }, 30000);

/* ---------- boot ---------- */
(function boot() {
  const hp = new URLSearchParams(location.hash.slice(1));
  if (hp.get('type') === 'recovery') S.recovery = true;
  const err = hp.get('error_description') || new URLSearchParams(location.search).get('error_description');
  sb.auth.onAuthStateChange((ev, session) => setTimeout(() => {
    if (ev === 'PASSWORD_RECOVERY') { S.recovery = true; S.session = session; stop(); return showAuth('recovery'); }
    if (ev === 'SIGNED_OUT') { stop(); S.session = null; return showAuth('signin'); }
    if (ev === 'TOKEN_REFRESHED' && session) { S.session = session; return; }
    if ((ev === 'SIGNED_IN' || ev === 'INITIAL_SESSION') && session) {
      if (S.recovery) return showAuth('recovery');
      if (/access_token|type=/.test(location.hash)) history.replaceState(null, '', appURL());
      return start(session);
    }
    if (ev === 'INITIAL_SESSION' && !session) showAuth('signin', err ? esc(err.replace(/\+/g, ' ')) + ' — request a new link below.' : '');
  }, 0));
})();
