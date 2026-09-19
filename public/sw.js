// ZELVYRA · service worker mínimo.
// Siempre intenta primero la red (así nunca te quedas con una versión vieja de la app);
// si no hay internet, usa la última copia guardada para poder abrir la app.
const CACHE = 'zelvyra-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;          // audio/video: que lo maneje el navegador
  if (new URL(req.url).origin !== self.location.origin) return;          // Firebase y demás: sin tocar
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && res.status === 200) { const copia = res.clone(); caches.open(CACHE).then((c) => c.put(req, copia)); }
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || caches.match('./')))
  );
});
