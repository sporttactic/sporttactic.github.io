/* Training Planner view */
window.Views = window.Views || {};
Views.training = function (mount) {
  const team = Store.activeTeam();
  const sportId = (window.App && App.getSport && App.getSport()) || 'handball';
  // Session foci follow the chosen sport, so a chess session never offers "Transition".
  const FOCI = ['Warm-up'].concat(SPORTS.exerciseCategories(sportId)).concat(['Physical']);
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

  function render() {
    const sessions = Store.scoped('training').slice().sort((a, b) => a.date - b.date);
    const cards = `
      <div class="grid cols-3">
        ${sessions.map(s => `
          <div class="card">
            <div style="display:flex;justify-content:space-between;align-items:start">
              <div><h3 style="margin:0">${UI.esc(dt(s.title))}</h3><p style="color:var(--muted)">${UI.fmtDate(s.date)} · ${s.duration} ${T('training.min')}</p></div>
              <span class="tag blue">${UI.esc(tt('focus', s.focus))}</span>
            </div>
            <div style="margin-top:10px">
              ${(s.exercises || []).map(id => { const e = Store.find('exercises', id); return e ? `<div class="tag" style="margin:2px">${UI.esc(dt(e.title))}</div>` : ''; }).join('') || `<span style="color:var(--muted)">${T('common.noData')}</span>`}
            </div>
            ${(s.animations || []).length ? `<div style="margin-top:8px"><span class="tag blue">▶ ${(s.animations || []).length} ${T('training.anims')}</span></div>` : ''}
            <div style="margin-top:12px"><button class="btn sm" data-show="${s.id}">${T('common.show')}</button> <button class="btn sm" data-edit="${s.id}">${T('common.edit')}</button> <button class="btn sm danger" data-del="${s.id}">${T('common.delete')}</button></div>
          </div>`).join('') || `<div class="empty"><div class="big">${UI.icon('calendar', 40)}</div>${T('training.noSessions')}</div>`}
      </div>`;

    mount.innerHTML = `
      ${AI.section('training')}
      <div class="page-head"><div><h1>${T('training.title')}</h1><p>${T('training.subtitle')}</p></div></div>
      ${UI.acc('sessions', T('training.sessions'), cards, {
      sub: T('training.sessionsHint'),
      actions: `${UI.shareBar('training')}
          <button class="btn" id="genSession">🤖 ${T('training.aiSession')}</button>
          <button class="btn primary" id="addSession">+ ${T('training.newSession')}</button>`
    })}
      ${personalAcc()}
      <div id="exLib"></div>`;

    UI.bindAcc(mount);
    mount.querySelector('#addSession').onclick = () => sessionForm();
    mount.querySelector('#genSession').onclick = () => aiSessionForm();
    UI.bindShare(mount, 'training', render);
    UI.bindShare(mount, 'personal', render);
    AI.bind(mount);
    mount.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => sessionForm(Store.find('training', b.dataset.edit)));
    mount.querySelectorAll('[data-show]').forEach(b => b.onclick = () => showSession(Store.find('training', b.dataset.show)));
    mount.querySelectorAll('[data-del]').forEach(b => b.onclick = () => UI.confirm(T('training.delSession'), async () => { await Store.remove('training', b.dataset.del); render(); }));
    bindPersonal();
    // The exercise library is its own section of this page.
    Views.exerciseLib(mount.querySelector('#exLib'), { onChange: render });
  }

  // ---- Personal training & max tests --------------------------------------
  // What a single player lifts, runs or jumps under a chosen plan. Kept in its
  // own store so it can be exported on its own and handed to another coach.
  const UNITS = ['kg', 'reps', 'sec', 'm', 'cm'];
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
              <button class="btn sm" data-pmax="${r.id}">🤖 ${T('personal.aiMax')}</button>
              <button class="btn sm" data-pedit="${r.id}">${T('common.edit')}</button>
              <button class="btn sm danger" data-pdel="${r.id}">${T('common.delete')}</button>
            </div>
          </div>`).join('') || `<div class="empty"><div class="big">${UI.icon('dumbbell', 40)}</div>${T('personal.none')}</div>`}
      </div>`;
    return UI.acc('personal', T('personal.title'), body, {
      sub: T('personal.hint'),
      actions: `${UI.shareBar('personal')}
        <button class="btn" id="aiMax">🤖 ${T('personal.aiMax')}</button>
        <button class="btn primary" id="addPersonal">+ ${T('personal.new')}</button>`
    });
  }

  function bindPersonal() {
    mount.querySelector('#addPersonal').onclick = () => personalForm();
    mount.querySelector('#aiMax').onclick = () => maxTestForm();
    mount.querySelectorAll('[data-pedit]').forEach(b => b.onclick = () => personalForm(Store.find('personal', b.dataset.pedit)));
    mount.querySelectorAll('[data-pshow]').forEach(b => b.onclick = () => showPersonal(Store.find('personal', b.dataset.pshow)));
    mount.querySelectorAll('[data-pmax]').forEach(b => b.onclick = () => {
      const r = Store.find('personal', b.dataset.pmax);
      if (r) maxTestForm(r.playerId, r.sessionId, r.playerName);
    });
    mount.querySelectorAll('[data-pdel]').forEach(b => b.onclick = () => UI.confirm(T('personal.del'), async () => { await Store.remove('personal', b.dataset.pdel); render(); }));
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
        const a = norm(e.title), b = norm(dt(e.title));
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
            <th>${T('personal.exercise')}</th><th>${T('personal.value')}</th><th>${T('personal.reps')}</th><th>1RM</th></tr></thead>
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
      : `<label class="field"><span>${T('personal.player')}</span><select id="p_player">${players.map(p => `<option value="${p.id}" ${p.id === r.playerId ? 'selected' : ''}>#${p.number} ${UI.esc(p.lastName || p.firstName)}</option>`).join('')}</select></label>`;
    UI.modal({
      title: r.id ? T('personal.edit') : T('personal.new'),
      width: 700,
      body: `
        <datalist id="exNames">${drills.map(e => `<option value="${UI.esc(dt(e.title))}"></option>`).join('')}</datalist>
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
      : `<label class="field"><span>${T('personal.player')}</span><select id="mx_player">${players.map(p => `<option value="${p.id}" ${p.id === playerId ? 'selected' : ''}>#${p.number} ${UI.esc(p.lastName || p.firstName)}</option>`).join('')}</select></label>`;
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
      s ? `Chosen training plan: ${dt(s.title)} (${tt('focus', s.focus)}, ${s.duration || 0} min).` : 'No training plan chosen.',
      planDrills.length
        ? 'Exercises in that plan:\n' + planDrills.map(e => `- ${dt(e.title)} (${tt('cat', e.category)}, ${e.intensity || 'Low'}, ${(e.muscles || []).join('/') || 'unspecified muscles'})`).join('\n')
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
      maxTokens: 1100,
      hide: /TESTS:.*$/im,
      // The report is advice; nothing is stored until the coach presses Create.
      actions: [{
        label: T('personal.createEntry'),
        onClick: (text, close) => {
          close();
          personalForm({
            playerId: p.id || '',
            playerName: who,
            sessionId: s ? s.id : '',
            tests: suggestedTests(text, planDrills)
          });
        }
      }],
      task: [
        'Build a personal max-test session for this one player, then the training loads that follow from it.',
        'Cover: which 3 to 5 exercises from the plan are worth max-testing and why, the warm-up ramp set by set,'
        + ' how to find the true max safely, what to write down, the estimated one-rep max from the numbers already recorded,'
        + ' the working loads as a percentage of that max for the next four weeks, and when to re-test.',
        'Use only exercises from the plan and the club library, and add the video link for every exercise you name.',
        'State clearly when the player must stop: pain, form breaking down, or no spotter.',
        'This is training advice, not medical advice — say so if the player is marked injured.',
        'End the answer with one line of exactly this shape, and nothing after it:',
        'TESTS: exercise name | kg; exercise name | reps; exercise name | cm',
        'Use only kg, reps, sec, m or cm as the unit, and list only the exercises you told the player to max-test.',
        '',
        lines
      ].join('\n')
    });
  }

  // Turns the machine-readable last line of the report into empty test rows the
  // coach fills in after the session; falls back to the plan's own exercises.
  function suggestedTests(text, planDrills) {
    const line = /TESTS:\s*(.+)$/im.exec(String(text || ''));
    if (line) {
      const rows = line[1].split(';').map(part => {
        const bits = part.split('|');
        const name = (bits[0] || '').replace(/[*_`]/g, '').trim().slice(0, 80);
        const unit = (bits[1] || '').trim().toLowerCase();
        return name ? { name, unit: UNITS.includes(unit) ? unit : 'kg', reps: 1 } : null;
      }).filter(Boolean).slice(0, 6);
      if (rows.length) return rows;
    }
    const fallback = planDrills.slice(0, 4).map(e => ({ name: dt(e.title).slice(0, 80), unit: 'kg', reps: 1 }));
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
        <p class="hint" style="margin-top:0">${UI.fmtDate(s.date)} · ${s.duration || 0} ${T('training.min')} · ${UI.esc(tt('focus', s.focus))}</p>
        <h4 style="margin-bottom:6px">${T('training.drills')}</h4>
        ${drills.length ? `<ul class="ai-guide">${drills.map(e => {
        const url = safeUrl(e.videoYt) || safeUrl(e.videoUrl);
        return `<li>${UI.esc(dt(e.title))} <span class="tag">${e.duration || 0} ${T('training.min')}</span>`
          + ` <span class="tag">${UI.esc(tt('cat', e.category))}</span>`
          + (url ? ` <a href="${UI.esc(url)}" target="_blank" rel="noopener noreferrer">▶ ${T('training.video')}</a>` : '') + '</li>';
      }).join('')}</ul>` : `<p class="hint">${T('common.noData')}</p>`}
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
          <label class="field"><span>${T('training.focus')}</span><select id="t_focus">${foci.map(x => `<option value="${x}" ${x === s.focus ? 'selected' : ''}>${UI.esc(tt('focus', x))}</option>`).join('')}</select></label>
        </div>
        <label class="field"><span>${T('training.drills')}</span><select id="t_ex" multiple size="5">${drills.map(e => `<option value="${e.id}" ${(s.exercises || []).includes(e.id) ? 'selected' : ''}>${UI.esc(dt(e.title))} (${UI.esc(tt('cat', e.category))})</option>`).join('')}</select></label>
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
          <label class="field"><span>${T('training.focus')}</span><select id="s_focus">${FOCI.map(x => `<option value="${x}">${UI.esc(tt('focus', x))}</option>`).join('')}</select></label>
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

  // Second step of the AI session dialog: the plan with a video link per drill.
  function showPlan(m, close, res, anims) {
    m.querySelector('.modal-body').innerHTML = `
      <h3 style="margin:0 0 4px">${UI.esc(res.title)}</h3>
      <p class="hint" style="margin-top:0">${UI.esc(tt('focus', res.focus))} · ${res.duration} ${T('training.min')}</p>
      <div class="ai-text">${AI.render(res.plan)}</div>
      <h4 style="margin-bottom:6px">${T('training.drills')}</h4>
      <ul class="ai-guide">
        ${res.drills.map(e => {
      const url = safeUrl(e.videoYt) || safeUrl(e.videoUrl);
      return `<li>${UI.esc(dt(e.title))} <span class="tag">${e.duration || 0} ${T('training.min')}</span>`
        + (url ? ` <a href="${UI.esc(url)}" target="_blank" rel="noopener noreferrer">▶ ${T('training.video')}</a>` : '') + '</li>';
    }).join('')}
      </ul>
      <h4 style="margin-bottom:6px">${T('training.showAnims')}</h4>
      ${ANIM.chipsHtml(anims)}`;
    ANIM.bind(m);
    m.querySelector('.modal-foot').innerHTML =
      `<button class="btn ghost" data-close2>${T('common.cancel')}</button><button class="btn primary" data-use>${T('training.aiUse')}</button>`;
    m.querySelector('[data-close2]').onclick = close;
    m.querySelector('[data-use]').onclick = () => {
      close();
      sessionForm({ title: res.title, focus: res.focus, duration: res.duration, exercises: res.drills.map(e => e.id), animations: anims || [] });
      UI.toast(T('training.aiSessionReady'), 'success');
    };
  }

  async function generateSession(what, dur, focus) {
    const lang = I18N.getLang() === 'da' ? 'Danish' : 'English';
    const lib = Store.all('exercises').slice(0, 40);
    if (!lib.length) { UI.toast(T('training.noDrills'), 'error'); return null; }
    // The model may only pick names from this list; anything else is dropped.
    const byName = new Map(lib.map(e => [dt(e.title).toLowerCase(), e]));
    const system = [
      `You plan ${SPORTS.name(sportId, 'en')} training sessions for a coach.`,
      `Write the title and the plan in ${lang}.`,
      'Answer with one JSON object and nothing else — no markdown, no code fence, no commentary.',
      'Shape: {"title":"","focus":"","duration":0,"drills":[""],"plan":""}',
      `focus must be exactly one of: ${FOCI.join(', ')}.`,
      'duration is whole minutes as a number.',
      'drills: 3 to 6 titles copied EXACTLY from the drill library below, in the order they should be run. Use no other titles and invent nothing.',
      'plan: short lines — warm-up, the main part with each picked drill and how long it runs, the finish, and 2 coaching points. Max 150 words.',
      'Keep it safe for amateur athletes and say when to stop if there is pain.',
      'Drill library:\n' + lib.map(e => `- ${dt(e.title)} (${tt('cat', e.category)}, ${e.duration || 0} min, ${e.intensity || 'Low'})`).join('\n')
    ].join('\n');
    const user = `Session about: ${what}\nTotal length: ${dur} minutes\nFocus: ${focus}`;

    const raw = await AI.complete(system, user, 900);
    if (!raw) return null;
    let d;
    try { d = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)); }
    catch (err) { UI.toast(T('training.aiBad'), 'error'); return null; }
    const drills = (Array.isArray(d.drills) ? d.drills : [])
      .map(t => byName.get(String(t).trim().toLowerCase())).filter(Boolean).slice(0, 8);
    const title = String(d.title || '').trim().slice(0, 80);
    if (!title || !drills.length) { UI.toast(T('training.aiBad'), 'error'); return null; }
    return {
      title, drills,
      focus: FOCI.includes(d.focus) ? d.focus : focus,
      duration: Math.min(300, Math.max(15, Math.round(+d.duration || dur))),
      plan: String(d.plan || '').slice(0, 2000)
    };
  }

  render();
};
