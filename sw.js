/* Service Worker：現場離線可用 */
const CACHE = 'tender-photo-v2';
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
  // 安裝時同樣繞過 HTTP 快取，避免把舊檔案存進離線快取
  e.waitUntil(caches.open(CACHE)
    .then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'no-cache' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

/* 採 network-first：有網路時一律取最新版本，離線時回退快取。
   （cache-first 會讓使用者長期停留在舊版程式，改版後不會生效）

   注意：GitHub Pages 會送出 Cache-Control: max-age=600，單純 fetch() 仍會
   命中瀏覽器 HTTP 快取，改版後最多 10 分鐘才生效。故一律以 no-cache 發出
   請求，強制帶 ETag 向伺服器重新驗證：沒變動時回 304，成本極低。 */
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  if (new URL(e.request.url).origin !== self.location.origin) return;

  e.respondWith(
    fetch(e.request.url, { cache: 'no-cache', credentials: 'same-origin' }).then((res) => {
      if (res && res.status === 200 && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match(e.request).then((hit) =>
      hit || (e.request.mode === 'navigate' ? caches.match('./index.html') : Promise.reject(new Error('offline')))))
  );
});
