const CACHE_NAME = 'eq-store-v20';
const APP_SHELL = [
    './',
    './index.html',
    './app.js',
    './style.css',
    './coastlines.js',
    './plates.js'
];

self.addEventListener('install', (e) => {
    self.skipWaiting();
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
    );
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then((keyList) => {
            return Promise.all(keyList.map((key) => {
                if (key !== CACHE_NAME) {
                    return caches.delete(key);
                }
            }));
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (e) => {
    // Only handle GET requests
    if (e.request.method !== 'GET') return;

    const url = new URL(e.request.url);
    // External live API requests (USGS, EMSC, NOAA, Firebase): always go straight to network
    if (url.origin !== self.location.origin) {
        return;
    }

    // Network-First with Offline Cache Fallback for same-origin app assets
    e.respondWith(
        fetch(e.request)
            .then((networkRes) => {
                if (networkRes && networkRes.status === 200) {
                    const resClone = networkRes.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(e.request, resClone));
                }
                return networkRes;
            })
            .catch(() => caches.match(e.request))
    );
});
