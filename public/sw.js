// Service worker de la web app : reçoit les notifications push et ouvre la review au bon commentaire.
// (Pas de cache hors ligne : la review a besoin du réseau pour les vidéos et les commentaires.)
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data?.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Nocturnz Review', {
    body: d.body || 'Nouvelle activité',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: d.tag,                 // une notification par review, remplacée par la suivante
    renotify: !!d.tag,
    data: { url: d.url || '/' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || '/', self.location.origin).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = wins.find((w) => w.url.startsWith(self.location.origin));
    if (open) { await open.focus(); return open.navigate(url); }
    return self.clients.openWindow(url);
  })());
});
