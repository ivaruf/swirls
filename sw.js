/* swirls service worker: network-first with cache fallback, so the app
   works offline but picks up new versions on the next online visit.
   On a trickling connection the network gets 3s to start answering and
   15s to deliver the whole file; past either deadline the cached copy is
   served while the download finishes in the background to refresh the
   cache for next launch. Requests with nothing cached wait indefinitely,
   since there is nothing to fall back to. */
var CACHE = 'swirls-v11'; // the twelve laid round the mark, and choosing one is how swirls begins
var ANSWER_TIMEOUT = 3000;
var DOWNLOAD_TIMEOUT = 15000;
var ASSETS = [
  './',
  './index.html',
  // Has to be IN the cache, not merely deployed: the players this rescues
  // are the ones whose browser has stopped asking this origin for anything.
  './moved.js',
  './main.js',
  './effects.js',
  // Nothing imports this one — it is its own classic script precisely so a
  // failure anywhere else cannot take it down — so nothing else would ever
  // pull it into the cache on its behalf.
  './screen.js',
  // Same reasoning as screen.js: nothing imports audio.js either, so nothing
  // else would ever pull it into the cache on its behalf.
  './audio.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-512-maskable.png',
  './apple-touch-icon.png'
];

// NO AUDIO IS PRECACHED — not the theme, and not one of the fourteen cues.
//
// The theme first, because it made the argument: 2.6 MB against 374 KB for
// everything listed above put together, and install blocks on every entry in
// that list, so precaching it would stall each version bump behind a download
// on whatever connection the player happens to be on. maxgear hit exactly this
// and its sw.js documents the same answer.
//
// The cues then followed it out, and the reasoning is the same one scaled
// down. A cue per effect is twelve files plus the mode cue: 179 KB, which
// would be a 48% rise in what EVERY install downloads — including the installs
// of the players who never turn sound on, which is all of them by default,
// because both levels start at zero. Paying that on every version bump for a
// feature nobody has asked for yet is the same mistake as the theme, only
// quieter.
//
// What replaces it is better than precaching in both directions: audio.js
// warms the whole cue set the moment the effects level first comes up, and the
// fetch handler below puts each file in the cache as it arrives. Nobody pays
// until they ask, and one online session with sound on leaves the complete set
// available offline for good. It needs no special case here, because audio.js
// asks for every file as a plain request and the handler's own put() covers
// them all.

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
        // ONLY OUR OWN OLD CACHES. CacheStorage is per ORIGIN, not per scope,
        // and every game in this hub is served from the one origin — so the
        // obvious `k !== CACHE` this used to say was deleting fishtank's
        // cache, supermine's, dam_break's and everyone else's on every visit
        // to swirls, taking their offline support with it until each was
        // opened online again. The slug prefix is what makes the filter mean
        // "mine", and it is why hub CLAUDE.md §3 asks for one.
        if (k !== CACHE && k.indexOf('swirls-') === 0) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    // `cacheName` is not optional here. A bare caches.match() searches EVERY
    // cache on the origin, and every game in this hub shares one — so this was
    // free to answer out of fishtank's cache, or the arcade's, for any URL they
    // both request. ../arcade/exit.js is precisely that: the arcade precaches
    // it, so the copy swirls got came from a store no version bump of ours
    // could ever refresh. Scoped, a miss simply falls through to the network.
    caches.match(e.request, { cacheName: CACHE, ignoreSearch: true }).then(function (cached) {
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
