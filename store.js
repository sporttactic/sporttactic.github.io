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

  function all(store) { return cache[store] || []; }
  function find(store, id) { return (cache[store] || []).find(x => x.id === id); }

  async function save(store, obj) {
    if (!obj.id) obj.id = uid(store.slice(0, 3));
    // Anything a team owns is stamped once, so no view has to remember to do it.
    if (TEAM_SCOPED.indexOf(store) >= 0 && !obj.teamId) obj.teamId = activeTeamId();
    obj.updatedAt = Date.now();
    await DB.put(store, obj);
    const arr = cache[store] || (cache[store] = []);
    const idx = arr.findIndex(x => x.id === obj.id);
    if (idx >= 0) arr[idx] = obj; else arr.push(obj);
    emit();
    return obj;
  }

  async function remove(store, id) {
    await DB.remove(store, id);
    cache[store] = (cache[store] || []).filter(x => x.id !== id);
    emit();
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

  // Default drill library — functional strength, agility & running programme.
  // The club's own clips lived on a private Google Drive that asks every viewer
  // to sign in, so each drill instead links to a YouTube search that always works.
  const YT = q => 'https://www.youtube.com/results?search_query=' + encodeURIComponent(q);
  const REPS = '5 sets x 10 reps per exercise, 60 s rest between exercises.';
  const DEFAULT_DRILLS = [
    { title: 'Goalkeeper Mobility Routine', category: 'Goalkeeper', duration: 10, intensity: 'Medium', tags: ['mobility', 'goalkeeper', 'warm-up'], muscles: ['shoulders', 'hipflexors', 'adductors', 'lowerback'], videoYt: YT('handball goalkeeper mobility routine'), description: 'Mobility work for handball goalkeepers: hips, shoulders and spine. Run it before shot training so the keeper can reach the corners without forcing the joints.' },
    { title: 'Interval Sprint Run', category: 'Conditioning', duration: 20, intensity: 'High', tags: ['running', 'intervals', 'endurance'], muscles: ['quads', 'hamstrings', 'glutes', 'calves'], videoYt: YT('interval sprint running workout'), description: '1 km warm-up, then 20 minutes of intervals: sprint past three lamp posts, jog easy past the next three. No lamp posts? Sprint the long sides of a football pitch and jog the short ones.' },
    { title: 'Quick Feet Program', category: 'Conditioning', duration: 10, intensity: 'High', tags: ['agility', 'footwork', 'speed'], muscles: ['calves', 'quads', 'hipflexors'], videoYt: YT('quick feet agility ladder drills'), description: 'Finish every interval run with 10 minutes of quick-feet work. Build the course with whatever gear you have — cones, sticks or lines on the floor.' },
    { title: 'Asymmetric Single-Leg Squat with Kettlebell', category: 'Conditioning', duration: 12, intensity: 'Medium', tags: ['legs', 'balance', 'core'], muscles: ['quads', 'glutes', 'abs', 'obliques'], videoYt: YT('single leg squat kettlebell offset load'), description: 'Single-leg squat with the load on one side only. Challenges stability, balance and muscle control, and trains core and legs in particular. ' + REPS },
    { title: 'Lateral Squat', category: 'Conditioning', duration: 12, intensity: 'Medium', tags: ['legs', 'hips', 'mobility'], muscles: ['adductors', 'glutes', 'quads'], videoYt: YT('lateral squat side squat technique'), description: 'Squat sideways over a wide stance, optionally holding a kettlebell or dumbbell. Strengthens legs, hips and core while improving stability, mobility and body control in sideways movement. ' + REPS },
    { title: 'Lateral Band Sidewalk', category: 'Conditioning', duration: 8, intensity: 'Low', tags: ['hips', 'glutes', 'stability'], muscles: ['glutes', 'adductors', 'hipflexors'], videoYt: YT('lateral band walk glute exercise'), description: 'Walk sideways with a resistance band around the legs, 2 m to each side. Strengthens the small stabilising muscles around hips, glutes and thighs. ' + REPS },
    { title: 'Lateral Jumps with Medicine Ball', category: 'Conditioning', duration: 12, intensity: 'High', tags: ['power', 'legs', 'balance'], muscles: ['quads', 'glutes', 'calves', 'obliques'], videoYt: YT('lateral jumps with medicine ball'), description: 'Explosive sideways jumps holding a medicine ball. Combines power, coordination and stability in one functional exercise for legs, core and balance. ' + REPS },
    { title: 'Explosive Step-Up to Jump with Knee Drive', category: 'Conditioning', duration: 12, intensity: 'High', tags: ['explosiveness', 'legs', 'acceleration'], muscles: ['quads', 'glutes', 'hipflexors', 'calves'], videoYt: YT('explosive step up jump knee drive'), description: 'Step up and jump with a hard knee drive while a band pulls you backwards. The resistance forces an aggressive forward lean and more power in every push-off. ' + REPS },
    { title: 'Explosive Step-Up to Overhead Grab', category: 'Conditioning', duration: 12, intensity: 'High', tags: ['power', 'jump', 'coordination'], muscles: ['quads', 'glutes', 'calves', 'shoulders'], videoYt: YT('step up jump overhead reach exercise'), description: 'Turn a powerful one-legged push-off into maximum jump height and grab the bar or plate at the top. Mirrors the handball jump shot by combining explosive legs with coordination and reach. ' + REPS },
    { title: 'Handball Jumping', category: 'Conditioning', duration: 12, intensity: 'High', tags: ['jump', 'timing', 'explosiveness'], muscles: ['quads', 'glutes', 'calves'], videoYt: YT('handball jump shot plyometric training'), description: 'Jump series that trains explosiveness, jump height, coordination and timing — directly transferable to game situations, above all the jump shot. ' + REPS },
    { title: 'Bulgarian Split Squat', category: 'Conditioning', duration: 12, intensity: 'Medium', tags: ['legs', 'balance', 'prevention'], muscles: ['quads', 'glutes', 'hamstrings'], videoYt: YT('bulgarian split squat technique'), description: 'Rear foot elevated split squat. One of the most effective single-leg exercises for balance, mobility and stability, and a real gamechanger for both strength and injury prevention. ' + REPS },
    { title: 'Nordic Hamstrings', category: 'Conditioning', duration: 10, intensity: 'High', tags: ['hamstrings', 'prevention', 'legs'], muscles: ['hamstrings', 'glutes', 'lowerback'], videoYt: YT('nordic hamstring curl technique'), description: 'Lower yourself slowly with the ankles held down. Extremely effective for the hamstrings, both for performance and for preventing ACL and muscle tears. Can also be done lying on your back with two cloths under the feet, pushing out and pulling back. ' + REPS },
    { title: 'Nordic Hamstrings Alternative', category: 'Conditioning', duration: 10, intensity: 'Medium', tags: ['hamstrings', 'prevention'], muscles: ['hamstrings', 'glutes'], videoYt: YT('nordic hamstring alternative slider curl'), description: 'Alternative to the Nordic hamstring curl when you have no partner or bench — same target muscles, lower entry level. ' + REPS },
    { title: 'Overhead Triceps Extension', category: 'Conditioning', duration: 10, intensity: 'Medium', tags: ['triceps', 'throwing', 'arms'], muscles: ['triceps', 'shoulders'], videoYt: YT('overhead triceps extension technique'), description: 'Strengthens the triceps, which plays a key role in throwing, passing and shooting — particularly relevant for handball players. ' + REPS },
    { title: 'Throwing Power Push', category: 'Conditioning', duration: 10, intensity: 'Medium', tags: ['throwing', 'shoulder', 'power'], muscles: ['chest', 'triceps', 'shoulders'], videoYt: YT('handball throwing power exercise band'), description: 'Builds throwing power in handball. Coaching point: keep the elbow in close to the body as the ball is pushed away. ' + REPS },
    { title: 'Cable/Band Woodchop', category: 'Conditioning', duration: 10, intensity: 'Medium', tags: ['core', 'rotation', 'power'], muscles: ['obliques', 'abs', 'shoulders'], videoYt: YT('cable woodchop core exercise'), description: 'Standing rotational pull. A functional power exercise for the core that trains explosive rotation and resistance to twist — the key to a harder shot, better balance in duels and prevention of back and shoulder injuries. ' + REPS },
    { title: 'Trapezius Band Training', category: 'Conditioning', duration: 8, intensity: 'Low', tags: ['shoulder', 'posture', 'prevention'], muscles: ['traps', 'neck', 'shoulders'], videoYt: YT('trapezius resistance band exercise'), description: 'Band work for the trapezius, the shoulder brake muscle. Strengthens the neck and shoulder area, improves posture and stability and prevents injuries where the upper body is loaded by throwing and contact. ' + REPS },
    { title: 'Rotator Cuff Training', category: 'Conditioning', duration: 8, intensity: 'Low', tags: ['shoulder', 'prevention', 'stability'], muscles: ['shoulders', 'traps'], videoYt: YT('rotator cuff band exercises'), description: 'Training the stabilising muscles of the shoulder is essential for keeping shoulder function and mobility and for preventing injuries. Light load, controlled tempo. ' + REPS },
    { title: 'Single-Arm Chest Press', category: 'Conditioning', duration: 10, intensity: 'Medium', tags: ['chest', 'shoulder', 'core'], muscles: ['chest', 'shoulders', 'triceps', 'abs'], videoYt: YT('single arm dumbbell chest press'), description: 'One-arm press with a kettlebell or dumbbell for shoulder and chest. Adds variation, increases muscle activation and corrects upper-body imbalances while challenging stability and core control. ' + REPS },
    { title: 'Landmine Press', category: 'Conditioning', duration: 10, intensity: 'Medium', tags: ['shoulder', 'core', 'chest'], muscles: ['shoulders', 'chest', 'abs'], videoYt: YT('landmine press technique'), description: 'Combines shoulder strength with core stability in a joint-friendly, very functional press — a good variation when you want to get away from the barbell or dumbbell. ' + REPS },
    { title: 'Rotational Plank', category: 'Conditioning', duration: 8, intensity: 'Medium', tags: ['core', 'stability', 'mobility'], muscles: ['abs', 'obliques', 'shoulders'], videoYt: YT('rotational plank exercise'), description: 'Plank with a switch between left and right rotation. Trains core strength, stability and mobility while improving coordination and control in both upper and lower body. ' + REPS },
    { title: 'Core Hip Drill', category: 'Conditioning', duration: 10, intensity: 'Medium', tags: ['core', 'hips', 'shoulder'], muscles: ['abs', 'hipflexors', 'glutes', 'shoulders'], videoYt: YT('core hip stability drill resistance band'), description: 'Advanced drill that combines static stability with dynamic power. Keeps the upper body still while the legs move, exactly like a shot or a feint; the band loads hip flexors and glutes for acceleration and sideways defensive movement, and the support arm builds shoulder stability. ' + REPS },
    { title: 'Arm Pull', category: 'Conditioning', duration: 10, intensity: 'Medium', tags: ['arms', 'back', 'pull'], muscles: ['lats', 'biceps', 'forearms', 'shoulders'], videoYt: YT('inverted row arm pull exercise'), description: 'Simple pull where you increase the load by going further down, so more force is needed to pull yourself up. Strengthens arms, shoulders and back and builds the stability and coordination that throwing and passing need. ' + REPS },
    { title: 'Pull with Lateral Movement', category: 'Conditioning', duration: 10, intensity: 'Medium', tags: ['back', 'shoulder', 'core'], muscles: ['lats', 'shoulders', 'obliques', 'biceps'], videoYt: YT('single arm row with lateral movement'), description: 'Pull combined with a sideways movement. Strengthens shoulders, back and core while improving the lateral stability and coordination handball demands. ' + REPS }
  ];
  // Titles of the drills that shipped before the default library existed.
  const OLD_DEMO_DRILLS = ['3v3 Continuous Attack', 'Goalkeeper Reaction Wall', 'Fast Break Waves', '6-0 Defensive Shifting'];

  async function seedIfEmpty() {
    if (all('clubs').length) return;
    const club = { id: uid('clu'), name: 'Metropolis HC', country: 'Germany', founded: 1974 };
    const season = { id: uid('sea'), name: '2024/2025', clubId: club.id, active: true };
    const team = { id: uid('tea'), name: 'Metropolis Men A', clubId: club.id, seasonId: season.id, division: 'Bundesliga', category: 'Senior Men' };
    await DB.bulkPut('clubs', [club]);
    await DB.bulkPut('seasons', [season]);
    await DB.bulkPut('teams', [team]);

    // Demo players removed — the roster starts empty so coaches add their own squad.
    const coaches = [
      { id: uid('coa'), teamId: team.id, name: 'Heinrich Vogel', role: 'Head Coach' },
      { id: uid('coa'), teamId: team.id, name: 'Lukas Bauer', role: 'Assistant Coach' },
      { id: uid('coa'), teamId: team.id, name: 'Mia Wolf', role: 'Goalkeeper Coach' }
    ];
    await DB.bulkPut('coaches', coaches);

    const opponents = [
      { id: uid('opp'), name: 'Rhein Löwen', formation: '6-0', tendencies: 'Strong pivot play, slow transitions', keyPlayers: 'No. 10 (playmaker), No. 44 (pivot)' },
      { id: uid('opp'), name: 'Nord Sturm', formation: '5-1', tendencies: 'Fast breaks, aggressive defense', keyPlayers: 'No. 7 (left wing sprinter)' }
    ];
    await DB.bulkPut('opponents', opponents);

    const matches = [
      { id: uid('mat'), teamId: team.id, opponent: 'Rhein Löwen', date: Date.now() - 6 * 864e5, type: 'League', venue: 'City Arena', home: true, homeScore: 28, awayScore: 25, status: 'finished' },
      { id: uid('mat'), teamId: team.id, opponent: 'Nord Sturm', date: Date.now() + 3 * 864e5, type: 'League', venue: 'North Hall', home: false, homeScore: 0, awayScore: 0, status: 'scheduled' }
    ];
    await DB.bulkPut('matches', matches);

    const exercises = DEFAULT_DRILLS.map(d => Object.assign({ id: uid('exe') }, d));
    await DB.bulkPut('exercises', exercises);

    const training = [
      { id: uid('trn'), teamId: team.id, title: 'Strength & Agility', date: Date.now() + 864e5, duration: 60, focus: 'Physical', exercises: exercises.slice(0, 3).map(e => e.id) }
    ];
    await DB.bulkPut('training', training);

    await loadAll();
  }

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

  // One-time upgrade: drop the four demo drills and install the real default
  // library (functional strength, agility & running) with its video links.
  async function installDefaultDrills() {
    if (await getSetting('drillsV2', false)) return;
    let touched = false;
    const victims = all('exercises').filter(e => OLD_DEMO_DRILLS.indexOf(e.title) >= 0);
    if (victims.length) {
      const ids = victims.map(e => e.id);
      for (const e of victims) await DB.remove('exercises', e.id);
      for (const s of all('training')) {
        const keep = (s.exercises || []).filter(id => ids.indexOf(id) < 0);
        if (keep.length !== (s.exercises || []).length) await DB.put('training', Object.assign({}, s, { exercises: keep }));
      }
      touched = true;
    }
    const have = new Set(all('exercises').map(e => e.title));
    const add = DEFAULT_DRILLS.filter(d => !have.has(d.title)).map(d => Object.assign({ id: uid('exe') }, d));
    if (add.length) { await DB.bulkPut('exercises', add); touched = true; }
    if (touched) await loadAll();
    await setSetting('drillsV2', true);
  }

  // One-time repair: the first default library pointed at a private Google Drive
  // that asks every viewer to sign in. Swap those dead links for the working ones
  // and add the muscle groups each default drill trains.
  async function repairDrillLinks() {
    if (await getSetting('drillsV4', false)) return;
    const isDead = (u) => {
      try { return /(^|\.)drive\.google\.com$/i.test(new URL(String(u)).hostname); }
      catch { return false; }
    };
    const byTitle = new Map(DEFAULT_DRILLS.map(d => [d.title, d]));
    const fixed = [];
    for (const e of all('exercises')) {
      const def = byTitle.get(e.title);
      if (!def) continue;
      const next = Object.assign({}, e, {
        videoUrl: isDead(e.videoUrl) ? '' : (e.videoUrl || ''),
        videoYt: e.videoYt || def.videoYt,
        muscles: (e.muscles && e.muscles.length) ? e.muscles : def.muscles.slice()
      });
      if (next.videoUrl !== e.videoUrl || next.videoYt !== e.videoYt || next.muscles !== e.muscles) fixed.push(next);
    }
    if (fixed.length) { await DB.bulkPut('exercises', fixed); await loadAll(); }
    await setSetting('drillsV4', true);
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
  const TEAM_SCOPED = ['players', 'coaches', 'matches', 'opponents', 'training', 'personal'];
  function teams() {
    const s = sportNow();
    return all('teams').filter(t => !t.sport || t.sport === s);
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
    if (await getSetting('teamScopeV1', false)) return;
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
  async function pack(v) {
    if (v == null || typeof v !== 'object') return v;
    if (v instanceof Blob) return { __blob: 1, type: v.type, size: v.size, data: await blobToB64(v) };
    if (v instanceof ArrayBuffer) return { __blob: 1, type: '', size: v.byteLength, data: await blobToB64(new Blob([v])) };
    if (v instanceof Date) return { __date: 1, iso: v.toISOString() };
    if (Array.isArray(v)) { const out = []; for (const x of v) out.push(await pack(x)); return out; }
    const out = {};
    for (const k of Object.keys(v)) out[k] = await pack(v[k]);
    return out;
  }
  function unpack(v) {
    if (v == null || typeof v !== 'object') return v;
    if (v.__blob) return b64ToBlob(v.data || '', v.type);
    if (v.__date) return new Date(v.iso);
    if (Array.isArray(v)) return v.map(unpack);
    const out = {};
    for (const k of Object.keys(v)) out[k] = unpack(v[k]);
    return out;
  }
  // A training plan is useless without the drills it points at, so it takes both.
  const PACK_STORES = {
    exercises: ['exercises'], training: ['training', 'exercises'], tactics: ['tactics'],
    personal: ['personal'], opponents: ['opponents']
  };
  function packKinds() { return Object.keys(PACK_STORES); }
  async function exportPack(kind) {
    const stores = PACK_STORES[kind];
    if (!stores) throw new Error('unknown pack');
    const data = {};
    for (const s of stores) data[s] = await pack(await DB.getAll(s));
    return { app: 'SportTactic', pack: kind, format: 1, exportedAt: new Date().toISOString(), stores, data };
  }
  // Rows are merged by id: re-importing the same file updates instead of duplicating.
  async function importPack(kind, dump) {
    const stores = PACK_STORES[kind];
    if (!stores) throw new Error('unknown pack');
    const data = (dump && typeof dump.data === 'object' && dump.data) || dump || {};
    let n = 0;
    for (const s of stores) {
      if (!Array.isArray(data[s])) continue;
      const rows = unpack(data[s]).filter(r => r && typeof r === 'object' && typeof r.id === 'string');
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
    getSetting, setSetting, teamStats, playerStats, matchEvents,
    seedIfEmpty, purgeDemoPlayers, installDefaultDrills, repairDrillLinks,
    players, stampSquadSport,
    teams, activeTeam, activeTeamId, setActiveTeam, scoped, matches, coaches, stampTeamScope,
    pack, unpack, packKinds, exportPack, importPack, GOAL_TYPES
  };
})();
