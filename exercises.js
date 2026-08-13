/* Exercise Library — a section of the Training Planner (it has no own route) */
window.Views = window.Views || {};

// ---- Muscle map --------------------------------------------------------
// The keys below are stored on each exercise (`muscles: ['quads', ...]`) and are
// what the SVG body highlights. Areas are only a grouping of those keys.
const MUSCLE_AREAS = {
  upper: ['neck', 'traps', 'shoulders', 'chest', 'lats', 'biceps', 'triceps', 'forearms'],
  core: ['abs', 'obliques', 'lowerback', 'hipflexors'],
  lower: ['glutes', 'quads', 'hamstrings', 'adductors', 'calves']
};
const MUSCLE_AREA_OF = (() => {
  const m = {};
  Object.keys(MUSCLE_AREAS).forEach(a => MUSCLE_AREAS[a].forEach(k => m[k] = a));
  return m;
})();
const MUSCLE_KEYS = Object.keys(MUSCLE_AREA_OF);

// Two anatomical figures (front, back) built from contoured paths. Every shape is
// modelled on the left half of the body and mirrored, so the sides always match.
// Muscle groups carry data-m — that is what gets highlighted and clicked; the head,
// limbs outline, hands and feet are silhouette only.
function muscleBodySvg(frontLabel, backLabel) {
  // A muscle group given as a left-side path, drawn twice (mirrored on x).
  const pair = (m, d) => `<g class="mus" data-m="${m}"><path d="${d}"/><path d="${d}" transform="scale(-1,1)"/></g>`;
  // A group that sits on the mid-line (abs, traps, low back) — drawn once.
  const one = (m, d) => `<g class="mus" data-m="${m}"><path d="${d}"/></g>`;
  const sil = d => `<path class="sil" d="${d}"/><path class="sil" d="${d}" transform="scale(-1,1)"/>`;

  const ARM = 'M-36 66 C-45 72 -49 86 -47 102 C-45 118 -43 134 -41 150 C-40 160 -37 167 -33 167 C-28 167 -26 160 -27 150 C-29 134 -28 116 -27 100 C-26 86 -28 74 -31 66 Z';
  const LEG = 'M-4 176 C-14 176 -24 180 -28 190 C-32 204 -30 226 -27 244 C-25 258 -23 272 -21 288 C-20 296 -18 302 -14 303 C-9 304 -6 300 -6 292 C-6 278 -7 260 -6 244 C-5 222 -4 200 -4 176 Z';
  const TRUNK = 'M-13 58 C-28 62 -38 70 -41 82 C-44 96 -40 112 -34 126 C-30 138 -28 150 -27 160 C-26 170 -28 175 -30 181 L30 181 C28 175 26 170 27 160 C28 150 30 138 34 126 C40 112 44 96 41 82 C38 70 28 62 13 58 Z';
  const FOOT = 'M-20 303 L-6 303 L-4 312 L-23 312 Z';
  const OUTLINE = `
    <ellipse class="sil" cx="0" cy="26" rx="17" ry="21"/>
    <path class="sil" d="${TRUNK}"/>
    ${sil(ARM)}${sil(LEG)}${sil(FOOT)}
    <circle class="sil" cx="-42" cy="172" r="6"/><circle class="sil" cx="42" cy="172" r="6"/>`;

  const front = `
    ${OUTLINE}
    ${one('neck', 'M-9 42 C-9 51 -11 56 -13 60 C-6 64 6 64 13 60 C11 56 9 51 9 42 Z')}
    ${pair('traps', 'M-11 50 C-19 55 -29 61 -37 70 C-30 72 -21 68 -13 61 Z')}
    ${pair('shoulders', 'M-30 64 C-40 68 -46 78 -45 91 C-38 94 -32 89 -29 81 C-27 74 -28 68 -30 64 Z')}
    ${pair('chest', 'M-4 68 C-16 66 -26 70 -30 78 C-32 86 -28 95 -20 98 C-12 101 -6 97 -4 90 Z')}
    ${pair('biceps', 'M-44 94 C-48 104 -48 118 -45 130 C-41 134 -36 130 -35 122 C-34 110 -36 100 -39 94 Z')}
    ${pair('forearms', 'M-45 134 C-48 144 -48 158 -45 167 C-41 170 -37 167 -36 159 C-35 148 -35 140 -37 134 Z')}
    ${pair('obliques', 'M-17 106 C-25 110 -30 118 -31 128 C-31 140 -27 150 -21 155 C-17 149 -16 132 -16 116 Z')}
    ${one('abs', 'M-15 104 C-17 118 -16 134 -13 150 C-6 156 6 156 13 150 C16 134 17 118 15 104 C6 100 -6 100 -15 104 Z')}
    ${pair('hipflexors', 'M-14 154 C-20 158 -24 164 -25 172 C-19 177 -11 177 -7 170 C-7 162 -10 156 -14 154 Z')}
    ${pair('adductors', 'M-3 180 C-9 184 -13 194 -13 208 C-13 220 -10 228 -6 233 C-3 225 -2 202 -2 182 Z')}
    ${pair('quads', 'M-8 180 C-19 182 -26 192 -28 206 C-30 222 -26 238 -20 246 C-14 250 -9 244 -8 234 C-7 216 -7 196 -8 180 Z')}
    <text class="blbl" x="0" y="330" text-anchor="middle">${UI.esc(frontLabel)}</text>`;

  const back = `
    ${OUTLINE}
    ${one('traps', 'M0 44 C-6 52 -14 58 -24 62 C-33 66 -39 73 -41 83 C-30 95 -16 105 0 109 C16 105 30 95 41 83 C39 73 33 66 24 62 C14 58 6 52 0 44 Z')}
    ${pair('shoulders', 'M-30 64 C-40 68 -46 78 -45 91 C-38 94 -32 89 -29 81 C-27 74 -28 68 -30 64 Z')}
    ${pair('lats', 'M-36 86 C-33 96 -30 108 -26 120 C-22 132 -17 142 -13 149 C-9 143 -10 128 -13 114 C-17 100 -23 90 -30 86 Z')}
    ${pair('triceps', 'M-44 94 C-48 104 -48 118 -45 130 C-41 134 -36 130 -35 122 C-34 110 -36 100 -39 94 Z')}
    ${pair('forearms', 'M-45 134 C-48 144 -48 158 -45 167 C-41 170 -37 167 -36 159 C-35 148 -35 140 -37 134 Z')}
    ${one('lowerback', 'M-14 148 C-16 158 -14 168 -10 174 C-4 178 4 178 10 174 C14 168 16 158 14 148 C6 144 -6 144 -14 148 Z')}
    ${pair('glutes', 'M-2 174 C-13 174 -23 180 -28 191 C-31 200 -28 211 -21 216 C-11 220 -3 212 -2 202 Z')}
    ${pair('hamstrings', 'M-8 214 C-19 216 -26 226 -28 238 C-29 250 -26 262 -20 268 C-14 271 -9 265 -8 254 C-7 240 -7 226 -8 214 Z')}
    ${pair('calves', 'M-9 264 C-19 266 -25 276 -26 288 C-26 297 -22 303 -17 303 C-12 302 -9 296 -9 288 C-8 278 -8 270 -9 264 Z')}
    <text class="blbl" x="0" y="330" text-anchor="middle">${UI.esc(backLabel)}</text>`;

  return `<svg class="body-map" viewBox="0 0 300 344" role="img">
    <g transform="translate(78,8)">${front}</g>
    <g transform="translate(222,8)">${back}</g>
  </svg>`;
}

// The library lives inside the Training Planner. `mount` is its own container and
// `opts.onChange` redraws the host page when a drill is saved, deleted or imported.
Views.exerciseLib = function (mount, opts) {
  opts = opts || {};
  const sportId = (window.App && App.getSport && App.getSport()) || 'handball';
  const INT = ['Low', 'Medium', 'High'];
  // Only http(s) links may reach an href — blocks javascript:/data: payloads.
  const safeUrl = (u) => {
    const s = String(u || '').trim();
    if (!s) return '';
    try { const p = new URL(s); return (p.protocol === 'http:' || p.protocol === 'https:') ? p.href : ''; }
    catch { return ''; }
  };
  const tt = (p, v) => { const k = p + '.' + v; const r = T(k); return r === k ? v : r; };
  // A drill keeps its wording per language in `tr`; the plain fields are the
  // fallback for anything written before that, including imported files.
  const exTitle = e => UI.langText(e, 'title');
  const exDesc = e => UI.langText(e, 'description');
  const LANGS = ['en', 'da'];
  const EN_LANG = { en: 'English', da: 'Danish' };   // named in English for the model
  const langName = l => T('lang.' + l) !== 'lang.' + l ? T('lang.' + l) : l.toUpperCase();
  const withLang = (tr, lang, title, description) =>
    Object.assign({}, tr, { [lang]: { title, description } });
  const hasLang = (e, lang) => {
    const t = e && e.tr && e.tr[lang];
    return !!(t && typeof t.title === 'string' && t.title.trim());
  };
  const catLabel = c => (c === 'All' ? T('exercises.all') : tt('cat', c));
  const musLabel = m => tt('mus', m);
  let cat = 'All';
  let area = 'All';
  let muscle = '';

  // The sport's own categories first, plus any category the stored drills use,
  // so a library carried over from another sport stays reachable.
  function cats() {
    const own = SPORTS.exerciseCategories(sportId);
    const extra = [...new Set(Store.all('exercises').map(e => e.category).filter(c => c && own.indexOf(c) < 0))];
    return ['All'].concat(own, extra);
  }

  function keep(e) {
    const mus = e.muscles || [];
    if (cat !== 'All' && e.category !== cat) return false;
    if (area !== 'All' && !mus.some(m => MUSCLE_AREA_OF[m] === area)) return false;
    if (muscle && mus.indexOf(muscle) < 0) return false;
    return true;
  }

  function paint(set) {
    mount.querySelectorAll('.mus').forEach(g => g.classList.toggle('on', set.has(g.dataset.m)));
  }

  // What the figures show: a picked muscle wins, otherwise everything the listed
  // exercises train — narrowed to the chosen area, so "Upper body" never lights a leg.
  function focusSet(list) {
    if (muscle) return new Set([muscle]);
    const s = new Set();
    list.forEach(e => (e.muscles || []).forEach(m => {
      if (area === 'All' || MUSCLE_AREA_OF[m] === area) s.add(m);
    }));
    return s;
  }

  // One drill card — rendered inside the accordion of its own category.
  // A read-only team copy keeps the buttons on the drills it wrote itself; the
  // library that came down from the coach is looked at, not edited. The gate is
  // the one the store uses, so the button is offered exactly when it works.
  const mayChange = e => !Access.blocks('exercises', e);
  function cardHtml(e) {
    return `
      <div class="card" data-card="${e.id}">
        <div style="display:flex;justify-content:space-between"><h3 style="margin:0">${UI.esc(exTitle(e))}</h3><span class="tag blue">${UI.esc(tt('cat', e.category))}</span></div>
        <p style="color:var(--text-soft);margin:8px 0;font-size:13px">${UI.esc(exDesc(e))}</p>
        ${embedHtml(e)}
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">
          <span class="tag">${e.duration || 0} ${T('training.min')}</span><span class="tag ${e.intensity === 'High' ? 'red' : e.intensity === 'Medium' ? 'amber' : 'green'}">${UI.esc(tt('intensity', e.intensity || 'Low'))}</span>
          ${(e.muscles || []).map(m => `<span class="tag mus-tag" data-pick="${m}">${UI.esc(musLabel(m))}</span>`).join('')}
          ${(e.tags || []).map(t => `<span class="tag">#${UI.esc(t)}</span>`).join('')}
        </div>
        ${linksHtml(e)}
        ${animChips(e)}
        <button class="btn sm" data-show="${e.id}">${T('common.show')}</button>
        ${mayChange(e) ? `<button class="btn sm" data-edit="${e.id}">${T('common.edit')}</button>
        <button class="btn sm danger" data-del="${e.id}">${T('common.delete')}</button>` : ''}
      </div>`;
  }

  // The drill's own videos, played inside the card. Only an id we could parse
  // out of a known host ever reaches an iframe src, so no other host and no
  // javascript:/data: URL can be embedded.
  const embedSrc = u => UI.videoSrc(u);
  const videoList = e => UI.videosOf(e);
  const linkLabel = u => {
    const s = UI.videoSrc(u);
    if (s.indexOf('https://www.youtube.com/embed/') === 0) return 'YouTube';
    if (s.indexOf('https://drive.google.com/') === 0) return T('exercises.drive');
    return T('training.video');
  };
  const embedHtml = e => UI.videoEmbed(e);
  // Saved tactical-board animations attached to the drill — empty on most cards,
  // so the "none picked" hint is left to the dialogs.
  const animChips = e => (e.animations || []).length ? ANIM.chipsHtml(e.animations) : '';
  // The links that have no player of their own, offered as buttons instead.
  function linksHtml(e) {
    const rest = videoList(e).filter(u => !embedSrc(u));
    if (!rest.length) return '';
    return `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">${rest.map(u =>
      `<a class="btn sm" href="${UI.esc(u)}" target="_blank" rel="noopener noreferrer">▶ ${UI.esc(linkLabel(u))}</a>`).join('')}</div>`;
  }

  // Read-only view of one drill: the whole description, the video, what it
  // trains and its links.
  function showDrill(e) {
    if (!e) return;
    UI.modal({
      title: UI.esc(exTitle(e)),
      width: 640,
      body: `<p class="hint" style="margin-top:0">${UI.esc(tt('cat', e.category))} · ${e.duration || 0} ${T('training.min')} · ${UI.esc(tt('intensity', e.intensity || 'Low'))}</p>
        <p style="white-space:pre-line">${UI.esc(exDesc(e)) || `<span class="hint">${T('common.noData')}</span>`}</p>
        ${embedHtml(e)}
        <h4 style="margin-bottom:6px">${T('exercises.muscles')}</h4>
        ${(e.muscles || []).length
          ? `<div style="display:flex;gap:6px;flex-wrap:wrap">${(e.muscles || []).map(m => `<span class="tag">${UI.esc(musLabel(m))}</span>`).join('')}</div>`
          : `<p class="hint">${T('common.noData')}</p>`}
        ${(e.tags || []).length ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">${(e.tags || []).map(t => `<span class="tag">#${UI.esc(t)}</span>`).join('')}</div>` : ''}
        <h4 style="margin-bottom:6px">${T('training.anims')}</h4>
        ${ANIM.chipsHtml(e.animations)}
        <div style="margin-top:12px">${linksHtml(e)}</div>`,
      footer: `<button class="btn ghost" data-close2>${T('common.close')}</button>${mayChange(e) ? `<button class="btn primary" data-edit>${T('common.edit')}</button>` : ''}`,
      onOpen: (m, close) => {
        ANIM.bind(m);
        m.querySelector('[data-close2]').onclick = close;
        m.querySelector('[data-edit]').onclick = () => { close(); form(e); };
      }
    });
  }

  // The drills are folded into one accordion per category so a long library
  // stays scannable; the order follows the sport's own category list.
  function groupsHtml(list) {
    if (!list.length) return `<div class="empty"><div class="big">${UI.icon('dumbbell', 40)}</div>${T('exercises.none')}</div>`;
    const known = cats().filter(c => c !== 'All');
    const byCat = new Map();
    list.forEach(e => {
      const c = e.category || T('exercises.uncategorised');
      if (!byCat.has(c)) byCat.set(c, []);
      byCat.get(c).push(e);
    });
    const order = known.filter(c => byCat.has(c)).concat([...byCat.keys()].filter(c => known.indexOf(c) < 0));
    return order.map(c => UI.acc('exlibcat_' + c, catLabel(c),
      `<div class="grid cols-2">${byCat.get(c).map(cardHtml).join('')}</div>`,
      {
        sub: byCat.get(c).length + ' ' + T('training.drills'),
        actions: Access.readMode() ? '' : `<button class="btn sm danger" data-catdel="${UI.esc(c)}">🗑 ${T('exercises.delCat')}</button>`
      })).join('');
  }

  function render() {
    const list = Store.all('exercises').filter(keep);
    const inner = `
      <div class="ex-layout">
        <div class="card body-card">
          <h3 style="margin-top:0">${T('exercises.muscleMap')}</h3>
          ${muscleBodySvg(T('body.front'), T('body.back'))}
          <p class="hint">${muscle ? UI.esc(musLabel(muscle)) : (area === 'All' ? T('exercises.mapHint') : UI.esc(T('area.' + area)))}</p>
          ${muscle ? `<button class="btn sm" id="clearMus">${T('exercises.clearMuscle')}</button>` : ''}
        </div>
        <div>
          <div class="pill-row">${['All'].concat(Object.keys(MUSCLE_AREAS)).map(a =>
      `<span class="pill ${a === area ? 'active' : ''}" data-area="${a}">${UI.esc(a === 'All' ? T('exercises.allAreas') : T('area.' + a))}</span>`).join('')}</div>
          <div class="pill-row">${cats().map(c => `<span class="pill ${c === cat ? 'active' : ''}" data-cat="${c}">${UI.esc(catLabel(c))}</span>`).join('')}</div>
          ${list.length ? `<div class="lib-acts">
            <button class="btn sm" id="exExpand">▾ ${T('exercises.expandAll')}</button>
            <button class="btn sm" id="exCollapse">▸ ${T('exercises.collapseAll')}</button>
            <span class="hint">${list.length} ${T('training.drills')}</span>
          </div>` : ''}
          ${groupsHtml(list)}
        </div>
      </div>`;

    mount.innerHTML = UI.acc('exlib', T('exercises.title'), inner, {
      open: true,
      sub: T('exercises.subtitle'),
      actions: `${Access.readMode() ? '' : UI.shareBar('exercises')}
        ${mayChange(null) ? `<button class="btn" id="genEx">🤖 ${T('training.aiDrill')}</button>` : ''}
        ${Access.readMode() ? '' : `<button class="btn" id="trEx">🌐 ${T('exercises.translate')}</button>
        <button class="btn danger" id="wipeEx">${T('exercises.removeAll')}</button>`}
        ${mayChange(null) ? `<button class="btn primary" id="addEx">+ ${T('exercises.newExercise')}</button>` : ''}`
    });
    UI.bindAcc(mount);

    const focus = focusSet(list);
    paint(focus);

    mount.querySelectorAll('[data-area]').forEach(b => {
      b.onclick = () => { area = b.dataset.area; muscle = ''; render(); };
      // Hovering an area shows every muscle it covers, trained or not.
      b.onmouseenter = () => paint(new Set(b.dataset.area === 'All' ? MUSCLE_KEYS : MUSCLE_AREAS[b.dataset.area]));
      b.onmouseleave = () => paint(focus);
    });
    mount.querySelectorAll('[data-cat]').forEach(b => b.onclick = () => { cat = b.dataset.cat; render(); });
    mount.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => { muscle = b.dataset.pick; render(); });
    mount.querySelectorAll('[data-m]').forEach(g => g.onclick = () => { muscle = muscle === g.dataset.m ? '' : g.dataset.m; render(); });
    const clr = mount.querySelector('#clearMus');
    if (clr) clr.onclick = () => { muscle = ''; render(); };
    // Hovering a drill previews just that drill's muscles.
    mount.querySelectorAll('[data-card]').forEach(c => {
      const e = Store.find('exercises', c.dataset.card);
      c.onmouseenter = () => paint(new Set((e && e.muscles) || []));
      c.onmouseleave = () => paint(focus);
    });
    const addBtn = mount.querySelector('#addEx');
    if (addBtn) addBtn.onclick = () => form();
    const genBtn = mount.querySelector('#genEx');
    if (genBtn) genBtn.onclick = () => aiForm();
    const trBtn = mount.querySelector('#trEx');
    if (trBtn) trBtn.onclick = () => translateAll();
    // Emptying one fold at a time — useful after generating a batch you do not want.
    mount.querySelectorAll('[data-catdel]').forEach(b => b.onclick = () => {
      const c = b.dataset.catdel;
      const rows = Store.all('exercises').filter(e => (e.category || T('exercises.uncategorised')) === c);
      if (!rows.length) return;
      UI.confirm(T('exercises.delCatAsk').replace('{0}', rows.length).replace('{1}', catLabel(c)), async () => {
        const ids = rows.map(e => e.id);
        for (const id of ids) await Store.remove('exercises', id);
        for (const s of Store.all('training')) {
          const left = (s.exercises || []).filter(id => ids.indexOf(id) < 0);
          if (left.length !== (s.exercises || []).length) await Store.save('training', Object.assign({}, s, { exercises: left }));
        }
        UI.toast(ids.length + ' ' + T('exercises.removedAll'), 'success');
        done();
      });
    });
    // The category folds are ordinary <details>, so open/close them all at once.
    const folds = () => mount.querySelectorAll('details[data-acc^="exlibcat_"]');
    const setFolds = open => folds().forEach(d => {
      d.open = open;
      try { localStorage.setItem('stx_acc_' + d.dataset.acc, open ? '1' : '0'); } catch (err) { /* private mode */ }
    });
    const exp = mount.querySelector('#exExpand');
    if (exp) exp.onclick = () => setFolds(true);
    const col = mount.querySelector('#exCollapse');
    if (col) col.onclick = () => setFolds(false);
    const wipe = mount.querySelector('#wipeEx');
    if (wipe) wipe.onclick = () => {
      const all = Store.all('exercises');
      if (!all.length) return UI.toast(T('exercises.none'), 'error');
      UI.confirm(T('exercises.removeAllAsk'), async () => {
        const ids = all.map(e => e.id);
        for (const id of ids) await Store.remove('exercises', id);
        // A session pointing at a deleted drill would render an empty tag row.
        for (const s of Store.all('training')) {
          const keep = (s.exercises || []).filter(id => ids.indexOf(id) < 0);
          if (keep.length !== (s.exercises || []).length) await Store.save('training', Object.assign({}, s, { exercises: keep }));
        }
        UI.toast(ids.length + ' ' + T('exercises.removedAll'), 'success');
        done();
      });
    };
    mount.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => form(Store.find('exercises', b.dataset.edit)));
    mount.querySelectorAll('[data-show]').forEach(b => b.onclick = () => showDrill(Store.find('exercises', b.dataset.show)));
    ANIM.bind(mount);
    mount.querySelectorAll('[data-del]').forEach(b => b.onclick = () => UI.confirm(T('exercises.delExercise'), async () => { await Store.remove('exercises', b.dataset.del); done(); }));
    UI.bindShare(mount, 'exercises', done);
  }

  // Saving, deleting or importing also changes the sessions above, so the host
  // page is redrawn when it asked to be.
  function done() { if (opts.onChange) opts.onChange(); else render(); }

  // Translate every drill that has no text in the language now selected. The
  // model gets them in one batch and answers with a plain id → text map, so a
  // whole library costs one request instead of one per drill.
  async function translateAll() {
    const lang = I18N.getLang();
    const todo = Store.all('exercises').filter(e => !hasLang(e, lang));
    if (!todo.length) return UI.toast(T('exercises.trNone'), 'success');
    UI.confirm(T('exercises.trAsk').replace('{0}', todo.length).replace('{1}', langName(lang)), async () => {
      let n = 0;
      for (let i = 0; i < todo.length; i += 10) {
        const batch = todo.slice(i, i + 10);
        UI.toast(T('exercises.trWorking').replace('{0}', Math.min(i + 10, todo.length)).replace('{1}', todo.length));
        const rows = batch.map(e => ({ id: e.id, title: e.title || '', description: e.description || '' }));
        const system = [
          `You translate ${SPORTS.name(sportId, 'en')} training exercises into ${EN_LANG[lang] || lang}.`,
          'Answer with one JSON object and nothing else — no markdown, no code fence, no commentary.',
          'Shape: {"drills":[{"id":"","title":"","description":""}]}',
          'Return every id you were given, unchanged. Translate only the title and the description.',
          'Keep the coaching meaning, the numbers, the sets and the reps exactly as they are.',
          'Use the words a coach in that language actually says. Do not add anything of your own.'
        ].join('\n');
        const raw = await AI.complete(system, JSON.stringify({ drills: rows }), 400 + batch.length * 260);
        if (!raw) break;
        let d;
        try { d = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)); }
        catch (err) { UI.toast(T('training.aiBad'), 'error'); break; }
        for (const r of (Array.isArray(d.drills) ? d.drills : [])) {
          const e = batch.find(x => x.id === r.id);
          const title = String((r && r.title) || '').trim().slice(0, 80);
          if (!e || !title) continue;
          await Store.save('exercises', Object.assign({}, e, {
            tr: withLang(e.tr, lang, title, String(r.description || '').trim().slice(0, 1500))
          }));
          n++;
        }
      }
      UI.toast(n ? T('exercises.trDone').replace('{0}', n) : T('training.aiBad'), n ? 'success' : 'error');
      done();
    });
  }

  function musclePicker(picked) {
    return Object.keys(MUSCLE_AREAS).map(a => `
      <div class="mus-group"><span class="mus-group-h">${T('area.' + a)}</span>
        ${MUSCLE_AREAS[a].map(m => `<label class="mus-pick"><input type="checkbox" value="${m}" ${picked.indexOf(m) >= 0 ? 'checked' : ''}> ${UI.esc(musLabel(m))}</label>`).join('')}
      </div>`).join('');
  }

  // Describe what to train, ChatGPT drafts the exercises, the coach reviews them
  // before anything is saved. Tick the categories it should cover — and body
  // parts only if you want a split; leaving them empty gives plain sport drills.
  function aiForm() {
    const own = SPORTS.exerciseCategories(sportId);
    const preset = own.indexOf(cat) >= 0 ? cat : own[0];
    UI.modal({
      title: T('training.aiDrill'),
      width: 720,
      body: `<p style="color:var(--muted);font-size:13px">${T('training.aiDrillIntro')}</p>
        <label class="field"><span>${T('training.aiDrillWhat')}</span>
          <textarea id="g_what" rows="3" placeholder="${UI.esc(T('training.aiDrillPh'))}"></textarea></label>
        <div class="field"><span>${T('exercises.aiCats')} <span class="hint">— ${T('exercises.aiOptional')}</span></span>
          <div class="focus-acts">
            <button type="button" class="btn sm" data-call>${T('settings.shareAll')}</button>
            <button type="button" class="btn sm" data-cnone>${T('settings.shareNone')}</button>
          </div>
          <div id="g_cats" class="menu-picker">${own.map(x => `<label class="check-row menu-row"><input type="checkbox" value="${UI.esc(x)}" ${x === preset ? 'checked' : ''}><span>${UI.esc(tt('cat', x))}</span></label>`).join('')}</div>
          <p class="hint">${T('exercises.aiCatsHint')}</p></div>
        <div class="row">
          <label class="field"><span>${T('training.duration')}</span><input id="g_d" type="number" value="15"></label>
          <label class="field"><span>${T('training.intensity')}</span><select id="g_i">${INT.map(x => `<option value="${x}" ${x === 'Medium' ? 'selected' : ''}>${UI.esc(tt('intensity', x))}</option>`).join('')}</select></label>
          <label class="field"><span>${T('exercises.aiCount')}</span><input id="g_n" type="number" min="1" max="5" value="2"></label>
        </div>
        <details class="acc-lite">
          <summary>${T('exercises.aiParts')} <span class="hint">— ${T('exercises.aiPartsOptional')}</span></summary>
          <div class="focus-acts">
            <button type="button" class="btn sm" data-mall>${T('settings.shareAll')}</button>
            <button type="button" class="btn sm" data-mnone>${T('settings.shareNone')}</button>
          </div>
          <div id="g_mus" class="mus-picker">${musclePicker([])}</div>
          <p class="hint">${T('exercises.aiPartsHint')}</p>
        </details>
        <label class="field"><span>${T('training.anims')}</span>${ANIM.pickerHtml('g_anim', [], sportId)}</label>
        <p class="hint">${T('exercises.aiAnimsHint')}</p>
        <p class="hint">${T('exercises.aiVideoHint')}</p>
        <p class="hint">${T('training.aiDrillHint')}</p>`,
      footer: `<button class="btn ghost" data-close2>${T('common.cancel')}</button><button class="btn primary" data-gen>${T('training.aiGenerate')}</button>`,
      onOpen: (m, close) => {
        m.querySelector('[data-close2]').onclick = close;
        const boxes = [...m.querySelectorAll('#g_mus input')];
        const cboxes = [...m.querySelectorAll('#g_cats input')];
        m.querySelector('[data-mall]').onclick = () => boxes.forEach(b => { b.checked = true; });
        m.querySelector('[data-mnone]').onclick = () => boxes.forEach(b => { b.checked = false; });
        m.querySelector('[data-call]').onclick = () => cboxes.forEach(b => { b.checked = true; });
        m.querySelector('[data-cnone]').onclick = () => cboxes.forEach(b => { b.checked = false; });
        const btn = m.querySelector('[data-gen]');
        btn.onclick = async () => {
          const what = m.querySelector('#g_what').value.trim();
          if (!what) return UI.toast(T('training.aiWhatReq'), 'error');
          // Nothing ticked is a valid request: the model then picks the category itself.
          const picked = cboxes.filter(b => b.checked).map(b => b.value);
          const parts = boxes.filter(b => b.checked).map(b => b.value);
          const per = Math.max(1, Math.min(5, +m.querySelector('#g_n').value || 1));
          const animEl = m.querySelector('#g_anim');
          const anims = animEl ? [...animEl.selectedOptions].map(o => o.value) : [];
          const base = {
            what,
            duration: +m.querySelector('#g_d').value,
            intensity: m.querySelector('#g_i').value
          };
          btn.disabled = true;
          const drafts = [];
          // One request per category × body part keeps each answer short and on topic.
          const parts2 = parts.length ? parts : [''];
          const rounds = [];
          (picked.length ? picked : ['']).forEach(c => parts2.forEach(p => rounds.push({ category: c, muscle: p })));
          for (let i = 0; i < rounds.length; i++) {
            btn.textContent = T('ai.asking') + (rounds.length > 1 ? ` ${i + 1}/${rounds.length}` : '');
            const got = await generate(Object.assign({}, base, { category: rounds[i].category }), rounds[i].muscle, per);
            if (got) drafts.push(...got);
          }
          btn.disabled = false; btn.textContent = T('training.aiGenerate');
          if (!drafts.length) return;
          drafts.forEach(d => { d.animations = anims.slice(); });
          close();
          if (drafts.length === 1) { form(drafts[0]); UI.toast(T('training.aiReady'), 'success'); }
          else reviewDrafts(drafts);
        };
      }
    });
  }

  // Everything the model drafted, in one list — nothing reaches the library
  // until the coach ticks it and presses Save.
  function reviewDrafts(list) {
    UI.modal({
      title: T('exercises.aiReviewTitle'),
      width: 720,
      body: `<p class="hint" style="margin-top:0">${T('exercises.aiReviewHint')}</p>
        <div class="focus-acts">
          <button type="button" class="btn sm" data-all>${T('settings.shareAll')}</button>
          <button type="button" class="btn sm" data-none>${T('settings.shareNone')}</button>
        </div>
        <div class="draft-list">
          ${list.map((d, i) => `<div class="draft-row" data-row="${i}">
            <label class="check-row"><input type="checkbox" data-draft="${i}" checked><span><b>${UI.esc(d.title)}</b></span></label>
            <div class="draft-meta">
              <span class="tag blue">${UI.esc(tt('cat', d.category))}</span>
              <span class="tag">${d.duration} ${T('training.min')}</span>
              <span class="tag">${UI.esc(tt('intensity', d.intensity))}</span>
              ${d.muscles.map(x => `<span class="tag">${UI.esc(musLabel(x))}</span>`).join('')}
              <button type="button" class="btn sm" data-open="${i}">${T('common.edit')}</button>
            </div>
            <div class="draft-vids">
              <span class="hint">${T('exercises.videos')}</span>
              ${UI.videoEditor(d.videos || [])}
              <div class="draft-prev">${UI.videoEmbed(d, 1)}</div>
            </div>
            <div class="draft-vids">
              <span class="hint">${T('training.anims')}</span>
              ${ANIM.pickerHtml('g_anim_' + i, d.animations, sportId)}
            </div>
          </div>`).join('')}
        </div>`,
      footer: `<button class="btn ghost" data-close2>${T('common.cancel')}</button><button class="btn primary" data-save>${T('common.save')}</button>`,
      onOpen: (m, close) => {
        const boxes = [...m.querySelectorAll('[data-draft]')];
        m.querySelector('[data-all]').onclick = () => boxes.forEach(b => { b.checked = true; });
        m.querySelector('[data-none]').onclick = () => boxes.forEach(b => { b.checked = false; });
        // Editing a link writes it straight back onto the draft, so Save and the
        // Edit form both see what is on screen.
        UI.bindVideos(m, box => {
          const row = box.closest('.draft-row');
          const d = list[+row.dataset.row];
          d.videos = UI.readVideos(box);
          row.querySelector('.draft-prev').innerHTML = UI.videoEmbed(d, 1);
        });
        m.querySelectorAll('[data-open]').forEach(b => b.onclick = () => { close(); form(list[+b.dataset.open]); });
        list.forEach((d, i) => {
          const sel = m.querySelector('#g_anim_' + i);
          if (sel) sel.onchange = () => { d.animations = [...sel.selectedOptions].map(o => o.value); };
        });
        m.querySelector('[data-close2]').onclick = close;
        m.querySelector('[data-save]').onclick = async () => {
          const picked = boxes.filter(b => b.checked).map(b => list[+b.dataset.draft]);
          if (!picked.length) return UI.toast(T('exercises.aiNonePicked'), 'error');
          if (picked.some(d => (d.videos || []).some(u => !safeUrl(u)))) return UI.toast(T('training.badUrl'), 'error');
          for (const d of picked) await Store.save('exercises', Object.assign({}, d, { videos: (d.videos || []).map(safeUrl).filter(Boolean) }));
          close();
          UI.toast(picked.length + ' ' + T('exercises.aiSaved'), 'success');
          done();
        };
      }
    });
  }

  // Returns an ARRAY of drafts. `muscle` is optional — without it the request is
  // plain sport drills for the chosen category.
  async function generate(opts, muscle, count) {
    const { what, category: catPick, duration: dur, intensity } = opts;
    const n = Math.max(1, Math.min(5, count || 1));
    const sportName = SPORTS.name(sportId, 'en');
    const own = SPORTS.exerciseCategories(sportId);
    // The club's own exercise videos — the model may reuse one of these links, nothing else.
    const lib = Store.all('exercises')
      .map(e => ({ title: exTitle(e), url: videoList(e)[0] || '' }))
      .filter(e => e.url).slice(0, 30);
    const known = new Set(lib.map(e => e.url));
    const system = [
      `You design ${sportName} training exercises for a coach.`,
      'Answer with one JSON object and nothing else — no markdown, no code fence, no commentary.',
      `Shape: {"drills":[{"en":{"title":"","description":""},"da":{"title":"","description":""},"category":"","duration":0,"intensity":"","tags":[],"muscles":[],"video":"","links":[""],"search":""}]}`,
      'Every drill must carry BOTH language blocks: "en" in English and "da" in Danish. They are the same exercise written twice, not two different drills.',
      `Return exactly ${n} drill${n > 1 ? 's, each a different movement' : ''}.`,
      muscle
        ? `Every drill must load the ${muscle} as its main body part, and "muscles" must contain "${muscle}".`
        : catPick
          ? `These are ${sportName} drills for the "${catPick}" part of training — real ${sportName} work with the ball, the court and the players, not gym exercises, unless the category itself is physical.`
          : `These are ${sportName} drills for what the coach describes — real ${sportName} work with the ball, the court and the players, not gym exercises.`,
      catPick
        ? `category must be exactly "${catPick}".`
        : `category: choose the one that fits each drill best, taken only from this list: ${own.join(', ')}.`,
      `intensity must be exactly one of: ${INT.join(', ')}.`,
      'duration is whole minutes as a number. tags: 2-4 short lowercase English keywords.',
      `muscles: 1-5 keys for the body parts the exercise loads most, taken only from this list: ${MUSCLE_KEYS.join(', ')}.`,
      'description: setup and equipment, how it runs, 2-3 coaching points and one progression, as short lines, max 140 words.',
      'video: if one of the club videos listed below shows the same movement, copy its address here exactly. Otherwise leave it empty. Never invent, guess or shorten a link.',
      'links: 1-3 full YouTube addresses (https://www.youtube.com/watch?v=…) of real, public videos that demonstrate this exact drill.'
      + ' Give only ones you are confident exist — every address is checked against YouTube and a dead one is thrown away, so a wrong guess simply costs the coach the link.',
      `search: 3-6 English words for finding this drill on video, starting with the sport, e.g. "${sportName.toLowerCase()} fast break finishing drill".`,
      'Keep it safe for amateur athletes and say when to stop if there is pain.',
      lib.length ? 'Club videos:\n' + lib.map(e => `- ${e.title}: ${e.url}`).join('\n') : 'Club videos: none.'
    ].filter(Boolean).join('\n');
    const user = `Train: ${what}` + (catPick ? `\nCategory: ${catPick}` : '')
      + `\nTarget duration: ${dur} minutes\nIntensity: ${intensity}`
      + (muscle ? `\nBody part: ${muscle}` : '');

    const raw = await AI.complete(system, user, 900 + n * 900);
    if (!raw) return null;
    const body = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
    let d;
    try { d = JSON.parse(body); } catch (err) { UI.toast(T('training.aiBad'), 'error'); return null; }
    const rows = Array.isArray(d.drills) ? d.drills : [d];
    const out = rows.slice(0, n).map(r => clampDraft(r, catPick, dur, intensity, muscle, known, own, what)).filter(Boolean);
    if (!out.length) { UI.toast(T('training.aiBad'), 'error'); return null; }
    // Every suggested address is checked against YouTube; only ones that really
    // resolve are kept, and the search link stays as the fallback.
    if (out.some(x => (x.links || []).length)) UI.toast(T('exercises.aiChecking'));
    for (const drill of out) {
      const found = await AI.pickVideo(drill.links || []);
      if (found) drill.videos = [found].concat(drill.videos.filter(u => u !== found)).slice(0, 3);
      delete drill.links;
    }
    return out;
  }

  function clampDraft(d, catPick, dur, intensity, muscle, known, own, what) {
    // Both language blocks are kept; the plain fields hold the language on screen.
    const tr = {};
    LANGS.forEach(l => {
      const b = d && d[l];
      const t = String((b && b.title) || '').trim().slice(0, 80);
      if (t) tr[l] = { title: t, description: String((b && b.description) || '').trim().slice(0, 1500) };
    });
    const now = tr[I18N.getLang()] || tr[LANGS.find(l => tr[l])] || null;
    const title = (now && now.title) || String((d && d.title) || '').trim().slice(0, 80);
    if (!title) return null;
    // A club link is only accepted if it is one we sent; otherwise offer a video search for the topic.
    const video = known.has(String(d.video || '').trim()) ? String(d.video).trim() : '';
    const query = (String(d.search || '').trim() || what).slice(0, 80);
    const muscles = Array.isArray(d.muscles) ? d.muscles.map(x => String(x).trim()).filter(x => MUSCLE_KEYS.indexOf(x) >= 0).slice(0, 6) : [];
    if (muscle && muscles.indexOf(muscle) < 0) muscles.unshift(muscle);
    return {
      title,
      tr,
      category: own.includes(d.category) ? d.category : (catPick || (own.indexOf(cat) >= 0 ? cat : own[0])),
      duration: Math.min(180, Math.max(5, Math.round(+d.duration || dur))),
      intensity: INT.includes(d.intensity) ? d.intensity : intensity,
      description: (now && now.description) || String(d.description || '').trim().slice(0, 1500),
      videos: [video || 'https://www.youtube.com/results?search_query=' + encodeURIComponent(query)],
      // Checked against YouTube by the caller; whatever survives goes in front.
      links: (Array.isArray(d.links) ? d.links : []).map(u => String(u).trim()).filter(Boolean).slice(0, 3),
      tags: Array.isArray(d.tags) ? d.tags.slice(0, 5).map(t => String(t).trim().slice(0, 24)).filter(Boolean) : [],
      muscles: muscles.slice(0, 6)
    };
  }

  function form(e = {}) {
    const own = SPORTS.exerciseCategories(sportId);
    const cats2 = e.category && own.indexOf(e.category) < 0 ? own.concat([e.category]) : own;
    UI.modal({
      title: e.id ? T('exercises.editExercise') : T('exercises.newExercise'),
      width: 640,
      body: `
        <p class="hint" style="margin-top:0">${T('exercises.editLang').replace('{0}', langName(I18N.getLang()))}</p>
        <label class="field"><span>${T('training.titleField')}</span><input id="e_t" value="${UI.esc(exTitle(e))}"></label>
        <div class="row">
          <label class="field"><span>${T('training.category')}</span><select id="e_c">${cats2.map(x => `<option value="${x}" ${x === e.category ? 'selected' : ''}>${UI.esc(tt('cat', x))}</option>`).join('')}</select></label>
          <label class="field"><span>${T('training.duration')}</span><input id="e_d" type="number" value="${e.duration || 15}"></label>
          <label class="field"><span>${T('training.intensity')}</span><select id="e_i">${INT.map(x => `<option value="${x}" ${x === e.intensity ? 'selected' : ''}>${UI.esc(tt('intensity', x))}</option>`).join('')}</select></label>
        </div>
        <label class="field"><span>${T('training.description')}</span><textarea id="e_desc" rows="4">${UI.esc(exDesc(e))}</textarea></label>
        <div class="field"><span>${T('exercises.videos')}</span>
          ${UI.videoEditor(videoList(e))}
          <p class="hint">${T('exercises.videosHint')}</p></div>
        <div class="field"><span>${T('exercises.embed')}</span><div id="e_prev">${embedHtml(e) || `<p class="hint">${T('exercises.embedNone')}</p>`}</div></div>
        <label class="field"><span>${T('training.tags')}</span><input id="e_tags" value="${UI.esc((e.tags || []).join(', '))}"></label>
        <div class="field"><span>${T('exercises.muscles')}</span><div id="e_mus" class="mus-picker">${musclePicker(e.muscles || [])}</div></div>
        <label class="field"><span>${T('training.anims')}</span>${ANIM.pickerHtml('e_anim', e.animations, sportId)}</label>
        <p class="hint">${T('exercises.animsHint')}</p>`,
      footer: `<button class="btn ghost" data-close2>${T('common.cancel')}</button><button class="btn primary" data-save>${T('common.save')}</button>`,
      onOpen: (m, close) => {
        // Paste a link and the player appears straight away, so you can see you
        // got the right clip before saving.
        const prev = m.querySelector('#e_prev'), box = m.querySelector('[data-vids]');
        const urls = () => UI.readVideos(box);
        const repaint = () => {
          prev.innerHTML = UI.videoEmbed({ videos: urls(), title: e.title })
            || `<p class="hint">${T('exercises.embedNone')}</p>`;
        };
        UI.bindVideos(m, repaint);
        m.querySelector('[data-close2]').onclick = close;
        m.querySelector('[data-save]').onclick = async () => {
          const videos = urls();
          if (videos.some(u => !safeUrl(u))) return UI.toast(T('training.badUrl'), 'error');
          const title = m.querySelector('#e_t').value.trim();
          const description = m.querySelector('#e_desc').value.trim();
          if (!title) return UI.toast(T('training.titleReq'), 'error');
          const anim = m.querySelector('#e_anim');
          const obj = Object.assign({}, e, {
            title, description, category: m.querySelector('#e_c').value,
            duration: +m.querySelector('#e_d').value, intensity: m.querySelector('#e_i').value,
            // What you typed is stored under the language you typed it in.
            tr: withLang(e.tr, I18N.getLang(), title, description),
            // The list is the whole truth now; the two old single fields are folded into it.
            videos: videos.map(safeUrl).slice(0, 8), videoYt: '', videoUrl: '',
            animations: anim ? [...anim.selectedOptions].map(o => o.value) : (e.animations || []),
            tags: m.querySelector('#e_tags').value.split(',').map(s => s.trim()).filter(Boolean),
            muscles: [...m.querySelectorAll('#e_mus input:checked')].map(i => i.value).filter(v => MUSCLE_KEYS.indexOf(v) >= 0)
          });
          await Store.save('exercises', obj); close(); UI.toast(T('exercises.saved'), 'success'); done();
        };
      }
    });
  }
  render();
};
