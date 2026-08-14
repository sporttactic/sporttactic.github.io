/* Teams & Players view */
window.Views = window.Views || {};
Views.teams = function (mount) {
  const sportId = (window.App && App.getSport && App.getSport()) || 'handball';
  // Translate an option value with fallback to the raw value.
  const tt = (p, v) => { const k = p + '.' + v; const r = T(k); return r === k ? v : r; };
  let editing = false;   // squad table switched to inline editing

  // Accepts what a coach actually types (+45 12 34 56 78, 0045-…) and stores
  // E.164, so every view reads back the same string. '' means "not a number".
  function normPhone(v) {
    const raw = String(v == null ? '' : v).trim();
    if (!raw) return '';
    const plus = raw[0] === '+' || raw.slice(0, 2) === '00';
    const digits = raw.replace(/\D/g, '').replace(/^00/, '');
    if (digits.length < 8 || digits.length > 15) return '';
    return (plus ? '+' : '') + digits;
  }

  const posBadgeHtml = (pos) => {
    const b = SPORTS.posBadge(sportId, pos);
    return `<span class="pos-badge role-${b.role}" style="--pos:${b.color}" title="${UI.esc(tt('pos', pos || ''))}">${UI.esc(b.ab)}</span>`;
  };
  const nameInitials = n => { const s = String(n || '').trim().split(/\s+/); return UI.initials(s[0], s[1]); };

  // The club shares a file, but not this block: whatever is listed here stays on
  // this device, which is the one thing the panel has to say out loud.
  function animShareOff() {
    if (!window.TeamCloud || !TeamCloud.cfg().fileId || !window.Privacy) return false;
    return !Privacy.mayShare(Privacy.policy(), 'tactics');
  }
  // Animations a coach filed under this squad on the tactical board, plus the
  // club's own. Saving one files it under no squad, so leaving those out showed
  // a coach an empty panel for work their players could already see.
  function teamAnimations(team) {
    if (!team) return [];
    return Store.all('tactics').filter(t => t.kind === 'system'
      && (t.sport || 'handball') === sportId
      && (t.teamId === team.id || !t.teamId));
  }

  function render() {
    const team = Store.activeTeam();
    const teamList = Store.teams();
    const players = team ? Store.players(team.id) : [];
    const coaches = team ? Store.coaches(team.id) : [];
    const positions = SPORTS.positions(sportId);

    const readRow = p => `
      <tr data-p="${p.id}">
        <td data-label="${UI.esc(T('teams.name'))}" class="wide no-label"><div class="sq-who"><span class="avatar">${UI.initials(p.firstName, p.lastName)}</span><span class="sq-no">#${UI.esc(p.number || '?')}</span><span class="sq-nm">${UI.esc(p.firstName)} ${UI.esc(p.lastName)}</span></div></td>
        <td data-label="${UI.esc(T('teams.position'))}"><span class="sq-val">${posBadgeHtml(p.position)}<span class="sq-pos">${UI.esc(tt('pos', p.position))}</span></span></td>
        <td data-label="${UI.esc(T('teams.size'))}" class="sq-num">${p.height || '—'} / ${p.weight || '—'}</td>
        <td data-label="${UI.esc(T('teams.status'))}">
          <span class="tag ${p.status === 'injured' ? 'red' : p.status === 'suspended' ? 'amber' : 'green'}">${UI.esc(tt('status', p.status || 'active'))}</span>
          ${p.status === 'injured' && p.injuryNote ? `<div class="injury-note">${UI.esc(p.injuryNote)}</div>` : ''}
        </td>
        <td data-label="${UI.esc(T('teams.contact'))}" class="wide"><div class="contact-cell"><span>${UI.esc(p.phone || '—')}</span><span class="contact-mail">${UI.esc(p.email || '—')}</span></div></td>
        <td class="acts-cell">
          <div class="row-acts icons">
            <button class="btn sm" data-mail="${p.id}" title="${UI.esc(T('mail.mail'))}" aria-label="${UI.esc(T('mail.mail'))}">✉</button>
            <button class="btn sm" data-chat="${p.id}" title="${UI.esc(T('teams.chat'))}" aria-label="${UI.esc(T('teams.chat'))}">💬</button>
            <button class="btn sm" data-edit="${p.id}" title="${UI.esc(T('common.edit'))}" aria-label="${UI.esc(T('common.edit'))}">✎</button>
            <button class="btn sm danger" data-del="${p.id}" title="${UI.esc(T('common.delete'))}" aria-label="${UI.esc(T('common.delete'))}">${UI.icon('trash', 14)}</button>
          </div>
        </td>
      </tr>`;

    // Inline editing: every cell of the squad is a field, saved in one go.
    const editRow = p => `
      <tr data-p="${p.id}" class="row-edit">
        <td data-label="${UI.esc(T('teams.name'))}" class="wide"><div class="cell-pair">
          <input class="cell cell-no" type="number" data-f="number" value="${UI.esc(p.number || '')}" placeholder="#" aria-label="${UI.esc(T('teams.number'))}">
          <input class="cell" data-f="firstName" value="${UI.esc(p.firstName || '')}" placeholder="${UI.esc(T('teams.firstName'))}">
          <input class="cell" data-f="lastName" value="${UI.esc(p.lastName || '')}" placeholder="${UI.esc(T('teams.lastName'))}"></div></td>
        <td data-label="${UI.esc(T('teams.position'))}"><select class="cell" data-f="position">${positions.map(x => `<option value="${UI.esc(x)}" ${x === p.position ? 'selected' : ''}>${UI.esc(SPORTS.posBadge(sportId, x).ab)} \u2013 ${UI.esc(tt('pos', x))}</option>`).join('')}</select></td>
        <td data-label="${UI.esc(T('teams.size'))}"><div class="cell-pair">
          <input class="cell" type="number" data-f="height" value="${UI.esc(p.height || '')}" placeholder="${UI.esc(T('teams.height'))}">
          <input class="cell" type="number" data-f="weight" value="${UI.esc(p.weight || '')}" placeholder="${UI.esc(T('teams.weight'))}"></div></td>
        <td data-label="${UI.esc(T('teams.status'))}"><select class="cell" data-f="status">
          ${['active', 'injured', 'suspended'].map(s => `<option value="${s}" ${p.status === s ? 'selected' : ''}>${UI.esc(tt('status', s))}</option>`).join('')}</select></td>
        <td data-label="${UI.esc(T('teams.contact'))}" class="wide"><div class="cell-pair">
          <input class="cell" type="tel" data-f="phone" value="${UI.esc(p.phone || '')}" placeholder="+45…">
          <input class="cell" type="email" data-f="email" value="${UI.esc(p.email || '')}" placeholder="${UI.esc(T('teams.email'))}"></div></td>
        <td class="acts-cell"><div class="row-acts icons"><button class="btn sm danger" data-del="${p.id}" title="${UI.esc(T('common.delete'))}" aria-label="${UI.esc(T('common.delete'))}">${UI.icon('trash', 14)}</button></div></td>
      </tr>`;

    const squadTable = `
      <div class="grid cols-4" style="margin-bottom:16px">
        ${UI.statCard(players.length, T('dash.players'))}
        ${UI.statCard(players.filter(p => p.position === 'Goalkeeper').length, 'GK')}
        ${UI.statCard(coaches.length, T('teams.staff'))}
        ${UI.statCard(players.filter(p => p.status === 'active').length, T('status.available'))}
      </div>
      ${editing ? `<p class="hint">${T('teams.editHint')}</p>` : ''}
      <div class="table-wrap">
        <table class="compact stack${editing ? ' squad-edit' : ''}">
          <thead><tr><th>${T('teams.name')}</th><th>${T('teams.position')}</th><th>${T('teams.size')}</th><th>${T('teams.status')}</th><th>${T('teams.contact')}</th><th></th></tr></thead>
          <tbody>
            ${players.map(p => editing ? editRow(p) : readRow(p)).join('') || `<tr><td colspan="6" class="empty">${T('common.noData')}</td></tr>`}
          </tbody>
        </table>
      </div>`;

    const staffList = coaches.map(c => `
      <div class="staff-row">
        <span class="avatar">${nameInitials(c.name)}</span>
        <span class="staff-name">${UI.esc(c.name)}${c.email ? `<span class="staff-mail">${UI.esc(c.email)}</span>` : ''}</span>
        <span class="tag blue">${UI.esc(tt('coachRole', c.role))}</span>
        <span class="staff-actions">
          <button class="btn sm" data-staffchat="${c.id}" title="${UI.esc(T('teams.chat'))}" aria-label="${UI.esc(T('teams.chat'))}">💬</button>
          <button class="btn sm" data-editstaff="${c.id}" title="${UI.esc(T('common.edit'))}" aria-label="${UI.esc(T('common.edit'))}">✎</button>
          <button class="btn sm danger" data-delstaff="${c.id}" title="${UI.esc(T('common.delete'))}" aria-label="${UI.esc(T('common.delete'))}">${UI.icon('trash', 14)}</button>
        </span>
      </div>`).join('') || `<p style="color:var(--muted)">${T('common.noData')}</p>`;

    const teamAnims = teamAnimations(team);
    const squadActions = editing
      ? `<button class="btn ghost" id="cancelSquad">${T('common.cancel')}</button>
         <button class="btn primary" id="saveSquad">${T('teams.saveSquad')}</button>`
      : `<button class="btn sm" id="mailSquad">✉ ${T('mail.title')}</button>
         <button class="btn sm" id="squadAnims">▶ ${T('teams.anims')} <span class="tag">${teamAnims.length}</span></button>
         <button class="btn sm" id="editSquad" data-write>✎ ${T('teams.editSquad')}</button>
         <button class="btn sm" id="aiSquad" data-write>🤖 ${T('teams.aiSquad')}</button>
         <button class="btn primary" id="addPlayer">+ ${T('teams.addPlayer')}</button>`;

    const teamBar = `
      <div class="team-bar">
        <label class="field"><span>${T('teams.activeTeam')}</span>
          <select id="teamPick">${teamList.map(x => `<option value="${UI.esc(x.id)}" ${team && x.id === team.id ? 'selected' : ''}>${UI.esc(x.name)}</option>`).join('') || `<option value="">${UI.esc(T('teams.noTeam'))}</option>`}</select></label>
        <button class="btn sm" id="editTeamBtn" data-write ${team ? '' : 'disabled'}>✎ ${T('teams.editTeam')}</button>
        <button class="btn sm" id="newTeam" data-write>+ ${T('teams.newTeam')}</button>
        <button class="btn sm danger" id="delTeam" ${Store.all('teams').length < 2 ? 'disabled' : ''}>${T('teams.delTeam')}</button>
      </div>
      ${team ? `<div class="team-facts">
        <span class="tag">${T('teams.clubField')}: ${UI.esc(clubName(team) || '—')}</span>
        <span class="tag">${T('teams.seasonField')}: ${UI.esc(seasonName(team) || '—')}</span>
        <span class="tag">${T('teams.division')}: ${UI.esc(team.division || '—')}</span>
        <span class="tag">${T('teams.category')}: ${UI.esc(team.category || '—')}</span>
        <span class="tag">${T('teams.venue')}: ${UI.esc(team.venue || '—')}</span>
      </div>` : ''}
      <p class="hint">${T('teams.scopeHint')}</p>`;

    mount.innerHTML = `
      ${AI.section('injuries')}
      <div class="page-head">
        <div><h1>${T('teams.title')}</h1>
          <p><button type="button" class="inline-edit" id="editTeam" data-write title="${T('teams.editTeam')}">${UI.esc(team ? team.name : T('teams.noTeam'))}${team && team.division ? ' · ' + UI.esc(team.division) : ''}<span class="pen">✎</span></button></p>
        </div>
      </div>
      ${UI.acc('teamPickers', T('teams.teams'), teamBar, {
      sub: teamList.length + ' · ' + SPORTS.name(sportId, I18N.getLang())
    })}
      ${UI.acc('squad', T('teams.squad'), squadTable, {
      sub: T('teams.squadHint') + ': ' + SPORTS.name(sportId, I18N.getLang()),
      actions: squadActions
    })}
      ${UI.acc('staff', T('teams.staff'), staffList, {
      actions: `<button class="btn sm primary" id="addStaff">+ ${T('teams.addStaff')}</button>`
    })}`;
    UI.bindAcc(mount);
    bind(team, players);
  }

  function bind(team, players) {
    const q = s => mount.querySelector(s);
    q('#editTeam').onclick = () => teamForm(team);
    const editBtn = q('#editTeamBtn');
    if (editBtn) editBtn.onclick = () => team ? teamForm(team) : UI.toast(T('teams.noTeamFirst'), 'error');
    q('#addStaff').onclick = () => team ? staffForm(team) : UI.toast(T('teams.noTeamFirst'), 'error');

    const pick = q('#teamPick');
    if (pick) pick.onchange = () => { Store.setActiveTeam(pick.value); App.populateTeamPicker(); render(); };
    q('#newTeam').onclick = () => teamForm(null, true);
    q('#delTeam').onclick = () => {
      if (!team) return;
      UI.confirm(T('teams.delTeamAsk'), async () => {
        // Everything the team owns goes with it, so no orphan rows are left behind.
        for (const s of ['players', 'coaches', 'matches', 'opponents', 'training', 'personal']) {
          for (const r of Store.all(s).filter(x => x.teamId === team.id)) await Store.remove(s, r.id);
        }
        await Store.remove('teams', team.id);
        Store.setActiveTeam('');
        App.populateTeamPicker();
        UI.toast(T('common.delete'), 'success'); render();
      });
    };

    if (editing) {
      q('#cancelSquad').onclick = () => { editing = false; render(); };
      q('#saveSquad').onclick = () => saveSquad(players);
    } else {
      q('#addPlayer').onclick = () => team ? form(team) : UI.toast(T('teams.noTeamFirst'), 'error');
      q('#aiSquad').onclick = () => team ? aiSquadForm(team) : UI.toast(T('teams.noTeamFirst'), 'error');
      q('#editSquad').onclick = () => { editing = true; render(); };
      q('#mailSquad').onclick = () => MAIL.compose({
        players, title: T('mail.title') + ' — ' + T('teams.squad')
      });
      q('#squadAnims').onclick = () => animListDialog(team, teamAnimations(team));
      mount.querySelectorAll('[data-mail]').forEach(b => b.onclick = () => {
        const p = Store.find('players', b.dataset.mail);
        if (p) MAIL.compose({ players: [p], title: T('mail.title') + ' — ' + (p.firstName + ' ' + p.lastName).trim() });
      });
      mount.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => form(team, Store.find('players', b.dataset.edit)));
      mount.querySelectorAll('[data-chat]').forEach(b => b.onclick = () => {
        const p = Store.find('players', b.dataset.chat);
        if (p) App.go('messenger', { playerId: p.id, playerName: (p.firstName + ' ' + p.lastName).trim(), memberStore: 'players', from: 'teams' });
      });
    }

    mount.querySelectorAll('[data-editstaff]').forEach(b => b.onclick = () => staffForm(team, Store.find('coaches', b.dataset.editstaff)));
    mount.querySelectorAll('[data-delstaff]').forEach(b => b.onclick = () => UI.confirm(T('teams.delStaff'), async () => { await Store.remove('coaches', b.dataset.delstaff); UI.toast(T('common.delete')); render(); }));
    mount.querySelectorAll('[data-staffchat]').forEach(b => b.onclick = () => {
      const c = Store.find('coaches', b.dataset.staffchat);
      if (c) App.go('messenger', { playerId: c.id, playerName: c.name, memberStore: 'coaches', from: 'teams' });
    });
    mount.querySelectorAll('[data-del]').forEach(b => b.onclick = () => UI.confirm(T('teams.delPlayer'), async () => { await Store.remove('players', b.dataset.del); UI.toast(T('common.delete')); render(); }));
    AI.bind(mount);
  }

  // Writes back only the rows the coach actually changed.
  async function saveSquad(players) {
    const rows = [...mount.querySelectorAll('tr[data-p]')];
    let n = 0, bad = 0;
    for (const tr of rows) {
      const p = players.find(x => x.id === tr.dataset.p);
      if (!p) continue;
      const get = f => { const el = tr.querySelector(`[data-f="${f}"]`); return el ? el.value.trim() : ''; };
      const first = get('firstName');
      if (!first) { bad++; continue; }
      const raw = get('phone');
      // Stored in E.164, so every view sends to the same string.
      const phone = raw ? normPhone(raw) : '';
      if (raw && !phone) { bad++; continue; }
      const rawMail = get('email');
      const email = rawMail ? MAIL.normEmail(rawMail) : '';
      if (rawMail && !email) { bad++; continue; }
      const next = Object.assign({}, p, {
        number: +get('number') || 0,
        firstName: first,
        lastName: get('lastName'),
        position: get('position'),
        height: +get('height') || 0,
        weight: +get('weight') || 0,
        phone,
        email,
        status: get('status')
      });
      // An injury note must not linger on a player who is fit again.
      if (next.status !== 'injured') next.injuryNote = '';
      const changed = ['number', 'firstName', 'lastName', 'position', 'height', 'weight', 'phone', 'email', 'status', 'injuryNote']
        .some(k => (p[k] || '') !== (next[k] || ''));
      if (!changed) continue;
      await Store.save('players', next);
      n++;
    }
    if (bad) UI.toast(T('teams.rowsSkipped') + ': ' + bad, 'error');
    if (n) UI.toast(T('teams.squadSaved') + ' (' + n + ')', 'success');
    editing = false;
    render();
  }

  // The animations a coach filed under this squad on the tactical board.
  function animListDialog(team, anims) {    const row = a => `<div class="acc-person">
      <span class="acc-person-main">
        <b>${UI.esc(a.name || T('tactics.animTitle'))}</b>
        <span class="tag">${(a.frames || []).length} ${UI.esc(T('tactics.frameList'))}</span>
        ${(a.clips || []).length ? `<span class="tag green">▶ ${(a.clips || []).length}</span>` : ''}
      </span>
      <span class="bm-acts">
        <button class="btn sm" data-anim-show="${UI.esc(a.id)}">▶ ${T('teams.animShowNow')}</button>
        <button class="btn sm primary" data-anim-open="${UI.esc(a.id)}">${T('common.go')}</button>
        ${team && a.teamId === team.id ? `<button class="btn sm danger" data-anim-rm="${UI.esc(a.id)}">${T('teams.animRemove')}</button>` : ''}
      </span>
    </div>`;
    UI.modal({
      title: T('teams.anims') + (team ? ' — ' + team.name : ''),
      width: 620,
      body: `<p>${UI.esc(T('teams.animsIntro'))}</p>
        ${animShareOff() ? `<p class="hint warn">${UI.esc(T('teams.animsOff'))}</p>` : ''}
        <div class="acc-people">${anims.length ? anims.map(row).join('') : `<p class="hint">${UI.esc(T('teams.animsNone'))}</p>`}</div>`,
      footer: `<button class="btn" data-board>${UI.esc(T('teams.animsBoard'))}</button>
        <button class="btn primary" data-close2>${T('common.close')}</button>`,
      onOpen: (m, close) => {
        m.querySelector('[data-close2]').onclick = close;
        m.querySelector('[data-board]').onclick = () => { close(); App.go('tactics'); };
        m.querySelectorAll('[data-anim-open]').forEach(b => b.onclick = () => {
          close();
          App.go('tactics', { animId: b.dataset.animOpen });
        });
        // Watch it here and now; the board is for working on it.
        m.querySelectorAll('[data-anim-show]').forEach(b => b.onclick = () => {
          const id = b.dataset.animShow;
          close();
          ANIM.open(id);
        });
        m.querySelectorAll('[data-anim-rm]').forEach(b => b.onclick = () => {
          const a = Store.find('tactics', b.dataset.animRm);
          if (!a) return;
          // Only the link to the squad goes; the animation itself stays in the library.
          UI.confirm(T('teams.animRemoveAsk').replace('{0}', a.name || ''), async () => {
            await Store.save('tactics', Object.assign({}, a, { teamId: '' }));
            close();
            UI.toast(T('teams.animRemoved'), 'success');
            render();
          });
        });
      }
    });
  }

  function form(team, p = {}) {
    const positions = SPORTS.positions(sportId);
    UI.modal({
      title: p.id ? T('teams.editPlayer') : T('teams.newPlayer'),
      body: `
        <div class="row"><label class="field"><span>${T('teams.firstName')}</span><input id="f_first" value="${UI.esc(p.firstName || '')}"></label>
        <label class="field"><span>${T('teams.lastName')}</span><input id="f_last" value="${UI.esc(p.lastName || '')}"></label></div>
        <div class="row"><label class="field"><span>${T('teams.number')}</span><input id="f_num" type="number" value="${UI.esc(p.number || '')}"></label>
        <label class="field"><span>${T('teams.position')}</span><select id="f_pos">${positions.map(x => `<option value="${x}" ${x === p.position ? 'selected' : ''}>${UI.esc(SPORTS.posBadge(sportId, x).ab)} \u2013 ${UI.esc(tt('pos', x))}</option>`).join('')}</select></label></div>
        <div class="row"><label class="field"><span>${T('teams.height')} (cm)</span><input id="f_h" type="number" value="${UI.esc(p.height || '')}"></label>
        <label class="field"><span>${T('teams.weight')} (kg)</span><input id="f_w" type="number" value="${UI.esc(p.weight || '')}"></label>
        <label class="field"><span>${T('teams.status')}</span><select id="f_st"><option value="active" ${p.status === 'active' ? 'selected' : ''}>${UI.esc(tt('status', 'active'))}</option><option value="injured" ${p.status === 'injured' ? 'selected' : ''}>${UI.esc(tt('status', 'injured'))}</option><option value="suspended" ${p.status === 'suspended' ? 'selected' : ''}>${UI.esc(tt('status', 'suspended'))}</option></select></label></div>
        <label class="field"><span>${T('teams.phone')}</span><input id="f_ph" type="tel" value="${UI.esc(p.phone || '')}" placeholder="+45 12 34 56 78">
          <span class="hint">${T('teams.phoneHint')}</span></label>
        <label class="field"><span>${T('teams.email')}</span><input id="f_em" type="email" value="${UI.esc(p.email || '')}" placeholder="${UI.esc(T('teams.emailPh'))}">
          <span class="hint">${T('teams.emailHint')}</span></label>
        <label class="field" id="f_noteWrap" style="display:${p.status === 'injured' ? 'block' : 'none'}"><span>${T('teams.injuryNote')}</span>
          <textarea id="f_note" rows="3" placeholder="${UI.esc(T('teams.injuryNotePh'))}">${UI.esc(p.injuryNote || '')}</textarea>
          <span class="hint">${T('teams.injuryNoteHint')}</span></label>`,
      footer: `<button class="btn ghost" data-close2>${T('common.cancel')}</button><button class="btn primary" data-save>${T('common.save')}</button>`,
      onOpen: (m, close) => {
        m.querySelector('[data-close2]').onclick = close;
        const st = m.querySelector('#f_st'), noteWrap = m.querySelector('#f_noteWrap');
        st.onchange = () => { noteWrap.style.display = st.value === 'injured' ? 'block' : 'none'; };
        m.querySelector('[data-save]').onclick = async () => {
          const injured = st.value === 'injured';
          const raw = m.querySelector('#f_ph').value.trim();
          const phone = raw ? normPhone(raw) : '';
          const rawMail = m.querySelector('#f_em').value.trim();
          const email = rawMail ? MAIL.normEmail(rawMail) : '';
          const obj = Object.assign({}, p, {
            teamId: team.id,
            // The squad belongs to the sport it was registered under — switching
            // sport hides players from the other categories.
            sport: p.sport || sportId,
            firstName: m.querySelector('#f_first').value.trim(),
            lastName: m.querySelector('#f_last').value.trim(),
            number: +m.querySelector('#f_num').value,
            position: m.querySelector('#f_pos').value,
            height: +m.querySelector('#f_h').value,
            weight: +m.querySelector('#f_w').value,
            phone,
            email,
            status: st.value,
            injuryNote: injured ? m.querySelector('#f_note').value.trim() : ''
          });
          if (!obj.firstName) return UI.toast(T('teams.reqName'), 'error');
          if (raw && !phone) return UI.toast(T('teams.badPhone'), 'error');
          if (rawMail && !email) return UI.toast(T('teams.badEmail'), 'error');
          await Store.save('players', obj);
          close(); UI.toast(T('common.save'), 'success'); render();
        };
      }
    });
  }

  // ---- AI squad builder ---------------------------------------------------
  // Type the names you already have — the model fills in the squad around them:
  // a shirt number nobody else wears, a position that fits the sport, and a
  // plausible height and weight for the level. Nothing is invented that could
  // identify anybody: no phone numbers, no addresses, no e-mail.
  function aiSquadForm(team) {
    const positions = SPORTS.positions(sportId);
    const taken = Store.players(team.id).map(p => +p.number).filter(Boolean);
    UI.modal({
      title: T('teams.aiSquad'),
      width: 640,
      body: `<p style="color:var(--muted);font-size:13px">${T('teams.aiSquadIntro')}</p>
        <label class="field"><span>${T('teams.aiSquadNames')}</span>
          <textarea id="as_names" rows="8" placeholder="${UI.esc(T('teams.aiSquadPh'))}"></textarea>
          <span class="hint">${T('teams.aiSquadNamesHint')}</span></label>
        <label class="field"><span>${T('teams.aiSquadLevel')} <span class="hint">— ${T('exercises.aiOptional')}</span></span>
          <input id="as_level" maxlength="80" value="${UI.esc([team.category, team.division].filter(Boolean).join(' · '))}"></label>
        <p class="hint">${T('teams.aiSquadHint')}</p>`,
      footer: `<button class="btn ghost" data-close2>${T('common.cancel')}</button>
        <button class="btn primary" data-gen>${T('training.aiGenerate')}</button>`,
      onOpen: (m, close) => {
        m.querySelector('[data-close2]').onclick = close;
        const btn = m.querySelector('[data-gen]');
        btn.onclick = async () => {
          const names = m.querySelector('#as_names').value.split(/[\n;]+/)
            .map(s => s.replace(/^\s*[\d.,)#-]+\s*/, '').trim()).filter(Boolean).slice(0, 40);
          if (!names.length) return UI.toast(T('teams.aiSquadReq'), 'error');
          btn.disabled = true; btn.textContent = T('ai.asking');
          const drafts = await generateSquad(names, m.querySelector('#as_level').value.trim(), positions, taken);
          btn.disabled = false; btn.textContent = T('training.aiGenerate');
          if (!drafts || !drafts.length) return;
          close();
          aiSquadReview(team, drafts);
        };
      }
    });
  }

  async function generateSquad(names, level, positions, taken) {
    const sport = SPORTS.name(sportId, 'en');
    const system = [
      `You build a ${sport} squad list for a coach.`,
      'Answer with one JSON object and nothing else — no markdown, no code fence, no commentary.',
      'Shape: {"players":[{"firstName":"","lastName":"","number":0,"position":"","height":0,"weight":0}]}',
      'Return exactly one entry for every name you were given, in the same order.',
      'Split each name into first and last name. Spell both exactly as they were written — never translate, shorten or correct them.',
      `position must be copied from this list, in English: ${positions.join(', ')}.`,
      'Spread the positions the way a real squad is built for this sport, with the right number of goalkeepers.',
      'number is a shirt number from 1 to 99, different for every player, and not one of these already in use: ' + (taken.join(', ') || 'none') + '.',
      'height is in centimetres and weight in kilograms — plausible for the level, never a real person\'s data.',
      'Invent nothing else. No e-mail, no phone number, no notes, no comments.'
    ].join('\n');
    const user = JSON.stringify({ level: level || '', names });
    const raw = await AI.complete(system, user, 260 + names.length * 60);
    if (!raw) return null;
    let d;
    try { d = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)); }
    catch (e) { UI.toast(T('training.aiBad'), 'error'); return null; }
    const used = new Set(taken);
    const out = (Array.isArray(d.players) ? d.players : []).map(p => {
      let num = Math.max(0, Math.min(99, Math.round(+p.number || 0)));
      while (!num || used.has(num)) num = num < 99 ? num + 1 : 1;
      used.add(num);
      return {
        firstName: String(p.firstName || '').trim().slice(0, 40),
        lastName: String(p.lastName || '').trim().slice(0, 40),
        number: num,
        position: positions.indexOf(String(p.position || '')) >= 0 ? p.position : positions[0],
        height: Math.max(0, Math.min(260, Math.round(+p.height || 0))),
        weight: Math.max(0, Math.min(200, Math.round(+p.weight || 0)))
      };
    }).filter(p => p.firstName || p.lastName);
    if (!out.length) UI.toast(T('training.aiBad'), 'error');
    return out;
  }

  // Nothing reaches the squad until the coach has looked at it and ticked it.
  function aiSquadReview(team, list) {
    const positions = SPORTS.positions(sportId);
    const row = (p, i) => `<div class="draft-row">
      <label class="check-row"><input type="checkbox" data-draft="${i}" checked>
        <span><b>${UI.esc((p.firstName + ' ' + p.lastName).trim())}</b></span></label>
      <div class="draft-meta">
        <label class="field" style="max-width:88px"><span>${T('teams.number')}</span>
          <input type="number" data-f="number" data-i="${i}" min="1" max="99" value="${UI.esc(p.number)}"></label>
        <label class="field" style="max-width:200px"><span>${T('teams.position')}</span>
          <select data-f="position" data-i="${i}">${positions.map(x => `<option value="${UI.esc(x)}" ${x === p.position ? 'selected' : ''}>${UI.esc(SPORTS.posBadge(sportId, x).ab)} \u2013 ${UI.esc(tt('pos', x))}</option>`).join('')}</select></label>
        <label class="field" style="max-width:96px"><span>${T('teams.height')}</span>
          <input type="number" data-f="height" data-i="${i}" value="${UI.esc(p.height || '')}"></label>
        <label class="field" style="max-width:96px"><span>${T('teams.weight')}</span>
          <input type="number" data-f="weight" data-i="${i}" value="${UI.esc(p.weight || '')}"></label>
      </div>
    </div>`;
    UI.modal({
      title: T('teams.aiSquadReview'),
      width: 720,
      body: `<p class="hint" style="margin-top:0">${T('teams.aiSquadReviewHint')}</p>
        <div class="focus-acts">
          <button type="button" class="btn sm" data-all>${T('settings.shareAll')}</button>
          <button type="button" class="btn sm" data-none>${T('settings.shareNone')}</button>
        </div>
        <div class="draft-list">${list.map(row).join('')}</div>`,
      footer: `<button class="btn ghost" data-close2>${T('common.cancel')}</button>
        <button class="btn primary" data-save>${T('common.save')}</button>`,
      onOpen: (m, close) => {
        const boxes = [...m.querySelectorAll('[data-draft]')];
        m.querySelector('[data-all]').onclick = () => boxes.forEach(b => { b.checked = true; });
        m.querySelector('[data-none]').onclick = () => boxes.forEach(b => { b.checked = false; });
        // What is on screen is what gets saved, so an edit here is not lost.
        m.querySelectorAll('[data-f]').forEach(el => el.onchange = () => {
          const p = list[+el.dataset.i];
          p[el.dataset.f] = el.type === 'number' ? +el.value || 0 : el.value;
        });
        m.querySelector('[data-close2]').onclick = close;
        m.querySelector('[data-save]').onclick = async () => {
          const picked = boxes.filter(b => b.checked).map(b => list[+b.dataset.draft]);
          if (!picked.length) return UI.toast(T('exercises.aiNonePicked'), 'error');
          for (const p of picked) {
            await Store.save('players', {
              teamId: team.id, sport: sportId, status: 'active',
              firstName: p.firstName, lastName: p.lastName, number: p.number,
              position: p.position, height: p.height, weight: p.weight
            });
          }
          close();
          UI.toast(picked.length + ' ' + T('teams.aiSquadSaved'), 'success');
          render();
        };
      }
    });
  }

  // `fresh` starts a brand new squad instead of editing the active one.
  const clubName = t => { const c = t && Store.find('clubs', t.clubId); return c ? c.name : ''; };
  const seasonName = t => { const s = t && Store.find('seasons', t.seasonId); return s ? s.name : ''; };

  function teamForm(team, fresh) {
    const t = fresh ? {} : (team || {});
    // The text field stays authoritative; the select beside it only fills it in,
    // so a league SportTactic has never heard of is still allowed. The option
    // shows the translated wording while the value written stays English.
    const combo = (id, val, list, prefix) => `<div class="combo">
      <input id="${id}" value="${UI.esc(val || '')}">
      <select id="${id}Pick"><option value="">${T('teams.pick')}</option>${list.map(x => `<option value="${UI.esc(x)}" ${x === val ? 'selected' : ''}>${UI.esc(tt(prefix, x))}</option>`).join('')}</select>
    </div>`;
    const club = Store.find('clubs', t.clubId) || Store.all('clubs')[0] || {};
    const season = Store.find('seasons', t.seasonId) || Store.all('seasons')[0] || {};
    UI.modal({
      title: fresh ? T('teams.newTeam') : T('teams.editTeam'),
      width: 620,
      body: `
        <label class="field"><span>${T('teams.teamName')}</span><input id="t_name" value="${UI.esc(t.name || '')}"></label>
        <div class="row"><label class="field"><span>${T('teams.division')}</span>${combo('t_div', t.division, SPORTS.divisions(sportId), 'division')}</label>
        <label class="field"><span>${T('teams.category')}</span>${combo('t_cat', t.category, SPORTS.categories(sportId), 'teamCat')}</label></div>
        <div class="row">
          <label class="field"><span>${T('teams.clubField')}</span><input id="t_club" value="${UI.esc(club.name || '')}" placeholder="${UI.esc(T('teams.clubPh'))}"></label>
          <label class="field"><span>${T('teams.seasonField')}</span><input id="t_season" value="${UI.esc(season.name || '')}" placeholder="2025/2026"></label>
        </div>
        <label class="field"><span>${T('teams.venue')}</span><input id="t_venue" value="${UI.esc(t.venue || '')}" placeholder="${UI.esc(T('teams.venuePh'))}">
          <span class="hint">${T('teams.venueHint')}</span></label>
        ${fresh ? `<p class="hint">${T('teams.newTeamHint')}</p>` : ''}`,
      footer: `<button class="btn ghost" data-close2>${T('common.cancel')}</button><button class="btn primary" data-save>${T('common.save')}</button>`,
      onOpen: (m, close) => {
        m.querySelector('[data-close2]').onclick = close;
        ['t_div', 't_cat'].forEach(id => {
          const pick = m.querySelector('#' + id + 'Pick');
          pick.onchange = () => { if (pick.value) m.querySelector('#' + id).value = pick.value; };
        });
        m.querySelector('[data-save]').onclick = async () => {
          const name = m.querySelector('#t_name').value.trim();
          if (!name) return UI.toast(T('teams.reqTeamName'), 'error');
          // The club and the season are their own records — renamed in place, or
          // created when the install has none yet.
          const clubName2 = m.querySelector('#t_club').value.trim();
          const seasonName2 = m.querySelector('#t_season').value.trim();
          let clubId = club.id, seasonId = season.id;
          if (clubName2) clubId = (await Store.save('clubs', Object.assign({}, club, { name: clubName2 }))).id;
          if (seasonName2) seasonId = (await Store.save('seasons', Object.assign({}, season, { name: seasonName2, clubId: clubId }))).id;
          // Falls back to creating the team when none exists yet.
          const obj = Object.assign({}, t, {
            name, clubId, seasonId,
            // A team belongs to one sport, so the switcher only lists its own squads.
            sport: t.sport || sportId,
            division: m.querySelector('#t_div').value.trim(),
            category: m.querySelector('#t_cat').value.trim(),
            venue: m.querySelector('#t_venue').value.trim().slice(0, 80)
          });
          const saved = await Store.save('teams', obj);
          if (fresh) Store.setActiveTeam(saved.id);
          App.populateTeamPicker();
          close(); UI.toast(T('common.save'), 'success'); render();
        };
      }
    });
  }

  function staffForm(team, c = {}) {
    const roles = ['Head Coach', 'Assistant Coach', 'Goalkeeper Coach', 'Physio', 'Analyst', 'Team Manager'];
    UI.modal({
      title: c.id ? T('teams.editStaff') : T('teams.newStaff'),
      body: `
        <label class="field"><span>${T('teams.staffName')}</span><input id="s_name" value="${UI.esc(c.name || '')}"></label>
        <label class="field"><span>${T('teams.staffRole')}</span><select id="s_role">${roles.map(x => `<option value="${x}" ${x === c.role ? 'selected' : ''}>${UI.esc(tt('coachRole', x))}</option>`).join('')}</select></label>
        <label class="field"><span>${T('teams.email')}</span><input id="s_email" type="email" autocomplete="off" spellcheck="false" value="${UI.esc(c.email || '')}" placeholder="${UI.esc(T('teams.coachEmailPh'))}">
          <span class="hint">${T('teams.staffEmailHint')}</span></label>`,
      footer: `<button class="btn ghost" data-close2>${T('common.cancel')}</button><button class="btn primary" data-save>${T('common.save')}</button>`,
      onOpen: (m, close) => {
        m.querySelector('[data-close2]').onclick = close;
        m.querySelector('[data-save]').onclick = async () => {
          const email = m.querySelector('#s_email').value.trim();
          if (email && !MAIL.normEmail(email)) return UI.toast(T('teams.badEmail'), 'error');
          const obj = Object.assign({}, c, {
            teamId: team.id,
            name: m.querySelector('#s_name').value.trim(),
            role: m.querySelector('#s_role').value,
            email: MAIL.normEmail(email) || ''
          });
          if (!obj.name) return UI.toast(T('teams.reqStaffName'), 'error');
          await Store.save('coaches', obj);
          close(); UI.toast(T('common.save'), 'success'); render();
        };
      }
    });
  }

  render();
};
