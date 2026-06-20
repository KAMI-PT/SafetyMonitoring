/* ================================================================
   HSE MONITOR — SERVICE WORKER
   Strategi cache:
   - Asset statis (CSS/JS/font dari CDN, halaman HTML) -> cache-first
     dengan fallback ke network jika belum ada di cache.
   - Panggilan API ke backend GAS -> SELALU network-first (tidak boleh
     pakai data lama, karena ini data HSE yang harus real-time/akurat).
   - Versi cache dinaikkan (CACHE_VERSION) setiap kali Anda update
     Index.html, agar pengguna otomatis dapat versi baru.
   ================================================================ */

const CACHE_VERSION = 'hse-monitor-v1';
const STATIC_CACHE   = CACHE_VERSION + '-static';

// File inti yang di-cache saat instalasi (app shell)
const APP_SHELL = [
  './',
  './Index.html',
  './manifest.json'
];

// ── INSTALL: cache app shell ───────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting(); // langsung aktif, tidak tunggu tab lama ditutup
});

// ── ACTIVATE: hapus cache versi lama ───────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith('hse-monitor-') && key !== STATIC_CACHE)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// ── FETCH: strategi berbeda untuk API vs asset statis ──────────
self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // Jangan cache request non-GET (POST ke GAS API harus selalu live)
  if (event.request.method !== 'GET') {
    return; // biarkan lewat tanpa intervensi service worker
  }

  // API call ke backend GAS -> network-first, JANGAN pernah disajikan dari cache
  if (url.includes('script.google.com') || url.includes('script.googleusercontent.com')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Tile peta (ESRI/OSM) -> cache-first (tile jarang berubah, hemat kuota)
  if (url.includes('arcgisonline.com') || url.includes('tile.openstreetmap.org')) {
    event.respondWith(
      caches.open(STATIC_CACHE).then((cache) =>
        cache.match(event.request).then((cached) => {
          if (cached) return cached;
          return fetch(event.request).then((resp) => {
            cache.put(event.request, resp.clone());
            return resp;
          });
        })
      )
    );
    return;
  }

  // Asset lain (HTML/CSS/JS/font dari CDN) -> stale-while-revalidate
  // Tampilkan versi cache dulu (cepat), lalu update cache di belakang layar
  event.respondWith(
    caches.open(STATIC_CACHE).then((cache) =>
      cache.match(event.request).then((cached) => {
        const fetchPromise = fetch(event.request)
          .then((resp) => {
            if (resp && resp.status === 200) {
              cache.put(event.request, resp.clone());
            }
            return resp;
          })
          .catch(() => cached); // offline -> pakai cache jika ada
        return cached || fetchPromise;
      })
    )
  );
});
