/* swirls service worker: network-first with cache fallback, so the app
   works offline but picks up new versions on the next online visit.
   On a trickling connection the network gets 3s to start answering and
   15s to deliver the whole file; past either deadline the cached copy is
   served while the download finishes in the background to refresh the
   cache for next launch. Requests with nothing cached wait indefinitely,
   since there is nothing to fall back to. */
var CACHE = 'swirls-v3';
var ANSWER_TIMEOUT = 3000;
var DOWNLOAD_TIMEOUT = 15000;
var ASSETS = [
  './',
  './index.html',
  './main.js',
  './effects.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-512-maskable.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (cache) { return cache.addAll(ASSETS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(function (cached) {
      if (!cached) {
        return fetch(e.request).then(function (res) {
          var copy = res.clone();
          caches.open(CACHE).then(function (cache) { cache.put(e.request, copy); });
          return res;
        });
      }
      return raceNetworkAgainstCache(e, cached);
    })
  );
});

function raceNetworkAgainstCache(e, cached) {
  return new Promise(function (resolve) {
    var settled = false;
    var answerTimer = setTimeout(useCache, ANSWER_TIMEOUT);
    var downloadTimer = setTimeout(useCache, DOWNLOAD_TIMEOUT);

    function useCache() {
      if (settled) return;
      settled = true;
      resolve(cached);
    }

    var download = fetch(e.request).then(function (res) {
      clearTimeout(answerTimer);
      /* Buffer the full body so "answered" can't mean "trickling":
         only a completely delivered file beats the cache. */
      return res.arrayBuffer().then(function (buf) {
        clearTimeout(downloadTimer);
        var full = new Response(buf, {
          status: res.status,
          statusText: res.statusText,
          headers: res.headers
        });
        var copy = full.clone();
        caches.open(CACHE).then(function (cache) { cache.put(e.request, copy); });
        if (!settled) {
          settled = true;
          resolve(full);
        }
      });
    }).catch(function () {
      clearTimeout(answerTimer);
      clearTimeout(downloadTimer);
      useCache();
    });

    /* Keep the worker alive so a download that lost the race still
       lands in the cache for the next launch. */
    e.waitUntil(download);
  });
}
