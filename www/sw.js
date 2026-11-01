/* ArbMusic service worker — приложение работает даже без интернета */
'use strict';
const CACHE = 'arbmusic-v1';
const SHELL = [
  './index.html',
  './css/style.css',
  './js/app.js',
  './icon-192.png',
  './icon-512.png',
  './manifest.webmanifest',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;          // сторонние — мимо
  if (req.headers.has('range')) return;                 // media range — мимо
  if (!url.pathname.startsWith(new URL('./', location.href).pathname)) return;

  // навигация: сразу из кэша, обновляем в фоне
  if (req.mode === 'navigate') {
    e.respondWith(
      caches.match('./index.html').then((hit) => hit || fetch(req))
    );
    return;
  }

  // остальные ресурсы: stale-while-revalidate
  e.respondWith(
    caches.match(req).then((hit) => {
      const fresh = fetch(req).then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => hit);
      return hit || fresh;
    })
  );
});
