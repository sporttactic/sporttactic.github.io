/* Matches view */
window.Views = window.Views || {};
Views.matches = function (mount) {
  const team = Store.activeTeam();
  const matches = Store.matches().slice().sort((a, b) => b.date - a.date);
  const squad = Store.players(team && team.id);
  // A match with no list yet counts as "everyone available", so older matches
  // and a quick fixture still work without picking anyone.
  const lineupOf = m => (Array.isArray(m.players) && m.players.length)
    ? m.players.filter(id => squad.some(p => p.id === id))
    : null;
  const label = p => '#' + (p.number || '?') + ' ' + [p.firstName, p.lastName].filter(Boolean).join(' ').trim();

  const table = `
    <div class="table-wrap">
      <table>
        <thead><tr><th>${T('matches.date')}</th><th>${T('matches.opponent')}</th><th>${T('matches.sport')}</th><th>${T('matches.type')}</th><th>${T('matches.venue')}</th><th>${T('matches.squad')}</th><th>${T('matches.score')}</th><th>${T('matches.status')}</th><th></th></tr></thead>
        <tbody>
          ${matches.map(m => {
    const line = lineupOf(m);
    return `
            <tr>
              <td>${UI.fmtDate(m.date)}</td>
              <td><strong>${UI.esc(m.home ? T('common.vs') : T('common.at'))} ${UI.esc(m.opponent)}</strong></td>
              <td><span class="tag blue">${UI.esc(SPORTS.name(m.sport || 'handball', I18N.getLang()))}</span></td>
              <td><span class="tag">${UI.esc(T('matchType.' + m.type) !== 'matchType.' + m.type ? T('matchType.' + m.type) : m.type)}</span></td>
              <td>${UI.esc(m.venue || '—')}</td>
              <td><span class="tag ${line ? 'green' : ''}">${line ? line.length + '/' + squad.length : T('matches.allPlayers')}</span></td>
              <td>${m.status === 'finished' ? `<strong>${m.homeScore} : ${m.awayScore}</strong>` : '—'}</td>
              <td><span class="tag ${m.status === 'finished' ? 'green' : 'amber'}">${UI.esc(m.status === 'finished' ? T('matches.finished') : m.status === 'live' ? T('matches.live') : T('matches.scheduled'))}</span></td>
              <td style="text-align:right;white-space:nowrap">
                <button class="btn sm" data-squad="${m.id}">👥 ${T('matches.squad')}</button>
                <button class="btn sm" data-scout="${m.id}">${T('nav.scouting')}</button>
                <button class="btn sm" data-edit="${m.id}">${T('common.edit')}</button>
                <button class="btn sm danger" data-del="${m.id}">${T('common.delete')}</button>
              </td>
            </tr>`;
  }).join('') || `<tr><td colspan="9" class="empty">${T('common.noData')}</td></tr>`}
        </tbody>
      </table>
    </div>`;

  mount.innerHTML = `
    <div class="page-head">
      <div><h1>${T('matches.title')}</h1><p>${T('matches.subtitle') || ''}</p></div>
    </div>
    ${UI.acc('matchList', T('matches.schedule'), table, {
    sub: team ? T('matches.ofTeam').replace('{0}', team.name) : '',
    actions: UI.shareBar('matches', { exportLabel: T('matches.exportBtn'), importLabel: T('matches.importBtn') })
      + `<button class="btn primary" id="addMatch">+ ${T('matches.newMatch')}</button>`
  })}`;
  UI.bindAcc(mount);
  UI.bindShare(mount, 'matches', () => App.render(), { scoped: true });

  function form(mt = {}) {
    const d = mt.date ? new Date(mt.date) : new Date();
    const dstr = d.toISOString().slice(0, 10);
    const picked = lineupOf(mt);
    UI.modal({
      title: mt.id ? T('matches.editMatch') : T('matches.newMatch'),
      width: 660,
      body: `
        <label class="field"><span>${T('matches.opponent')}</span><input id="m_opp" value="${UI.esc(mt.opponent || '')}"></label>
        <div class="row">
          <label class="field"><span>${T('matches.date')}</span><input id="m_date" type="date" value="${dstr}"></label>
          <label class="field"><span>${T('matches.type')}</span><select id="m_type">${['Friendly', 'League', 'Cup', 'Tournament'].map(x => `<option value="${x}" ${x === mt.type ? 'selected' : ''}>${T('matchType.' + x)}</option>`).join('')}</select></label>
        </div>
        <div class="row">
          <label class="field"><span>${T('matches.sport')}</span><select id="m_sport">${SPORTS.LIST.map(s => `<option value="${s.id}" ${s.id === (mt.sport || (window.App && App.getSport && App.getSport())) ? 'selected' : ''}>${SPORTS.name(s.id, I18N.getLang())}</option>`).join('')}</select></label>
          <label class="field"><span>${T('matches.venue')}</span><input id="m_venue" value="${UI.esc(mt.venue || (mt.id ? '' : (team && team.venue) || ''))}"></label>
        </div>
        <div class="row">
          <label class="field"><span>${T('matches.home')}/${T('matches.away')}</span><select id="m_home"><option value="1" ${mt.home ? 'selected' : ''}>${T('matches.home')}</option><option value="0" ${mt.home === false ? 'selected' : ''}>${T('matches.away')}</option></select></label>
        </div>
        <div class="row">
          <label class="field"><span>${T('matches.home')} ${T('matches.score')}</span><input id="m_hs" type="number" value="${mt.homeScore || 0}"></label>
          <label class="field"><span>${T('matches.away')} ${T('matches.score')}</span><input id="m_as" type="number" value="${mt.awayScore || 0}"></label>
          <label class="field"><span>${T('matches.status')}</span><select id="m_status">${['scheduled', 'live', 'finished'].map(x => `<option value="${x}" ${x === mt.status ? 'selected' : ''}>${T('matches.' + x)}</option>`).join('')}</select></label>
        </div>
        ${squadPickerHtml(picked)}`,
      footer: `<button class="btn ghost" data-close2>${T('common.cancel')}</button><button class="btn primary" data-save>${T('common.save')}</button>`,
      onOpen: (m, close) => {
        m.querySelector('[data-close2]').onclick = close;
        bindSquadPicker(m);
        m.querySelector('[data-save]').onclick = async () => {
          const obj = Object.assign({}, mt, {
            teamId: team.id,
            opponent: m.querySelector('#m_opp').value.trim(),
            date: new Date(m.querySelector('#m_date').value).getTime(),
            type: m.querySelector('#m_type').value,
            sport: m.querySelector('#m_sport').value,
            venue: m.querySelector('#m_venue').value.trim(),
            home: m.querySelector('#m_home').value === '1',
            homeScore: +m.querySelector('#m_hs').value,
            awayScore: +m.querySelector('#m_as').value,
            status: m.querySelector('#m_status').value,
            players: readSquadPicker(m, mt.players)
          });
          if (!obj.opponent) return UI.toast(T('matches.opponent'), 'error');
          await Store.save('matches', obj);
          close(); UI.toast(T('common.save'), 'success'); App.render();
        };
      }
    });
  }

  // Who is actually playing this match. An empty list means the whole squad,
  // which is what every match had before this existed.
  function squadPickerHtml(picked) {
    if (!squad.length) return `<p class="hint">${T('matches.squadNoPlayers')}</p>`;
    const on = id => !picked || picked.indexOf(id) >= 0;
    return `<div class="field"><span>${T('matches.squad')}</span>
      <div class="focus-acts">
        <button type="button" class="btn sm" data-sqall>${T('settings.shareAll')}</button>
        <button type="button" class="btn sm" data-sqnone>${T('settings.shareNone')}</button>
        <button type="button" class="btn sm" data-sqfit>${T('matches.squadFit')}</button>
        <span class="hint" data-sqcount></span>
      </div>
      <div class="menu-picker" id="m_squad">
        ${squad.map(p => `<label class="check-row menu-row"><input type="checkbox" data-pl="${UI.esc(p.id)}" data-st="${UI.esc(p.status || 'active')}" ${on(p.id) ? 'checked' : ''}>
          <span>${UI.esc(label(p))}${p.status === 'injured' ? ` <span class="tag warn">${T('status.injured')}</span>` : ''}${p.status === 'suspended' ? ` <span class="tag">${T('status.suspended')}</span>` : ''}</span></label>`).join('')}
      </div>
      <span class="hint">${T('matches.squadHint')}</span></div>`;
  }
  function bindSquadPicker(m) {
    const boxes = [...m.querySelectorAll('[data-pl]')];
    if (!boxes.length) return;
    const count = m.querySelector('[data-sqcount]');
    const sync = () => { count.textContent = boxes.filter(b => b.checked).length + '/' + boxes.length; };
    boxes.forEach(b => b.onchange = sync);
    m.querySelector('[data-sqall]').onclick = () => { boxes.forEach(b => { b.checked = true; }); sync(); };
    m.querySelector('[data-sqnone]').onclick = () => { boxes.forEach(b => { b.checked = false; }); sync(); };
    // Everyone who is neither injured nor set to Not Active.
    m.querySelector('[data-sqfit]').onclick = () => {
      boxes.forEach(b => { b.checked = b.dataset.st !== 'injured' && b.dataset.st !== 'suspended'; });
      sync();
    };
    sync();
  }
  function readSquadPicker(m, prev) {
    const boxes = [...m.querySelectorAll('[data-pl]')];
    if (!boxes.length) return Array.isArray(prev) ? prev : [];
    const on = boxes.filter(b => b.checked).map(b => b.dataset.pl);
    // Everyone ticked is the same as no restriction — store it as empty.
    return on.length === boxes.length ? [] : on;
  }

  // Match-day shortcut: the line-up on its own, without the rest of the form.
  function squadForm(mt) {
    if (!mt) return;
    UI.modal({
      title: T('matches.squad') + ' — ' + (mt.opponent || ''),
      width: 620,
      body: `<p class="hint" style="margin-top:0">${UI.fmtDate(mt.date)} · ${UI.esc(mt.home ? T('matches.home') : T('matches.away'))}</p>
        ${squadPickerHtml(lineupOf(mt))}`,
      footer: `<button class="btn ghost" data-close2>${T('common.cancel')}</button><button class="btn primary" data-save>${T('common.save')}</button>`,
      onOpen: (m, close) => {
        m.querySelector('[data-close2]').onclick = close;
        bindSquadPicker(m);
        m.querySelector('[data-save]').onclick = async () => {
          await Store.save('matches', Object.assign({}, mt, { players: readSquadPicker(m, mt.players) }));
          close(); UI.toast(T('common.save'), 'success'); App.render();
        };
      }
    });
  }

  mount.querySelector('#addMatch').onclick = () => form();
  mount.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => form(Store.find('matches', b.dataset.edit)));
  mount.querySelectorAll('[data-squad]').forEach(b => b.onclick = () => squadForm(Store.find('matches', b.dataset.squad)));
  mount.querySelectorAll('[data-scout]').forEach(b => b.onclick = () => App.go('scouting', { matchId: b.dataset.scout }));
  mount.querySelectorAll('[data-del]').forEach(b => b.onclick = () => UI.confirm(T('matches.delMatch'), async () => { await Store.remove('matches', b.dataset.del); UI.toast(T('common.delete')); App.render(); }));
};
