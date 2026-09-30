const cacheName = 'bluviboard-offline-__PWA_BUILD_ID__';
const offlinePage = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(cacheName).then(async (cache) => {
    const response = await fetch(offlinePage, { cache: 'reload', credentials: 'omit' });
    if (!response.ok) throw new Error('Offline page is unavailable');
    await cache.put(offlinePage, response);
  }));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith('bluviboard-offline-') && key !== cacheName).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'APPLY_UPDATE') event.waitUntil(self.skipWaiting());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Only a public offline page is cached. API responses, drawings, images,
  // authentication and administrative pages always go directly to the network.
  if (event.request.method !== 'GET' || event.request.mode !== 'navigate' || url.origin !== self.location.origin || url.pathname !== '/') return;
  event.respondWith(fetch(event.request).catch(async () => {
    const cached = await (await caches.open(cacheName)).match(offlinePage);
    return cached ?? Response.error();
  }));
});
