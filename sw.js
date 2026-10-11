// Naikkan versi bila ubah mana-mana fail app supaya telefon dapat versi baru.
const CACHE = 'komitmen-v5';
const ASSETS = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'sync.js',
  'firebase-config.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', e => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

// Cache dulu (laju & offline), kemudian kemaskini cache di belakang.
self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  // App files + Firebase SDK (versioned URL, safe to cache) so sync loads offline too.
  const sdk = url.origin === 'https://www.gstatic.com' && url.pathname.startsWith('/firebasejs/');
  if (req.method !== 'GET' || (url.origin !== location.origin && !sdk)) return;
  e.respondWith(
    caches.open(CACHE).then(cache =>
      cache.match(req, { ignoreSearch: true }).then(hit => {
        const net = fetch(req).then(res => {
          if (res.ok) cache.put(req, res.clone());
          return res;
        }).catch(() => hit || (req.mode === 'navigate' ? cache.match('index.html') : undefined));
        return hit || net;
      })
    )
  );
});
