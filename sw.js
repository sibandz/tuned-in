const CACHE_NAME = 'tuned-in-app-v5';
const APP_SHELL = [
  '/',
  '/Today.html',
  '/manifest.webmanifest',
  '/icons/icon-180.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(key => key !== CACHE_NAME)
        .map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('push', event => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (error) {
    console.error('Could not parse a push notification payload:', error);
  }

  const title = typeof payload.title === 'string' ? payload.title : 'Today';
  const options = {
    body: typeof payload.body === 'string' ? payload.body : '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-180.png',
    tag: typeof payload.tag === 'string' ? payload.tag : 'tuned-in-reminder',
    renotify: false,
    data: { url: typeof payload.url === 'string' ? payload.url : '/Today.html' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(
    typeof event.notification.data?.url === 'string' ? event.notification.data.url : '/Today.html',
    self.location.origin
  );
  if (target.origin !== self.location.origin) return;

  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async clients => {
    const existing = clients.find(client => new URL(client.url).origin === self.location.origin);
    if (existing) {
      if (new URL(existing.url).pathname !== target.pathname) await existing.navigate(target.href);
      return existing.focus();
    }
    return self.clients.openWindow(target.href);
  }));
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
          }
          return response;
        })
        .catch(async () => (await caches.match(request)) || caches.match('/Today.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => cached || fetch(request).then(response => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
      }
      return response;
    }))
  );
});
