/* Service Worker：現場離線可用 */
const CACHE = 'tender-photo-v1';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './assets/app.css',
  './vendor/jszip.min.js',
  './vendor/docx.iife.js',
  './js/util.js',
  './js/store.js',
  './js/presets.js',
  './js/imaging.js',
  './js/layout.js',
  './js/export-docx.js',
  './js/export-print.js',
  './js/export-zip.js',
  './js/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

/* 採 network-first：有網路時一律取最新版本，離線時回退快取。
   （cache-first 會讓使用者長期停留在舊版程式，改版後不會生效） */
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  if (new URL(e.request.url).origin !== self.location.origin) return;

  e.respondWith(
    fetch(e.request).then((res) => {
      if (res && res.status === 200 && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match(e.request).then((hit) =>
      hit || (e.request.mode === 'navigate' ? caches.match('./index.html') : Promise.reject(new Error('offline')))))
  );
});
