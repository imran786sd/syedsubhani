// Update version to force browser to reload
const CACHE_NAME = 'budget-pro-v2'; 

const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  'https://d3js.org/d3.v7.min.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'
];

// Install Event
self.addEventListener('install', (e) => {
  self.skipWaiting(); // Force new worker to take over immediately
  e.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
});

// Activate Event (Clean up old v1 cache)
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(keyList.map((key) => {
        if (key !== CACHE_NAME) {
          return caches.delete(key);
        }
      }));
    })
  );
  return self.clients.claim();
});

// FETCH STRATEGY: Network First (Falls back to Cache)
self.addEventListener('fetch', (e) => {
  e.respondWith(
    fetch(e.request)
      .then((response) => {
        // If network works, update the cache with the new file
        const resClone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(e.request, resClone));
        return response;
      })
      .catch(() => {
        // If network fails (offline), use the cached version
        return caches.match(e.request);
      })
  );
});
