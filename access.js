/* access.js — who may do what.

   The app already stored a role string ('Coach', 'Player', …) but nothing ever
   read it, so every device could do everything. This turns that string into a
   permission tier and adds the club's member list: the people an admin or a
   coach hands access to, and the role each of them gets. The member list is
   what the shared Google Drive database (cloud.js) invites, so a player is
   invited as a reader and a coach as an editor without anybody having to
   understand Drive permissions. */
const Access = (() => {
  // The five role names are unchanged so existing devices and the i18n keys
  // ('role.Coach', …) keep working; each one maps to a tier.
  const ROLES = ['Super Admin', 'Club Admin', 'Coach', 'Analyst', 'Player'];
  const TIER = {
    'Super Admin': 'admin', 'Club Admin': 'admin',
    'Coach': 'coach', 'Analyst': 'analyst', 'Player': 'player'
  };
  // The three roles an admin or coach hands out. Analyst and the two admin
  // levels stay available on the device itself, but inviting somebody is kept
  // to the three words every club already uses.
  const GRANTABLE = ['Club Admin', 'Coach', 'Player'];

  const PERMS = {
    admin: ['*'],
    coach: ['cloud.read', 'cloud.write', 'cloud.setup', 'people.read', 'people.write', 'data.edit', 'data.wipe'],
    analyst: ['cloud.read', 'cloud.write', 'people.read', 'data.edit'],
    player: ['cloud.read']
  };
  // Editors on the shared file may write it; players only ever read it.
  const DRIVE_ROLE = { admin: 'writer', coach: 'writer', analyst: 'writer', player: 'reader' };

  const MEMBERS_KEY = 'accessMembers';

  function normRole(r) {
    const v = String(r == null ? '' : r).trim();
    if (ROLES.indexOf(v) >= 0) return v;
    // Tolerate lower-case or legacy spellings coming out of an old backup.
    const hit = ROLES.find(x => x.toLowerCase() === v.toLowerCase());
    return hit || 'Coach';
  }
  // Synchronous on purpose: every render path needs the answer while building
  // HTML, and Store.getSetting only reads the same in-memory cache anyway.
  function role() {
    const rec = Store.find('settings', 'role');
    return normRole(rec ? rec.value : 'Coach');
  }
  function tier(r) { return TIER[normRole(r || role())] || 'player'; }
  function can(perm, r) {
    const list = PERMS[tier(r)] || [];
    return list.indexOf('*') >= 0 || list.indexOf(perm) >= 0;
  }
  const isAdmin = r => tier(r) === 'admin';
  // "Admin or coach" — the gate the access panel and the cloud setup use.
  const isStaff = r => ['admin', 'coach'].indexOf(tier(r)) >= 0;
  // Drive decides who may write the file, so an invitation has to match what the
  // policy promised: with contributions on, everybody invited arrives as an
  // editor — otherwise a player is handed a code that says "contribute" and a
  // file Google will not let them save to.
  function driveRole(r) {
    if (tier(r) === 'player') return 'reader';
    const base = DRIVE_ROLE[tier(r)] || 'reader';
    if (base === 'writer') return base;
    const pol = window.Privacy ? Privacy.policy() : null;
    return (pol && Privacy.contributes(pol)) ? 'writer' : base;
  }
  function label(r) {
    const v = normRole(r);
    const t = window.T ? T('role.' + v) : v;
    return t && t !== 'role.' + v ? t : v;
  }

  // ---- Member list -------------------------------------------------------
  // { id, name, email, role, addedAt, invitedAt, note }
  function members() {
    const rec = Store.find('settings', MEMBERS_KEY);
    return Array.isArray(rec && rec.value) ? rec.value.slice() : [];
  }
  const normEmail = e => String(e == null ? '' : e).trim().toLowerCase();
  function findMember(email) {
    const e = normEmail(email);
    return e ? members().find(m => normEmail(m.email) === e) || null : null;
  }
  async function saveMembers(list) {
    await Store.setSetting(MEMBERS_KEY, (list || []).map(m => ({
      id: m.id || Store.uid('acc'),
      name: String(m.name || '').trim(),
      email: normEmail(m.email),
      role: normRole(m.role),
      addedAt: m.addedAt || Date.now(),
      invitedAt: m.invitedAt || 0,
      note: String(m.note || '').trim()
    })));
    return members();
  }
  // One entry per e-mail address: granting the same person again changes the
  // role they hold instead of adding them twice.
  async function grant(person) {
    const email = normEmail(person && person.email);
    if (!email || email.indexOf('@') < 1) throw new Error('bad-email');
    const list = members();
    const at = list.findIndex(m => normEmail(m.email) === email);
    const entry = Object.assign({}, at >= 0 ? list[at] : {}, person, { email, role: normRole(person.role) });
    if (at >= 0) list[at] = entry; else list.push(entry);
    await saveMembers(list);
    return entry;
  }
  async function revoke(id) {
    await saveMembers(members().filter(m => m.id !== id));
  }
  async function markInvited(ids) {
    const set = new Set(ids || []);
    await saveMembers(members().map(m => set.has(m.id) ? Object.assign({}, m, { invitedAt: Date.now() }) : m));
  }
  // ---- What a copy made with the team code may do ------------------------
  // The coach decides this once, next to the code itself; it rides along in the
  // shared file, so every device that joins opens the same way. It only ever
  // bites on a player-tier device that follows somebody else's file — the owner
  // and the coaches never see it.
  const PROFILE_KEY = 'memberProfile';
  // The one module a read-only copy keeps: the player's own training plan, the
  // drills they write for it and their own records.
  const OPEN_ROUTES = ['training'];
  const OPEN_STORES = ['training', 'exercises', 'personal'];
  // Live scouting is the coach's tool at the table, so it is never on a player
  // copy — not the module, and not the events it writes.
  const NEVER_ROUTES = ['scouting'];
  // Rows a read-only member made themselves carry this, so they can change and
  // remove their own work without ever touching the club's.
  const MEMBER_STAMP = 'byMember';
  // Device preferences (theme, language, which file to follow) stay theirs;
  // these decide what the copy is allowed to be, so they are not.
  const FIXED_SETTINGS = ['role', PROFILE_KEY, 'sharePolicy', 'accessMembers', 'menuHidden', 'roleKeys', 'roleClaim'];

  function profile() {
    const rec = Store.find('settings', PROFILE_KEY);
    const v = (rec && rec.value && typeof rec.value === 'object') ? rec.value : {};
    const routes = a => Array.isArray(a) ? a.filter(r => typeof r === 'string') : [];
    return {
      // Read-only is what a player copy IS. The coach can open it up, but a club
      // that never opened this screen still hands out a look-only copy.
      readOnly: v.readOnly !== false,
      training: v.training !== false,
      hide: routes(v.hide),
      // The areas kept off a coach who was let in with one squad's word. Empty
      // by default: a coach is a coach, just on that squad only.
      coachHide: routes(v.coachHide),
      // Per squad, when the club wants one squad's coach to have a different
      // set from the rest. A squad missing here follows coachHide.
      coachTeams: (v.coachTeams && typeof v.coachTeams === 'object') ? v.coachTeams : {}
    };
  }
  async function saveProfile(p) {
    const cur = profile();
    await Store.setSetting(PROFILE_KEY, {
      readOnly: !!(p && p.readOnly),
      training: !(p && p.training === false),
      hide: Array.isArray(p && p.hide) ? p.hide.slice() : [],
      coachHide: Array.isArray(p && p.coachHide) ? p.coachHide.slice() : [],
      coachTeams: (p && p.coachTeams && typeof p.coachTeams === 'object') ? p.coachTeams : cur.coachTeams
    });
    return profile();
  }
  // What a coach holding this squad's word may not open.
  function coachHidden(teamId) {
    const p = profile();
    const own = teamId ? p.coachTeams[teamId] : null;
    return Array.isArray(own) ? own.filter(r => typeof r === 'string') : p.coachHide;
  }
  async function saveCoachAreas(teamId, hide) {
    if (!teamId) return profile();
    const p = profile();
    const map = Object.assign({}, p.coachTeams);
    map[teamId] = Array.isArray(hide) ? hide.slice() : [];
    return saveProfile(Object.assign({}, p, { coachTeams: map }));
  }
  // A copy that follows a file somebody else owns.
  function following() {
    const c = (window.TeamCloud && TeamCloud.cfg) ? TeamCloud.cfg() : null;
    return !!(c && c.fileId && !c.owner);
  }
  // A copy that follows a file somebody else owns and holds no more than a
  // player's role. Everything below hangs off this one answer.
  function memberCopy() {
    return following() && tier() === 'player';
  }
  function readMode() {
    if (following() && window.TeamCloud && TeamCloud.isCoachSyncing && TeamCloud.isCoachSyncing()) return true;
    return memberCopy() && (profile().readOnly || unclaimed());
  }
  // Staff let in with ONE squad's word: a full coach on that squad, but only in
  // the areas the club ticked for them.
  function squadCoach() {
    if (!following() || tier() === 'player') return false;
    const c = claim();
    return !!(c && c.teamId);
  }
  function hiddenModules() {
    if (memberCopy()) return NEVER_ROUTES.concat(profile().hide);
    return squadCoach() ? coachHidden(teamLock()) : [];
  }
  // Everything the app counts — totals, ratings, reports — is derived from the
  // scouting events, so hiding them at the source empties all of it at once.
  const hidesEvents = () => memberCopy();
  // Is this module one the coach left open to a read-only copy? Training stays
  // open on a team-code join even before (or without) a role word is claimed —
  // an unproven role must not cost a player the one module that is theirs.
  function moduleOpen(route) {
    return !readMode() || (profile().training && OPEN_ROUTES.indexOf(route) >= 0);
  }
  const openStores = () => {
    const base = profile().training ? OPEN_STORES : [];
    // Whatever the club opened for contributions has to be writable here too,
    // or a member would have nothing to send back. Still only their own rows —
    // blocks() keeps the club's records the club's. Unproven role passwords
    // still stop here, but never take the training exception above down with them.
    if (unclaimed() || !window.Privacy) return base;
    const pol = Privacy.policy();
    if (!Privacy.contributes(pol)) return base;
    // DB is a top-level const, so it is a global binding but NOT a property of
    // window — testing window.DB would silently leave this list empty.
    const all = typeof DB === 'undefined' ? [] : DB.STORES;
    const open = all.filter(s => s !== 'settings' && Privacy.mayEdit(pol, s));
    return base.concat(open.filter(s => base.indexOf(s) < 0));
  };
  // The write gate. A read-only member may add to the modules the coach left
  // open and change what they added there; the club's own rows and everything
  // else are refused. `row` is the record on its way in, or the stored one on a
  // delete.
  function blocks(store, row, opts) {
    if (!readMode()) return false;
    if (store === 'settings') {
      // A verified role password is the coach's own say-so, so those two writes
      // through claimRole() are let past the lock they are meant to open.
      if (claiming && row && (row.id === 'role' || row.id === CLAIM_KEY || row.id === KEYS_KEY)) return false;
      return FIXED_SETTINGS.indexOf(row && row.id) >= 0;
    }
    if (openStores().indexOf(store) < 0) return true;
    // Re-tagging a drill's category is not the same as rewriting it — a member
    // may do this to ANY drill the training exception already opened, not only
    // the ones stamped as their own.
    if (store === 'exercises' && opts && opts.categoryOnly) return false;
    // The stored row decides, never the incoming one, so an edit cannot claim
    // a club drill by sending the stamp along with it.
    const known = (row && row.id) ? Store.find(store, row.id) : null;
    return !!(known && !known[MEMBER_STAMP]);
  }

  // ---- Role passwords ----------------------------------------------------
  // The team code lets a device read the shared file; one of these words decides
  // what that device is allowed to BE. Anybody holding the code can read the
  // file, so only a salted PBKDF2 hash travels in it — the words themselves stay
  // on the device that made them, which is the one that hands them out.
  // A squad has two words of its own — one for its players and one for its
  // coaches — so whoever joins with either sees that squad and never the
  // others.
  const KEYS_KEY = 'roleKeys';          // shared: { v, set, salt, iter, roles, teams }
  const WORDS_KEY = 'roleKeyWords';     // this device only: { set, words }
  const CLAIM_KEY = 'roleClaim';        // this device only: which word it showed
  const KEY_ITER = 310000;
  // No 0/O, 1/I/L — a password read off a screen and typed on a phone.
  const KEY_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let claiming = false;

  const cryptoOk = () => !!(window.crypto && crypto.subtle && crypto.getRandomValues);
  function b64(buf) { let s = ''; new Uint8Array(buf).forEach(b => { s += String.fromCharCode(b); }); return btoa(s); }
  function unb64(s) { return Uint8Array.from(atob(s), c => c.charCodeAt(0)); }
  async function keyHash(word, salt, iter) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(word), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base, 256);
    return b64(bits);
  }
  function makeWord() {
    const r = crypto.getRandomValues(new Uint8Array(10));
    const s = [...r].map(n => KEY_CHARS[n % KEY_CHARS.length]).join('');
    return s.slice(0, 4) + '-' + s.slice(4, 8) + '-' + s.slice(8);
  }
  function roleKeys() {
    const rec = Store.find('settings', KEYS_KEY);
    const v = (rec && rec.value && typeof rec.value === 'object') ? rec.value : null;
    return (v && v.salt && v.roles) ? v : null;
  }
  // Only the device that generated them holds the readable words.
  function roleKeyWords() {
    const rec = Store.find('settings', WORDS_KEY);
    const v = (rec && rec.value && typeof rec.value === 'object') ? rec.value : {};
    return (v.words && typeof v.words === 'object') ? v.words : v;
  }
  // The words on this device belong to one set of hashes. If the file now holds
  // a different set — somebody generated new ones elsewhere — these words would
  // be refused, so the coach is told rather than handing out a dead password.
  function wordsStale() {
    const rec = Store.find('settings', WORDS_KEY);
    const v = rec && rec.value;
    const keys = roleKeys();
    if (!keys || !v || !v.words) return false;
    return String(v.set || '') !== String(keys.set || '');
  }
  async function newRoleKeys() {
    if (!cryptoOk()) throw new Error('no-crypto');
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const set = b64(crypto.getRandomValues(new Uint8Array(6)));
    const words = {}, roles = {}, teams = {};
    // Every squad in the club, whatever sport it plays under: one word for its
    // players, one for the coaches the club wants kept to that squad.
    for (const t of Store.all('teams')) {
      const pw = makeWord(), cw = makeWord();
      words['team:' + t.id] = pw;
      words['coach:' + t.id] = cw;
      teams[t.id] = {
        name: t.name || '',
        hash: await keyHash(pw, salt, KEY_ITER),
        coachHash: await keyHash(cw, salt, KEY_ITER)
      };
    }
    await Store.setSetting(KEYS_KEY, { v: 2, set, salt: b64(salt), iter: KEY_ITER, roles, teams });
    await Store.setSetting(WORDS_KEY, { set, words });
    return words;
  }
  // A squad added after the words were made gets one of its own, without
  // touching anything already handed out. Only the device holding the words can
  // do it — anywhere else the new word would be a hash nobody can read.
  async function ensureTeamKeys() {
    const rec = roleKeys();
    const wrec = Store.find('settings', WORDS_KEY);
    const held = (wrec && wrec.value && wrec.value.words) ? wrec.value.words : null;
    if (!rec || !held || !cryptoOk() || wordsStale()) return 0;
    const salt = unb64(rec.salt);
    const iter = +rec.iter || KEY_ITER;
    const teams = Object.assign({}, rec.teams || {});
    const words = Object.assign({}, held);
    let added = 0;
    for (const t of Store.all('teams')) {
      const cur = teams[t.id];
      if (cur) {
        let next = cur;
        if (next.name !== (t.name || '')) next = Object.assign({}, next, { name: t.name || '' });
        // A set made before squads had a coach word of their own gets one here,
        // so the player word already handed out keeps working.
        if (!next.coachHash) {
          const cw = makeWord();
          words['coach:' + t.id] = cw;
          next = Object.assign({}, next, { coachHash: await keyHash(cw, salt, iter) });
          added++;
        }
        if (next !== cur) teams[t.id] = next;
        continue;
      }
      const pw = makeWord(), cw = makeWord();
      words['team:' + t.id] = pw;
      words['coach:' + t.id] = cw;
      teams[t.id] = {
        name: t.name || '',
        hash: await keyHash(pw, salt, iter),
        coachHash: await keyHash(cw, salt, iter)
      };
      added++;
    }
    await Store.setSetting(KEYS_KEY, Object.assign({}, rec, { teams }));
    await Store.setSetting(WORDS_KEY, { set: rec.set, words });
    return added;
  }
  // A squad the club deleted must not keep letting devices in. Its words go with
  // it, and the copies holding them find out on their next sync.
  async function pruneTeamKeys() {
    const rec = roleKeys();
    const wrec = Store.find('settings', WORDS_KEY);
    if (!rec || !rec.teams) return 0;
    const live = new Set(Store.all('teams').map(t => t.id));
    const teams = Object.assign({}, rec.teams);
    const words = (wrec && wrec.value && wrec.value.words) ? Object.assign({}, wrec.value.words) : null;
    let gone = 0;
    Object.keys(teams).forEach(id => {
      if (live.has(id)) return;
      delete teams[id];
      if (words) { delete words['team:' + id]; delete words['coach:' + id]; }
      gone++;
    });
    if (!gone) return 0;
    await Store.setSetting(KEYS_KEY, Object.assign({}, rec, { teams }));
    if (words) await Store.setSetting(WORDS_KEY, { set: rec.set, words });
    return gone;
  }
  // Returns the role the word unlocked, or '' when it matches none of them.
  // It is also what demotes: once a club uses passwords, a copy that cannot show
  // a valid one is a player, and unclaimed() then holds it read-only.
  async function claimRole(word) {
    const rec = roleKeys();
    const w = String(word == null ? '' : word).trim().toUpperCase();
    let hit = '', teamId = '';
    if (rec && w && cryptoOk()) {
      const hash = await keyHash(w, unb64(rec.salt), +rec.iter || KEY_ITER);
      const ids = Object.keys(rec.teams || {});
      // A squad's own coach word: everything a coach may do, on that squad.
      const c = ids.find(id => rec.teams[id] && rec.teams[id].coachHash === hash);
      if (c) { hit = 'Coach'; teamId = c; }
      else {
        const t = ids.find(id => rec.teams[id] && rec.teams[id].hash === hash);
        if (t) { hit = 'Player'; teamId = t; }
      }
      // A set made before player words were per squad had one for the club.
      if (!hit && rec.roles.Player === hash) hit = 'Player';
    }
    claiming = true;
    try {
      if (rec) await Store.setSetting(CLAIM_KEY, hit ? { role: hit, teamId, at: Date.now() } : null);
      if (hit) await Store.setSetting('role', hit);
      else if (rec && role() !== 'Player') await Store.setSetting('role', 'Player');
    } finally { claiming = false; }
    return hit;
  }
  // A copy following a club that uses role passwords, which has never shown one
  // that matched. It reads and nothing else, whatever the player profile says.
  function claim() {
    const rec = Store.find('settings', CLAIM_KEY);
    const v = rec && rec.value;
    return (v && typeof v === 'object' && ROLES.indexOf(v.role) >= 0) ? v : null;
  }
  function claimedRole() { const c = claim(); return c ? c.role : ''; }
  function unclaimed() { return !!roleKeys() && !claimedRole(); }
  // The squad a per-squad word opened, for a player or for a coach. Everything
  // the app shows is filtered through Store.teams(), so this one answer keeps
  // the device out of the club's other squads.
  function teamLock() {
    if (!following()) return '';
    const c = claim();
    return (c && c.teamId) ? String(c.teamId) : '';
  }
  // The set carried in a team code, taken on by a device that has none of its
  // own. It goes past the read-only lock the same way a verified word does:
  // this is the club telling the copy what the rules are, not the copy deciding.
  async function adoptRoleKeys(keys) {
    if (!keys || !keys.salt || !keys.roles) return false;
    claiming = true;
    try {
      await Store.setSetting(KEYS_KEY, {
        v: +keys.v || 2, set: String(keys.set || ''), salt: String(keys.salt),
        iter: +keys.iter || KEY_ITER, roles: keys.roles,
        teams: (keys.teams && typeof keys.teams === 'object') ? keys.teams : {}
      });
    } finally { claiming = false; }
    return true;
  }

  // Everybody the squad already knows about, so the coach picks from a list
  // instead of retyping addresses that are one screen away.
  function suggestions() {
    const out = [];
    const seen = new Set();
    const add = (name, email, role) => {
      const e = normEmail(email);
      if (!e || seen.has(e)) return;
      seen.add(e);
      out.push({ name: String(name || '').trim() || e, email: e, role });
    };
    (Store.coaches() || []).forEach(c => add(c.name, c.email, 'Coach'));
    (Store.players() || []).forEach(p => add([p.firstName, p.lastName].filter(Boolean).join(' '), p.email, 'Player'));
    return out;
  }

  return {
    ROLES, GRANTABLE, normRole, role, tier, can, isAdmin, isStaff, driveRole, label,
    members, findMember, saveMembers, grant, revoke, markInvited, suggestions, normEmail,
    OPEN_ROUTES, MEMBER_STAMP,
    profile, saveProfile, memberCopy, following, readMode, hiddenModules, moduleOpen, blocks, hidesEvents,
    coachHidden, saveCoachAreas,
    roleKeys, roleKeyWords, newRoleKeys, ensureTeamKeys, pruneTeamKeys, claimRole, claimedRole, claimedTeam: teamLock,
    unclaimed, wordsStale, adoptRoleKeys, teamLock, squadCoach
  };
})();
window.Access = Access;
