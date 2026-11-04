/* rasoi staff service worker (v12): Web Push only. No offline caching, so the app always loads the latest deploy. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data ? e.data.text() : '' }; }
  const title = d.title || 'New order';
  const opts = {
    body: d.body || 'Open the staff app',
    tag: d.tag || ('order-' + (d.order_id || Date.now())),
    renotify: true, requireInteraction: true,
    icon: 'brand/rasoi/rasoi-mark-512.png', badge: 'brand/rasoi/favicon-32.png',
    vibrate: [200, 100, 200, 100, 200], timestamp: d.ts || Date.now(),
    data: { url: d.url || './', order_id: d.order_id || null }
  };
  e.waitUntil((async () => {
    await self.registration.showNotification(title, opts);
    const cs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    cs.forEach(c => c.postMessage({ type: 'push', data: d }));
  })());
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const d = e.notification.data || {}, url = new URL(d.url || './', self.registration.scope).href;
  e.waitUntil((async () => {
    const cs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of cs) {
      if (c.url.startsWith(self.registration.scope)) {
        try { await c.focus(); } catch (_) { }
        c.postMessage({ type: 'open-order', id: d.order_id });
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
