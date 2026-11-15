self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { body: event.data ? event.data.text() : '' }; }
  event.waitUntil(self.registration.showNotification(data.title || 'SuperAI Monitor', {
    body: data.body || '有新的链上动作',
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    tag: data.tag || 'superai-monitor',
    renotify: true,
    data: { url: data.url || './' }
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || './';
  event.waitUntil((async () => {
    const all = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) if (c.url.includes(self.location.origin)) return c.focus();
    return clients.openWindow(url);
  })());
});
