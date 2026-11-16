const VERSION = 'form-v1-dev'; // Replaced by the build script with a content hash.
const PREFIX = `form:${new URL(self.registration.scope).pathname}:`;
const CACHE = PREFIX + VERSION;
const ASSETS = ['./js/schema3.js', './js/automatic.js', './js/routine-db.js', './js/surface.js', './js/routine-views.js', './icons/ui-routines.svg', './icons/ui-exercise.svg', './icons/ui-workouts.svg', './icons/ui-history.svg', './icons/ui-profile.svg', './icons/ui-next.svg', './icons/ui-dropdown.svg', './icons/ui-reset.svg', './icons/ui-restart.svg', './icons/ui-close.svg', './icons/ui-planning.svg', './icons/ui-rest.svg', './', './index.html', './styles.css', './config.js', './manifest.webmanifest', './js/app.js', './js/domain.js', './js/model.js', './js/analysis.js', './js/training-db.js', './js/ui.js', './js/views.js', './js/editors.js', './js/settings.js', './js/db.js', './js/cloud.js', './js/sync.js', './js/wheel.js', './js/backup.js', './icons/favicon.svg', './icons/apple-touch-icon.png', './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png'];
const PATHS = new Set(ASSETS.map(path => new URL(path, self.registration.scope).pathname));
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS.map(path => new Request(new URL(path, self.registration.scope), { cache: 'reload' })))));
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  // Never cache authentication, API requests, exports, or arbitrary navigations.
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !PATHS.has(url.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    return await cache.match(event.request, { ignoreSearch: true }) || fetch(event.request);
  })());
});
