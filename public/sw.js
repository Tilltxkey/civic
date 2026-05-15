// public/sw.js
const CACHE_NAME = 'civic-cache-v2';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(clients.claim()));

self.addEventListener('fetch', event => {
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});

// ── Push notification handler ────────────────────────────────
self.addEventListener('push', event => {
  if (!event.data) return;

  let payload;
  try { payload = event.data.json(); }
  catch { payload = { title: 'Civic', body: event.data.text() }; }

  const title   = payload.title ?? 'Civic';
  const options = {
    body:    payload.body    ?? '',
    icon:    payload.icon    ?? '/icon-192x192.png',
    badge:   payload.badge   ?? '/icon-192x192.png',
    data:    payload.data    ?? {},
    tag:     payload.tag     ?? 'civic-notif',       // replaces same-tag notifications
    renotify: payload.renotify ?? false,
    vibrate: [200, 100, 200],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// ── Notification click: open/focus the app ───────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url ?? '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      // Focus existing tab if open
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.postMessage({ type: 'NOTIF_CLICK', data: event.notification.data });
          return client.focus();
        }
      }
      // Otherwise open a new tab
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});