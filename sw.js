/* Service worker: appen og toiletdata virker uden net. Kortbilleder og rute kræver internet. */
const VERSION = 'toilet-v2-2026-10-10';
const CORE = ['./', 'index.html', 'style.css', 'app.js', 'hours.js', 'data/toiletter.js', 'data/toiletter.geojson',
  'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png',
  'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css', 'vendor/markercluster/leaflet.markercluster.js',
  'vendor/markercluster/MarkerCluster.css', 'vendor/markercluster/MarkerCluster.Default.css',
  'vendor/leaflet/images/layers.png', 'vendor/leaflet/images/layers-2x.png'];
self.addEventListener('install', e => e.waitUntil(caches.open(VERSION).then(c => c.addAll(CORE)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return; // kort/rute: direkte til nettet
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => {
    const net = fetch(e.request).then(r => { if (r.ok) caches.open(VERSION).then(c => c.put(e.request, r.clone())); return r; });
    return hit ? (net.catch(() => hit), hit) : net.catch(() => caches.match('index.html'));
  }));
});
