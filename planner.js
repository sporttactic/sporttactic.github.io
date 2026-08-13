/* Event planner — the club calendar next to the fixture list: training camps,
   meetings, travel, tournaments and anything else the squad has to turn up for. */
window.Views = window.Views || {};

const PLANNER_KINDS = ['training', 'meeting', 'travel', 'tournament', 'social', 'other'];
const PLANNER_STATUS = ['planned', 'confirmed', 'done', 'cancelled'];

Views.planner = function (mount) {
  const team = Store.activeTeam();

  // An event belongs to the squad that made it, and can be handed to others: a
  // club meeting or a tournament is rarely one squad's business alone.
  const sharedWith = e => Array.isArray(e.teams) ? e.teams : [];
  const seenHere = (e, tid) => !tid || !e.teamId || e.teamId === tid
    || !!e.allTeams || sharedWith(e).indexOf(tid) >= 0;
  const shareTag = e => e.allTeams
    ? `<span class="tag blue">${UI.esc(T('planner.sharedAll'))}</span>`
    : (sharedWith(e).length ? `<span class="tag blue">${UI.esc(T('planner.shared').replace('{0}', sharedWith(e).length))}</span>` : '');
  // Only what this squad owns is ours to hand on.
  const mine = list => {
    const tid = Store.activeTeamId();
    return list.filter(e => !tid || !e.teamId || e.teamId === tid);
  };
  // A copy that follows a club file gets its events from a sync, not from here.
  const following = () => {
    const c = (window.TeamCloud && TeamCloud.cfg) ? TeamCloud.cfg() : null;
    return !!(c && c.fileId);
  };

  function render() {
    const tid = Store.activeTeamId();
    const events = Store.all('planner').filter(e => seenHere(e, tid))
      .slice().sort((a, b) => (b.date || 0) - (a.date || 0));
    const now = Date.now();
    const upcoming = events.filter(e => (e.date || 0) >= now - 864e5 && e.status !== 'cancelled').length;
    // An empty list with events on the device means they belong to another squad.
    const elsewhere = Store.all('planner').length - events.length;

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
                <td><strong>${UI.esc(e.title || '')}</strong> ${shareTag(e)}${e.notes ? `<div class="plan-note">${UI.esc(e.notes)}</div>` : ''}</td>
                <td><span class="tag blue">${UI.esc(T('plannerKind.' + e.kind) !== 'plannerKind.' + e.kind ? T('plannerKind.' + e.kind) : e.kind)}</span></td>
                <td>${UI.esc(e.place || '—')}</td>
                <td>${UI.esc(e.who || '—')}</td>
                <td><span class="tag ${e.status === 'done' ? 'green' : e.status === 'cancelled' ? 'warn' : 'amber'}">${UI.esc(T('plannerStatus.' + e.status) !== 'plannerStatus.' + e.status ? T('plannerStatus.' + e.status) : e.status)}</span></td>
                <td style="text-align:right">
                  <div class="row-acts">
                    <button class="btn sm" data-show="${e.id}">${T('common.show')}</button>
                    <button class="btn sm" data-edit="${e.id}">${T('common.edit')}</button>
                    <button class="btn sm danger" data-del="${e.id}">${T('common.delete')}</button>
                  </div>
                </td>
              </tr>`).join('') || `<tr><td colspan="8" class="empty">${T('common.noData')}</td></tr>`}
          </tbody>
        </table>
      </div>
      ${elsewhere > 0 ? `<p class="hint">${UI.esc(T('planner.otherSquad').replace('{0}', elsewhere))}</p>` : ''}
      ${!Store.all('planner').length && following() ? `<p class="hint">${UI.esc(T('planner.noneShared'))}</p>
        <div class="row" style="flex:0;margin-top:8px"><button class="btn" id="planSync" data-member-ok>${UI.esc(T('cloud.syncNow'))}</button></div>` : ''}`;

    mount.innerHTML = `
      <div class="page-head">
        <div><h1>${T('planner.title')}</h1><p>${T('planner.subtitle')}</p></div>
      </div>
      ${UI.acc('plannerList', T('planner.schedule'), table, {
      open: true,
      sub: team ? `${upcoming} ${T('planner.upcoming')} · ${team.name}` : `${upcoming} ${T('planner.upcoming')}`,
      actions: (events.length ? `<button class="btn sm danger" id="clearPlanner">🗑 ${T('planner.clearAll')}</button>` : '')
        + (mine(events).length && Store.teams().length > 1 ? `<button class="btn sm" id="shareEvents">📤 ${T('planner.shareBtn')}</button>` : '')
        + `<button class="btn primary" id="addEvent">+ ${T('planner.newEvent')}</button>`
    })}`;

    UI.bindAcc(mount);
    mount.querySelector('#addEvent').onclick = () => form();
    const clear = mount.querySelector('#clearPlanner');
    if (clear) clear.onclick = () => clearAll(events);
    const share = mount.querySelector('#shareEvents');
    if (share) share.onclick = () => shareDialog(mine(events));
    const sync = mount.querySelector('#planSync');
    if (sync) sync.onclick = async () => {
      sync.disabled = true;
      try { await TeamCloud.sync(); UI.toast(T('cloud.synced'), 'success'); }
      catch (e) { UI.toast(String((e && e.message) || e).slice(0, 200), 'error'); }
      finally { sync.disabled = false; render(); }
    };
    mount.querySelectorAll('[data-show]').forEach(b => b.onclick = () => show(Store.find('planner', b.dataset.show)));
    mount.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => form(Store.find('planner', b.dataset.edit)));
    mount.querySelectorAll('[data-del]').forEach(b => b.onclick = () => UI.confirm(T('planner.delAsk'), async () => {
      await Store.remove('planner', b.dataset.del);
      UI.toast(T('common.delete'));
      render();
    }));
  }

  // Empties this squad's calendar only — another team's plan is untouched.
  function clearAll(events) {
    const tid = Store.activeTeamId();
    // What another squad shared with us is theirs to delete, not ours.
    const mine = events.filter(e => !tid || !e.teamId || e.teamId === tid);
    if (!mine.length) return;
    UI.confirm(T('planner.clearAsk').replace('{0}', mine.length), async () => {
      for (const e of mine) await Store.remove('planner', e.id);
      UI.toast(T('planner.cleared'));
      render();
    });
  }

  // Hand several events to other squads in one go, instead of opening each one.
  function shareDialog(list) {
    const owner = Store.activeTeamId();
    const others = Store.teams().filter(t => t.id !== owner);
    if (!list.length || !others.length) return;
    const row = e => `<label class="check-row">
      <input type="checkbox" data-ev="${UI.esc(e.id)}">
      <span>${UI.esc(UI.fmtDate(e.date))} \u00b7 <b>${UI.esc(e.title || '')}</b> ${shareTag(e)}</span>
    </label>`;
    UI.modal({
      title: T('planner.shareTitle'),
      width: 620,
      body: `<p>${UI.esc(T('planner.shareIntro'))}</p>
        <div class="acc-people">${list.map(row).join('')}</div>
        <div class="row" style="flex:0;margin:8px 0;flex-wrap:wrap">
          <button type="button" class="btn sm" data-pick="all">${UI.esc(T('settings.shareAll'))}</button>
          <button type="button" class="btn sm" data-pick="none">${UI.esc(T('settings.shareNone'))}</button>
        </div>
        <h4 style="margin:14px 0 4px">${UI.esc(T('planner.access'))}</h4>
        <label class="check-row"><input type="checkbox" id="s_all">
          <span>${UI.esc(T('planner.allTeams'))}</span></label>
        <div class="menu-picker">${others.map(t => `<label class="check-row menu-row">
          <input type="checkbox" data-team="${UI.esc(t.id)}"><span>${UI.esc(t.name)}</span></label>`).join('')}</div>
        <p class="hint">${UI.esc(T('planner.shareReplaces'))}</p>`,
      footer: `<button class="btn ghost" data-close2>${T('common.cancel')}</button>
        <button class="btn primary" data-go>${T('planner.shareBtn')}</button>`,
      onOpen: (m, close) => {
        const evBoxes = [...m.querySelectorAll('[data-ev]')];
        const teamBoxes = [...m.querySelectorAll('[data-team]')];
        const all = m.querySelector('#s_all');
        const syncAll = () => teamBoxes.forEach(b => { b.disabled = all.checked; });
        all.onchange = syncAll;
        m.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => {
          evBoxes.forEach(x => { x.checked = b.dataset.pick === 'all'; });
        });
        m.querySelector('[data-close2]').onclick = close;
        m.querySelector('[data-go]').onclick = async () => {
          const picked = evBoxes.filter(b => b.checked).map(b => b.dataset.ev);
          if (!picked.length) return UI.toast(T('planner.sharePickEvents'), 'error');
          const teams = all.checked ? [] : teamBoxes.filter(b => b.checked).map(b => b.dataset.team);
          if (!all.checked && !teams.length) return UI.toast(T('planner.sharePickTeams'), 'error');
          for (const id of picked) {
            const e = Store.find('planner', id);
            if (e) await Store.save('planner', Object.assign({}, e, { allTeams: all.checked, teams }));
          }
          close();
          UI.toast(T('planner.shareDone').replace('{0}', picked.length), 'success');
          render();
        };
      }
    });
  }

  // The whole event on one page, for reading out loud at practice.
  function show(ev) {
    if (!ev) return;
    const label = (grp, v) => { const k = grp + '.' + v; const r = T(k); return r === k ? v : r; };
    const line = (lbl, val) => `<tr><th>${UI.esc(lbl)}</th><td>${UI.esc(val || '\u2014')}</td></tr>`;
    UI.modal({
      title: UI.esc(ev.title || T('planner.titleField')),
      width: 560,
      body: `
        <p class="hint" style="margin-top:0">${UI.fmtDate(ev.date)}${ev.time ? ' \u00b7 ' + UI.esc(ev.time) : ''}
          \u00b7 <span class="tag blue">${UI.esc(label('plannerKind', ev.kind))}</span>
          <span class="tag ${ev.status === 'done' ? 'green' : ev.status === 'cancelled' ? 'warn' : 'amber'}">${UI.esc(label('plannerStatus', ev.status))}</span></p>
        <table class="show-table">
          ${line(T('planner.place'), ev.place)}
          ${line(T('planner.who'), ev.who)}
          ${team ? line(T('teams.activeTeam'), team.name) : ''}
          ${line(T('planner.access'), ev.allTeams ? T('planner.allTeams')
        : (sharedWith(ev).map(id => (Store.find('teams', id) || {}).name).filter(Boolean).join(', ') || T('planner.accessNone')))}
        </table>
        <h4 style="margin:14px 0 6px">${T('planner.notes')}</h4>
        <p class="plan-note" style="white-space:pre-wrap">${UI.esc(ev.notes || T('common.noData'))}</p>`,
      footer: `<button class="btn ghost" data-close2>${T('common.close')}</button><button class="btn primary" data-edit>${T('common.edit')}</button>`,
      onOpen: (m, close) => {
        m.querySelector('[data-close2]').onclick = close;
        m.querySelector('[data-edit]').onclick = () => { close(); form(ev); };
      }
    });
  }

  function form(ev = {}) {
    const d = ev.date ? new Date(ev.date) : new Date();
    const dstr = d.toISOString().slice(0, 10);
    const owner = ev.teamId || Store.activeTeamId();
    const others = Store.teams().filter(t => t.id !== owner);
    const on = sharedWith(ev);
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
        <h4 style="margin:14px 0 4px">${UI.esc(T('planner.access'))}</h4>
        <p class="hint" style="margin:0">${UI.esc(T('planner.accessHint'))}</p>
        <label class="check-row"><input type="checkbox" id="p_all" ${ev.allTeams ? 'checked' : ''}>
          <span>${UI.esc(T('planner.allTeams'))}</span></label>
        ${others.length ? `<div class="menu-picker">${others.map(t => `<label class="check-row menu-row">
          <input type="checkbox" data-team="${UI.esc(t.id)}" ${on.indexOf(t.id) >= 0 ? 'checked' : ''}>
          <span>${UI.esc(t.name)}</span></label>`).join('')}</div>` : `<p class="hint">${UI.esc(T('planner.accessOnly'))}</p>`}
        <p class="hint">${T('planner.formHint')}</p>`,
      footer: `<button class="btn ghost" data-close2>${T('common.cancel')}</button><button class="btn primary" data-save>${T('common.save')}</button>`,
      onOpen: (m, close) => {
        const q = s => m.querySelector(s);
        q('#p_title').focus();
        const teamBoxes = [...m.querySelectorAll('[data-team]')];
        const all = q('#p_all');
        // Picking the whole club makes the squad-by-squad list meaningless.
        const syncAll = () => teamBoxes.forEach(b => { b.disabled = all.checked; });
        all.onchange = syncAll;
        syncAll();
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
            notes: q('#p_notes').value.trim().slice(0, 600),
            allTeams: all.checked,
            teams: all.checked ? [] : teamBoxes.filter(b => b.checked).map(b => b.dataset.team)
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
