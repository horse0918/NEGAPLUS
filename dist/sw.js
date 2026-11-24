const cacheName = 'nega-shell-2';
const assets = ['./','./style.css','./app.js','./manifest.webmanifest','./icon-192.png','./icon-512.png','./words.json'];
self.addEventListener('install', event => event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(assets)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const key of await caches.keys()) if (key.startsWith('nega-shell-') && key !== cacheName) await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.includes('/api/')) return;
  if (!event.request.mode.includes('navigate') && !assets.some(asset => new URL(asset, self.registration.scope).pathname === url.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(cacheName);
    try {
      const response = await fetch(event.request);
      if (response.ok) await cache.put(event.request, response.clone());
      return response;
    } catch {
      return await cache.match(event.request) || (event.request.mode === 'navigate' ? await cache.match('./') : Response.error());
    }
  })());
});
self.addEventListener('push', event => {
  const word = event.data?.text();
  if (word) event.waitUntil(self.registration.showNotification(word, { icon:'./icon-192.png' }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow(self.registration.scope));
});
