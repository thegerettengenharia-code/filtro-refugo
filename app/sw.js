var CACHE_NAME = 'refugo-pwa-v1';
var ASSETS = [
  './index.html',
  './css/fonts.css',
  './css/styles.css',
  './js/core.js',
  './js/sample.js',
  './js/ui.js',
  './vendor/xlsx.full.min.js',
  './assets/favicon.svg',
  './fonts/FiraSans-400.woff2',
  './fonts/FiraSans-500.woff2',
  './fonts/FiraSans-600.woff2',
  './fonts/FiraSans-700.woff2',
  './fonts/FiraCode-400.woff2',
  './fonts/FiraCode-500.woff2'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(ASSETS);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (key) { return key !== CACHE_NAME; }).map(function (key) { return caches.delete(key); })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function (event) {
  event.respondWith(
    caches.match(event.request).then(function (cached) {
      return cached || fetch(event.request).then(function (response) {
        return response;
      }).catch(function () {
        // Fallback or offline catch if needed
      });
    })
  );
});
