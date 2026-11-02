// Service Worker der Handy-Seite /app: zeigt Push-Benachrichtigungen (gefolgte Spieler)
// auch bei geschlossener Seite und öffnet beim Antippen die App.
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });

self.addEventListener('push', function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { title: 'Liveticker', body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Liveticker', {
    body: d.body || '',
    tag: d.tag || undefined,
    renotify: !!d.tag,
    icon: '/brand-logo',
    badge: '/shuttle.svg',
    data: { url: d.url || '/app' },
  }));
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || '/app';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) {
      if (new URL(list[i].url).pathname === new URL(url, self.location.origin).pathname && 'focus' in list[i]) return list[i].focus();
    }
    return self.clients.openWindow(url);
  }));
});
