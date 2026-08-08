/* sw.js — offline app shell for SportTactic.

   Strategy (same-origin GET only):
   · navigations   → network first, fall back to the cached index.html
   · other assets  → exact-URL cache hit wins (URLs are version-stamped with ?v=N,
                     so a bump is automatically a cache miss and refetches), then
                     network, then a version-ignoring cache match as a last resort.

   BUMP `VERSION` and the matching `?v=` entries in SHELL whenever an asset changes.
*/
const VERSION = 'v103';
const CACHE = 'sporttactic-' + VERSION;

const SHELL = [
  './',
  './index.html',
  './help.html',
  './license.html',
  './oldipads.html',
  './manifest.webmanifest',
  './logo.svg?v=6',
  './styles.css?v=87',
  './db.js?v=14',
  './i18n.js?v=95',
  './sports.js?v=20',
  './playbook.js?v=12',
  './store.js?v=21',
  './ui.js?v=26',
  './mail.js?v=11',
  './ai.js?v=11',
  './dashboard.js?v=16',
  './teams.js?v=30',
  './matches.js?v=19',
  './planner.js?v=1',
  './scouting.js?v=27',
  './statistics.js?v=23',
  './chess.js?v=13',
  './bridge.js?v=13',
  './poker.js?v=13',
  './backgammon.js?v=13',
  './tactics.js?v=61',
  './anim.js?v=1',
  './video.js?v=22',
  './training.js?v=36',
  './exercises.js?v=30',
  './opponents.js?v=19',
  './reports.js?v=21',
  './settings.js?v=43',
  './backup.js?v=1',
  './messenger.js?v=16',
  './app.js?v=26'
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // One bad URL must not abandon the whole precache, so add them individually.
    await Promise.all(SHELL.map(u => cache.add(new Request(u, { cache: 'reload' })).catch(() => null)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('sporttactic-') && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

async function putIfOk(request, response) {
  if (!response || !response.ok || response.type !== 'basic') return response;
  const cache = await caches.open(CACHE);
  cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Never touch cross-origin traffic (MQTT relay, esm.sh, video embeds, Drive).
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        return await putIfOk(req, await fetch(req));
      } catch (err) {
        return (await caches.match(req, { ignoreSearch: true }))
          || (await caches.match('./index.html'))
          || Response.error();
      }
    })());
    return;
  }

  e.respondWith((async () => {
    const hit = await caches.match(req);
    if (hit) return hit;
    try {
      return await putIfOk(req, await fetch(req));
    } catch (err) {
      // Offline after a ?v= bump — the previous build is still better than nothing.
      return (await caches.match(req, { ignoreSearch: true })) || Response.error();
    }
  })());
});
