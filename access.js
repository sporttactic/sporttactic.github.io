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
  function driveRole(r) { return DRIVE_ROLE[tier(r)] || 'reader'; }
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
  // Rows a read-only member made themselves carry this, so they can change and
  // remove their own work without ever touching the club's.
  const MEMBER_STAMP = 'byMember';
  // Device preferences (theme, language, which file to follow) stay theirs;
  // these four decide what the copy is allowed to be, so they are not.
  const FIXED_SETTINGS = ['role', PROFILE_KEY, 'sharePolicy', 'accessMembers', 'menuHidden'];

  function profile() {
    const rec = Store.find('settings', PROFILE_KEY);
    const v = (rec && rec.value && typeof rec.value === 'object') ? rec.value : {};
    return {
      readOnly: !!v.readOnly,
      training: v.training !== false,
      hide: Array.isArray(v.hide) ? v.hide.filter(r => typeof r === 'string') : []
    };
  }
  async function saveProfile(p) {
    await Store.setSetting(PROFILE_KEY, {
      readOnly: !!(p && p.readOnly),
      training: !(p && p.training === false),
      hide: Array.isArray(p && p.hide) ? p.hide.slice() : []
    });
    return profile();
  }
  // A copy that follows a file somebody else owns and holds no more than a
  // player's role. Everything below hangs off this one answer.
  function memberCopy() {
    const c = (window.TeamCloud && TeamCloud.cfg) ? TeamCloud.cfg() : null;
    return !!(c && c.fileId && !c.owner) && tier() === 'player';
  }
  function readMode() { return memberCopy() && profile().readOnly; }
  function hiddenModules() { return memberCopy() ? profile().hide : []; }
  // Is this module one the coach left open to a read-only copy?
  function moduleOpen(route) {
    return !readMode() || (profile().training && OPEN_ROUTES.indexOf(route) >= 0);
  }
  const openStores = () => (profile().training ? OPEN_STORES : []);
  // The write gate. A read-only member may add to the modules left open and
  // change what they added there; the club's own rows and everything else are
  // refused. `row` is the record on its way in, or the stored one on a delete.
  function blocks(store, row) {
    if (!readMode()) return false;
    if (store === 'settings') return FIXED_SETTINGS.indexOf(row && row.id) >= 0;
    if (openStores().indexOf(store) < 0) return true;
    // The stored row decides, never the incoming one, so an edit cannot claim
    // a club drill by sending the stamp along with it.
    const known = (row && row.id) ? Store.find(store, row.id) : null;
    return !!(known && !known[MEMBER_STAMP]);
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
    profile, saveProfile, memberCopy, readMode, hiddenModules, moduleOpen, blocks
  };
})();
window.Access = Access;
