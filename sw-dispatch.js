const CACHE = 'izik-dispatch-1776735780';
const ASSETS = ['/dispatch-hq.html', '/manifest-dispatch.json', '/icon-dispatch.png'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS).catch(()=>{}))
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if(e.request.method !== 'GET') return;
  if(e.request.url.includes('firebase') ||
     e.request.url.includes('googleapis') ||
     e.request.url.includes('gstatic') ||
     e.request.url.includes('maps')) return;

  if(e.request.url.endsWith('.html') || e.request.url.includes('dispatch-hq')) {
    e.respondWith(
      fetch(e.request, {cache: 'no-store'}).then(res => {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return res;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then(cached =>
      cached || fetch(e.request).then(res => {
        if(res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      })
    )
  );
});

self.addEventListener('activate', () => {
  self.clients.matchAll({type: 'window'}).then(clients => {
    clients.forEach(client => client.postMessage({type: 'SW_UPDATED'}));
  });
});
