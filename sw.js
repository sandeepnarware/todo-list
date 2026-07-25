const CACHE = 'pomodone-v4';
// Scope-relative so the same list works at the domain root and under /todo-list/.
const URLS = ['./', './index.html', './style.css', './app.js', './quotes.json', './icon.svg', './manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(
    // Cache entries individually: addAll() rejects the whole install if any one
    // URL 404s, which would leave the app with no offline copy at all.
    caches.open(CACHE)
      .then(c => Promise.all(URLS.map(u => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
});

// Network-first: always try the network so code/style updates apply immediately,
// falling back to the cache only when offline. Successful responses refresh the cache.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // Let cross-origin traffic (Razorpay checkout script, its iframe and API calls)
  // go straight to the network — payment widgets must never be served from cache.
  if (new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
