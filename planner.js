/* Event planner — the club calendar next to the fixture list: training camps,
   meetings, travel, tournaments and anything else the squad has to turn up for. */
window.Views = window.Views || {};

const PLANNER_KINDS = ['training', 'meeting', 'travel', 'tournament', 'social', 'other'];
const PLANNER_STATUS = ['planned', 'confirmed', 'done', 'cancelled'];

Views.planner = function (mount) {
  const team = Store.activeTeam();

  function render() {
    const events = Store.scoped('planner').slice().sort((a, b) => (b.date || 0) - (a.date || 0));
    const now = Date.now();
    const upcoming = events.filter(e => (e.date || 0) >= now - 864e5 && e.status !== 'cancelled').length;

    const table = `
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>${T('planner.date')}</th><th>${T('planner.time')}</th><th>${T('planner.titleField')}</th>
            <th>${T('planner.kind')}</th><th>${T('planner.place')}</th><th>${T('planner.who')}</th>
            <th>${T('planner.status')}</th><th></th>
          </tr></thead>
          <tbody>
            ${events.map(e => `
              <tr>
                <td>${UI.fmtDate(e.date)}</td>
                <td>${UI.esc(e.time || '—')}</td>
                <td><strong>${UI.esc(e.title || '')}</strong>${e.notes ? `<div class="plan-note">${UI.esc(e.notes)}</div>` : ''}</td>
                <td><span class="tag blue">${UI.esc(T('plannerKind.' + e.kind) !== 'plannerKind.' + e.kind ? T('plannerKind.' + e.kind) : e.kind)}</span></td>
                <td>${UI.esc(e.place || '—')}</td>
                <td>${UI.esc(e.who || '—')}</td>
                <td><span class="tag ${e.status === 'done' ? 'green' : e.status === 'cancelled' ? 'warn' : 'amber'}">${UI.esc(T('plannerStatus.' + e.status) !== 'plannerStatus.' + e.status ? T('plannerStatus.' + e.status) : e.status)}</span></td>
                <td style="text-align:right;white-space:nowrap">
                  <button class="btn sm" data-edit="${e.id}">${T('common.edit')}</button>
                  <button class="btn sm danger" data-del="${e.id}">${T('common.delete')}</button>
                </td>
              </tr>`).join('') || `<tr><td colspan="8" class="empty">${T('common.noData')}</td></tr>`}
          </tbody>
        </table>
      </div>`;

    mount.innerHTML = `
      <div class="page-head">
        <div><h1>${T('planner.title')}</h1><p>${T('planner.subtitle')}</p></div>
      </div>
      ${UI.acc('plannerList', T('planner.schedule'), table, {
      sub: team ? `${upcoming} ${T('planner.upcoming')} · ${team.name}` : `${upcoming} ${T('planner.upcoming')}`,
      actions: UI.shareBar('planner', { exportLabel: T('planner.exportBtn'), importLabel: T('planner.importBtn') })
        + (events.length ? `<button class="btn sm danger" id="clearPlanner">🗑 ${T('planner.clearAll')}</button>` : '')
        + `<button class="btn primary" id="addEvent">+ ${T('planner.newEvent')}</button>`
    })}`;

    UI.bindAcc(mount);
    UI.bindShare(mount, 'planner', render, { scoped: true });
    mount.querySelector('#addEvent').onclick = () => form();
    const clear = mount.querySelector('#clearPlanner');
    if (clear) clear.onclick = () => clearAll(events);
    mount.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => form(Store.find('planner', b.dataset.edit)));
    mount.querySelectorAll('[data-del]').forEach(b => b.onclick = () => UI.confirm(T('planner.delAsk'), async () => {
      await Store.remove('planner', b.dataset.del);
      UI.toast(T('common.delete'));
      render();
    }));
  }

  // Empties this squad's calendar only — another team's plan is untouched.
  function clearAll(events) {
    if (!events.length) return;
    UI.confirm(T('planner.clearAsk').replace('{0}', events.length), async () => {
      for (const e of events) await Store.remove('planner', e.id);
      UI.toast(T('planner.cleared'));
      render();
    });
  }

  function form(ev = {}) {
    const d = ev.date ? new Date(ev.date) : new Date();
    const dstr = d.toISOString().slice(0, 10);
    UI.modal({
      title: ev.id ? T('planner.editEvent') : T('planner.newEvent'),
      width: 620,
      body: `
        <label class="field"><span>${T('planner.titleField')}</span><input id="p_title" maxlength="80" value="${UI.esc(ev.title || '')}" placeholder="${UI.esc(T('planner.titlePh'))}"></label>
        <div class="row">
          <label class="field"><span>${T('planner.date')}</span><input id="p_date" type="date" value="${dstr}"></label>
          <label class="field"><span>${T('planner.time')}</span><input id="p_time" type="time" value="${UI.esc(ev.time || '')}"></label>
          <label class="field"><span>${T('planner.kind')}</span><select id="p_kind">${PLANNER_KINDS.map(k => `<option value="${k}" ${k === (ev.kind || 'training') ? 'selected' : ''}>${T('plannerKind.' + k)}</option>`).join('')}</select></label>
        </div>
        <div class="row">
          <label class="field"><span>${T('planner.place')}</span><input id="p_place" maxlength="80" value="${UI.esc(ev.place || '')}" placeholder="${UI.esc(T('planner.placePh'))}"></label>
          <label class="field"><span>${T('planner.who')}</span><input id="p_who" maxlength="80" value="${UI.esc(ev.who || '')}" placeholder="${UI.esc(T('planner.whoPh'))}"></label>
          <label class="field"><span>${T('planner.status')}</span><select id="p_status">${PLANNER_STATUS.map(s => `<option value="${s}" ${s === (ev.status || 'planned') ? 'selected' : ''}>${T('plannerStatus.' + s)}</option>`).join('')}</select></label>
        </div>
        <label class="field"><span>${T('planner.notes')}</span><textarea id="p_notes" rows="3" maxlength="600">${UI.esc(ev.notes || '')}</textarea></label>
        <p class="hint">${T('planner.formHint')}</p>`,
      footer: `<button class="btn ghost" data-close2>${T('common.cancel')}</button><button class="btn primary" data-save>${T('common.save')}</button>`,
      onOpen: (m, close) => {
        const q = s => m.querySelector(s);
        q('#p_title').focus();
        q('[data-close2]').onclick = close;
        q('[data-save]').onclick = async () => {
          const title = q('#p_title').value.trim();
          if (!title) return UI.toast(T('planner.needTitle'), 'error');
          await Store.save('planner', Object.assign({}, ev, {
            title,
            date: new Date(q('#p_date').value || Date.now()).getTime(),
            time: q('#p_time').value || '',
            kind: q('#p_kind').value,
            place: q('#p_place').value.trim().slice(0, 80),
            who: q('#p_who').value.trim().slice(0, 80),
            status: q('#p_status').value,
            notes: q('#p_notes').value.trim().slice(0, 600)
          }));
          close();
          UI.toast(T('common.save'), 'success');
          render();
        };
      }
    });
  }

  render();
};
