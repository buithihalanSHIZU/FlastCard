const CACHE_NAME = 'taiwan-huayu-v1-20260921';
const APP_SHELL = [
  './', './index.html', './styles.css', './app.js', './cards.js',
  './search.js', './search-client.js', './regex-worker.js',
  './manifest.webmanifest', './favicon.svg', './FlastCard/grammar.json', './quiz-data.json'
];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME && (key.startsWith('taiwan-huayu-') || key.startsWith('jlpt-n1-'))).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(fetch(event.request).then(response => {
    if(response.ok) { const copy=response.clone(); caches.open(CACHE_NAME).then(cache => cache.put(event.request,copy)); }
    return response;
  }).catch(()=>caches.match(event.request)));
});
