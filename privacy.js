/* privacy.js — what a team code may see, and what it may change.

   The shared file on Drive is readable by anybody holding the team code, so the
   coach decides here what actually goes into it. Three separate questions, kept
   apart on purpose:

     · is this block of data shared at all
     · which squads go into the file — a club can run several and share one
     · may a code holder change it, and may they delete from it
     · and for the handful of genuinely personal fields — phone, e-mail, injury
       notes — does the real value travel, a blurred one, a made-up one, ****,
       or nothing

   Two rules are not negotiable and have no setting: a private chat key never
   leaves the device, and a value that was redacted on the way out can never
   overwrite the real one on the way back in. */
const Privacy = (() => {
  const KEY = 'sharePolicy';

  // Secrets rather than data. These are stripped whatever the policy says.
  const SECRET_FIELDS = { players: ['chatKey'], coaches: ['chatKey'] };

  const GROUPS = [
    { id: 'squad', stores: ['clubs', 'teams', 'seasons', 'players', 'coaches'], def: { share: true, edit: false, del: false } },
    { id: 'matches', stores: ['matches', 'events'], def: { share: true, edit: false, del: false } },
    { id: 'training', stores: ['training', 'exercises'], def: { share: true, edit: false, del: false } },
    { id: 'tactics', stores: ['tactics'], def: { share: true, edit: false, del: false } },
    { id: 'planner', stores: ['planner'], def: { share: true, edit: false, del: false } },
    { id: 'video', stores: ['videos'], def: { share: true, edit: false, del: false } },
    { id: 'opponents', stores: ['opponents'], def: { share: false, edit: false, del: false } },
    { id: 'reports', stores: ['reports'], def: { share: true, edit: false, del: false } },
    // Health and max tests: off unless the coach deliberately turns it on.
    { id: 'personal', stores: ['personal'], def: { share: false, edit: false, del: false } }
  ];

  const MODES = ['keep', 'partial', 'fake', 'mask', 'remove'];
  const FIELDS = [
    { id: 'email', stores: ['players', 'coaches'], kind: 'email', def: 'mask' },
    { id: 'phone', stores: ['players', 'coaches'], kind: 'phone', def: 'mask' },
    { id: 'lastName', stores: ['players', 'coaches'], kind: 'name', def: 'keep' },
    { id: 'injuryNote', stores: ['players'], kind: 'text', def: 'remove' },
    { id: 'height', stores: ['players'], kind: 'num', def: 'keep' },
    { id: 'weight', stores: ['players'], kind: 'num', def: 'keep' },
    { id: 'notes', stores: ['personal'], kind: 'text', def: 'remove' }
  ];

  const MASK = '\u2022\u2022\u2022\u2022\u2022\u2022';

  function defaults() {
    // teams: null is every squad, including one added tomorrow.
    const p = { groups: {}, fields: {}, teams: null };
    GROUPS.forEach(g => { p.groups[g.id] = Object.assign({}, g.def); });
    FIELDS.forEach(f => { p.fields[f.id] = f.def; });
    return p;
  }
  function policy() {
    const rec = Store.find('settings', KEY);
    const saved = (rec && rec.value && typeof rec.value === 'object') ? rec.value : {};
    const p = defaults();
    if (Array.isArray(saved.teams)) p.teams = saved.teams.filter(t => typeof t === 'string');
    GROUPS.forEach(g => {
      const s = saved.groups && saved.groups[g.id];
      if (s && typeof s === 'object') {
        p.groups[g.id] = { share: !!s.share, edit: !!s.edit, del: !!s.del };
        // Delete only means anything on a block somebody may edit.
        if (!p.groups[g.id].edit) p.groups[g.id].del = false;
      }
    });
    FIELDS.forEach(f => {
      const s = saved.fields && saved.fields[f.id];
      if (MODES.indexOf(s) >= 0) p.fields[f.id] = s;
    });
    return p;
  }
  async function save(p) { await Store.setSetting(KEY, p); }
  async function reset() { await Store.setSetting(KEY, defaults()); }

  const groupOf = store => GROUPS.find(g => g.stores.indexOf(store) >= 0) || null;
  function rights(pol, store) {
    const g = groupOf(store);
    if (!g) return { share: true, edit: false, del: false };
    return (pol && pol.groups && pol.groups[g.id]) || g.def;
  }
  const mayShare = (pol, store) => !!rights(pol, store).share;
  const mayEdit = (pol, store) => !!(rights(pol, store).share && rights(pol, store).edit);
  const mayDelete = (pol, store) => !!(mayEdit(pol, store) && rights(pol, store).del);

  // ---- Which squads travel -----------------------------------------------
  // A club running several squads does not always want all of them in one
  // shared file. Nothing is deleted by leaving a squad out: it simply stays on
  // this device, so the coach keeps the whole club and the file holds a part.
  function sharedTeams(pol) {
    const t = (pol || policy()).teams;
    return Array.isArray(t) ? new Set(t) : null;
  }
  const teamShared = (ids, teamId) => !ids || !teamId || ids.has(teamId);
  // Every store at once, because the events carry no squad of their own and
  // have to follow the matches that survived. A row with no teamId belongs to
  // the club rather than to a squad, so it travels either way.
  function keepTeams(data, pol) {
    const ids = sharedTeams(pol);
    if (!ids || !data || typeof data !== 'object') return data;
    const out = {};
    Object.keys(data).forEach(s => {
      const rows = data[s];
      if (!Array.isArray(rows)) { out[s] = rows; return; }
      out[s] = s === 'teams'
        ? rows.filter(r => r && ids.has(r.id))
        : rows.filter(r => r && teamShared(ids, r.teamId));
    });
    if (Array.isArray(out.matches) && Array.isArray(out.events)) {
      const kept = new Set(out.matches.map(r => r.id));
      out.events = out.events.filter(r => kept.has(r.matchId));
    }
    return out;
  }

  // ---- Redaction ---------------------------------------------------------
  // Made-up values are derived from the record id, so the same player gets the
  // same fake name on every sync instead of a new one each time.
  function seedOf(s) {
    let h = 2166136261;
    const str = String(s == null ? '' : s);
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = (h * 16777619) >>> 0; }
    return h;
  }
  const FAKE_NAMES = ['Hansen', 'Jensen', 'Nielsen', 'Pedersen', 'Andersen', 'Larsen', 'Sørensen', 'Rasmussen', 'Jørgensen', 'Petersen', 'Madsen', 'Kristensen'];

  function redactValue(v, kind, mode, seed) {
    if (mode === 'keep') return v;
    if (mode === 'remove') return undefined;
    if (v == null || v === '') return v;
    if (mode === 'mask') return kind === 'num' ? 0 : MASK;
    if (mode === 'fake') {
      if (kind === 'email') return 'person' + (seed % 900 + 100) + '@example.invalid';
      if (kind === 'phone') return '+00 00 00 ' + String(seed % 100).padStart(2, '0');
      if (kind === 'name') return FAKE_NAMES[seed % FAKE_NAMES.length];
      if (kind === 'num') return Math.round((+v || 0) / 5) * 5;
      return MASK;
    }
    // partial — enough to recognise a record, not enough to contact anybody.
    const s = String(v);
    if (kind === 'email') {
      const at = s.indexOf('@');
      const dot = s.lastIndexOf('.');
      return (at > 0 ? s[0] : '') + '\u2022\u2022\u2022@\u2022\u2022\u2022' + (dot > at ? s.slice(dot) : '');
    }
    if (kind === 'phone') return '\u2022\u2022\u2022\u2022\u2022\u2022' + s.replace(/\D/g, '').slice(-2);
    if (kind === 'name') return s.charAt(0).toUpperCase() + '.';
    if (kind === 'num') return Math.round((+v || 0) / 5) * 5;
    return s.slice(0, 12) + (s.length > 12 ? '\u2026' : '');
  }

  const fieldsFor = store => FIELDS.filter(f => f.stores.indexOf(store) >= 0);
  // Field paths whose value was altered, so the receiving side knows never to
  // let them overwrite a real value it already holds.
  function protectedPaths(pol) {
    const out = [];
    FIELDS.forEach(f => {
      if ((pol.fields[f.id] || f.def) !== 'keep') f.stores.forEach(s => out.push(s + '.' + f.id));
    });
    Object.keys(SECRET_FIELDS).forEach(s => SECRET_FIELDS[s].forEach(f => out.push(s + '.' + f)));
    return out;
  }

  // A shareable copy of one store's rows. Never mutates the originals.
  function redactRows(store, rows, pol) {
    const secrets = SECRET_FIELDS[store] || [];
    const fields = fieldsFor(store);
    if (!secrets.length && !fields.length) return rows;
    return (rows || []).map(row => {
      const copy = Object.assign({}, row);
      secrets.forEach(f => { delete copy[f]; });
      const seed = seedOf(row && row.id);
      fields.forEach(f => {
        const mode = pol.fields[f.id] || f.def;
        if (mode === 'keep') return;
        const v = redactValue(copy[f.id], f.kind, mode, seed);
        if (v === undefined) delete copy[f.id]; else copy[f.id] = v;
      });
      return copy;
    });
  }

  // How many records and how many personal fields the current policy lets out.
  function summary(pol) {
    const p = pol || policy();
    const data = {};
    let blocks = 0;
    GROUPS.forEach(g => {
      if (!p.groups[g.id].share) return;
      blocks++;
      g.stores.forEach(s => { data[s] = Store.all(s) || []; });
    });
    const kept = keepTeams(data, p);
    let records = 0;
    Object.keys(kept).forEach(s => { records += kept[s].length; });
    const hidden = FIELDS.filter(f => (p.fields[f.id] || f.def) !== 'keep').length;
    return { records, blocks, totalBlocks: GROUPS.length, hidden, totalFields: FIELDS.length };
  }

  return {
    GROUPS, FIELDS, MODES, MASK, SECRET_FIELDS,
    defaults, policy, save, reset,
    groupOf, rights, mayShare, mayEdit, mayDelete,
    sharedTeams, keepTeams,
    redactRows, redactValue, protectedPaths, summary, seedOf
  };
})();
window.Privacy = Privacy;
