/* Service Worker：現場離線可用 */
const CACHE = 'tender-photo-v3';
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
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

/* 工地常是「有訊號但極慢」，比完全沒訊號更難用：等這麼久還沒回應就先吃快取 */
const NET_TIMEOUT = 3500;

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

/* 採 network-first：有網路時一律取最新版本，離線或網路過慢時回退快取。
   （cache-first 會讓使用者長期停留在舊版程式，改版後不會生效）

   注意：GitHub Pages 會送出 Cache-Control: max-age=600，單純 fetch() 仍會
   命中瀏覽器 HTTP 快取，改版後最多 10 分鐘才生效。故一律以 no-cache 發出
   請求，強制帶 ETag 向伺服器重新驗證：沒變動時回 304，成本極低。 */
function networkFirst(request) {
  const net = fetch(request.url, { cache: 'no-cache', credentials: 'same-origin' })
    .then((res) => {
      if (res && res.status === 200 && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(request, copy));
      }
      return res;
    });

  // 逾時只是「先用快取回應」，net 仍會跑完並把新版寫回快取，下次開啟就是新的
  const raced = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('slow-network')), NET_TIMEOUT);
    net.then(
      (res) => { clearTimeout(t); resolve(res); },
      (err) => { clearTimeout(t); reject(err); }
    );
  });

  return raced
    .catch(() => caches.match(request))
    .then((hit) => hit || net)
    .catch(() => (request.mode === 'navigate' ? caches.match('./index.html') : null))
    .then((hit) => hit || new Response('離線，且此資源沒有快取。', {
      status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    }));
}

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  if (new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(networkFirst(e.request));
});
