'use strict';
// Service worker: guarda la "cáscara" de la app en el teléfono para que abra rápido
// y muestre un aviso si no hay internet. NUNCA guarda datos de la empresa (/api, /files).
const VERSION = 'ee-2.2.2';
const SHELL = ['/', '/index.html', '/app.css', '/app.js', '/app2.js', '/help.js', '/i18n.js', '/manifest.webmanifest', '/fonts/dm-sans-latin.woff2',
  '/brand/ee-logo.png', '/brand/icon-192.png', '/brand/icon-512.png', '/brand/apple-touch-icon.png', '/brand/favicon-32.png', '/offline.html'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/files/')) return; // datos: siempre del servidor
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('/index.html').then(r => r || caches.match('/offline.html'))));
    return;
  }
  // Archivos de la app: responde de inmediato desde el teléfono y se actualiza en segundo plano.
  e.respondWith(caches.open(VERSION).then(async c => {
    const hit = await c.match(req);
    const net = fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});

// Notificaciones push: el aviso llega vacío; se pide al servidor qué mostrar (con la sesión del usuario).
self.addEventListener('push', e => {
  e.waitUntil(fetch('/api/push/latest', { credentials: 'same-origin', cache: 'no-store' })
    .then(r => r.json()).catch(() => ({ title: 'Elevated Exteriors', body: '', url: '#/' }))
    .then(n => self.registration.showNotification(n.title || 'Elevated Exteriors', {
      body: n.body || '', icon: '/brand/icon-192.png', badge: '/brand/favicon-32.png', data: { url: n.url || '#/' }, tag: 'ee', renotify: true,
    })));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = '/' + (e.notification.data && e.notification.data.url || '#/');
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) { if ('focus' in c) { c.navigate(target).catch(() => {}); return c.focus(); } }
    return self.clients.openWindow(target);
  }));
});
