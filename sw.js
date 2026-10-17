/* English Words — service worker.
   Сначала сеть (чтобы обновления доходили сразу), кэш — только запасной вариант без интернета. */
const CACHE = 'engword-v10';
const FILES = [
  './', 'index.html', 'style.css?v=10', 'core.js?v=10', 'srs.js?v=10', 'csv.js?v=10', 'tts.js?v=10', 'drive.js?v=10', 'app.js?v=10',
  'manifest.webmanifest?v=10', 'privacy.html', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-180.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => Promise.all(FILES.map((f) => c.add(new Request(f, { cache: 'reload' })).catch(() => {})))).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // запросы к Google идут напрямую
  e.respondWith(
    fetch(req, { cache: 'no-cache' })
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() =>
        caches.match(req, { ignoreSearch: false }).then((hit) => hit || caches.match(req, { ignoreSearch: true })).then((hit) => hit || (req.mode === 'navigate' ? caches.match('index.html') : undefined))
      )
  );
});
