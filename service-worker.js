const CACHE_NAME = 'screenshot-history-cache-v1';
const urlsToCache = [
    '/',
    '/index.html',
    '/style.css',
    '/main.js',
    '/manifest.json',
    '/capture.js',
    '/diffing.js',
    '/fileAccess.js',
    '/ocr.js',
    '/retention.js',
    '/storage.js',
    '/summarization.js',
    'https://cdn.jsdelivr.net/npm/dexie@3.2.2/dist/dexie.min.js',
    'https://unpkg.com/tesseract.js@v4.0.0/dist/tesseract.min.js',
    'https://cdn.tailwindcss.com'
];

self.addEventListener('install', event => {
    // Pre-cache all essential resources
    event.waitUntil(
        caches.open(CACHE_NAME)
        .then(cache => {
            console.log('Opened cache');
            return cache.addAll(urlsToCache);
        })
        .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    // Clean up old caches
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.filter(cacheName => {
                    return cacheName !== CACHE_NAME;
                }).map(cacheName => {
                    return caches.delete(cacheName);
                })
            );
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    // For LangChain and other API requests, don't try to cache them
    if (event.request.url.includes('cdn.jsdelivr.net/npm/@langchain') || 
        event.request.url.includes('api.openai.com') ||
        event.request.url.includes('generativelanguage.googleapis.com') ||
        event.request.url.includes('api.anthropic.com')) {
        return;
    }
    
    event.respondWith(
        caches.match(event.request)
        .then(response => {
            // Cache hit - return the response
            if (response) {
                return response;
            }
            
            // Clone the request because it's a one-time use stream
            const fetchRequest = event.request.clone();
            
            return fetch(fetchRequest).then(
                response => {
                    // Check if we received a valid response
                    if(!response || response.status !== 200 || response.type !== 'basic') {
                        return response;
                    }
                    
                    // Clone the response because it's a one-time use stream
                    const responseToCache = response.clone();
                    
                    caches.open(CACHE_NAME)
                        .then(cache => {
                            cache.put(event.request, responseToCache);
                        });
                        
                    return response;
                }
            );
        })
    );
});

// Handle offline functionality
self.addEventListener('message', event => {
    if (event.data === 'skipWaiting') {
        self.skipWaiting();
    }
});
