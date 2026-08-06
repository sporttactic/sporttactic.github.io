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
            <div style="margin-top:12px"><button class="btn sm" data-edit="${s.id}">${T('common.edit')}</button> <button class="btn sm danger" data-del="${s.id}">${T('common.delete')}</button></div>
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
              <span class="tag blue">${(r.tests || []).length} ${T('personal.tests')}</span>
            </div>
            <div style="margin-top:10px">
              ${(r.tests || []).map(t => `<div class="tag" style="margin:2px">${UI.esc(testLine(t))}</div>`).join('')
            || `<span style="color:var(--muted)">${T('common.noData')}</span>`}
            </div>
            ${r.notes ? `<p style="margin:10px 0 0;color:var(--text-soft)">${UI.esc(r.notes)}</p>` : ''}
            <div style="margin-top:12px">
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
    mount.querySelectorAll('[data-pmax]').forEach(b => b.onclick = () => {
      const r = Store.find('personal', b.dataset.pmax);
      if (r) maxTestForm(r.playerId, r.sessionId);
    });
    mount.querySelectorAll('[data-pdel]').forEach(b => b.onclick = () => UI.confirm(T('personal.del'), async () => { await Store.remove('personal', b.dataset.pdel); render(); }));
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

  function personalForm(r = {}) {
    const players = squad();
    const sessions = Store.scoped('training').slice().sort((a, b) => a.date - b.date);
    const drills = Store.all('exercises');
    const dstr = new Date(r.date || Date.now()).toISOString().slice(0, 10);
    if (!players.length) return UI.toast(T('personal.noPlayers'), 'error');
    UI.modal({
      title: r.id ? T('personal.edit') : T('personal.new'),
      width: 640,
      body: `
        <datalist id="exNames">${drills.map(e => `<option value="${UI.esc(dt(e.title))}"></option>`).join('')}</datalist>
        <div class="row">
          <label class="field"><span>${T('personal.player')}</span><select id="p_player">${players.map(p => `<option value="${p.id}" ${p.id === r.playerId ? 'selected' : ''}>#${p.number} ${UI.esc(p.lastName || p.firstName)}</option>`).join('')}</select></label>
          <label class="field"><span>${T('personal.plan')}</span><select id="p_plan"><option value="">${T('personal.noPlan')}</option>${sessions.map(s => `<option value="${s.id}" ${s.id === r.sessionId ? 'selected' : ''}>${UI.esc(dt(s.title))}</option>`).join('')}</select></label>
          <label class="field"><span>${T('training.date')}</span><input id="p_date" type="date" value="${dstr}"></label>
        </div>
        <label class="field"><span>${T('personal.tests')}</span></label>
        <div id="p_tests">${((r.tests && r.tests.length) ? r.tests : [{ unit: 'kg', reps: 1 }]).map(testRowHtml).join('')}</div>
        <button type="button" class="btn sm" id="p_addTest">+ ${T('personal.addTest')}</button>
        <label class="field" style="margin-top:12px"><span>${T('personal.notes')}</span><textarea id="p_notes" rows="3">${UI.esc(r.notes || '')}</textarea></label>
        <p class="hint">${T('personal.safety')}</p>`,
      footer: `<button class="btn ghost" data-close2>${T('common.cancel')}</button><button class="btn primary" data-save>${T('common.save')}</button>`,
      onOpen: (m, close) => {
        const list = m.querySelector('#p_tests');
        const bindRm = () => list.querySelectorAll('[data-trm]').forEach(b => b.onclick = () => {
          if (list.children.length > 1) b.closest('.test-row').remove();
        });
        bindRm();
        m.querySelector('#p_addTest').onclick = () => { list.insertAdjacentHTML('beforeend', testRowHtml({ unit: 'kg', reps: 1 })); bindRm(); };
        m.querySelector('[data-close2]').onclick = close;
        m.querySelector('[data-save]').onclick = async () => {
          const pid = m.querySelector('#p_player').value;
          const p = Store.find('players', pid);
          const sid = m.querySelector('#p_plan').value;
          const s = sid ? Store.find('training', sid) : null;
          const tests = [...list.querySelectorAll('.test-row')].map(row => ({
            name: row.querySelector('[data-tn]').value.trim().slice(0, 80),
            value: +row.querySelector('[data-tv]').value || 0,
            unit: row.querySelector('[data-tu]').value,
            reps: Math.max(1, Math.min(100, +row.querySelector('[data-tr]').value || 1))
          })).filter(t => t.name && t.value > 0);
          if (!p) return UI.toast(T('personal.noPlayers'), 'error');
          if (!tests.length) return UI.toast(T('personal.testReq'), 'error');
          const obj = Object.assign({}, r, {
            playerId: p.id,
            // The name is stored too, so an exported file still reads correctly
            // for a coach who does not have this squad.
            playerName: ('#' + (p.number || '?') + ' ' + [p.firstName, p.lastName].filter(Boolean).join(' ')).trim(),
            sport: r.sport || sportId,
            sessionId: sid, sessionTitle: s ? s.title : '',
            date: new Date(m.querySelector('#p_date').value).getTime() || Date.now(),
            notes: m.querySelector('#p_notes').value.trim().slice(0, 1000),
            tests
          });
          await Store.save('personal', obj);
          close(); UI.toast(T('personal.saved'), 'success'); render();
        };
      }
    });
  }

  // Reads this player's own recorded numbers and the drills of the chosen plan,
  // then asks for a max-test protocol and the loads to train at.
  function maxTestForm(playerId, sessionId) {
    const players = squad();
    const sessions = Store.scoped('training').slice().sort((a, b) => a.date - b.date);
    if (!players.length) return UI.toast(T('personal.noPlayers'), 'error');
    UI.modal({
      title: T('personal.aiMax'),
      width: 620,
      body: `<p style="color:var(--muted);font-size:13px">${T('personal.aiIntro')}</p>
        <div class="row">
          <label class="field"><span>${T('personal.player')}</span><select id="mx_player">${players.map(p => `<option value="${p.id}" ${p.id === playerId ? 'selected' : ''}>#${p.number} ${UI.esc(p.lastName || p.firstName)}</option>`).join('')}</select></label>
          <label class="field"><span>${T('personal.plan')}</span><select id="mx_plan"><option value="">${T('personal.noPlan')}</option>${sessions.map(s => `<option value="${s.id}" ${s.id === sessionId ? 'selected' : ''}>${UI.esc(dt(s.title))}</option>`).join('')}</select></label>
        </div>
        <label class="field"><span>${T('personal.goal')}</span><textarea id="mx_goal" rows="2" placeholder="${UI.esc(T('personal.goalPh'))}"></textarea></label>
        <p class="hint">${T('personal.aiHint')}</p>`,
      footer: `<button class="btn ghost" data-close2>${T('common.cancel')}</button><button class="btn primary" data-gen>${T('training.aiGenerate')}</button>`,
      onOpen: (m, close) => {
        m.querySelector('[data-close2]').onclick = close;
        m.querySelector('[data-gen]').onclick = () => {
          const p = Store.find('players', m.querySelector('#mx_player').value);
          if (!p) return UI.toast(T('personal.noPlayers'), 'error');
          const s = Store.find('training', m.querySelector('#mx_plan').value);
          const goal = m.querySelector('#mx_goal').value.trim().slice(0, 300);
          close();
          runMaxTest(p, s, goal);
        };
      }
    });
  }

  function runMaxTest(p, s, goal) {
    const history = Store.scoped('personal').filter(r => r.playerId === p.id)
      .sort((a, b) => (b.date || 0) - (a.date || 0)).slice(0, 8);
    const planDrills = s ? (s.exercises || []).map(id => Store.find('exercises', id)).filter(Boolean) : [];
    const lines = [
      `Player: #${p.number || '?'} ${[p.firstName, p.lastName].filter(Boolean).join(' ')} — ${p.position || 'unknown position'}`
      + `, ${p.height || '?'} cm, ${p.weight || '?'} kg, status ${p.status || 'active'}.`,
      s ? `Chosen training plan: ${dt(s.title)} (${tt('focus', s.focus)}, ${s.duration || 0} min).` : 'No training plan chosen.',
      planDrills.length
        ? 'Exercises in that plan:\n' + planDrills.map(e => `- ${dt(e.title)} (${tt('cat', e.category)}, ${e.intensity || 'Low'}, ${(e.muscles || []).join('/') || 'unspecified muscles'})`).join('\n')
        : 'The plan lists no exercises.',
      history.length
        ? 'Max tests already recorded, newest first:\n' + history.map(r => `- ${new Date(r.date).toISOString().slice(0, 10)}: ` + (r.tests || []).map(testLine).join('; ')).join('\n')
        : 'No max tests recorded yet.',
      goal ? `The player wants: ${goal}` : ''
    ].filter(Boolean).join('\n');

    AI.report({
      title: T('personal.aiMax') + ' — #' + (p.number || '?') + ' ' + (p.lastName || p.firstName),
      maxTokens: 1100,
      hide: /TESTS:.*$/im,
      // The report is advice; nothing is stored until the coach presses Create.
      actions: [{
        label: T('personal.createEntry'),
        onClick: (text, close) => {
          close();
          personalForm({
            playerId: p.id,
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
        <label class="field"><span>${T('training.drills')}</span><select id="t_ex" multiple size="5">${drills.map(e => `<option value="${e.id}" ${(s.exercises || []).includes(e.id) ? 'selected' : ''}>${UI.esc(dt(e.title))} (${UI.esc(tt('cat', e.category))})</option>`).join('')}</select></label>`,
      footer: `<button class="btn ghost" data-close2>${T('common.cancel')}</button><button class="btn primary" data-save>${T('common.save')}</button>`,
      onOpen: (m, close) => {
        m.querySelector('[data-close2]').onclick = close;
        m.querySelector('[data-save]').onclick = async () => {
          const obj = Object.assign({}, s, {
            teamId: team && team.id, title: m.querySelector('#t_title').value.trim(),
            date: new Date(m.querySelector('#t_date').value).getTime(),
            duration: +m.querySelector('#t_dur').value, focus: m.querySelector('#t_focus').value,
            exercises: [...m.querySelector('#t_ex').selectedOptions].map(o => o.value)
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
        <p class="hint">${T('training.aiSessionHint')}</p>`,
      footer: `<button class="btn ghost" data-close2>${T('common.cancel')}</button><button class="btn primary" data-gen>${T('training.aiGenerate')}</button>`,
      onOpen: (m, close) => {
        m.querySelector('[data-close2]').onclick = close;
        const btn = m.querySelector('[data-gen]');
        btn.onclick = async () => {
          const what = m.querySelector('#s_what').value.trim();
          if (!what) return UI.toast(T('training.aiSessionReq'), 'error');
          btn.disabled = true; btn.textContent = T('ai.asking');
          const plan = await generateSession(what, +m.querySelector('#s_dur').value, m.querySelector('#s_focus').value);
          btn.disabled = false; btn.textContent = T('training.aiGenerate');
          if (plan) showPlan(m, close, plan);
        };
      }
    });
  }

  // Second step of the AI session dialog: the plan with a video link per drill.
  function showPlan(m, close, res) {
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
      </ul>`;
    m.querySelector('.modal-foot').innerHTML =
      `<button class="btn ghost" data-close2>${T('common.cancel')}</button><button class="btn primary" data-use>${T('training.aiUse')}</button>`;
    m.querySelector('[data-close2]').onclick = close;
    m.querySelector('[data-use]').onclick = () => {
      close();
      sessionForm({ title: res.title, focus: res.focus, duration: res.duration, exercises: res.drills.map(e => e.id) });
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
