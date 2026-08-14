/* sw.js — offline app shell for SportTactic.

   Strategy (same-origin GET only):
   · navigations   → network first, fall back to the cached index.html
   · other assets  → exact-URL cache hit wins (URLs are version-stamped with ?v=N,
                     so a bump is automatically a cache miss and refetches), then
                     network, then a version-ignoring cache match as a last resort.

   BUMP `VERSION` and the matching `?v=` entries in SHELL whenever an asset changes.
*/
const VERSION = 'v167';
const CACHE = 'sporttactic-' + VERSION;

const SHELL = [
  './',
  './index.html',
  './help.html',
  './license.html',
  './oldipads.html',
  './manifest.webmanifest',
  './logo.svg?v=6',
  './icon-maskable.svg?v=1',
  './styles.css?v=104',
  './db.js?v=14',
  './i18n.js?v=131',
  './sports.js?v=20',
  './playbook.js?v=12',
  './store.js?v=32',
  './ui.js?v=31',
  './access.js?v=14',
  './privacy.js?v=2',
  './drive.js?v=2',
  './cloud.js?v=7',
  './mail.js?v=12',
  './ai.js?v=12',
  './dashboard.js?v=17',
  './teams.js?v=40',
  './matches.js?v=22',
  './planner.js?v=9',
  './scouting.js?v=28',
  './statistics.js?v=26',
  './chess.js?v=13',
  './bridge.js?v=13',
  './poker.js?v=13',
  './backgammon.js?v=13',
  './tactics.js?v=72',
  './anim.js?v=5',
  './video.js?v=24',
  './training.js?v=37',
  './exercises.js?v=32',
  './opponents.js?v=20',
  './reports.js?v=22',
  './settings.js?v=77',
  './backup.js?v=2',
  './messenger.js?v=18',
  './app.js?v=33',
  './mobile.js?v=1'
];

// Fill the cache and report how much of the shell actually made it, so the
// install can fail loudly instead of leaving a half-cached app.
async function precacheAll() {
  const cache = await caches.open(CACHE);
  // One bad URL must not abandon the whole precache, so add them individually.
  const results = await Promise.all(SHELL.map(u =>
    cache.add(new Request(u, { cache: 'reload' })).then(() => true, () => false)));
  const ok = results.filter(Boolean).length;
  return { ok, total: SHELL.length, missing: SHELL.filter((u, i) => !results[i]) };
}

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    await precacheAll();
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
  const data = e.data || {};
  if (data.type === 'SKIP_WAITING') { self.skipWaiting(); return; }
  // Settings > Offline > "Download for offline use" — the coach forces the whole
  // shell into the cache before leaving for a hall with no signal, and gets a
  // straight answer about whether it worked.
  if (data.type === 'PRECACHE_ALL') {
    const reply = m => { if (e.ports && e.ports[0]) e.ports[0].postMessage(m); };
    e.waitUntil(precacheAll().then(
      r => reply({ ok: r.missing.length === 0, cached: r.ok, total: r.total, missing: r.missing }),
      err => reply({ ok: false, error: String(err && err.message || err) })
    ));
  }
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
