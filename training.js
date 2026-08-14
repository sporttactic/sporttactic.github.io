/* Training Planner view */
window.Views = window.Views || {};
Views.training = function (mount) {
  const team = Store.activeTeam();
  const sportId = (window.App && App.getSport && App.getSport()) || 'handball';
  // Session foci follow the chosen sport, so a chess session never offers "Transition".
  // exerciseCategories() already ends with Physical, so it must not be added again.
  const FOCI = ['Warm-up'].concat(SPORTS.exerciseCategories(sportId));
  // Only http(s) links may reach an href — blocks javascript:/data: payloads.
  const safeUrl = (u) => {
    const s = String(u || '').trim();
    if (!s) return '';
    try { const p = new URL(s); return (p.protocol === 'http:' || p.protocol === 'https:') ? p.href : ''; }
    catch { return ''; }
  };
  // Translate an option value with fallback to the raw value.
  const tt = (p, v) => { const k = p + '.' + v; const r = T(k); return r === k ? v : r; };
  // Translate default (seed) session/exercise names; user content is unchanged.
  const dt = v => { const k = 'seed.' + v; const r = T(k); return r === k ? v : r; };
  const ex = e => UI.langText(e, 'title');   // a drill's title in the chosen language
  // A focus is Warm-up or one of the sport's categories, so the category wording
  // is reused rather than kept in a second list that drifts out of step.
  const focusLabel = v => { const c = T('cat.' + v); return c !== 'cat.' + v ? c : tt('focus', v); };
  // One drill in a plan: the name, its tags, the clip playing inline when the
  // link has a player, and the plain link when it has not.
  function drillItem(e, withCat) {
    const link = UI.videosOf(e).find(u => !UI.videoSrc(u));
    return `<li><span class="drill-head">${UI.esc(ex(e))} <span class="tag">${e.duration || 0} ${T('training.min')}</span>`
      + (withCat ? ` <span class="tag">${UI.esc(tt('cat', e.category))}</span>` : '')
      + (link ? ` <a href="${UI.esc(link)}" target="_blank" rel="noopener noreferrer">▶ ${T('training.video')}</a>` : '')
      + `</span>${UI.videoEmbed(e, 1)}</li>`;
  }

  // A read-only team copy plans its own work: the sessions and records it wrote
  // itself keep their buttons, the coach's are read. The gate is the one the
  // store uses, so a button is offered exactly when it would work.
  const mayChange = (row, store) => !Access.blocks(store || 'training', row);

  function render() {
    const sessions = Store.scoped('training').slice().sort((a, b) => a.date - b.date);
    const cards = `
      <div class="grid cols-3">
        ${sessions.map(s => `
          <div class="card">
            <div style="display:flex;justify-content:space-between;align-items:start">
              <div><h3 style="margin:0">${UI.esc(dt(s.title))}</h3><p style="color:var(--muted)">${UI.fmtDate(s.date)} · ${s.duration} ${T('training.min')}</p></div>
              <span class="tag blue">${UI.esc(focusLabel(s.focus))}</span>
            </div>
            <div style="margin-top:10px">
              ${(s.exercises || []).map(id => { const e = Store.find('exercises', id); return e ? `<div class="tag" style="margin:2px">${UI.esc(ex(e))}</div>` : ''; }).join('') || `<span style="color:var(--muted)">${T('common.noData')}</span>`}
            </div>
            ${(s.animations || []).length ? `<div style="margin-top:8px"><span class="tag blue">▶ ${(s.animations || []).length} ${T('training.anims')}</span></div>` : ''}
            <div style="margin-top:12px"><button class="btn sm" data-show="${s.id}">${T('common.show')}</button> <button class="btn sm" data-srep="${s.id}">📄 ${T('training.report')}</button>${mayChange(s) ? ` <button class="btn sm" data-edit="${s.id}">${T('common.edit')}</button> <button class="btn sm danger" data-del="${s.id}">${T('common.delete')}</button>` : ''}</div>
          </div>`).join('') || `<div class="empty"><div class="big">${UI.icon('calendar', 40)}</div>${T('training.noSessions')}</div>`}
      </div>`;

    mount.innerHTML = `
      ${AI.section('training')}
      <div class="page-head"><div><h1>${T('training.title')}</h1><p>${T('training.subtitle')}</p></div></div>
      ${UI.acc('sessions', T('training.sessions'), cards, {
      sub: T('training.sessionsHint'),
      actions: `${Access.readMode() ? '' : UI.shareBar('training')}
          ${mayChange(null) ? `<button class="btn" id="genSession">🤖 ${T('training.aiSession')}</button>
          <button class="btn primary" id="addSession">+ ${T('training.newSession')}</button>` : ''}`
    })}
      ${personalAcc()}
      ${progressAcc()}
      <div id="exLib"></div>`;

    UI.bindAcc(mount);
    const addBtn = mount.querySelector('#addSession');
    if (addBtn) addBtn.onclick = () => sessionForm();
    const genBtn = mount.querySelector('#genSession');
    if (genBtn) genBtn.onclick = () => aiSessionForm();
    UI.bindShare(mount, 'training', render);
    UI.bindShare(mount, 'personal', render);
    AI.bind(mount);
    mount.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => sessionForm(Store.find('training', b.dataset.edit)));
    mount.querySelectorAll('[data-show]').forEach(b => b.onclick = () => showSession(Store.find('training', b.dataset.show)));
    mount.querySelectorAll('[data-srep]').forEach(b => b.onclick = () => sessionReportForm(Store.find('training', b.dataset.srep)));
    mount.querySelectorAll('[data-del]').forEach(b => b.onclick = () => UI.confirm(T('training.delSession'), async () => { await Store.remove('training', b.dataset.del); render(); }));
    bindPersonal();
    bindProgress();
    // The exercise library is its own section of this page.
    Views.exerciseLib(mount.querySelector('#exLib'), { onChange: render });
  }

  // ---- Personal training & max tests --------------------------------------
  // What a single player lifts, runs or jumps under a chosen plan. Kept in its
  // own store so it can be exported on its own and handed to another coach.
  const UNITS = ['kg', 'reps', 'sec', 'm', 'cm'];
  const INT = ['Low', 'Medium', 'High'];
  const MAX_NEW = 10;   // drills one AI session may write from scratch
  const squad = () => Store.players(team && team.id);
  // CrossFit and bodybuilding are trained by one person, not by a squad, so the
  // records are labelled with a free-text name instead of a roster pick.
  const solo = () => ['crossfit', 'bodybuilding'].indexOf(sportId) >= 0;
  const athleteName = () => { try { return (localStorage.getItem('stx_athlete_name') || '').trim() || T('personal.me'); } catch { return T('personal.me'); } };
  function rememberAthlete(n) { try { localStorage.setItem('stx_athlete_name', n); } catch { /* private mode */ } }
  const entries = () => Store.scoped('personal')
    .filter(r => !r.sport || r.sport === sportId)
    .slice().sort((a, b) => (b.date || 0) - (a.date || 0));
  // Epley: a set of reps at a given load estimates the one-rep max.
  const oneRm = (kg, reps) => (kg > 0 && reps > 1) ? Math.round(kg * (1 + reps / 30)) : 0;
  const testLine = t => `${t.name}: ${t.value} ${t.unit}${t.reps > 1 ? ' \u00d7 ' + t.reps : ''}${t.unit === 'kg' && oneRm(t.value, t.reps) ? ' (1RM \u2248 ' + oneRm(t.value, t.reps) + ' kg)' : ''}`;

  function personalAcc() {
    const rows = entries();
    const body = `
      <div class="grid cols-2">
        ${rows.map(r => `
          <div class="card">
            <div style="display:flex;justify-content:space-between;align-items:start;gap:8px">
              <div><h3 style="margin:0">${UI.esc(r.playerName || T('personal.unknownPlayer'))}</h3>
                <p style="color:var(--muted);margin:2px 0 0">${UI.fmtDate(r.date)}${r.sessionTitle ? ' · ' + UI.esc(dt(r.sessionTitle)) : ''}</p></div>
              <div style="text-align:right">
                ${(r.exercises || []).length ? `<span class="tag">🏋 ${(r.exercises || []).length} ${T('personal.exercises')}</span>` : ''}
                ${(r.tests || []).length ? `<span class="tag blue">🏆 ${(r.tests || []).length} ${T('personal.tests')}</span>` : ''}
              </div>
            </div>
            ${(r.exercises || []).length ? `<div style="margin-top:10px">
              ${(r.exercises || []).map(e => `<div class="tag" style="margin:2px">${UI.esc(exLine(e))}</div>`).join('')}
            </div>` : ''}
            ${(r.tests || []).length ? `<div style="margin-top:6px">
              ${(r.tests || []).map(t => `<div class="tag blue" style="margin:2px">${UI.esc(testLine(t))}</div>`).join('')}
            </div>` : ''}
            ${!(r.exercises || []).length && !(r.tests || []).length ? `<div style="margin-top:10px;color:var(--muted)">${T('common.noData')}</div>` : ''}
            ${r.notes ? `<p style="margin:10px 0 0;color:var(--text-soft)">${UI.esc(r.notes)}</p>` : ''}
            <div style="margin-top:12px">
              <button class="btn sm" data-pshow="${r.id}">${T('common.show')}</button>
              <button class="btn sm" data-prep="${r.id}">📄 ${T('training.report')}</button>
              <button class="btn sm" data-pmax="${r.id}">🤖 ${T('personal.aiMax')}</button>
              ${mayChange(r, 'personal') ? `<button class="btn sm" data-pedit="${r.id}">${T('common.edit')}</button>
              <button class="btn sm danger" data-pdel="${r.id}">${T('common.delete')}</button>` : ''}
            </div>
          </div>`).join('') || `<div class="empty"><div class="big">${UI.icon('dumbbell', 40)}</div>${T('personal.none')}</div>`}
      </div>`;
    return UI.acc('personal', T('personal.title'), body, {
      sub: T('personal.hint'),
      actions: `${Access.readMode() ? '' : UI.shareBar('personal')}
        <button class="btn" id="personalReport">📄 ${T('training.report')}</button>
        ${mayChange(null, 'personal') ? `<button class="btn" id="aiMax">🤖 ${T('personal.aiMax')}</button>
        <button class="btn primary" id="addPersonal">+ ${T('personal.new')}</button>` : ''}`
    });
  }

  function bindPersonal() {
    const addBtn = mount.querySelector('#addPersonal');
    if (addBtn) addBtn.onclick = () => personalForm();
    const maxBtn = mount.querySelector('#aiMax');
    if (maxBtn) maxBtn.onclick = () => maxTestForm();
    mount.querySelector('#personalReport').onclick = () => personalSummaryForm();
    mount.querySelectorAll('[data-pedit]').forEach(b => b.onclick = () => personalForm(Store.find('personal', b.dataset.pedit)));
    mount.querySelectorAll('[data-pshow]').forEach(b => b.onclick = () => showPersonal(Store.find('personal', b.dataset.pshow)));
    mount.querySelectorAll('[data-prep]').forEach(b => b.onclick = () => personalReport(Store.find('personal', b.dataset.prep)));
    mount.querySelectorAll('[data-pmax]').forEach(b => b.onclick = () => {
      const r = Store.find('personal', b.dataset.pmax);
      if (r) maxTestForm(r.playerId, r.sessionId, r.playerName);
    });
    mount.querySelectorAll('[data-pdel]').forEach(b => b.onclick = () => UI.confirm(T('personal.del'), async () => { await Store.remove('personal', b.dataset.pdel); render(); }));
  }

  // ---- Status & progression -----------------------------------------------
  // Its own section under the sessions: one curve that answers "is the work
  // going up?". The chart is an SVG that scrolls sideways instead of shrinking,
  // so on an iPhone every point stays big enough to tap; on an iPad the whole
  // period fits at once.
  const PROG_KEY = 'stx_progress_' + sportId;
  const METRICS = ['volume', 'onerm', 'load', 'reps'];
  const RANGES = ['90', '180', '365', '0'];
  const KG = { volume: 'kg', onerm: 'kg', load: 'kg', reps: '' };
  const normName = s => String(s || '').trim().toLowerCase();
  let prog = readProg();
  function readProg() {
    const d = { who: '', ex: '', metric: 'volume', range: '365' };
    try { return Object.assign(d, JSON.parse(localStorage.getItem(PROG_KEY) || '{}')); } catch { return d; }
  }
  function writeProg() { try { localStorage.setItem(PROG_KEY, JSON.stringify(prog)); } catch { /* private mode */ } }
  const num = n => Math.round(n).toLocaleString(I18N.getLang() === 'da' ? 'da-DK' : 'en-GB');
  const withUnit = v => num(v) + (KG[prog.metric] ? ' ' + KG[prog.metric] : '');

  // Everyone and every exercise that actually appears in the records.
  function progWho() { return [...new Set(entries().map(r => (r.playerName || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)); }
  function progNames() {
    const map = new Map();
    entries().forEach(r => (r.exercises || []).concat(r.tests || []).forEach(x => {
      const n = String(x.name || '').trim();
      if (n && !map.has(normName(n))) map.set(normName(n), n);
    }));
    return [...map.values()].sort((a, b) => a.localeCompare(b));
  }

  // One number per record, according to the chosen measure.
  function progValue(r) {
    const keep = x => !prog.ex || normName(x.name) === normName(prog.ex);
    const exs = (r.exercises || []).filter(keep);
    const tests = (r.tests || []).filter(keep);
    const kg = exs.concat(tests).filter(x => x.unit === 'kg' && x.value > 0);
    if (prog.metric === 'reps') return exs.reduce((n, e) => n + (e.sets || 1) * (e.reps || 1), 0) + tests.reduce((n, t) => n + (t.reps || 1), 0);
    if (prog.metric === 'load') return Math.max(0, ...kg.map(x => +x.value || 0));
    if (prog.metric === 'onerm') return Math.max(0, ...tests.concat(exs).filter(x => x.unit === 'kg' && x.value > 0).map(x => oneRm(+x.value, x.reps || 1) || +x.value));
    return exs.reduce((n, e) => n + volume(e), 0)
      + tests.reduce((n, t) => n + ((t.unit === 'kg' && t.value > 0) ? Math.round(t.value * (t.reps || 1)) : 0), 0);
  }

  function progSeries() {
    const days = +prog.range || 0;
    const from = days ? Date.now() - days * 864e5 : 0;
    return entries()
      .filter(r => (!prog.who || (r.playerName || '').trim() === prog.who) && (r.date || 0) >= from)
      .filter(r => !prog.ex || (r.exercises || []).concat(r.tests || []).some(x => normName(x.name) === normName(prog.ex)))
      .map(r => ({ t: r.date || 0, v: progValue(r), who: r.playerName || '', id: r.id }))
      .filter(p => p.v > 0)
      .sort((a, b) => a.t - b.t);
  }

  function progressAcc() {
    const who = progWho(), names = progNames();
    const opt = (v, label, sel) => `<option value="${UI.esc(v)}" ${sel ? 'selected' : ''}>${UI.esc(label)}</option>`;
    const body = `
      <div class="pg-controls">
        <label class="field"><span>${T('progress.athlete')}</span><select id="pg_who">
          ${opt('', T('progress.all'), !prog.who)}${who.map(n => opt(n, n, n === prog.who)).join('')}</select></label>
        <label class="field"><span>${T('progress.exercise')}</span><select id="pg_ex">
          ${opt('', T('progress.allEx'), !prog.ex)}${names.map(n => opt(n, n, n === prog.ex)).join('')}</select></label>
        <label class="field"><span>${T('progress.metric')}</span><select id="pg_metric">
          ${METRICS.map(m => opt(m, T('progress.m_' + m), m === prog.metric)).join('')}</select></label>
        <label class="field"><span>${T('progress.range')}</span><select id="pg_range">
          ${RANGES.map(d => opt(d, T('progress.r' + d), d === prog.range)).join('')}</select></label>
      </div>
      <div id="pgBody"></div>`;
    return UI.acc('progress', T('progress.title'), body, { sub: T('progress.hint') });
  }

  function bindProgress() {
    const pick = id => mount.querySelector(id);
    [['#pg_who', 'who'], ['#pg_ex', 'ex'], ['#pg_metric', 'metric'], ['#pg_range', 'range']].forEach(([sel, key]) => {
      const el = pick(sel);
      if (el) el.onchange = () => { prog[key] = el.value; writeProg(); drawProgress(); };
    });
    drawProgress();
  }

  // Round the top of the scale up to a readable number so the grid labels are
  // not 2 877 kg but 3 000 kg.
  function niceTop(v) {
    if (!(v > 0)) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    return Math.ceil((v / p) * 2) / 2 * p;
  }

  // Compact labels keep the chart small: 2 875 becomes 2.9k, and the axis dates
  // drop the year.
  const kNum = n => (Math.abs(n) >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'k' : String(Math.round(n)));
  const shortDate = t => {
    try { return new Date(t).toLocaleDateString(I18N.getLang() === 'da' ? 'da-DK' : 'en-GB', { day: '2-digit', month: 'short' }); }
    catch (e) { return UI.fmtDate(t); }
  };

  function chartSvg(pts) {
    const H = 168, L = 40, R = 12, TOP = 10, B = 26;
    const W = Math.max(320, L + R + Math.max(1, pts.length - 1) * 46);
    const top = niceTop(Math.max(...pts.map(p => p.v)));
    const x = i => (pts.length < 2) ? L + (W - L - R) / 2 : L + i * (W - L - R) / (pts.length - 1);
    const y = v => TOP + (1 - v / top) * (H - TOP - B);
    const base = y(0);
    const pt = pts.map((p, i) => [x(i), y(p.v)]);
    // Catmull-Rom through every point, expressed as cubic Béziers — a real
    // curve rather than a zig-zag of straight segments.
    let d = `M${pt[0][0].toFixed(1)} ${pt[0][1].toFixed(1)}`;
    for (let i = 0; i < pt.length - 1; i++) {
      const p0 = pt[i - 1] || pt[i], p1 = pt[i], p2 = pt[i + 1], p3 = pt[i + 2] || p2;
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
      const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      d += ` C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
    }
    const area = pts.length > 1 ? `<path class="pg-area" d="${d} L${pt[pt.length - 1][0].toFixed(1)} ${base} L${pt[0][0].toFixed(1)} ${base} Z"/>` : '';
    const grid = [0, 1, 2, 3].map(k => {
      const v = top * k / 3, gy = y(v).toFixed(1);
      return `<line class="pg-grid" x1="${L}" y1="${gy}" x2="${W - R}" y2="${gy}"/>`
        + `<text class="pg-ylbl" x="${L - 6}" y="${(+gy + 4).toFixed(1)}" text-anchor="end">${UI.esc(kNum(v))}</text>`;
    }).join('');
    const step = Math.ceil(pts.length / 5);
    // Label every nth point plus the last one — but drop the previous label when
    // the last one would land right on top of it.
    const marks = [];
    for (let i = 0; i < pts.length; i += step) marks.push(i);
    const lastIdx = pts.length - 1;
    if (marks[marks.length - 1] !== lastIdx) {
      if (lastIdx - marks[marks.length - 1] < step) marks.pop();
      marks.push(lastIdx);
    }
    const xlbl = marks.map(i => {
      const p = pts[i];
      // The outermost dates would run past the edge of a middle-anchored label.
      const anchor = i === 0 ? 'start' : (i === lastIdx ? 'end' : 'middle');
      const px = i === 0 ? x(i) - 8 : (i === lastIdx ? x(i) + 8 : x(i));
      return `<text class="pg-xlbl" x="${px.toFixed(1)}" y="${H - 8}" text-anchor="${anchor}">${UI.esc(shortDate(p.t))}</text>`;
    }).join('');
    const dots = pts.map((p, i) => `<g class="pg-pt" data-i="${i}" tabindex="0" role="button">`
      + `<title>${UI.esc(UI.fmtDate(p.t) + ' · ' + withUnit(p.v))}</title>`
      + `<circle class="pg-hit" cx="${x(i).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="15"/>`
      + `<circle class="pg-dot" cx="${x(i).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="4.5"/></g>`).join('');
    return `<div class="pg-scroll"><svg class="pg-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${UI.esc(T('progress.title'))}">
      ${grid}${area}<path class="pg-line" d="${d}"/>${xlbl}${dots}</svg></div>`;
  }

  function drawProgress() {
    const host = mount.querySelector('#pgBody');
    if (!host) return;
    const pts = progSeries();
    if (!pts.length) {
      host.innerHTML = `<div class="empty"><div class="big">${UI.icon('dumbbell', 40)}</div>${T('progress.none')}</div>`;
      return;
    }
    const first = pts[0].v, last = pts[pts.length - 1].v;
    const bestP = pts.reduce((a, b) => (b.v > a.v ? b : a), pts[0]);
    const change = first > 0 ? Math.round((last - first) / first * 100) : 0;
    const sum = pts.reduce((n, p) => n + p.v, 0);
    const totalCard = (prog.metric === 'volume' || prog.metric === 'reps')
      ? UI.statCard(withUnit(sum), T('progress.total'))
      : UI.statCard(withUnit(bestP.v), T('progress.best'));
    host.innerHTML = `
      <div class="grid cols-4 pg-cards">
        ${UI.statCard(pts.length, T('progress.entries'))}
        ${UI.statCard(withUnit(last), T('progress.latest'))}
        ${totalCard}
        ${UI.statCard((change > 0 ? '+' : '') + change + '%', T('progress.trend'), pts.length > 1 ? { dir: change < 0 ? 'down' : 'up', text: shortDate(pts[0].t) + ' → ' + shortDate(pts[pts.length - 1].t) } : null)}
      </div>
      ${chartSvg(pts)}
      <p class="hint" id="pgRead">${UI.esc(T('progress.tapHint'))}</p>`;
    const read = host.querySelector('#pgRead');
    host.querySelectorAll('.pg-pt').forEach(g => {
      const show = () => {
        const p = pts[+g.dataset.i];
        host.querySelectorAll('.pg-pt').forEach(o => o.classList.remove('on'));
        g.classList.add('on');
        read.textContent = UI.fmtDate(p.t) + ' · ' + withUnit(p.v) + (p.who ? ' · ' + p.who : '');
      };
      g.onclick = show;
      g.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); show(); } };
    });
  }

  // ---- Personal record details --------------------------------------------
  // Which body parts a record loads is taken from the drill library: a test name
  // that matches a drill inherits that drill's muscles, and the linked plan adds
  // the muscles of the drills it runs.
  function musclesFor(r) {
    const set = new Set();
    const lib = Store.all('exercises');
    const norm = s => String(s || '').trim().toLowerCase();
    const add = e => (e.muscles || []).forEach(m => set.add(m));
    (r.tests || []).concat(r.exercises || []).forEach(t => {
      const n = norm(t.name);
      if (!n) return;
      lib.forEach(e => {
        const a = norm(e.title), b = norm(ex(e));
        if (a === n || b === n || (a && n.indexOf(a) >= 0) || (b && n.indexOf(b) >= 0)) add(e);
      });
    });
    const plan = r.sessionId && Store.find('training', r.sessionId);
    if (plan) (plan.exercises || []).forEach(id => { const e = Store.find('exercises', id); if (e) add(e); });
    return set;
  }

  function showPersonal(r) {
    if (!r) return;
    const tests = r.tests || [];
    const exs = r.exercises || [];
    const hit = musclesFor(r);
    const canMap = typeof muscleBodySvg === 'function';
    const musLabel = m => tt('mus', m);
    const areaOf = (typeof MUSCLE_AREA_OF === 'object' && MUSCLE_AREA_OF) || {};
    const grouped = {};
    hit.forEach(m => { const a = areaOf[m] || 'upper'; (grouped[a] = grouped[a] || []).push(m); });
    const plan = r.sessionId && Store.find('training', r.sessionId);
    UI.modal({
      title: UI.esc(r.playerName || T('personal.unknownPlayer')),
      width: 720,
      body: `
        <p class="hint" style="margin-top:0">${UI.fmtDate(r.date)}${r.sessionTitle ? ' · ' + UI.esc(dt(r.sessionTitle)) : ''}</p>
        <h4 style="margin-bottom:6px">🏋 ${T('personal.exercises')}</h4>
        ${exs.length ? `<table class="table"><thead><tr>
            <th>${T('personal.exercise')}</th><th>${T('personal.sets')}</th><th>${T('personal.reps')}</th><th>${T('personal.load')}</th><th>${T('personal.volume')}</th></tr></thead>
          <tbody>${exs.map(e => `<tr>
            <td>${UI.esc(e.name || '')}</td>
            <td>${UI.esc(e.sets || 1)}</td>
            <td>${UI.esc(e.reps || 1)}</td>
            <td>${e.value > 0 ? UI.esc(e.value) + ' ' + UI.esc(e.unit || '') : '—'}</td>
            <td>${volume(e) ? volume(e) + ' kg' : '—'}</td></tr>`).join('')}</tbody></table>`
        : `<p class="hint">${T('common.noData')}</p>`}
        <h4 style="margin-bottom:6px">🏆 ${T('personal.tests')}</h4>
        ${tests.length ? `<table class="table"><thead><tr>
            <th>${T('personal.exercise')}</th><th>${T('personal.value')}</th><th>${T('personal.reps')}</th><th>${T('personal.oneRm')}</th></tr></thead>
          <tbody>${tests.map(t => `<tr>
            <td>${UI.esc(t.name || '')}</td>
            <td>${UI.esc(t.value == null ? '' : t.value)} ${UI.esc(t.unit || '')}</td>
            <td>${UI.esc(t.reps || 1)}</td>
            <td>${t.unit === 'kg' && oneRm(t.value, t.reps) ? oneRm(t.value, t.reps) + ' kg' : '—'}</td></tr>`).join('')}</tbody></table>`
        : `<p class="hint">${T('common.noData')}</p>`}
        ${r.notes ? `<p style="color:var(--text-soft)">${UI.esc(r.notes)}</p>` : ''}
        ${plan ? `<p class="hint">${T('personal.plan')}: ${UI.esc(dt(plan.title))}</p>` : ''}
        <h4 style="margin-bottom:6px">${T('personal.bodyTitle')}</h4>
        ${canMap ? `<div class="body-modal">${muscleBodySvg(T('body.front'), T('body.back'))}</div>` : ''}
        ${hit.size
        ? `<div style="display:flex;gap:6px;flex-wrap:wrap">${Object.keys(grouped).map(a =>
          `<span class="tag blue">${UI.esc(T('area.' + a))}</span>` +
          grouped[a].map(m => `<span class="tag">${UI.esc(musLabel(m))}</span>`).join('')).join('')}</div>
           <p class="hint">${T('personal.bodyHint')}</p>`
        : `<p class="hint">${T('personal.noMuscles')}</p>`}`,
      footer: `<button class="btn ghost" data-close2>${T('common.close')}</button><button class="btn primary" data-edit>${T('common.edit')}</button>`,
      onOpen: (m, close) => {
        m.querySelectorAll('.mus').forEach(g => g.classList.toggle('on', hit.has(g.dataset.m)));
        m.querySelector('[data-close2]').onclick = close;
        m.querySelector('[data-edit]').onclick = () => { close(); personalForm(r); };
      }
    });
  }

  // ---- Printable reports ---------------------------------------------------
  // A session sheet the coach can hand to a player, and a record of what one
  // athlete has actually lifted. Both open a self-contained print window, so
  // they work offline and need no PDF library.
  const REPORT_CSS = `
    body { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #111; margin: 0; padding: 28px; }
    h1 { font-size: 22px; margin: 0 0 4px; }
    h2 { font-size: 16px; margin: 22px 0 6px; padding-bottom: 4px; border-bottom: 2px solid #111; }
    h3 { font-size: 14px; margin: 14px 0 4px; }
    p.sub { color: #555; margin: 0 0 16px; font-size: 13px; }
    p.foot { color: #777; font-size: 11px; margin-top: 28px; border-top: 1px solid #ccc; padding-top: 6px; }
    table { border-collapse: collapse; width: 100%; margin: 6px 0 10px; font-size: 12px; }
    th, td { border: 1px solid #bbb; padding: 5px 8px; text-align: left; vertical-align: top; }
    th { background: #eee; }
    ul { margin: 4px 0 10px; padding-left: 18px; font-size: 12px; }
    .meta { font-size: 12px; color: #333; margin: 0 0 10px; }
    .note { border: 1px solid #bbb; height: 58px; margin: 4px 0 12px; }
    .none { color: #777; font-size: 12px; font-style: italic; }
    .sign { margin-top: 10px; font-size: 12px; color: #333; }
    @media print { body { padding: 0; } h2 { page-break-after: avoid; } section { page-break-inside: avoid; } }`;

  function printReport(title, sub, html) {
    const w = window.open('', '_blank');
    if (!w) return UI.toast(T('training.popupBlocked'), 'error');
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${UI.esc(title)}</title><style>${REPORT_CSS}</style></head><body>`
      + `<h1>${UI.esc(title)}</h1><p class="sub">${UI.esc(sub)}</p>${html}`
      + `<p class="foot">SportTactic · ${UI.esc(UI.fmtDate(Date.now()))}</p></body></html>`);
    w.document.close();
    setTimeout(() => { try { w.print(); } catch (e) { /* the user can print it themselves */ } }, 300);
  }

  const teamLine = () => [team && team.name, SPORTS.name(sportId, I18N.getLang())].filter(Boolean).join(' · ');
  const recTitle = r => (r.playerName || T('personal.unknownPlayer'));

  // Which personal records belong to a plan, optionally for one player only.
  const recordsFor = (sessionId, playerKey) => entries()
    .filter(r => r.sessionId === sessionId && (!playerKey || rowKey(r) === playerKey))
    .sort((a, b) => (a.date || 0) - (b.date || 0));
  const rowKey = r => r.playerId || ('name:' + (r.playerName || ''));

  function exTableHtml(exs) {
    if (!exs.length) return '';
    return `<table><thead><tr><th>${T('personal.exercise')}</th><th>${T('personal.sets')}</th><th>${T('personal.reps')}</th><th>${T('personal.load')}</th><th>${T('personal.volume')}</th></tr></thead><tbody>`
      + exs.map(e => `<tr><td>${UI.esc(e.name || '')}</td><td>${UI.esc(e.sets || 1)}</td><td>${UI.esc(e.reps || 1)}</td>`
        + `<td>${e.value > 0 ? UI.esc(e.value + ' ' + (e.unit || '')) : '—'}</td><td>${volume(e) ? volume(e) + ' kg' : '—'}</td></tr>`).join('')
      + '</tbody></table>';
  }
  function testTableHtml(tests) {
    if (!tests.length) return '';
    return `<table><thead><tr><th>${T('personal.exercise')}</th><th>${T('personal.value')}</th><th>${T('personal.reps')}</th><th>${T('personal.oneRm')}</th></tr></thead><tbody>`
      + tests.map(t => `<tr><td>${UI.esc(t.name || '')}</td><td>${UI.esc((t.value == null ? '' : t.value) + ' ' + (t.unit || ''))}</td>`
        + `<td>${UI.esc(t.reps || 1)}</td><td>${t.unit === 'kg' && oneRm(t.value, t.reps) ? oneRm(t.value, t.reps) + ' kg' : '—'}</td></tr>`).join('')
      + '</tbody></table>';
  }

  // Pick who the session sheet is for; a blank sheet is printed for a player
  // with nothing recorded yet, so it doubles as the form they fill in.
  function sessionReportForm(s) {
    if (!s) return;
    const players = squad();
    const rows = players.length
      ? `<div class="focus-acts">
           <button type="button" class="btn sm" data-all>${T('settings.shareAll')}</button>
           <button type="button" class="btn sm" data-none>${T('settings.shareNone')}</button>
         </div>
         <div class="menu-picker">${players.map(p => `<label class="check-row menu-row"><input type="checkbox" data-p="${p.id}" checked><span>#${UI.esc(p.number || '?')} ${UI.esc([p.firstName, p.lastName].filter(Boolean).join(' '))}</span></label>`).join('')}</div>`
      : `<p class="hint">${T('training.reportNoPlayers')}</p>`;
    UI.modal({
      title: T('training.reportSession'),
      width: 640,
      body: `<p class="hint" style="margin-top:0">${UI.esc(dt(s.title || ''))} · ${UI.fmtDate(s.date)} · ${s.duration || 0} ${T('training.min')}</p>
        ${rows}
        <label class="check-row"><input type="checkbox" id="r_desc" checked><span>${T('training.reportDesc')}</span></label>
        <label class="check-row"><input type="checkbox" id="r_blank" checked><span>${T('training.reportBlank')}</span></label>`,
      footer: `<button class="btn ghost" data-close2>${T('common.cancel')}</button><button class="btn primary" data-go>${T('training.reportPrint')}</button>`,
      onOpen: (m, close) => {
        const boxes = [...m.querySelectorAll('[data-p]')];
        const all = m.querySelector('[data-all]');
        if (all) all.onclick = () => boxes.forEach(b => { b.checked = true; });
        const none = m.querySelector('[data-none]');
        if (none) none.onclick = () => boxes.forEach(b => { b.checked = false; });
        m.querySelector('[data-close2]').onclick = close;
        m.querySelector('[data-go]').onclick = () => {
          const picked = boxes.filter(b => b.checked).map(b => Store.find('players', b.dataset.p)).filter(Boolean);
          close();
          sessionReport(s, picked, { desc: m.querySelector('#r_desc').checked, blank: m.querySelector('#r_blank').checked });
        };
      }
    });
  }

  function sessionReport(s, players, opts) {
    const drills = (s.exercises || []).map(id => Store.find('exercises', id)).filter(Boolean);
    const drillHtml = drills.length
      ? `<table><thead><tr><th>${T('training.titleField')}</th><th>${T('training.category')}</th><th>${T('training.duration')}</th><th>${T('training.intensity')}</th><th>${T('exercises.muscles')}</th></tr></thead><tbody>`
      + drills.map(e => `<tr><td>${UI.esc(ex(e))}${opts.desc && e.description ? `<br><span class="none">${UI.esc(e.description)}</span>` : ''}</td>`
        + `<td>${UI.esc(tt('cat', e.category))}</td><td>${e.duration || 0} ${T('training.min')}</td>`
        + `<td>${UI.esc(tt('intensity', e.intensity || 'Low'))}</td>`
        + `<td>${(e.muscles || []).map(x => UI.esc(tt('mus', x))).join(', ') || '—'}</td></tr>`).join('')
      + '</tbody></table>'
      : `<p class="none">${T('common.noData')}</p>`;

    const perPlayer = players.map(p => {
      const key = p.id;
      const recs = recordsFor(s.id, key);
      const body = recs.length
        ? recs.map(r => `<h3>${UI.fmtDate(r.date)}</h3>${exTableHtml(r.exercises || [])}${testTableHtml(r.tests || [])}`
          + (r.notes ? `<p class="meta">${UI.esc(r.notes)}</p>` : '')).join('')
        : (opts.blank
          ? `<table><thead><tr><th>${T('personal.exercise')}</th><th>${T('personal.sets')}</th><th>${T('personal.reps')}</th><th>${T('personal.load')}</th><th>${T('training.notes')}</th></tr></thead><tbody>`
          + (drills.length ? drills : [{ title: '' }, { title: '' }, { title: '' }])
            .map(e => `<tr><td>${UI.esc(e.title ? ex(e) : '')}</td><td></td><td></td><td></td><td></td></tr>`).join('')
          + '</tbody></table>'
          : `<p class="none">${T('training.reportNothing')}</p>`);
      return `<section><h2>#${UI.esc(p.number || '?')} ${UI.esc([p.firstName, p.lastName].filter(Boolean).join(' '))}</h2>`
        + `<p class="meta">${UI.esc(tt('pos', p.position) || p.position || '')}${p.height ? ' · ' + p.height + ' cm' : ''}${p.weight ? ' · ' + p.weight + ' kg' : ''}</p>`
        + body
        + (opts.blank ? `<p class="meta">${T('training.notes')}</p><div class="note"></div>` : '')
        + `<p class="sign">${T('training.reportSign')}</p></section>`;
    }).join('');

    printReport(
      T('training.reportSession') + ' — ' + dt(s.title || ''),
      [teamLine(), UI.fmtDate(s.date), (s.duration || 0) + ' ' + T('training.min'), focusLabel(s.focus)].filter(Boolean).join(' · '),
      `<h2>${T('training.drills')}</h2>${drillHtml}${perPlayer}`
    );
  }

  // One saved personal record, printed on its own.
  function personalReport(r) {
    if (!r) return;
    const plan = r.sessionId && Store.find('training', r.sessionId);
    printReport(
      T('personal.title') + ' — ' + recTitle(r),
      [teamLine(), UI.fmtDate(r.date), plan ? dt(plan.title) : ''].filter(Boolean).join(' · '),
      `<h2>🏋 ${T('personal.exercises')}</h2>${exTableHtml(r.exercises || []) || `<p class="none">${T('common.noData')}</p>`}`
      + `<h2>🏆 ${T('personal.tests')}</h2>${testTableHtml(r.tests || []) || `<p class="none">${T('common.noData')}</p>`}`
      + (r.notes ? `<h2>${T('training.notes')}</h2><p class="meta">${UI.esc(r.notes)}</p>` : '')
      + `<p class="sign">${T('personal.safety')}</p>`
    );
  }

  // Everything one athlete has recorded, newest last, with their best lifts on top.
  function personalSummaryForm() {
    const rows = entries();
    if (!rows.length) return UI.toast(T('personal.none'), 'error');
    const who = [...new Set(rows.map(r => (r.playerName || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    UI.modal({
      title: T('training.reportPersonal'),
      width: 560,
      body: `<p class="hint" style="margin-top:0">${T('training.reportPersonalHint')}</p>
        <label class="field"><span>${T('progress.athlete')}</span><select id="pr_who"><option value="">${T('progress.all')}</option>${who.map(n => `<option value="${UI.esc(n)}">${UI.esc(n)}</option>`).join('')}</select></label>`,
      footer: `<button class="btn ghost" data-close2>${T('common.cancel')}</button><button class="btn primary" data-go>${T('training.reportPrint')}</button>`,
      onOpen: (m, close) => {
        m.querySelector('[data-close2]').onclick = close;
        m.querySelector('[data-go]').onclick = () => { const v = m.querySelector('#pr_who').value; close(); personalSummary(v); };
      }
    });
  }

  function personalSummary(whoName) {
    const rows = entries().filter(r => !whoName || (r.playerName || '').trim() === whoName)
      .sort((a, b) => (a.date || 0) - (b.date || 0));
    if (!rows.length) return UI.toast(T('personal.none'), 'error');
    // Best kg result per exercise across every record, so the sheet opens with the maxima.
    const best = new Map();
    rows.forEach(r => (r.tests || []).concat(r.exercises || []).forEach(x => {
      if (x.unit !== 'kg' || !(x.value > 0)) return;
      const cur = best.get(x.name);
      const est = oneRm(x.value, x.reps || 1) || x.value;
      if (!cur || est > cur.est) best.set(x.name, { name: x.name, value: x.value, reps: x.reps || 1, est });
    }));
    const bestHtml = best.size
      ? `<table><thead><tr><th>${T('personal.exercise')}</th><th>${T('personal.value')}</th><th>${T('personal.reps')}</th><th>${T('personal.oneRm')}</th></tr></thead><tbody>`
      + [...best.values()].sort((a, b) => b.est - a.est).map(b => `<tr><td>${UI.esc(b.name)}</td><td>${b.value} kg</td><td>${b.reps}</td><td>${b.est} kg</td></tr>`).join('')
      + '</tbody></table>'
      : `<p class="none">${T('common.noData')}</p>`;
    const body = rows.map(r => {
      const plan = r.sessionId && Store.find('training', r.sessionId);
      return `<section><h2>${UI.fmtDate(r.date)}${whoName ? '' : ' — ' + UI.esc(recTitle(r))}</h2>`
        + (plan ? `<p class="meta">${T('personal.plan')}: ${UI.esc(dt(plan.title))}</p>` : '')
        + exTableHtml(r.exercises || []) + testTableHtml(r.tests || [])
        + (r.notes ? `<p class="meta">${UI.esc(r.notes)}</p>` : '') + '</section>';
    }).join('');
    printReport(
      T('training.reportPersonal') + (whoName ? ' — ' + whoName : ''),
      [teamLine(), UI.fmtDate(rows[0].date) + ' – ' + UI.fmtDate(rows[rows.length - 1].date), rows.length + ' ' + T('progress.entries')].filter(Boolean).join(' · '),
      `<h2>🏆 ${T('training.reportBest')}</h2>${bestHtml}${body}`
    );
  }

  function testRowHtml(t) {
    t = t || {};
    return `<div class="test-row">
      <input class="cell" data-tn list="exNames" value="${UI.esc(t.name || '')}" placeholder="${UI.esc(T('personal.exercise'))}">
      <input class="cell" data-tv type="number" step="any" value="${UI.esc(t.value == null ? '' : t.value)}" placeholder="${UI.esc(T('personal.value'))}">
      <select class="cell" data-tu>${UNITS.map(u => `<option ${u === t.unit ? 'selected' : ''}>${u}</option>`).join('')}</select>
      <input class="cell" data-tr type="number" value="${UI.esc(t.reps || 1)}" title="${UI.esc(T('personal.reps'))}">
      <button type="button" class="btn sm danger" data-trm>✕</button>
    </div>`;
  }
  // A session of ordinary work: sets × reps at a load, not a one-off maximum.
  function exRowHtml(e) {
    e = e || {};
    return `<div class="ex-row">
      <input class="cell" data-en list="exNames" value="${UI.esc(e.name || '')}" placeholder="${UI.esc(T('personal.exercise'))}">
      <input class="cell" data-es type="number" value="${UI.esc(e.sets || 3)}" title="${UI.esc(T('personal.sets'))}" placeholder="${UI.esc(T('personal.sets'))}">
      <input class="cell" data-er type="number" value="${UI.esc(e.reps || 10)}" title="${UI.esc(T('personal.reps'))}" placeholder="${UI.esc(T('personal.reps'))}">
      <input class="cell" data-ev type="number" step="any" value="${UI.esc(e.value == null ? '' : e.value)}" title="${UI.esc(T('personal.load'))}" placeholder="${UI.esc(T('personal.load'))}">
      <select class="cell" data-eu>${UNITS.map(u => `<option ${u === e.unit ? 'selected' : ''}>${u}</option>`).join('')}</select>
      <button type="button" class="btn sm danger" data-erm>✕</button>
    </div>`;
  }
  // sets × reps × load — only meaningful for a weight.
  const volume = e => (e.unit === 'kg' && e.value > 0) ? Math.round(e.sets * e.reps * e.value) : 0;
  const exLine = e => `${e.name}: ${e.sets} × ${e.reps}${e.value > 0 ? ' @ ' + e.value + ' ' + e.unit : ''}`;

  function personalForm(r = {}) {
    const players = squad();
    const sessions = Store.scoped('training').slice().sort((a, b) => a.date - b.date);
    const drills = Store.all('exercises');
    const dstr = new Date(r.date || Date.now()).toISOString().slice(0, 10);
    if (!solo() && !players.length) return UI.toast(T('personal.noPlayers'), 'error');
    const whoField = solo()
      ? `<label class="field"><span>${T('personal.athlete')}</span><input id="p_name" maxlength="60" value="${UI.esc(r.playerName || athleteName())}"></label>`
      : `<label class="field"><span>${T('personal.player')}</span><select id="p_player">${players.map(p => `<option value="${p.id}" ${p.id === r.playerId ? 'selected' : ''}>#${UI.esc(p.number)} ${UI.esc(p.lastName || p.firstName)}</option>`).join('')}</select></label>`;
    UI.modal({
      title: r.id ? T('personal.edit') : T('personal.new'),
      width: 700,
      body: `
        <datalist id="exNames">${drills.map(e => `<option value="${UI.esc(ex(e))}"></option>`).join('')}</datalist>
        <div class="row">
          ${whoField}
          <label class="field"><span>${T('personal.plan')}</span><select id="p_plan"><option value="">${T('personal.noPlan')}</option>${sessions.map(s => `<option value="${s.id}" ${s.id === r.sessionId ? 'selected' : ''}>${UI.esc(dt(s.title))}</option>`).join('')}</select></label>
          <label class="field"><span>${T('training.date')}</span><input id="p_date" type="date" value="${dstr}"></label>
        </div>
        <h4 class="pt-head">🏋 ${T('personal.exercises')}</h4>
        <p class="hint">${T('personal.exHint')}</p>
        <div id="p_ex">${((r.exercises && r.exercises.length) ? r.exercises : [{ sets: 3, reps: 10, unit: 'kg' }]).map(exRowHtml).join('')}</div>
        <button type="button" class="btn sm" id="p_addEx">+ ${T('personal.addExercise')}</button>
        <h4 class="pt-head">🏆 ${T('personal.tests')}</h4>
        <p class="hint">${T('personal.testHint')}</p>
        <div id="p_tests">${((r.tests && r.tests.length) ? r.tests : [{ unit: 'kg', reps: 1 }]).map(testRowHtml).join('')}</div>
        <button type="button" class="btn sm" id="p_addTest">+ ${T('personal.addTest')}</button>
        <label class="field" style="margin-top:12px"><span>${T('personal.notes')}</span><textarea id="p_notes" rows="3">${UI.esc(r.notes || '')}</textarea></label>
        <p class="hint">${T('personal.safety')}</p>`,
      footer: `<button class="btn ghost" data-close2>${T('common.cancel')}</button><button class="btn primary" data-save>${T('common.save')}</button>`,
      onOpen: (m, close) => {
        const list = m.querySelector('#p_tests');
        const exList = m.querySelector('#p_ex');
        const bindRm = () => list.querySelectorAll('[data-trm]').forEach(b => b.onclick = () => {
          if (list.children.length > 1) b.closest('.test-row').remove();
        });
        const bindExRm = () => exList.querySelectorAll('[data-erm]').forEach(b => b.onclick = () => {
          if (exList.children.length > 1) b.closest('.ex-row').remove();
        });
        bindRm(); bindExRm();
        m.querySelector('#p_addTest').onclick = () => { list.insertAdjacentHTML('beforeend', testRowHtml({ unit: 'kg', reps: 1 })); bindRm(); };
        m.querySelector('#p_addEx').onclick = () => { exList.insertAdjacentHTML('beforeend', exRowHtml({ sets: 3, reps: 10, unit: 'kg' })); bindExRm(); };
        m.querySelector('[data-close2]').onclick = close;
        m.querySelector('[data-save]').onclick = async () => {
          const nameEl = m.querySelector('#p_name');
          const p = nameEl ? null : Store.find('players', m.querySelector('#p_player').value);
          const who = nameEl
            ? (nameEl.value.trim().slice(0, 60) || T('personal.me'))
            : (p ? ('#' + (p.number || '?') + ' ' + [p.firstName, p.lastName].filter(Boolean).join(' ')).trim() : '');
          const sid = m.querySelector('#p_plan').value;
          const s = sid ? Store.find('training', sid) : null;
          const tests = [...list.querySelectorAll('.test-row')].map(row => ({
            name: row.querySelector('[data-tn]').value.trim().slice(0, 80),
            value: +row.querySelector('[data-tv]').value || 0,
            unit: row.querySelector('[data-tu]').value,
            reps: Math.max(1, Math.min(100, +row.querySelector('[data-tr]').value || 1))
          })).filter(t => t.name && t.value > 0);
          const exercises = [...exList.querySelectorAll('.ex-row')].map(row => ({
            name: row.querySelector('[data-en]').value.trim().slice(0, 80),
            sets: Math.max(1, Math.min(50, +row.querySelector('[data-es]').value || 1)),
            reps: Math.max(1, Math.min(200, +row.querySelector('[data-er]').value || 1)),
            value: +row.querySelector('[data-ev]').value || 0,
            unit: row.querySelector('[data-eu]').value
          })).filter(e => e.name);
          if (!nameEl && !p) return UI.toast(T('personal.noPlayers'), 'error');
          if (!tests.length && !exercises.length) return UI.toast(T('personal.rowReq'), 'error');
          if (nameEl) rememberAthlete(who);
          const obj = Object.assign({}, r, {
            playerId: p ? p.id : '',
            // The name is stored too, so an exported file still reads correctly
            // for a coach who does not have this squad.
            playerName: who,
            sport: r.sport || sportId,
            sessionId: sid, sessionTitle: s ? s.title : '',
            date: new Date(m.querySelector('#p_date').value).getTime() || Date.now(),
            notes: m.querySelector('#p_notes').value.trim().slice(0, 1000),
            exercises, tests
          });
          await Store.save('personal', obj);
          close(); UI.toast(T('personal.saved'), 'success'); render();
        };
      }
    });
  }

  // Reads this player's own recorded numbers and the drills of the chosen plan,
  // then asks for a max-test protocol and the loads to train at.
  function maxTestForm(playerId, sessionId, name) {
    const players = squad();
    const sessions = Store.scoped('training').slice().sort((a, b) => a.date - b.date);
    if (!solo() && !players.length) return UI.toast(T('personal.noPlayers'), 'error');
    const whoField = solo()
      ? `<label class="field"><span>${T('personal.athlete')}</span><input id="mx_name" maxlength="60" value="${UI.esc(name || athleteName())}"></label>`
      : `<label class="field"><span>${T('personal.player')}</span><select id="mx_player">${players.map(p => `<option value="${p.id}" ${p.id === playerId ? 'selected' : ''}>#${UI.esc(p.number)} ${UI.esc(p.lastName || p.firstName)}</option>`).join('')}</select></label>`;
    UI.modal({
      title: T('personal.aiMax'),
      width: 620,
      body: `<p style="color:var(--muted);font-size:13px">${T('personal.aiIntro')}</p>
        <div class="row">
          ${whoField}
          <label class="field"><span>${T('personal.plan')}</span><select id="mx_plan"><option value="">${T('personal.noPlan')}</option>${sessions.map(s => `<option value="${s.id}" ${s.id === sessionId ? 'selected' : ''}>${UI.esc(dt(s.title))}</option>`).join('')}</select></label>
        </div>
        <label class="field"><span>${T('personal.goal')}</span><textarea id="mx_goal" rows="2" placeholder="${UI.esc(T('personal.goalPh'))}"></textarea></label>
        <p class="hint">${T('personal.aiHint')}</p>`,
      footer: `<button class="btn ghost" data-close2>${T('common.cancel')}</button><button class="btn primary" data-gen>${T('training.aiGenerate')}</button>`,
      onOpen: (m, close) => {
        m.querySelector('[data-close2]').onclick = close;
        m.querySelector('[data-gen]').onclick = () => {
          const nameEl = m.querySelector('#mx_name');
          let p;
          if (nameEl) {
            const nm = nameEl.value.trim().slice(0, 60) || T('personal.me');
            rememberAthlete(nm);
            p = { id: '', name: nm };
          } else {
            p = Store.find('players', m.querySelector('#mx_player').value);
            if (!p) return UI.toast(T('personal.noPlayers'), 'error');
          }
          const s = Store.find('training', m.querySelector('#mx_plan').value);
          const goal = m.querySelector('#mx_goal').value.trim().slice(0, 300);
          close();
          runMaxTest(p, s, goal);
        };
      }
    });
  }

  function runMaxTest(p, s, goal) {
    // A solo athlete has no squad record, so entries are matched by the name.
    const who = p.name || ('#' + (p.number || '?') + ' ' + [p.firstName, p.lastName].filter(Boolean).join(' ')).trim();
    const history = Store.scoped('personal')
      .filter(r => p.id ? r.playerId === p.id : (r.playerName || '') === who)
      .sort((a, b) => (b.date || 0) - (a.date || 0)).slice(0, 8);
    const planDrills = s ? (s.exercises || []).map(id => Store.find('exercises', id)).filter(Boolean) : [];
    const profile = p.name
      ? `Athlete: ${who}. No squad record — body data unknown.`
      : `Player: ${who} — ${p.position || 'unknown position'}, ${p.height || '?'} cm, ${p.weight || '?'} kg, status ${p.status || 'active'}.`;
    const lines = [
      profile,
      s ? `Chosen training plan: ${dt(s.title)} (${focusLabel(s.focus)}, ${s.duration || 0} min).` : 'No training plan chosen.',
      planDrills.length
        ? 'Exercises in that plan:\n' + planDrills.map(e => `- ${ex(e)} (${tt('cat', e.category)}, ${e.intensity || 'Low'}, ${(e.muscles || []).join('/') || 'unspecified muscles'})`).join('\n')
        : 'The plan lists no exercises.',
      history.length
        ? 'Max tests already recorded, newest first:\n' + history.map(r => `- ${new Date(r.date).toISOString().slice(0, 10)}: ` + ((r.tests || []).map(testLine).join('; ') || 'none')).join('\n')
        : 'No max tests recorded yet.',
      history.some(r => (r.exercises || []).length)
        ? 'Training work already recorded, newest first:\n' + history.filter(r => (r.exercises || []).length)
          .map(r => `- ${new Date(r.date).toISOString().slice(0, 10)}: ` + (r.exercises || []).map(exLine).join('; ')).join('\n')
        : '',
      goal ? `The player wants: ${goal}` : ''
    ].filter(Boolean).join('\n');

    AI.report({
      title: T('personal.aiMax') + ' — ' + who,
      maxTokens: 1200,
      hide: /^(?:TESTS|WORK):.*$/gim,
      // The report is advice; nothing is stored until the coach presses Create.
      actions: [{
        label: T('personal.createEntry'),
        onClick: (text, close) => {
          close();
          personalForm({
            playerId: p.id || '',
            playerName: who,
            sessionId: s ? s.id : '',
            exercises: suggestedExercises(text, planDrills),
            tests: suggestedTests(text, planDrills)
          });
        }
      }],
      task: [
        'Build a personal training entry for this one player: the ordinary training work first, then the max tests that go with it.',
        'Size everything to THIS player — their position, height, weight and the numbers already recorded.'
        + ' Say in one line how the body data and the position changed your choice (e.g. a tall back needs different loads from a short wing).',
        'Cover: 4 to 6 training exercises from the plan with sets × reps and a starting load as a percentage of the estimated max,'
        + ' which 3 to 5 exercises are worth max-testing and why, the warm-up ramp set by set, how to find the true max safely,'
        + ' what to write down, the estimated one-rep max from the numbers already recorded,'
        + ' the working loads as a percentage of that max for the next four weeks, and when to re-test.',
        'Use only exercises from the plan and the club library, and add the video link for every exercise you name.',
        'State clearly when the player must stop: pain, form breaking down, or no spotter.',
        'This is training advice, not medical advice — say so if the player is marked injured.',
        'End the answer with exactly these two lines, in this order and with nothing after them:',
        'WORK: exercise name | sets | reps | unit; exercise name | sets | reps | unit',
        'TESTS: exercise name | unit; exercise name | reps; exercise name | cm',
        'Use only kg, reps, sec, m or cm as the unit. WORK lists the ordinary training exercises,'
        + ' TESTS lists only the exercises you told the player to max-test.',
        '',
        lines
      ].join('\n')
    });
  }

  // Turns the machine-readable trailer into rows the coach fills in after the
  // session. WORK becomes training exercises, TESTS becomes max tests.
  function suggestedExercises(text, planDrills) {
    const line = /^WORK:\s*(.+)$/im.exec(String(text || ''));
    if (line) {
      const rows = line[1].split(';').map(part => {
        const bits = part.split('|');
        const name = (bits[0] || '').replace(/[*_`]/g, '').trim().slice(0, 80);
        const unit = (bits[3] || '').trim().toLowerCase();
        return name ? {
          name,
          sets: Math.max(1, Math.min(50, Math.round(+bits[1]) || 3)),
          reps: Math.max(1, Math.min(200, Math.round(+bits[2]) || 10)),
          value: 0,
          unit: UNITS.includes(unit) ? unit : 'kg'
        } : null;
      }).filter(Boolean).slice(0, 8);
      if (rows.length) return rows;
    }
    const fallback = planDrills.slice(0, 4).map(e => ({ name: ex(e).slice(0, 80), sets: 3, reps: 10, value: 0, unit: 'kg' }));
    return fallback.length ? fallback : [{ sets: 3, reps: 10, unit: 'kg' }];
  }
  function suggestedTests(text, planDrills) {
    const line = /^TESTS:\s*(.+)$/im.exec(String(text || ''));
    if (line) {
      const rows = line[1].split(';').map(part => {
        const bits = part.split('|');
        const name = (bits[0] || '').replace(/[*_`]/g, '').trim().slice(0, 80);
        const unit = (bits[1] || '').trim().toLowerCase();
        return name ? { name, unit: UNITS.includes(unit) ? unit : 'kg', reps: 1 } : null;
      }).filter(Boolean).slice(0, 6);
      if (rows.length) return rows;
    }
    const fallback = planDrills.slice(0, 4).map(e => ({ name: ex(e).slice(0, 80), unit: 'kg', reps: 1 }));
    return fallback.length ? fallback : [{ unit: 'kg', reps: 1 }];
  }

  // ---- Session details -----------------------------------------------------
  // Read-only view of one plan: the drills with their videos and the tactical
  // board animations attached to it, each replayable in its own dialog.
  function showSession(s) {
    if (!s) return;
    const drills = (s.exercises || []).map(id => Store.find('exercises', id)).filter(Boolean);
    UI.modal({
      title: UI.esc(dt(s.title || '')),
      width: 640,
      body: `
        <p class="hint" style="margin-top:0">${UI.fmtDate(s.date)} · ${s.duration || 0} ${T('training.min')} · ${UI.esc(focusLabel(s.focus))}</p>
        <h4 style="margin-bottom:6px">${T('training.drills')}</h4>
        ${drills.length ? `<ul class="drill-list">${drills.map(e => drillItem(e, true)).join('')}</ul>` : `<p class="hint">${T('common.noData')}</p>`}
        <h4 style="margin-bottom:6px">${T('training.showAnims')}</h4>
        ${ANIM.chipsHtml(s.animations)}`,
      footer: `<button class="btn ghost" data-close2>${T('common.close')}</button><button class="btn primary" data-edit>${T('common.edit')}</button>`,
      onOpen: (m, close) => {
        ANIM.bind(m);
        m.querySelector('[data-close2]').onclick = close;
        m.querySelector('[data-edit]').onclick = () => { close(); sessionForm(s); };
      }
    });
  }

  function sessionForm(s = {}) {
    const dstr = new Date(s.date || Date.now()).toISOString().slice(0, 10);
    const drills = Store.all('exercises');
    // A session saved under another sport keeps its own focus in the list.
    const foci = s.focus && !FOCI.includes(s.focus) ? FOCI.concat([s.focus]) : FOCI;
    UI.modal({
      title: s.id ? T('training.editSession') : T('training.newSession'),
      body: `
        <label class="field"><span>${T('training.titleField')}</span><input id="t_title" value="${UI.esc(s.title || '')}"></label>
        <div class="row">
          <label class="field"><span>${T('training.date')}</span><input id="t_date" type="date" value="${dstr}"></label>
          <label class="field"><span>${T('training.duration')}</span><input id="t_dur" type="number" value="${s.duration || 90}"></label>
          <label class="field"><span>${T('training.focus')}</span><select id="t_focus">${foci.map(x => `<option value="${x}" ${x === s.focus ? 'selected' : ''}>${UI.esc(focusLabel(x))}</option>`).join('')}</select></label>
        </div>
        <label class="field"><span>${T('training.drills')}</span><select id="t_ex" multiple size="5">${drills.map(e => `<option value="${e.id}" ${(s.exercises || []).includes(e.id) ? 'selected' : ''}>${UI.esc(ex(e))} (${UI.esc(tt('cat', e.category))})</option>`).join('')}</select></label>
        <label class="field"><span>${T('training.anims')}</span>${ANIM.pickerHtml('t_anim', s.animations, sportId)}</label>
        <p class="hint">${T('training.animsHint')}</p>`,
      footer: `<button class="btn ghost" data-close2>${T('common.cancel')}</button><button class="btn primary" data-save>${T('common.save')}</button>`,
      onOpen: (m, close) => {
        m.querySelector('[data-close2]').onclick = close;
        m.querySelector('[data-save]').onclick = async () => {
          const anim = m.querySelector('#t_anim');
          const obj = Object.assign({}, s, {
            teamId: team && team.id, title: m.querySelector('#t_title').value.trim(),
            date: new Date(m.querySelector('#t_date').value).getTime(),
            duration: +m.querySelector('#t_dur').value, focus: m.querySelector('#t_focus').value,
            exercises: [...m.querySelector('#t_ex').selectedOptions].map(o => o.value),
            animations: anim ? [...anim.selectedOptions].map(o => o.value) : (s.animations || [])
          });
          if (!obj.title) return UI.toast(T('training.titleReq'), 'error');
          await Store.save('training', obj); close(); UI.toast(T('training.saved'), 'success'); render();
        };
      }
    });
  }

  // Describe the session, ChatGPT picks drills from the library and writes the run-through.
  // The coach sees the plan first and only then opens the normal session form.
  function aiSessionForm() {
    UI.modal({
      title: T('training.aiSession'),
      width: 620,
      body: `<p style="color:var(--muted);font-size:13px">${T('training.aiSessionIntro')}</p>
        <label class="field"><span>${T('training.aiSessionWhat')}</span>
          <textarea id="s_what" rows="3" placeholder="${UI.esc(T('training.aiSessionPh'))}"></textarea></label>
        <div class="row">
          <label class="field"><span>${T('training.duration')}</span><input id="s_dur" type="number" value="90"></label>
          <label class="field"><span>${T('training.focus')}</span><select id="s_focus">${FOCI.map(x => `<option value="${x}">${UI.esc(focusLabel(x))}</option>`).join('')}</select></label>
        </div>
        <label class="field"><span>${T('training.anims')}</span>${ANIM.pickerHtml('s_anim', [], sportId)}</label>
        <p class="hint">${T('training.animsHint')}</p>
        <p class="hint">${T('training.aiSessionHint')}</p>`,
      footer: `<button class="btn ghost" data-close2>${T('common.cancel')}</button><button class="btn primary" data-gen>${T('training.aiGenerate')}</button>`,
      onOpen: (m, close) => {
        m.querySelector('[data-close2]').onclick = close;
        const btn = m.querySelector('[data-gen]');
        btn.onclick = async () => {
          const what = m.querySelector('#s_what').value.trim();
          if (!what) return UI.toast(T('training.aiSessionReq'), 'error');
          const anim = m.querySelector('#s_anim');
          const picked = anim ? [...anim.selectedOptions].map(o => o.value) : [];
          btn.disabled = true; btn.textContent = T('ai.asking');
          const plan = await generateSession(what, +m.querySelector('#s_dur').value, m.querySelector('#s_focus').value);
          btn.disabled = false; btn.textContent = T('training.aiGenerate');
          if (plan) showPlan(m, close, plan, picked);
        };
      }
    });
  }

  // Second step of the AI session dialog: the plan, the drills it picked from the
  // library, and the ones it wrote from scratch for the chosen category.
  function showPlan(m, close, res, anims) {
    m.querySelector('.modal-body').innerHTML = `
      <h3 style="margin:0 0 4px">${UI.esc(res.title)}</h3>
      <p class="hint" style="margin-top:0">${UI.esc(focusLabel(res.focus))} · ${res.duration} ${T('training.min')}</p>
      <div class="ai-text">${AI.render(res.plan)}</div>
      <h4 style="margin-bottom:6px">${T('training.drills')}</h4>
      ${res.drills.length ? `<ul class="drill-list">
        ${res.drills.map(drillItem).join('')}
      </ul>` : `<p class="hint">${T('training.aiNoFit')}</p>`}
      ${res.fresh.length ? `<h4 style="margin-bottom:6px">${T('training.aiNewDrills')}</h4>
      <ul class="drill-list">${res.fresh.map((e, i) => `<li data-row="${i}">
        <span class="drill-head">${UI.esc(ex(e))} <span class="tag">${e.duration || 0} ${T('training.min')}</span>
          <span class="tag">${UI.esc(tt('cat', e.category))}</span></span>
        <div class="draft-vids"><span class="hint">${T('exercises.videos')}</span>${UI.videoEditor(e.videos || [])}
          <div class="draft-prev">${UI.videoEmbed(e, 1)}</div></div>
      </li>`).join('')}</ul>
      <p class="hint">${T('training.aiNewDrillsHint')}</p>` : ''}
      <h4 style="margin-bottom:6px">${T('training.showAnims')}</h4>
      ${ANIM.chipsHtml(anims)}`;
    ANIM.bind(m);
    // A generated link can be corrected or removed before anything is saved.
    UI.bindVideos(m, box => {
      const li = box.closest('li[data-row]');
      const d = res.fresh[+li.dataset.row];
      d.videos = UI.readVideos(box);
      li.querySelector('.draft-prev').innerHTML = UI.videoEmbed(d, 1);
    });
    m.querySelector('.modal-foot').innerHTML =
      `<button class="btn ghost" data-close2>${T('common.cancel')}</button><button class="btn primary" data-use>${T('training.aiUse')}</button>`;
    m.querySelector('[data-close2]').onclick = close;
    m.querySelector('[data-use]').onclick = async () => {
      if (res.fresh.some(d => (d.videos || []).some(u => !UI.safeUrl(u)))) return UI.toast(T('training.badUrl'), 'error');
      // The drills it wrote from scratch go into the library first, so the
      // session can point at them like any other drill.
      const ids = res.drills.map(e => e.id);
      for (const d of res.fresh) {
        const saved = await Store.save('exercises', Object.assign({}, d, { videos: (d.videos || []).map(UI.safeUrl).filter(Boolean) }));
        ids.push((saved && saved.id) || d.id);
      }
      if (res.fresh.length) UI.toast(res.fresh.length + ' ' + T('exercises.aiSaved'), 'success');
      close();
      sessionForm({ title: res.title, focus: res.focus, duration: res.duration, exercises: ids, animations: anims || [] });
      UI.toast(T('training.aiSessionReady'), 'success');
    };
  }

  async function generateSession(what, dur, focus) {
    // Only this sport's own categories — a handball request must never come back
    // with a bodybuilding drill just because it sits in the same library.
    const own = SPORTS.exerciseCategories(sportId);
    const lib = Store.all('exercises').filter(e => own.indexOf(e.category) >= 0).slice(0, 40);
    // The model may only pick names from this list; anything else is dropped.
    const byName = new Map(lib.map(e => [ex(e).toLowerCase(), e]));
    // Anything it writes from scratch is filed under the chosen focus when that
    // is a real category, so a "Shooting" session does not create "Warm-up" drills.
    const newCat = own.indexOf(focus) >= 0 ? focus : own[0];
    const sportName = SPORTS.name(sportId, 'en');
    const system = [
      `You plan ${sportName} training sessions for a coach.`,
      'Answer with one JSON object and nothing else — no markdown, no code fence, no commentary.',
      'Shape: {"title":"","focus":"","duration":0,"drills":[""],"new":[{"en":{"title":"","description":""},"da":{"title":"","description":""},"duration":0,"intensity":"","links":[""],"search":""}],"plan":""}',
      `focus must be exactly one of: ${FOCI.join(', ')}.`,
      'duration is whole minutes as a number.',
      lib.length
        ? 'drills: 0 to 6 titles copied EXACTLY from the drill library below, in the order they should be run. Use no other titles and invent nothing.'
        : 'drills: return an empty array — there is no drill library to pick from.',
      // Padding the list with whatever is in the library is the failure we are guarding against.
      'Only pick a drill when it genuinely trains what the coach asked for and belongs to this sport.'
      + ' A drill that is merely in the library is not a reason to include it.',
      `new: every drill this session needs that the library does NOT have, written from scratch as ${sportName} work`
      + ` for the "${newCat}" part of training. Real ${sportName} drills with the ball, the court and the players, not gym exercises,`
      + ' unless that category is itself physical. Each one carries BOTH language blocks: "en" in English and "da" in Danish, the same drill written twice.',
      'Write ONE entry for EVERY separate exercise the coach described or the session calls for — if the description names six drills, return six.'
      + ` Do not stop early and do not merge two drills into one. Up to ${MAX_NEW}, and their durations should add up to roughly the session length.`,
      'new[].description: setup and equipment, how it runs, 2-3 coaching points and one progression, as short lines, max 120 words.',
      `new[].search: 3-6 English words for finding that drill on video, starting with the sport, e.g. "${sportName.toLowerCase()} ${String(newCat).toLowerCase()} drill".`,
      'new[].links: 1-3 full YouTube addresses (https://www.youtube.com/watch?v=…) of real, public videos that demonstrate that drill.'
      + ' Give only ones you are confident exist — every address is checked against YouTube and a dead one is thrown away.',
      `new[].intensity must be exactly one of: ${INT.join(', ')}.`,
      'plan: short lines — warm-up, the main part with each drill and how long it runs, the finish, and 2 coaching points. Max 150 words.',
      'Keep it safe for amateur athletes and say when to stop if there is pain.',
      lib.length
        ? 'Drill library (this sport only):\n' + lib.map(e => `- ${ex(e)} (${tt('cat', e.category)}, ${e.duration || 0} min, ${e.intensity || 'Low'})`).join('\n')
        : 'Drill library: empty.'
    ].join('\n');
    const user = `Session about: ${what}\nTotal length: ${dur} minutes\nFocus: ${focus}\nCategory for new drills: ${newCat}`;

    const raw = await AI.complete(system, user, 1200 + MAX_NEW * 320);
    if (!raw) return null;
    let d;
    try { d = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)); }
    catch (err) { UI.toast(T('training.aiBad'), 'error'); return null; }
    const drills = (Array.isArray(d.drills) ? d.drills : [])
      .map(t => byName.get(String(t).trim().toLowerCase())).filter(Boolean).slice(0, 8);
    const fresh = (Array.isArray(d.new) ? d.new : []).slice(0, MAX_NEW).map(r => newDrill(r, newCat, what)).filter(Boolean);
    // Only an address that really resolves on YouTube is kept; the search link stays as the fallback.
    if (fresh.some(x => (x.links || []).length)) UI.toast(T('exercises.aiChecking'));
    for (const drill of fresh) {
      const found = await AI.pickVideo(drill.links || []);
      if (found) drill.videos = [found].concat(drill.videos.filter(u => u !== found)).slice(0, 3);
      delete drill.links;
    }
    const title = String(d.title || '').trim().slice(0, 80);
    if (!title) { UI.toast(T('training.aiBad'), 'error'); return null; }
    return {
      title, drills, fresh,
      focus: FOCI.includes(d.focus) ? d.focus : focus,
      duration: Math.min(300, Math.max(15, Math.round(+d.duration || dur))),
      plan: String(d.plan || '').slice(0, 2000)
    };
  }

  // One drafted drill, clamped and given a video search for its own topic.
  function newDrill(r, category, what) {
    const tr = {};
    ['en', 'da'].forEach(l => {
      const b = r && r[l];
      const t = String((b && b.title) || '').trim().slice(0, 80);
      if (t) tr[l] = { title: t, description: String((b && b.description) || '').trim().slice(0, 1500) };
    });
    const now = tr[I18N.getLang()] || tr.en || tr.da;
    if (!now) return null;
    const query = (String((r && r.search) || '').trim() || what).slice(0, 80);
    return {
      title: now.title, description: now.description, tr, category,
      duration: Math.min(180, Math.max(5, Math.round(+(r && r.duration) || 15))),
      intensity: INT.indexOf(r && r.intensity) >= 0 ? r.intensity : 'Medium',
      videos: ['https://www.youtube.com/results?search_query=' + encodeURIComponent(query)],
      links: (Array.isArray(r && r.links) ? r.links : []).map(u => String(u).trim()).filter(Boolean).slice(0, 3),
      tags: [], muscles: []
    };
  }

  render();
};
