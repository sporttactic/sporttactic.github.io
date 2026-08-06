/* Teams & Players view */
window.Views = window.Views || {};
Views.teams = function (mount) {
  const teams = Store.all('teams');
  const team = teams[0];
  const players = team ? Store.all('players').filter(p => p.teamId === team.id) : [];
  const coaches = team ? Store.all('coaches').filter(c => c.teamId === team.id) : [];
  const sportId = (window.App && App.getSport && App.getSport()) || 'handball';
  // Translate an option value with fallback to the raw value.
  const tt = (p, v) => { const k = p + '.' + v; const r = T(k); return r === k ? v : r; };
  const posBadgeHtml = (pos) => {
    const b = SPORTS.posBadge(sportId, pos);
    return `<span class="pos-badge role-${b.role}" style="--pos:${b.color}" title="${UI.esc(tt('pos', pos || ''))}">${UI.esc(b.ab)}</span>`;
  };

  mount.innerHTML = `
    <div class="page-head">
      <div><h1>${T('teams.title')}</h1>
        <p><button type="button" class="inline-edit" id="editTeam" title="${T('teams.editTeam')}">${UI.esc(team ? team.name : T('teams.noTeam'))}${team && team.division ? ' · ' + UI.esc(team.division) : ''}<span class="pen">✎</span></button></p>
      </div>
      <button class="btn primary" id="addPlayer">+ ${T('teams.addPlayer')}</button>
    </div>
    <div class="grid cols-4" style="margin-bottom:16px">
      ${UI.statCard(players.length, T('dash.players'))}
      ${UI.statCard(players.filter(p => p.position === 'Goalkeeper').length, 'GK')}
      ${UI.statCard(coaches.length, T('teams.staff'))}
      ${UI.statCard(players.filter(p => p.status === 'active').length, T('status.available'))}
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>${T('teams.number')}</th><th>${T('teams.name')}</th><th>${T('teams.position')}</th><th>${T('teams.height')}</th><th>${T('teams.status')}</th><th></th></tr></thead>
        <tbody>
          ${players.map(p => `
            <tr>
              <td><strong>${p.number}</strong></td>
              <td><div style="display:flex;align-items:center;gap:10px"><span class="avatar">${UI.initials(p.firstName, p.lastName)}</span>${UI.esc(p.firstName)} ${UI.esc(p.lastName)}</div></td>
              <td>${posBadgeHtml(p.position)}${UI.esc(tt('pos', p.position))}</td>
              <td>${p.height || '—'} cm</td>
              <td>
                <span class="tag ${p.status === 'injured' ? 'red' : p.status === 'suspended' ? 'amber' : 'green'}">${UI.esc(tt('status', p.status || 'active'))}</span>
                <button class="btn sm danger" data-del="${p.id}" title="${T('common.delete')}">${UI.icon('trash', 14)}</button>
              </td>
              <td style="text-align:right;white-space:nowrap">
                <button class="btn sm" data-chat="${p.id}">💬 ${T('teams.chat')}</button>
                <button class="btn sm" data-edit="${p.id}">${T('common.edit')}</button>
              </td>
            </tr>`).join('') || `<tr><td colspan="6" class="empty">${T('common.noData')}</td></tr>`}
        </tbody>
      </table>
    </div>
    <div class="card" style="margin-top:16px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <h3 style="margin:0">${T('teams.staff')}</h3>
        <button class="btn sm primary" id="addStaff">+ ${T('teams.addStaff')}</button>
      </div>
      ${coaches.map(c => `
        <div class="staff-row">
          <span class="staff-name">${UI.esc(c.name)}</span>
          <span class="tag blue">${UI.esc(tt('coachRole', c.role))}</span>
          <span class="staff-actions">
            <button class="btn sm" data-staffchat="${c.id}">💬 ${T('teams.chat')}</button>
            <button class="btn sm" data-editstaff="${c.id}">${T('common.edit')}</button>
            <button class="btn sm danger" data-delstaff="${c.id}" title="${T('common.delete')}">${UI.icon('trash', 14)}</button>
          </span>
        </div>`).join('') || `<p style="color:var(--muted)">${T('common.noData')}</p>`}
    </div>`;

  function form(p = {}) {
    const positions = SPORTS.positions(sportId);
    UI.modal({
      title: p.id ? T('teams.editPlayer') : T('teams.newPlayer'),
      body: `
        <div class="row"><label class="field"><span>${T('teams.firstName')}</span><input id="f_first" value="${UI.esc(p.firstName || '')}"></label>
        <label class="field"><span>${T('teams.lastName')}</span><input id="f_last" value="${UI.esc(p.lastName || '')}"></label></div>
        <div class="row"><label class="field"><span>${T('teams.number')}</span><input id="f_num" type="number" value="${p.number || ''}"></label>
        <label class="field"><span>${T('teams.position')}</span><select id="f_pos">${positions.map(x => `<option value="${x}" ${x === p.position ? 'selected' : ''}>${UI.esc(SPORTS.posBadge(sportId, x).ab)} \u2013 ${UI.esc(tt('pos', x))}</option>`).join('')}</select></label></div>
        <div class="row"><label class="field"><span>${T('teams.height')} (cm)</span><input id="f_h" type="number" value="${p.height || ''}"></label>
        <label class="field"><span>${T('teams.status')}</span><select id="f_st"><option value="active" ${p.status === 'active' ? 'selected' : ''}>${UI.esc(tt('status', 'active'))}</option><option value="injured" ${p.status === 'injured' ? 'selected' : ''}>${UI.esc(tt('status', 'injured'))}</option><option value="suspended" ${p.status === 'suspended' ? 'selected' : ''}>${UI.esc(tt('status', 'suspended'))}</option></select></label></div>`,
      footer: `<button class="btn ghost" data-close2>${T('common.cancel')}</button><button class="btn primary" data-save>${T('common.save')}</button>`,
      onOpen: (m, close) => {
        m.querySelector('[data-close2]').onclick = close;
        m.querySelector('[data-save]').onclick = async () => {
          const obj = Object.assign({}, p, {
            teamId: team.id,
            firstName: m.querySelector('#f_first').value.trim(),
            lastName: m.querySelector('#f_last').value.trim(),
            number: +m.querySelector('#f_num').value,
            position: m.querySelector('#f_pos').value,
            height: +m.querySelector('#f_h').value,
            status: m.querySelector('#f_st').value
          });
          if (!obj.firstName) return UI.toast(T('teams.reqName'), 'error');
          await Store.save('players', obj);
          close(); UI.toast(T('common.save'), 'success'); App.render();
        };
      }
    });
  }

  function teamForm() {
    const t = team || {};
    UI.modal({
      title: T('teams.editTeam'),
      body: `
        <label class="field"><span>${T('teams.teamName')}</span><input id="t_name" value="${UI.esc(t.name || '')}"></label>
        <div class="row"><label class="field"><span>${T('teams.division')}</span><input id="t_div" value="${UI.esc(t.division || '')}"></label>
        <label class="field"><span>${T('teams.category')}</span><input id="t_cat" value="${UI.esc(t.category || '')}"></label></div>`,
      footer: `<button class="btn ghost" data-close2>${T('common.cancel')}</button><button class="btn primary" data-save>${T('common.save')}</button>`,
      onOpen: (m, close) => {
        m.querySelector('[data-close2]').onclick = close;
        m.querySelector('[data-save]').onclick = async () => {
          const name = m.querySelector('#t_name').value.trim();
          if (!name) return UI.toast(T('teams.reqTeamName'), 'error');
          const club = Store.all('clubs')[0], season = Store.all('seasons')[0];
          // Falls back to creating the team when none exists yet.
          const obj = Object.assign({ clubId: club && club.id, seasonId: season && season.id }, t, {
            name,
            division: m.querySelector('#t_div').value.trim(),
            category: m.querySelector('#t_cat').value.trim()
          });
          await Store.save('teams', obj);
          close(); UI.toast(T('common.save'), 'success'); App.render();
        };
      }
    });
  }

  function staffForm(c = {}) {
    const roles = ['Head Coach', 'Assistant Coach', 'Goalkeeper Coach', 'Physio', 'Analyst', 'Team Manager'];
    UI.modal({
      title: c.id ? T('teams.editStaff') : T('teams.newStaff'),
      body: `
        <label class="field"><span>${T('teams.staffName')}</span><input id="s_name" value="${UI.esc(c.name || '')}"></label>
        <label class="field"><span>${T('teams.staffRole')}</span><select id="s_role">${roles.map(x => `<option value="${x}" ${x === c.role ? 'selected' : ''}>${UI.esc(tt('coachRole', x))}</option>`).join('')}</select></label>`,
      footer: `<button class="btn ghost" data-close2>${T('common.cancel')}</button><button class="btn primary" data-save>${T('common.save')}</button>`,
      onOpen: (m, close) => {
        m.querySelector('[data-close2]').onclick = close;
        m.querySelector('[data-save]').onclick = async () => {
          const obj = Object.assign({}, c, {
            teamId: team.id,
            name: m.querySelector('#s_name').value.trim(),
            role: m.querySelector('#s_role').value
          });
          if (!obj.name) return UI.toast(T('teams.reqStaffName'), 'error');
          await Store.save('coaches', obj);
          close(); UI.toast(T('common.save'), 'success'); App.render();
        };
      }
    });
  }

  mount.querySelector('#editTeam').onclick = () => teamForm();
  mount.querySelector('#addPlayer').onclick = () => form();
  mount.querySelector('#addStaff').onclick = () => staffForm();
  mount.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => form(Store.find('players', b.dataset.edit)));
  mount.querySelectorAll('[data-editstaff]').forEach(b => b.onclick = () => staffForm(Store.find('coaches', b.dataset.editstaff)));
  mount.querySelectorAll('[data-delstaff]').forEach(b => b.onclick = () => UI.confirm(T('teams.delStaff'), async () => { await Store.remove('coaches', b.dataset.delstaff); UI.toast(T('common.delete')); App.render(); }));
  mount.querySelectorAll('[data-chat]').forEach(b => b.onclick = () => {
    const p = Store.find('players', b.dataset.chat);
    if (p) App.go('messenger', { playerId: p.id, playerName: (p.firstName + ' ' + p.lastName).trim(), memberStore: 'players', from: 'teams' });
  });
  mount.querySelectorAll('[data-staffchat]').forEach(b => b.onclick = () => {
    const c = Store.find('coaches', b.dataset.staffchat);
    if (c) App.go('messenger', { playerId: c.id, playerName: c.name, memberStore: 'coaches', from: 'teams' });
  });
  mount.querySelectorAll('[data-del]').forEach(b => b.onclick = () => UI.confirm(T('teams.delPlayer'), async () => { await Store.remove('players', b.dataset.del); UI.toast(T('common.delete')); App.render(); }));
};
