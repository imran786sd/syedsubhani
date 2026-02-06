// sw.js - Service Worker
const CACHE_NAME = "gym-app-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./firebase-init.js",
  "./documentation.html",
  "./logo.png",
  // Add any other local images you use
  "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css", 
  "https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;800&display=swap"
];

// 1. Install Service Worker & Cache Files
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
});

// 2. Serve Cached Files when Offline
self.addEventListener("fetch", (e) => {
  e.respondWith(
    caches.match(e.request).then((response) => {
      return response || fetch(e.request);
    })
  );
});
