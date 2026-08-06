/* Matches view */
window.Views = window.Views || {};
Views.matches = function (mount) {
  const team = Store.all('teams')[0];
  const matches = Store.all('matches').slice().sort((a, b) => b.date - a.date);

  mount.innerHTML = `
    <div class="page-head">
      <div><h1>${T('matches.title')}</h1><p>${T('matches.subtitle') || ''}</p></div>
      <button class="btn primary" id="addMatch">+ ${T('matches.newMatch')}</button>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>${T('matches.date')}</th><th>${T('matches.opponent')}</th><th>${T('matches.sport')}</th><th>${T('matches.type')}</th><th>${T('matches.venue')}</th><th>${T('matches.score')}</th><th>${T('matches.status')}</th><th></th></tr></thead>
        <tbody>
          ${matches.map(m => `
            <tr>
              <td>${UI.fmtDate(m.date)}</td>
              <td><strong>${UI.esc(m.home ? T('common.vs') : T('common.at'))} ${UI.esc(m.opponent)}</strong></td>
              <td><span class="tag blue">${UI.esc(SPORTS.name(m.sport || 'handball', I18N.getLang()))}</span></td>
              <td><span class="tag">${UI.esc(T('matchType.' + m.type) !== 'matchType.' + m.type ? T('matchType.' + m.type) : m.type)}</span></td>
              <td>${UI.esc(m.venue || '—')}</td>
              <td>${m.status === 'finished' ? `<strong>${m.homeScore} : ${m.awayScore}</strong>` : '—'}</td>
              <td><span class="tag ${m.status === 'finished' ? 'green' : 'amber'}">${UI.esc(m.status === 'finished' ? T('matches.finished') : m.status === 'live' ? T('matches.live') : T('matches.scheduled'))}</span></td>
              <td style="text-align:right">
                <button class="btn sm" data-scout="${m.id}">${T('nav.scouting')}</button>
                <button class="btn sm" data-edit="${m.id}">${T('common.edit')}</button>
                <button class="btn sm danger" data-del="${m.id}">${T('common.delete')}</button>
              </td>
            </tr>`).join('') || `<tr><td colspan="8" class="empty">${T('common.noData')}</td></tr>`}
        </tbody>
      </table>
    </div>`;

  function form(mt = {}) {
    const d = mt.date ? new Date(mt.date) : new Date();
    const dstr = d.toISOString().slice(0, 10);
    UI.modal({
      title: mt.id ? T('matches.editMatch') : T('matches.newMatch'),
      body: `
        <label class="field"><span>${T('matches.opponent')}</span><input id="m_opp" value="${UI.esc(mt.opponent || '')}"></label>
        <div class="row">
          <label class="field"><span>${T('matches.date')}</span><input id="m_date" type="date" value="${dstr}"></label>
          <label class="field"><span>${T('matches.type')}</span><select id="m_type">${['Friendly', 'League', 'Cup', 'Tournament'].map(x => `<option value="${x}" ${x === mt.type ? 'selected' : ''}>${T('matchType.' + x)}</option>`).join('')}</select></label>
        </div>
        <div class="row">
          <label class="field"><span>${T('matches.sport')}</span><select id="m_sport">${SPORTS.LIST.map(s => `<option value="${s.id}" ${s.id === (mt.sport || (window.App && App.getSport && App.getSport())) ? 'selected' : ''}>${SPORTS.name(s.id, I18N.getLang())}</option>`).join('')}</select></label>
          <label class="field"><span>${T('matches.venue')}</span><input id="m_venue" value="${UI.esc(mt.venue || '')}"></label>
        </div>
        <div class="row">
          <label class="field"><span>${T('matches.home')}/${T('matches.away')}</span><select id="m_home"><option value="1" ${mt.home ? 'selected' : ''}>${T('matches.home')}</option><option value="0" ${mt.home === false ? 'selected' : ''}>${T('matches.away')}</option></select></label>
        </div>
        <div class="row">
          <label class="field"><span>${T('matches.home')} ${T('matches.score')}</span><input id="m_hs" type="number" value="${mt.homeScore || 0}"></label>
          <label class="field"><span>${T('matches.away')} ${T('matches.score')}</span><input id="m_as" type="number" value="${mt.awayScore || 0}"></label>
          <label class="field"><span>${T('matches.status')}</span><select id="m_status">${['scheduled', 'live', 'finished'].map(x => `<option value="${x}" ${x === mt.status ? 'selected' : ''}>${T('matches.' + x)}</option>`).join('')}</select></label>
        </div>`,
      footer: `<button class="btn ghost" data-close2>${T('common.cancel')}</button><button class="btn primary" data-save>${T('common.save')}</button>`,
      onOpen: (m, close) => {
        m.querySelector('[data-close2]').onclick = close;
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
            status: m.querySelector('#m_status').value
          });
          if (!obj.opponent) return UI.toast(T('matches.opponent'), 'error');
          await Store.save('matches', obj);
          close(); UI.toast(T('common.save'), 'success'); App.render();
        };
      }
    });
  }

  mount.querySelector('#addMatch').onclick = () => form();
  mount.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => form(Store.find('matches', b.dataset.edit)));
  mount.querySelectorAll('[data-scout]').forEach(b => b.onclick = () => App.go('scouting', { matchId: b.dataset.scout }));
  mount.querySelectorAll('[data-del]').forEach(b => b.onclick = () => UI.confirm(T('matches.delMatch'), async () => { await Store.remove('matches', b.dataset.del); UI.toast(T('common.delete')); App.render(); }));
};
