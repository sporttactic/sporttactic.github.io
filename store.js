/* store.js — in-memory cache over IndexedDB + seed data + domain helpers */
const Store = (() => {
  const cache = {};
  const listeners = new Set();

  function uid(prefix = 'id') {
    return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  async function loadAll() {
    for (const s of DB.STORES) cache[s] = await DB.getAll(s);
  }

  function all(store) {
    // A player copy is not shown the scouting events, so nothing counted from
    // them — season totals, ratings, match reports — shows up either. They still
    // sync: the shared file is read and written straight from the database.
    if (store === 'events' && typeof window !== 'undefined' && window.Access && Access.hidesEvents && Access.hidesEvents()) return [];
    return cache[store] || [];
  }
  function find(store, id) { return (cache[store] || []).find(x => x.id === id); }

  // ---- Read-only lock ----------------------------------------------------
  // A backup exported with a pass key opens view-only: the recipient can look
  // at everything but cannot change it until they type the key. The guard lives
  // in localStorage because save()/remove() are synchronous entry points and a
  // settings row would be cleared by the very import that sets the lock.
  const LOCK_KEY = 'stx_lock';
  const LOCK_FREE = ['settings'];       // device preferences stay editable
  let lockGuard = null;
  try { lockGuard = JSON.parse(localStorage.getItem(LOCK_KEY) || 'null'); } catch (e) { lockGuard = null; }
  // Boot migrations write too; staying quiet for the first seconds keeps their
  // blocked writes from throwing a toast in the coach's face on every load.
  let lockQuiet = true;
  setTimeout(() => { lockQuiet = false; }, 4000);
  let lastNag = 0;
  function locked() { return !!lockGuard; }
  function lockInfo() { return lockGuard; }
  function setLock(g) {
    lockGuard = (g && g.hash) ? g : null;
    try {
      if (lockGuard) localStorage.setItem(LOCK_KEY, JSON.stringify(lockGuard));
      else localStorage.removeItem(LOCK_KEY);
    } catch (e) { /* private mode */ }
    emit();
  }
  function blockWrite(store, row) {
    const lock = !!lockGuard && LOCK_FREE.indexOf(store) < 0;
    // The second read-only mode: a copy that joined with a team code the coach
    // handed out as look-only. Access decides; this only reports it.
    const member = !lock && !!(window.Access && Access.blocks && Access.blocks(store, row));
    if (!lock && !member) return false;
    const now = Date.now();
    if (!lockQuiet && now - lastNag > 2000 && window.UI && UI.toast) {
      lastNag = now;
      const key = member ? 'mem.blocked' : 'lock.blocked';
      UI.toast(window.T ? T(key) : 'Read-only copy', 'error');
    }
    return true;
  }

  async function save(store, obj) {
    if (blockWrite(store, obj)) return obj;
    if (!obj.id) obj.id = uid(store.slice(0, 3));
    // Anything a team owns is stamped once, so no view has to remember to do it.
    if (TEAM_SCOPED.indexOf(store) >= 0 && !obj.teamId) obj.teamId = activeTeamId();
    // What a read-only member writes here is their own work, and stays theirs
    // to change or delete — the club's rows came down from the shared file.
    if (store !== 'settings' && window.Access && Access.readMode && Access.readMode()) {
      obj[Access.MEMBER_STAMP] = true;
    }
    obj.updatedAt = Date.now();
    await DB.put(store, obj);
    const arr = cache[store] || (cache[store] = []);
    const idx = arr.findIndex(x => x.id === obj.id);
    if (idx >= 0) arr[idx] = obj; else arr.push(obj);
    emit();
    return obj;
  }

  async function remove(store, id) {
    if (blockWrite(store, find(store, id))) return false;
    await DB.remove(store, id);
    cache[store] = (cache[store] || []).filter(x => x.id !== id);
    // Without this, a sync merges in whichever copy is still on Drive and the
    // deleted row comes right back — the tombstone is what tells a later sync
    // that the row is gone on purpose, not just missing from this device yet.
    if (store !== 'settings') await recordTombstone(store, id);
    emit();
    return true;
  }

  function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  function emit() { listeners.forEach(fn => fn()); }

  // ---- Settings ----
  async function getSetting(key, def) {
    const s = find('settings', key);
    return s ? s.value : def;
  }
  async function setSetting(key, value) {
    await save('settings', { id: key, value });
  }

  // ---- Deletion tombstones ------------------------------------------------
  // A delete only removes the row locally; a sync that merges by "newest
  // updatedAt wins" has no way to tell a stale remote copy from an intentional
  // delete, so the row it still has on Drive comes right back. A tombstone is a
  // record of when an id was deleted, kept as a shared setting so it travels
  // with the sync and other devices honour the delete too.
  const TOMBSTONE_KEY = 'tombstones';
  const TOMBSTONE_MAX_AGE = 90 * 864e5; // every device should have caught up by then
  function tombstones() {
    const s = find('settings', TOMBSTONE_KEY);
    return (s && s.value && typeof s.value === 'object') ? s.value : {};
  }
  async function recordTombstone(store, id) {
    const t = tombstones();
    const forStore = Object.assign({}, t[store], { [id]: Date.now() });
    await setSetting(TOMBSTONE_KEY, Object.assign({}, t, { [store]: forStore }));
  }
  // Union of both sides, newest deletedAt per id — a whole-row "newest wins"
  // merge would throw away whichever side lost the timestamp race entirely.
  function mergeTombstones(a, b) {
    const out = {};
    const now = Date.now();
    [a || {}, b || {}].forEach(map => {
      Object.keys(map).forEach(store => {
        const src = map[store] || {};
        const dst = out[store] || (out[store] = {});
        Object.keys(src).forEach(id => {
          const at = +src[id] || 0;
          if (now - at > TOMBSTONE_MAX_AGE) return;
          if (!dst[id] || at > dst[id]) dst[id] = at;
        });
      });
    });
    return out;
  }
  // Drops rows a tombstone says were deleted at or after they were last edited.
  function dropTombstoned(store, rows, tombs) {
    const t = (tombs || tombstones())[store];
    if (!t || !rows || !rows.length) return rows;
    return rows.filter(r => !(r && t[r.id] && t[r.id] >= (+r.updatedAt || 0)));
  }
  // Folds a remote settings block's tombstones into ours and persists the
  // union so a delete made on any device sticks after the next sync everywhere.
  async function syncTombstones(remoteSettingsRows) {
    let tombs = tombstones();
    const remoteRow = Array.isArray(remoteSettingsRows) && remoteSettingsRows.find(r => r && r.id === TOMBSTONE_KEY);
    if (remoteRow) {
      const merged = mergeTombstones(tombs, unpack(remoteRow.value));
      if (JSON.stringify(merged) !== JSON.stringify(tombs)) await setSetting(TOMBSTONE_KEY, merged);
      tombs = merged;
    }
    return tombs;
  }

  // ---- Statistics helpers ----
  const GOAL_TYPES = ['Fast Break', 'Backcourt Shot', 'Wing Shot', 'Pivot Shot', '7m Throw', 'Breakthrough'];
  function matchEvents(matchId) { return all('events').filter(e => e.matchId === matchId); }

  function teamStats(matchId) {
    const ev = matchEvents(matchId);
    const goals = ev.filter(e => e.result === 'goal').length;
    const shots = ev.filter(e => e.category === 'attack' && (e.result === 'goal' || e.result === 'miss' || e.result === 'save')).length;
    const assists = ev.filter(e => e.type === 'Assist').length;
    const turnovers = ev.filter(e => e.category === 'turnover').length;
    const fastbreaks = ev.filter(e => e.type === 'Fast Break').length;
    const saves = ev.filter(e => e.type === 'Save' || e.type === 'Penalty Save').length;
    const suspensions = ev.filter(e => e.type === '2-minute suspension').length;
    return {
      goals, shots, assists, turnovers, fastbreaks, saves, suspensions,
      shotPct: shots ? Math.round((goals / shots) * 100) : 0
    };
  }

  function playerStats(playerId) {
    const ev = all('events').filter(e => e.playerId === playerId);
    const goals = ev.filter(e => e.result === 'goal').length;
    const attempts = ev.filter(e => e.category === 'attack').length;
    const assists = ev.filter(e => e.type === 'Assist').length;
    const turnovers = ev.filter(e => e.category === 'turnover').length;
    const saves = ev.filter(e => e.type === 'Save' || e.type === 'Penalty Save').length;
    return {
      goals, attempts, assists, turnovers, saves,
      shotPct: attempts ? Math.round((goals / attempts) * 100) : 0,
      rating: Math.min(10, (goals * 1.2 + assists * 0.8 + saves * 1.0 - turnovers * 0.7 + 5)).toFixed(1)
    };
  }

  // Drills that earlier builds shipped with. The library now starts EMPTY —
  // a coach builds it from their own work or with the AI drill generator — so
  // these titles exist only to sweep the old seeded rows out on upgrade.
  const SEED_DRILL_TITLES = [
    '3v3 Continuous Attack', 'Goalkeeper Reaction Wall', 'Fast Break Waves', '6-0 Defensive Shifting', 'Goalkeeper Mobility Routine',
    'Interval Sprint Run', 'Quick Feet Program', 'Asymmetric Single-Leg Squat with Kettlebell', 'Lateral Squat', 'Lateral Band Sidewalk',
    'Lateral Jumps with Medicine Ball', 'Explosive Step-Up to Jump with Knee Drive', 'Explosive Step-Up to Overhead Grab', 'Handball Jumping',
    'Bulgarian Split Squat', 'Nordic Hamstrings', 'Nordic Hamstrings Alternative', 'Overhead Triceps Extension', 'Throwing Power Push',
    'Cable/Band Woodchop', 'Trapezius Band Training', 'Rotator Cuff Training', 'Single-Arm Chest Press', 'Landmine Press', 'Rotational Plank',
    'Core Hip Drill', 'Arm Pull', 'Pull with Lateral Movement', 'Back Squat 5x5', 'Deadlift 5x3', 'Clean & Jerk Technique', 'Snatch Progression',
    'Pull-Up & Muscle-Up Ladder', 'Handstand & Wall Walk', 'Cindy (AMRAP 20)', 'Fran (21-15-9)', 'EMOM Engine Builder', 'Rowing Intervals 500 m',
    'Shoulder & Hip Mobility Flow', 'Post-Session Recovery', 'Barbell Bench Press', 'Incline Dumbbell Press', 'Barbell Row', 'Lat Pulldown & Pull-Up',
    'Overhead Press', 'Lateral Raise Triple Set', 'Barbell Curl & Skullcrusher', 'Back Squat Hypertrophy', 'Romanian Deadlift', 'Leg Press & Calf Raise',
    'Core Circuit', 'Steady-State Cardio'
  ];

  // Matches earlier builds shipped with. A season now starts empty, so these two
  // exist only to sweep the old seeded rows out on upgrade.
  const SEED_MATCHES = [
    { opponent: 'Rhein Löwen', venue: 'City Arena', homeScore: 28, awayScore: 25 },
    { opponent: 'Nord Sturm', venue: 'North Hall', homeScore: 0, awayScore: 0 }
  ];

  // The demo club earlier builds opened with. Nothing is invented any more —
  // the club, its squads and everything in them are the coach's own — so these
  // names exist only to sweep the old rows out on upgrade.
  const SEED_CLUB = 'Metropolis HC';
  const SEED_SEASON = '2024/2025';
  const SEED_TEAM = 'Metropolis Men A';
  const SEED_COACHES = ['Heinrich Vogel', 'Lukas Bauer', 'Mia Wolf'];
  const SEED_SESSION = 'Strength & Agility';
  const SEED_OPPONENTS = ['Rhein Löwen', 'Nord Sturm'];

  // One-time cleanup: remove the old built-in demo players (and their events)
  // from installs that were seeded before demo players were dropped.
  async function purgeDemoPlayers() {
    if (await getSetting('demoPurged', false)) return;
    const demo = [
      ['Jonas', 'Keller', 1], ['Milan', 'Horvat', 12], ['Erik', 'Sandberg', 7], ['Tomas', 'Novak', 4],
      ['Andre', 'Costa', 10], ['Petar', 'Ilic', 9], ['Leon', 'Fischer', 22], ['Marko', 'Babic', 44],
      ['Nils', 'Berg', 6], ['Sven', 'Ott', 15], ['David', 'Krause', 8], ['Ivan', 'Peric', 11]
    ];
    const isDemo = p => demo.some(d => d[0] === p.firstName && d[1] === p.lastName && +d[2] === +p.number);
    const victims = all('players').filter(isDemo);
    if (victims.length) {
      const ids = victims.map(p => p.id);
      for (const p of victims) await DB.remove('players', p.id);
      for (const e of all('events').filter(e => ids.indexOf(e.playerId) >= 0)) await DB.remove('events', e.id);
      await loadAll();
    }
    await setSetting('demoPurged', true);
  }

  // One-time upgrade: the app no longer ships a drill library, so every drill an
  // earlier build seeded is removed and its id stripped out of the plans that
  // used it. A drill the coach edited or wrote themselves is left alone.
  async function purgeSeedDrills() {
    if (await getSetting('drillsNoneV1', false)) return;
    const victims = all('exercises').filter(e => SEED_DRILL_TITLES.indexOf(e.title) >= 0);
    if (victims.length) {
      const ids = victims.map(e => e.id);
      for (const e of victims) await DB.remove('exercises', e.id);
      for (const s of all('training')) {
        const keep = (s.exercises || []).filter(id => ids.indexOf(id) < 0);
        if (keep.length !== (s.exercises || []).length) await DB.put('training', Object.assign({}, s, { exercises: keep }));
      }
      await loadAll();
    }
    await setSetting('drillsNoneV1', true);
  }

  // One-time upgrade: the app no longer ships demo matches. A seeded row the
  // coach has since scouted or rewritten is left alone — only an untouched one
  // goes, so nobody loses a season they actually played.
  async function purgeSeedMatches() {
    if (await getSetting('matchesNoneV1', false)) return;
    const scouted = new Set(all('events').map(e => e.matchId));
    const victims = all('matches').filter(m => !scouted.has(m.id) && SEED_MATCHES.some(s =>
      s.opponent === m.opponent && s.venue === m.venue
      && +s.homeScore === +m.homeScore && +s.awayScore === +m.awayScore));
    if (victims.length) {
      for (const m of victims) await DB.remove('matches', m.id);
      await loadAll();
    }
    await setSetting('matchesNoneV1', true);
  }

  // One-time upgrade: the demo club goes, so the team picker shows the coach's
  // own squad instead of a made-up one. It only goes if it was never used — a
  // single player, match or session of their own and the whole club stays.
  async function purgeSeedClub() {
    if (await getSetting('clubNoneV1', false)) return;
    const team = all('teams').find(t => t.name === SEED_TEAM);
    if (team) {
      const owns = s => all(s).filter(r => r.teamId === team.id);
      const staff = owns('coaches');
      const sessions = owns('training');
      // The two demo opponents were handed to this team by an earlier upgrade,
      // so they count as part of the demo club rather than as work of its own.
      const foes = all('opponents').filter(o => !o.teamId || o.teamId === team.id);
      const untouched = !owns('players').length && !owns('matches').length && !owns('personal').length
        && !owns('planner').length && !owns('tactics').length && !owns('videos').length
        && staff.every(c => SEED_COACHES.indexOf(c.name) >= 0)
        && sessions.every(s => s.title === SEED_SESSION && !(s.exercises || []).length)
        && owns('opponents').every(o => SEED_OPPONENTS.indexOf(o.name) >= 0);
      if (untouched) {
        for (const c of staff) await DB.remove('coaches', c.id);
        for (const s of sessions) await DB.remove('training', s.id);
        for (const o of foes.filter(o => SEED_OPPONENTS.indexOf(o.name) >= 0)) await DB.remove('opponents', o.id);
        await DB.remove('teams', team.id);
        // The club and season are only theirs while no other squad uses them.
        const orphan = id => id && !all('teams').some(t => t.id !== team.id && (t.clubId === id || t.seasonId === id));
        const season = all('seasons').find(s => s.id === team.seasonId && s.name === SEED_SEASON);
        if (season && orphan(season.id)) await DB.remove('seasons', season.id);
        const club = all('clubs').find(c => c.id === team.clubId && c.name === SEED_CLUB);
        if (club && orphan(club.id)) await DB.remove('clubs', club.id);
        await loadAll();
      }
    }
    await setSetting('clubNoneV1', true);
  }

  // ---- Sport-bound squads ------------------------------------------------
  // A player is registered under the sport that was active when the card was
  // created, so switching sport shows only that squad.
  const sportNow = () => (typeof window !== 'undefined' && window.App && App.getSport ? App.getSport() : 'handball');

  // ---- Multiple teams ----------------------------------------------------
  // A club can run several squads side by side. The active team is a device
  // preference (localStorage, per sport) rather than a settings row, because
  // players()/matches() are synchronous and getSetting is not.
  const K_TEAM = 'stx_team_';
  const TEAM_SCOPED = ['players', 'coaches', 'matches', 'opponents', 'training', 'personal', 'planner'];
  function teams() {
    const s = sportNow();
    const list = all('teams').filter(t => !t.sport || t.sport === s);
    // A player copy that joined with one squad's own password sees that squad
    // and no other — every team-scoped read runs through here.
    const lock = (typeof window !== 'undefined' && window.Access && Access.teamLock) ? Access.teamLock() : '';
    return lock ? list.filter(t => t.id === lock) : list;
  }
  function activeTeam() {
    const list = teams();
    let id = '';
    try { id = localStorage.getItem(K_TEAM + sportNow()) || ''; } catch { /* private mode */ }
    return list.find(t => t.id === id) || list[0] || null;
  }
  function activeTeamId() { const t = activeTeam(); return t ? t.id : ''; }
  function setActiveTeam(id) {
    try { localStorage.setItem(K_TEAM + sportNow(), id || ''); } catch { /* private mode */ }
    emit();
  }
  // Everything a team owns is filtered through here, so one squad never sees
  // another squad's matches, opponents or training.
  function scoped(store, teamId) {
    const tid = teamId === undefined ? activeTeamId() : teamId;
    if (!tid) return all(store);
    return all(store).filter(r => r.teamId === tid);
  }
  const matches = teamId => scoped('matches', teamId);
  const coaches = teamId => scoped('coaches', teamId);
  // One-time upgrade: rows made before teams were separated are handed to the
  // first team of their sport, so nothing disappears after the update.
  async function stampTeamScope() {
    if (!(await getSetting('teamScopeV1', false))) {
      const first = teams()[0];
      if (first) {
        for (const s of TEAM_SCOPED) {
          const rows = all(s).filter(r => !r.teamId).map(r => Object.assign({}, r, { teamId: first.id }));
          if (rows.length) await DB.bulkPut(s, rows);
        }
        const noSport = all('teams').filter(t => !t.sport).map(t => Object.assign({}, t, { sport: sportNow() }));
        if (noSport.length) await DB.bulkPut('teams', noSport);
        await loadAll();
      }
      await setSetting('teamScopeV1', true);
    }
    // The event planner became team-scoped after V1 had already run on most
    // devices, so its events sat there with no squad — and scoped() hides every
    // one of them the moment a squad is active, on this device and on every
    // copy that syncs them.
    if (!(await getSetting('teamScopeV2', false))) {
      await adoptUnscoped(true);
      await setSetting('teamScopeV2', true);
    }
  }

  // A row that comes down from the shared file without a squad of its own is
  // filtered out by scoped() and would never be seen again, so it joins the
  // squad this device works with. `touch` bumps updatedAt so the repair also
  // wins its way into the shared file; without it the stamp stays local.
  async function adoptUnscoped(touch) {
    const lock = (typeof window !== 'undefined' && window.Access && Access.teamLock) ? Access.teamLock() : '';
    const tid = lock || activeTeamId();
    if (!tid) return 0;
    let n = 0;
    for (const s of TEAM_SCOPED) {
      const rows = all(s).filter(r => !r.teamId)
        .map(r => Object.assign({}, r, touch ? { teamId: tid, updatedAt: Date.now() } : { teamId: tid }));
      if (rows.length) { await DB.bulkPut(s, rows); n += rows.length; }
    }
    if (n) await loadAll();
    return n;
  }

  // players()        -> the active team's players, current sport only
  // players(teamId)  -> that team's players, current sport only
  function players(teamId) {
    const s = sportNow();
    const tid = teamId === undefined ? activeTeamId() : teamId;
    return all('players').filter(p => (!p.sport || p.sport === s) && (!tid || p.teamId === tid));
  }
  // One-time upgrade: squads created before this rule keep the sport in use, so
  // nobody disappears from the app after the update.
  async function stampSquadSport(sportId) {
    if (await getSetting('squadSportV1', false)) return;
    const rows = all('players').filter(p => !p.sport).map(p => Object.assign({}, p, { sport: sportId }));
    if (rows.length) { await DB.bulkPut('players', rows); await loadAll(); }
    await setSetting('squadSportV1', true);
  }

  // ---- Share packs -------------------------------------------------------
  // A pack is one module exported on its own, so a coach can hand a teammate
  // just the drill library, the training plan or the tactical board.
  // Blobs are base64-encoded because JSON.stringify turns a Blob into `{}`.
  const blobToB64 = blob => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] || '');
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
  function b64ToBlob(b64, type) {
    const bin = atob(b64), u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return new Blob([u8], { type: type || 'application/octet-stream' });
  }
  // A blank carries no information but still costs its key on every row, and a
  // squad has a lot of optional fields nobody filled in. Dropping them makes a
  // shared file markedly smaller for free: a key that is not there reads back as
  // undefined, which is what an empty one meant anyway, and merging replaces
  // whole rows by id so clearing a field still travels.
  // false and 0 are answers, not blanks — those stay.
  const isBlank = v => v === undefined || v === null || v === ''
    || (Array.isArray(v) && !v.length);
  // Blob references sourced from IndexedDB can go stale (a phone reclaiming
  // memory in the background is the usual trigger) — reading them then throws
  // a bare browser NotFoundError ("the object can not be found here"), which
  // used to take the ENTIRE sync down with it. One unreadable photo/thumbnail
  // now just drops out of the pack instead of blocking every other row.
  async function packBlob(v, asBuffer) {
    try { return { __blob: 1, type: asBuffer ? '' : v.type, size: asBuffer ? v.byteLength : v.size, data: await blobToB64(asBuffer ? new Blob([v]) : v) }; }
    catch (e) { return null; }
  }
  async function pack(v) {
    if (v == null || typeof v !== 'object') return v;
    if (v instanceof Blob) return await packBlob(v, false);
    if (v instanceof ArrayBuffer) return await packBlob(v, true);
    if (v instanceof Date) return { __date: 1, iso: v.toISOString() };
    if (Array.isArray(v)) { const out = []; for (const x of v) out.push(await pack(x)); return out; }
    const out = {};
    for (const k of Object.keys(v)) {
      if (isBlank(v[k])) continue;
      const packed = await pack(v[k]);
      if (packed !== null) out[k] = packed;
    }
    return out;
  }
  // Keys that are not data. JSON.parse happily produces an own "__proto__"
  // property, and copying it onto a plain object with = or Object.assign runs
  // the inherited setter instead — which is how a shared file or a mailed
  // backup gets to choose the prototype of every row it brings with it.
  const UNSAFE_KEY = k => k === '__proto__' || k === 'constructor' || k === 'prototype';
  function unpack(v) {
    if (v == null || typeof v !== 'object') return v;
    if (v.__blob) return b64ToBlob(v.data || '', v.type);
    if (v.__date) return new Date(v.iso);
    if (Array.isArray(v)) return v.map(unpack);
    const out = {};
    for (const k of Object.keys(v)) { if (!UNSAFE_KEY(k)) out[k] = unpack(v[k]); }
    return out;
  }
  // A file that arrives from outside decides how many rows it hands over, so
  // the ceiling is set here rather than by whoever wrote the file.
  const MAX_ROWS_PER_STORE = 200000;
  // A training plan is useless without the drills it points at, so it takes both.
  const PACK_STORES = {
    exercises: ['exercises'], training: ['training', 'exercises'], tactics: ['tactics'],
    personal: ['personal'], opponents: ['opponents'],
    matches: ['matches', 'events'], planner: ['planner'],
    // The whole Training Planner page in one file: sessions, the drills they use,
    // and personal training & max tests — Status & progression is a chart drawn
    // from these same personal rows, so it travels with them for free.
    trainingPlanner: ['training', 'exercises', 'personal'],
    // The team record comes first so the club and season it points at can be found.
    team: ['teams', 'clubs', 'seasons', 'players', 'coaches'],
    stats: ['players', 'matches', 'events'], video: ['videos']
  };
  // A team pack carries its own team record, so its rows must keep the teamId
  // they arrive with instead of being re-stamped onto the active squad.
  const SELF_TEAM = ['team'];
  function packKinds() { return Object.keys(PACK_STORES); }
  // opts.teamId narrows the file to ONE squad: team-scoped stores are filtered
  // on teamId, and the events store follows the matches that survived.
  async function exportPack(kind, opts) {
    const stores = PACK_STORES[kind];
    if (!stores) throw new Error('unknown pack');
    const teamId = opts && opts.teamId;
    const data = {};
    let keep = null;
    let mine = null;
    for (const s of stores) {
      let rows = await DB.getAll(s);
      // The plan on screen is what this squad owns AND what other squads handed
      // it, so an "export what I see" backup follows the same rule — a strict
      // ownership filter would silently export nothing for a squad that mostly
      // looks at events other squads shared in.
      if (teamId && s === 'planner') rows = rows.filter(r => !r.teamId || r.teamId === teamId
        || r.allTeams || (Array.isArray(r.teams) && r.teams.indexOf(teamId) >= 0));
      else if (teamId && TEAM_SCOPED.indexOf(s) >= 0) rows = rows.filter(r => r.teamId === teamId);
      if (teamId && s === 'teams') { rows = rows.filter(r => r.id === teamId); mine = rows; }
      if (mine && (s === 'clubs' || s === 'seasons')) {
        const want = new Set(mine.map(t => s === 'clubs' ? t.clubId : t.seasonId).filter(Boolean));
        rows = rows.filter(r => want.has(r.id));
      }
      if (s === 'matches') keep = new Set(rows.map(r => r.id));
      if (s === 'events' && keep) rows = rows.filter(r => keep.has(r.matchId));
      data[s] = await pack(rows);
    }
    return { app: 'SportTactic', pack: kind, format: 1, exportedAt: new Date().toISOString(), teamId: teamId || '', stores, data };
  }
  // Rows are merged by id: re-importing the same file updates instead of duplicating.
  // opts.teamId re-stamps every team-scoped row, so a file from another club
  // lands in the squad you are looking at instead of disappearing.
  async function importPack(kind, dump, opts) {
    const stores = PACK_STORES[kind];
    if (!stores) throw new Error('unknown pack');
    // bulkPut goes straight to the database, so the read-only lock is checked here.
    if (blockWrite(stores[0])) throw new Error('read-only');
    const teamId = opts && opts.teamId;
    const data = (dump && typeof dump.data === 'object' && dump.data) || dump || {};
    let n = 0;
    for (const s of stores) {
      if (!Array.isArray(data[s])) continue;
      if (data[s].length > MAX_ROWS_PER_STORE) throw new Error('too many records in ' + s);
      let rows = unpack(data[s]).filter(r => r && typeof r === 'object' && typeof r.id === 'string');
      if (teamId && SELF_TEAM.indexOf(kind) < 0 && TEAM_SCOPED.indexOf(s) >= 0) rows = rows.map(r => Object.assign({}, r, { teamId }));
      if (!rows.length) continue;
      await DB.bulkPut(s, rows);
      n += rows.length;
    }
    if (!n) throw new Error('nothing to import');
    await loadAll();
    return n;
  }

  return {
    uid, loadAll, all, find, save, remove, onChange,
    locked, lockInfo, setLock,
    getSetting, setSetting, teamStats, playerStats, matchEvents,
    purgeDemoPlayers, purgeSeedDrills, purgeSeedMatches, purgeSeedClub,
    players, stampSquadSport,
    teams, activeTeam, activeTeamId, setActiveTeam, scoped, matches, coaches, stampTeamScope, adoptUnscoped,
    pack, unpack, packKinds, exportPack, importPack, GOAL_TYPES,
    tombstones, mergeTombstones, dropTombstoned, syncTombstones
  };
})();
