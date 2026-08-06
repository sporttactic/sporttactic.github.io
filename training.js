/* Training Planner view */
window.Views = window.Views || {};
Views.training = function (mount) {
  const team = Store.all('teams')[0];
  const FOCI = ['Warm-up', 'Attack', 'Defense', 'Transition', 'Goalkeeper', 'Physical', 'Set Plays'];
  const DCATS = ['Attack', 'Defense', 'Goalkeeper', 'Passing', 'Shooting', 'Transition', 'Conditioning'];
  const INT = ['Low', 'Medium', 'High'];
  // Only http(s) links may reach an href — blocks javascript:/data: payloads.
  const safeUrl = (u) => {
    const s = String(u || '').trim();
    if (!s) return '';
    try { const p = new URL(s); return (p.protocol === 'http:' || p.protocol === 'https:') ? p.href : ''; }
    catch { return ''; }
  };
  // Translate an option value with fallback to the raw value.
  const tt = (p, v) => { const k = p + '.' + v; const r = T(k); return r === k ? v : r; };
  // Translate default (seed) drill/session names & descriptions; user content is unchanged.
  const dt = v => { const k = 'seed.' + v; const r = T(k); return r === k ? v : r; };
  const dd = (title, desc) => { const k = 'seedDesc.' + title; const r = T(k); return r === k ? (desc || '') : r; };

  function render() {
    const sessions = Store.all('training').slice().sort((a, b) => a.date - b.date);
    const drills = Store.all('exercises');
    mount.innerHTML = `
      <div class="page-head"><div><h1>${T('training.title')}</h1><p>${T('training.subtitle')}</p></div>
        <button class="btn primary" id="addSession">+ ${T('training.newSession')}</button></div>
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
      </div>

      <div class="page-head" style="margin-top:24px"><div><h2 style="margin:0;font-size:20px">${T('training.drillsLib')}</h2><p>${T('training.drillsHint')}</p></div>
        <button class="btn primary" id="addDrill">+ ${T('training.newDrill')}</button></div>
      <div class="grid cols-3">
        ${drills.map(e => `
          <div class="card">
            <div style="display:flex;justify-content:space-between"><h3 style="margin:0">${UI.esc(dt(e.title))}</h3><span class="tag blue">${UI.esc(tt('cat', e.category))}</span></div>
            <p style="color:var(--text-soft);margin:8px 0;font-size:13px">${UI.esc(dd(e.title, e.description))}</p>
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">
              <span class="tag">${e.duration || 0} ${T('training.min')}</span>
              <span class="tag ${e.intensity === 'High' ? 'red' : e.intensity === 'Medium' ? 'amber' : 'green'}">${UI.esc(tt('intensity', e.intensity || 'Low'))}</span>
              ${(e.tags || []).map(t => `<span class="tag">#${UI.esc(t)}</span>`).join('')}
            </div>
            ${(() => {
      const yt = safeUrl(e.videoYt), vid = safeUrl(e.videoUrl);
      if (!yt && !vid) return '';
      return `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">
              ${yt ? `<a class="btn sm" href="${UI.esc(yt)}" target="_blank" rel="noopener noreferrer">▶ YouTube</a>` : ''}
              ${vid ? `<a class="btn sm" href="${UI.esc(vid)}" target="_blank" rel="noopener noreferrer">▶ ${T('training.video')}</a>` : ''}
            </div>`;
    })()}
            <button class="btn sm" data-dedit="${e.id}">${T('common.edit')}</button> <button class="btn sm danger" data-ddel="${e.id}">${T('common.delete')}</button>
          </div>`).join('') || `<div class="empty"><div class="big">${UI.icon('dumbbell', 40)}</div>${T('training.noDrills')}</div>`}
      </div>`;

    mount.querySelector('#addSession').onclick = () => sessionForm();
    mount.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => sessionForm(Store.find('training', b.dataset.edit)));
    mount.querySelectorAll('[data-del]').forEach(b => b.onclick = () => UI.confirm(T('training.delSession'), async () => { await Store.remove('training', b.dataset.del); render(); }));
    mount.querySelector('#addDrill').onclick = () => drillForm();
    mount.querySelectorAll('[data-dedit]').forEach(b => b.onclick = () => drillForm(Store.find('exercises', b.dataset.dedit)));
    mount.querySelectorAll('[data-ddel]').forEach(b => b.onclick = () => UI.confirm(T('training.delDrill'), async () => { await Store.remove('exercises', b.dataset.ddel); render(); }));
  }

  function sessionForm(s = {}) {
    const dstr = new Date(s.date || Date.now()).toISOString().slice(0, 10);
    const drills = Store.all('exercises');
    UI.modal({
      title: s.id ? T('training.editSession') : T('training.newSession'),
      body: `
        <label class="field"><span>${T('training.titleField')}</span><input id="t_title" value="${UI.esc(s.title || '')}"></label>
        <div class="row">
          <label class="field"><span>${T('training.date')}</span><input id="t_date" type="date" value="${dstr}"></label>
          <label class="field"><span>${T('training.duration')}</span><input id="t_dur" type="number" value="${s.duration || 90}"></label>
          <label class="field"><span>${T('training.focus')}</span><select id="t_focus">${FOCI.map(x => `<option value="${x}" ${x === s.focus ? 'selected' : ''}>${UI.esc(tt('focus', x))}</option>`).join('')}</select></label>
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

  // Create / edit a drill (stored in the shared exercises library).
  function drillForm(e = {}) {
    UI.modal({
      title: e.id ? T('training.editDrill') : T('training.newDrill'),
      body: `
        <label class="field"><span>${T('training.titleField')}</span><input id="d_t" value="${UI.esc(e.title || '')}"></label>
        <div class="row">
          <label class="field"><span>${T('training.category')}</span><select id="d_c">${DCATS.map(x => `<option value="${x}" ${x === e.category ? 'selected' : ''}>${UI.esc(tt('cat', x))}</option>`).join('')}</select></label>
          <label class="field"><span>${T('training.duration')}</span><input id="d_d" type="number" value="${e.duration || 15}"></label>
          <label class="field"><span>${T('training.intensity')}</span><select id="d_i">${INT.map(x => `<option value="${x}" ${x === e.intensity ? 'selected' : ''}>${UI.esc(tt('intensity', x))}</option>`).join('')}</select></label>
        </div>
        <label class="field"><span>${T('training.description')}</span><textarea id="d_desc" rows="4">${UI.esc(e.description || '')}</textarea></label>
        <label class="field"><span>${T('training.youtube')}</span><input id="d_yt" type="url" inputmode="url" placeholder="https://www.youtube.com/watch?v=..." value="${UI.esc(e.videoYt || '')}"></label>
        <label class="field"><span>${T('training.videoLink')}</span><input id="d_vid" type="url" inputmode="url" placeholder="https://vimeo.com/..." value="${UI.esc(e.videoUrl || '')}"></label>
        <p style="color:var(--muted);font-size:12px;margin:-4px 0 8px">${T('training.videoHint')}</p>
        <label class="field"><span>${T('training.tags')}</span><input id="d_tags" value="${UI.esc((e.tags || []).join(', '))}"></label>`,
      footer: `<button class="btn ghost" data-close2>${T('common.cancel')}</button><button class="btn primary" data-save>${T('common.save')}</button>`,
      onOpen: (m, close) => {
        m.querySelector('[data-close2]').onclick = close;
        m.querySelector('[data-save]').onclick = async () => {
          const yt = m.querySelector('#d_yt').value.trim(), vid = m.querySelector('#d_vid').value.trim();
          if ((yt && !safeUrl(yt)) || (vid && !safeUrl(vid))) return UI.toast(T('training.badUrl'), 'error');
          const obj = Object.assign({}, e, {
            title: m.querySelector('#d_t').value.trim(), category: m.querySelector('#d_c').value,
            duration: +m.querySelector('#d_d').value, intensity: m.querySelector('#d_i').value,
            description: m.querySelector('#d_desc').value.trim(),
            videoYt: yt, videoUrl: vid,
            tags: m.querySelector('#d_tags').value.split(',').map(s => s.trim()).filter(Boolean)
          });
          if (!obj.title) return UI.toast(T('training.titleReq'), 'error');
          await Store.save('exercises', obj); close(); UI.toast(T('training.drillSaved'), 'success'); render();
        };
      }
    });
  }

  render();
};
