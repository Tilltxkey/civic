// public/sw.js
const CACHE_NAME = 'civic-cache-v1';

// We don't need to cache much for the prompt to work, 
// but the browser needs to see a 'fetch' listener.
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Logic for offline support can go here later
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});