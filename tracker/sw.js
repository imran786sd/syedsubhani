// ==========================================
// SERVICE WORKER (Offline Capability)
// Version: v0.1
// ==========================================

const CACHE_NAME = 'budget-pro-v0.1';

// Files to cache immediately on install
const ASSETS = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './config.js',
    './firebase-init.js',
    './manifest.json',
    // External Libraries (CDNs)
    'https://d3js.org/d3.v7.min.js',
    'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'
];

// 1. INSTALL EVENT
// Runs when the browser first sees this SW version.
self.addEventListener('install', (e) => {
    // Force this new SW to become active immediately (don't wait for tabs to close)
    self.skipWaiting(); 

    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS);
        })
    );
});

// 2. ACTIVATE EVENT
// Runs when the new SW takes control. Good for cleaning up old caches.
self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then((keyList) => {
            return Promise.all(keyList.map((key) => {
                // If a cache exists that is NOT the current name, delete it
                if (key !== CACHE_NAME) {
                    return caches.delete(key);
                }
            }));
        })
    );
    // Tell the SW to take control of all open tabs immediately
    return self.clients.claim();
});

// 3. FETCH STRATEGY: Network First -> Fallback to Cache
// This ensures users always see fresh data if online.
self.addEventListener('fetch', (e) => {
    
    // Skip non-GET requests (like Firestore writes) and Chrome extensions
    if (e.request.method !== 'GET' || !e.request.url.startsWith('http')) {
        return;
    }

    e.respondWith(
        fetch(e.request)
            .then((response) => {
                // If network fetch succeeds:
                // 1. Clone the response (streams can only be read once)
                const resClone = response.clone();
                
                // 2. Update the cache with this fresh version
                caches.open(CACHE_NAME).then((cache) => {
                    cache.put(e.request, resClone);
                });

                // 3. Return fresh data to the app
                return response;
            })
            .catch(() => {
                // If network fails (Offline):
                // Return the cached version if we have it
                return caches.match(e.request);
            })
    );
});
