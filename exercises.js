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
  const dt = v => { const k = 'seed.' + v; const r = T(k); return r === k ? v : r; };
  const dd = (title, desc) => { const k = 'seedDesc.' + title; const r = T(k); return r === k ? (desc || '') : r; };
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
          <div class="grid cols-2">
            ${list.map(e => `
              <div class="card" data-card="${e.id}">
                <div style="display:flex;justify-content:space-between"><h3 style="margin:0">${UI.esc(dt(e.title))}</h3><span class="tag blue">${UI.esc(tt('cat', e.category))}</span></div>
                <p style="color:var(--text-soft);margin:8px 0;font-size:13px">${UI.esc(dd(e.title, e.description))}</p>
                <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">
                  <span class="tag">${e.duration || 0} ${T('training.min')}</span><span class="tag ${e.intensity === 'High' ? 'red' : e.intensity === 'Medium' ? 'amber' : 'green'}">${UI.esc(tt('intensity', e.intensity || 'Low'))}</span>
                  ${(e.muscles || []).map(m => `<span class="tag mus-tag" data-pick="${m}">${UI.esc(musLabel(m))}</span>`).join('')}
                  ${(e.tags || []).map(t => `<span class="tag">#${UI.esc(t)}</span>`).join('')}
                </div>
                ${(() => {
        const yt = safeUrl(e.videoYt), vid = safeUrl(e.videoUrl);
        if (!yt && !vid) return '';
        return `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">
                  ${yt ? `<a class="btn sm" href="${UI.esc(yt)}" target="_blank" rel="noopener noreferrer">▶ YouTube</a>` : ''}
                  ${vid ? `<a class="btn sm" href="${UI.esc(vid)}" target="_blank" rel="noopener noreferrer">▶ ${T('training.video')}</a>` : ''}
                </div>`;
      })()}
                <button class="btn sm" data-edit="${e.id}">${T('common.edit')}</button> <button class="btn sm danger" data-del="${e.id}">${T('common.delete')}</button>
              </div>`).join('') || `<div class="empty"><div class="big">${UI.icon('dumbbell', 40)}</div>${T('exercises.none')}</div>`}
          </div>
        </div>
      </div>`;

    mount.innerHTML = UI.acc('exlib', T('exercises.title'), inner, {
      sub: T('exercises.subtitle'),
      actions: `${UI.shareBar('exercises')}
        <button class="btn" id="genEx">🤖 ${T('training.aiDrill')}</button>
        <button class="btn primary" id="addEx">+ ${T('exercises.newExercise')}</button>`
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
    mount.querySelector('#addEx').onclick = () => form();
    mount.querySelector('#genEx').onclick = () => aiForm();
    mount.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => form(Store.find('exercises', b.dataset.edit)));
    mount.querySelectorAll('[data-del]').forEach(b => b.onclick = () => UI.confirm(T('exercises.delExercise'), async () => { await Store.remove('exercises', b.dataset.del); done(); }));
    UI.bindShare(mount, 'exercises', done);
  }

  // Saving, deleting or importing also changes the sessions above, so the host
  // page is redrawn when it asked to be.
  function done() { if (opts.onChange) opts.onChange(); else render(); }

  function musclePicker(picked) {
    return Object.keys(MUSCLE_AREAS).map(a => `
      <div class="mus-group"><span class="mus-group-h">${T('area.' + a)}</span>
        ${MUSCLE_AREAS[a].map(m => `<label class="mus-pick"><input type="checkbox" value="${m}" ${picked.indexOf(m) >= 0 ? 'checked' : ''}> ${UI.esc(musLabel(m))}</label>`).join('')}
      </div>`).join('');
  }

  // Describe what to train, ChatGPT drafts the exercise, the coach reviews it in the
  // normal form before saving.
  function aiForm() {
    const own = SPORTS.exerciseCategories(sportId);
    UI.modal({
      title: T('training.aiDrill'),
      width: 560,
      body: `<p style="color:var(--muted);font-size:13px">${T('training.aiDrillIntro')}</p>
        <label class="field"><span>${T('training.aiDrillWhat')}</span>
          <textarea id="g_what" rows="3" placeholder="${UI.esc(T('training.aiDrillPh'))}"></textarea></label>
        <div class="row">
          <label class="field"><span>${T('training.category')}</span><select id="g_c">${own.map(x => `<option value="${x}">${UI.esc(tt('cat', x))}</option>`).join('')}</select></label>
          <label class="field"><span>${T('training.duration')}</span><input id="g_d" type="number" value="15"></label>
          <label class="field"><span>${T('training.intensity')}</span><select id="g_i">${INT.map(x => `<option value="${x}" ${x === 'Medium' ? 'selected' : ''}>${UI.esc(tt('intensity', x))}</option>`).join('')}</select></label>
        </div>
        <p class="hint">${T('training.aiDrillHint')}</p>`,
      footer: `<button class="btn ghost" data-close2>${T('common.cancel')}</button><button class="btn primary" data-gen>${T('training.aiGenerate')}</button>`,
      onOpen: (m, close) => {
        m.querySelector('[data-close2]').onclick = close;
        const btn = m.querySelector('[data-gen]');
        btn.onclick = async () => {
          const what = m.querySelector('#g_what').value.trim();
          if (!what) return UI.toast(T('training.aiWhatReq'), 'error');
          btn.disabled = true; btn.textContent = T('ai.asking');
          const draft = await generate(what, m.querySelector('#g_c').value, +m.querySelector('#g_d').value, m.querySelector('#g_i').value);
          btn.disabled = false; btn.textContent = T('training.aiGenerate');
          if (!draft) return;
          close();
          form(draft);
          UI.toast(T('training.aiReady'), 'success');
        };
      }
    });
  }

  async function generate(what, catPick, dur, intensity) {
    const lang = I18N.getLang() === 'da' ? 'Danish' : 'English';
    const own = SPORTS.exerciseCategories(sportId);
    // The club's own exercise videos — the model may reuse one of these links, nothing else.
    const lib = Store.all('exercises')
      .map(e => ({ title: dt(e.title), url: safeUrl(e.videoYt) || safeUrl(e.videoUrl) }))
      .filter(e => e.url).slice(0, 30);
    const known = new Set(lib.map(e => e.url));
    const system = [
      `You design ${SPORTS.name(sportId, 'en')} training exercises for a coach.`,
      `Write title, description and tags in ${lang}.`,
      'Answer with one JSON object and nothing else — no markdown, no code fence, no commentary.',
      'Shape: {"title":"","category":"","duration":0,"intensity":"","description":"","tags":[],"muscles":[],"video":"","search":""}',
      `category must be exactly one of: ${own.join(', ')}.`,
      `intensity must be exactly one of: ${INT.join(', ')}.`,
      'duration is whole minutes as a number. tags: 2-4 short lowercase keywords.',
      `muscles: 1-5 keys for the body parts the exercise loads most, taken only from this list: ${MUSCLE_KEYS.join(', ')}.`,
      'description: setup and equipment, how it runs, 2-3 coaching points and one progression, as short lines, max 140 words.',
      'video: if one of the club videos listed below shows the same movement, copy its address here exactly. Otherwise leave it empty. Never invent, guess or shorten a link.',
      'search: 3-6 English words for looking the exercise up on video, e.g. "bulgarian split squat technique".',
      'Keep it safe for amateur athletes and say when to stop if there is pain.',
      lib.length ? 'Club videos:\n' + lib.map(e => `- ${e.title}: ${e.url}`).join('\n') : 'Club videos: none.'
    ].join('\n');
    const user = `Train: ${what}\nPreferred category: ${catPick}\nTarget duration: ${dur} minutes\nIntensity: ${intensity}`;

    const raw = await AI.complete(system, user, 700);
    if (!raw) return null;
    const body = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
    let d;
    try { d = JSON.parse(body); } catch (err) { UI.toast(T('training.aiBad'), 'error'); return null; }
    const title = String(d.title || '').trim().slice(0, 80);
    if (!title) { UI.toast(T('training.aiBad'), 'error'); return null; }
    // A club link is only accepted if it is one we sent; otherwise offer a video search for the topic.
    const video = known.has(String(d.video || '').trim()) ? String(d.video).trim() : '';
    const query = (String(d.search || '').trim() || what).slice(0, 80);
    return {
      title,
      category: own.includes(d.category) ? d.category : catPick,
      duration: Math.min(180, Math.max(5, Math.round(+d.duration || dur))),
      intensity: INT.includes(d.intensity) ? d.intensity : intensity,
      description: String(d.description || '').trim().slice(0, 1500),
      videoUrl: video,
      videoYt: video ? '' : 'https://www.youtube.com/results?search_query=' + encodeURIComponent(query),
      tags: Array.isArray(d.tags) ? d.tags.slice(0, 5).map(t => String(t).trim().slice(0, 24)).filter(Boolean) : [],
      muscles: Array.isArray(d.muscles) ? d.muscles.map(x => String(x).trim()).filter(x => MUSCLE_KEYS.indexOf(x) >= 0).slice(0, 6) : []
    };
  }

  function form(e = {}) {
    const own = SPORTS.exerciseCategories(sportId);
    const cats2 = e.category && own.indexOf(e.category) < 0 ? own.concat([e.category]) : own;
    UI.modal({
      title: e.id ? T('exercises.editExercise') : T('exercises.newExercise'),
      width: 640,
      body: `
        <label class="field"><span>${T('training.titleField')}</span><input id="e_t" value="${UI.esc(e.title || '')}"></label>
        <div class="row">
          <label class="field"><span>${T('training.category')}</span><select id="e_c">${cats2.map(x => `<option value="${x}" ${x === e.category ? 'selected' : ''}>${UI.esc(tt('cat', x))}</option>`).join('')}</select></label>
          <label class="field"><span>${T('training.duration')}</span><input id="e_d" type="number" value="${e.duration || 15}"></label>
          <label class="field"><span>${T('training.intensity')}</span><select id="e_i">${INT.map(x => `<option value="${x}" ${x === e.intensity ? 'selected' : ''}>${UI.esc(tt('intensity', x))}</option>`).join('')}</select></label>
        </div>
        <label class="field"><span>${T('training.description')}</span><textarea id="e_desc" rows="4">${UI.esc(e.description || '')}</textarea></label>
        <label class="field"><span>${T('training.youtube')}</span><input id="e_yt" type="url" inputmode="url" placeholder="https://www.youtube.com/watch?v=..." value="${UI.esc(e.videoYt || '')}"></label>
        <label class="field"><span>${T('training.videoLink')}</span><input id="e_vid" type="url" inputmode="url" placeholder="https://vimeo.com/..." value="${UI.esc(e.videoUrl || '')}"></label>
        <p style="color:var(--muted);font-size:12px;margin:-4px 0 8px">${T('training.videoHint')}</p>
        <label class="field"><span>${T('training.tags')}</span><input id="e_tags" value="${UI.esc((e.tags || []).join(', '))}"></label>
        <div class="field"><span>${T('exercises.muscles')}</span><div id="e_mus" class="mus-picker">${musclePicker(e.muscles || [])}</div></div>`,
      footer: `<button class="btn ghost" data-close2>${T('common.cancel')}</button><button class="btn primary" data-save>${T('common.save')}</button>`,
      onOpen: (m, close) => {
        m.querySelector('[data-close2]').onclick = close;
        m.querySelector('[data-save]').onclick = async () => {
          const yt = m.querySelector('#e_yt').value.trim(), vid = m.querySelector('#e_vid').value.trim();
          if ((yt && !safeUrl(yt)) || (vid && !safeUrl(vid))) return UI.toast(T('training.badUrl'), 'error');
          const obj = Object.assign({}, e, {
            title: m.querySelector('#e_t').value.trim(), category: m.querySelector('#e_c').value,
            duration: +m.querySelector('#e_d').value, intensity: m.querySelector('#e_i').value,
            description: m.querySelector('#e_desc').value.trim(),
            videoYt: yt, videoUrl: vid,
            tags: m.querySelector('#e_tags').value.split(',').map(s => s.trim()).filter(Boolean),
            muscles: [...m.querySelectorAll('#e_mus input:checked')].map(i => i.value).filter(v => MUSCLE_KEYS.indexOf(v) >= 0)
          });
          if (!obj.title) return UI.toast(T('training.titleReq'), 'error');
          await Store.save('exercises', obj); close(); UI.toast(T('exercises.saved'), 'success'); done();
        };
      }
    });
  }
  render();
};
