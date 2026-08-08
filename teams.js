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

  function render() {
    const team = Store.activeTeam();
    const teamList = Store.teams();
    const players = team ? Store.players(team.id) : [];
    const coaches = team ? Store.coaches(team.id) : [];
    const positions = SPORTS.positions(sportId);

    const readRow = p => `
      <tr data-p="${p.id}">
        <td><strong>${p.number}</strong></td>
        <td><div style="display:flex;align-items:center;gap:10px"><span class="avatar">${UI.initials(p.firstName, p.lastName)}</span>${UI.esc(p.firstName)} ${UI.esc(p.lastName)}</div></td>
        <td>${posBadgeHtml(p.position)}${UI.esc(tt('pos', p.position))}</td>
        <td>${p.height || '—'} cm</td>
        <td>${p.weight || '—'} kg</td>
        <td><div class="contact-cell"><span>${UI.esc(p.phone || '—')}</span><span class="contact-mail">${UI.esc(p.email || '—')}</span></div></td>
        <td>
          <span class="tag ${p.status === 'injured' ? 'red' : p.status === 'suspended' ? 'amber' : 'green'}">${UI.esc(tt('status', p.status || 'active'))}</span>
          <button class="btn sm danger" data-del="${p.id}" title="${T('common.delete')}">${UI.icon('trash', 14)}</button>
          ${p.status === 'injured' && p.injuryNote ? `<div class="injury-note">${UI.esc(p.injuryNote)}</div>` : ''}
        </td>
        <td style="text-align:right;white-space:nowrap">
          <button class="btn sm" data-mail="${p.id}">✉ ${T('mail.mail')}</button>
          <button class="btn sm" data-chat="${p.id}">💬 ${T('teams.chat')}</button>
          <button class="btn sm" data-edit="${p.id}">${T('common.edit')}</button>
        </td>
      </tr>`;

    // Inline editing: every cell of the squad is a field, saved in one go.
    const editRow = p => `
      <tr data-p="${p.id}" class="row-edit">
        <td><input class="cell" type="number" data-f="number" value="${UI.esc(p.number || '')}"></td>
        <td><div class="cell-pair">
          <input class="cell" data-f="firstName" value="${UI.esc(p.firstName || '')}" placeholder="${UI.esc(T('teams.firstName'))}">
          <input class="cell" data-f="lastName" value="${UI.esc(p.lastName || '')}" placeholder="${UI.esc(T('teams.lastName'))}"></div></td>
        <td><select class="cell" data-f="position">${positions.map(x => `<option value="${UI.esc(x)}" ${x === p.position ? 'selected' : ''}>${UI.esc(SPORTS.posBadge(sportId, x).ab)} \u2013 ${UI.esc(tt('pos', x))}</option>`).join('')}</select></td>
        <td><input class="cell" type="number" data-f="height" value="${UI.esc(p.height || '')}"></td>
        <td><input class="cell" type="number" data-f="weight" value="${UI.esc(p.weight || '')}"></td>
        <td><div class="cell-pair">
          <input class="cell" type="tel" data-f="phone" value="${UI.esc(p.phone || '')}" placeholder="+45…">
          <input class="cell" type="email" data-f="email" value="${UI.esc(p.email || '')}" placeholder="${UI.esc(T('teams.email'))}"></div></td>
        <td><select class="cell" data-f="status">
          ${['active', 'injured', 'suspended'].map(s => `<option value="${s}" ${p.status === s ? 'selected' : ''}>${UI.esc(tt('status', s))}</option>`).join('')}</select></td>
        <td style="text-align:right"><button class="btn sm danger" data-del="${p.id}" title="${T('common.delete')}">${UI.icon('trash', 14)}</button></td>
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
        <table class="${editing ? 'squad-edit' : ''}">
          <thead><tr><th>${T('teams.number')}</th><th>${T('teams.name')}</th><th>${T('teams.position')}</th><th>${T('teams.height')}</th><th>${T('teams.weight')}</th><th>${T('teams.contact')}</th><th>${T('teams.status')}</th><th></th></tr></thead>
          <tbody>
            ${players.map(p => editing ? editRow(p) : readRow(p)).join('') || `<tr><td colspan="8" class="empty">${T('common.noData')}</td></tr>`}
          </tbody>
        </table>
      </div>`;

    const staffList = coaches.map(c => `
      <div class="staff-row">
        <span class="staff-name">${UI.esc(c.name)}${c.email ? `<span class="staff-mail">${UI.esc(c.email)}</span>` : ''}</span>
        <span class="tag blue">${UI.esc(tt('coachRole', c.role))}</span>
        <span class="staff-actions">
          <button class="btn sm" data-staffchat="${c.id}">💬 ${T('teams.chat')}</button>
          <button class="btn sm" data-editstaff="${c.id}">${T('common.edit')}</button>
          <button class="btn sm danger" data-delstaff="${c.id}" title="${T('common.delete')}">${UI.icon('trash', 14)}</button>
        </span>
      </div>`).join('') || `<p style="color:var(--muted)">${T('common.noData')}</p>`;

    const squadActions = editing
      ? `<button class="btn ghost" id="cancelSquad">${T('common.cancel')}</button>
         <button class="btn primary" id="saveSquad">${T('teams.saveSquad')}</button>`
      : `<button class="btn sm" id="mailSquad">✉ ${T('mail.title')}</button>
         <button class="btn sm" id="chatSquad">💬 ${T('chat.squad')}</button>
         <button class="btn sm" id="editSquad">✎ ${T('teams.editSquad')}</button>
         <button class="btn primary" id="addPlayer">+ ${T('teams.addPlayer')}</button>`;

    const teamBar = `
      <div class="team-bar">
        <label class="field"><span>${T('teams.activeTeam')}</span>
          <select id="teamPick">${teamList.map(x => `<option value="${UI.esc(x.id)}" ${team && x.id === team.id ? 'selected' : ''}>${UI.esc(x.name)}</option>`).join('') || `<option value="">${UI.esc(T('teams.noTeam'))}</option>`}</select></label>
        <button class="btn sm" id="editTeamBtn" ${team ? '' : 'disabled'}>✎ ${T('teams.editTeam')}</button>
        <button class="btn sm" id="newTeam">+ ${T('teams.newTeam')}</button>
        <button class="btn sm danger" id="delTeam" ${teamList.length < 2 ? 'disabled' : ''}>${T('teams.delTeam')}</button>
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
          <p><button type="button" class="inline-edit" id="editTeam" title="${T('teams.editTeam')}">${UI.esc(team ? team.name : T('teams.noTeam'))}${team && team.division ? ' · ' + UI.esc(team.division) : ''}<span class="pen">✎</span></button></p>
        </div>
      </div>
      ${UI.acc('teamPickers', T('teams.teams'), teamBar, { sub: teamList.length + ' · ' + SPORTS.name(sportId, I18N.getLang()) })}
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
      q('#editSquad').onclick = () => { editing = true; render(); };
      q('#mailSquad').onclick = () => MAIL.compose({
        players, title: T('mail.title') + ' — ' + T('teams.squad')
      });
      q('#chatSquad').onclick = () => App.go('messenger', { from: 'teams' });
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

  function form(team, p = {}) {
    const positions = SPORTS.positions(sportId);
    UI.modal({
      title: p.id ? T('teams.editPlayer') : T('teams.newPlayer'),
      body: `
        <div class="row"><label class="field"><span>${T('teams.firstName')}</span><input id="f_first" value="${UI.esc(p.firstName || '')}"></label>
        <label class="field"><span>${T('teams.lastName')}</span><input id="f_last" value="${UI.esc(p.lastName || '')}"></label></div>
        <div class="row"><label class="field"><span>${T('teams.number')}</span><input id="f_num" type="number" value="${p.number || ''}"></label>
        <label class="field"><span>${T('teams.position')}</span><select id="f_pos">${positions.map(x => `<option value="${x}" ${x === p.position ? 'selected' : ''}>${UI.esc(SPORTS.posBadge(sportId, x).ab)} \u2013 ${UI.esc(tt('pos', x))}</option>`).join('')}</select></label></div>
        <div class="row"><label class="field"><span>${T('teams.height')} (cm)</span><input id="f_h" type="number" value="${p.height || ''}"></label>
        <label class="field"><span>${T('teams.weight')} (kg)</span><input id="f_w" type="number" value="${p.weight || ''}"></label>
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
