/* Exercise Library view */
window.Views = window.Views || {};
Views.exercises = function (mount) {
  const sportId = (window.App && App.getSport && App.getSport()) || 'handball';
  const CATS = ['All'].concat(SPORTS.exerciseCategories(sportId));
  const INT = ['Low', 'Medium', 'High'];
  const tt = (p, v) => { const k = p + '.' + v; const r = T(k); return r === k ? v : r; };
  const dt = v => { const k = 'seed.' + v; const r = T(k); return r === k ? v : r; };
  const dd = (title, desc) => { const k = 'seedDesc.' + title; const r = T(k); return r === k ? (desc || '') : r; };
  const catLabel = c => (c === 'All' ? T('exercises.all') : tt('cat', c));
  let cat = 'All';

  function render() {
    const list = Store.all('exercises').filter(e => cat === 'All' || e.category === cat);
    mount.innerHTML = `
      <div class="page-head"><div><h1>${T('exercises.title')}</h1><p>${T('exercises.subtitle')}</p></div>
        <button class="btn primary" id="addEx">+ ${T('exercises.newExercise')}</button></div>
      <div class="pill-row">${CATS.map(c => `<span class="pill ${c === cat ? 'active' : ''}" data-cat="${c}">${UI.esc(catLabel(c))}</span>`).join('')}</div>
      <div class="grid cols-3">
        ${list.map(e => `
          <div class="card">
            <div style="display:flex;justify-content:space-between"><h3 style="margin:0">${UI.esc(dt(e.title))}</h3><span class="tag blue">${UI.esc(tt('cat', e.category))}</span></div>
            <p style="color:var(--text-soft);margin:8px 0;font-size:13px">${UI.esc(dd(e.title, e.description))}</p>
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">
              <span class="tag">${e.duration || 0} ${T('training.min')}</span><span class="tag ${e.intensity === 'High' ? 'red' : e.intensity === 'Medium' ? 'amber' : 'green'}">${UI.esc(tt('intensity', e.intensity || 'Low'))}</span>
              ${(e.tags || []).map(t => `<span class="tag">#${UI.esc(t)}</span>`).join('')}
            </div>
            <button class="btn sm" data-edit="${e.id}">${T('common.edit')}</button> <button class="btn sm danger" data-del="${e.id}">${T('common.delete')}</button>
          </div>`).join('') || `<div class="empty"><div class="big">${UI.icon('dumbbell', 40)}</div>${T('exercises.none')}</div>`}
      </div>`;
    mount.querySelectorAll('[data-cat]').forEach(b => b.onclick = () => { cat = b.dataset.cat; render(); });
    mount.querySelector('#addEx').onclick = () => form();
    mount.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => form(Store.find('exercises', b.dataset.edit)));
    mount.querySelectorAll('[data-del]').forEach(b => b.onclick = () => UI.confirm(T('exercises.delExercise'), async () => { await Store.remove('exercises', b.dataset.del); render(); }));
  }

  function form(e = {}) {
    const cats = SPORTS.exerciseCategories(sportId);
    UI.modal({
      title: e.id ? T('exercises.editExercise') : T('exercises.newExercise'),
      body: `
        <label class="field"><span>${T('training.titleField')}</span><input id="e_t" value="${UI.esc(e.title || '')}"></label>
        <div class="row">
          <label class="field"><span>${T('training.category')}</span><select id="e_c">${cats.map(x => `<option value="${x}" ${x === e.category ? 'selected' : ''}>${UI.esc(tt('cat', x))}</option>`).join('')}</select></label>
          <label class="field"><span>${T('training.duration')}</span><input id="e_d" type="number" value="${e.duration || 15}"></label>
          <label class="field"><span>${T('training.intensity')}</span><select id="e_i">${INT.map(x => `<option value="${x}" ${x === e.intensity ? 'selected' : ''}>${UI.esc(tt('intensity', x))}</option>`).join('')}</select></label>
        </div>
        <label class="field"><span>${T('training.description')}</span><textarea id="e_desc" rows="4">${UI.esc(e.description || '')}</textarea></label>
        <label class="field"><span>${T('training.tags')}</span><input id="e_tags" value="${UI.esc((e.tags || []).join(', '))}"></label>`,
      footer: `<button class="btn ghost" data-close2>${T('common.cancel')}</button><button class="btn primary" data-save>${T('common.save')}</button>`,
      onOpen: (m, close) => {
        m.querySelector('[data-close2]').onclick = close;
        m.querySelector('[data-save]').onclick = async () => {
          const obj = Object.assign({}, e, {
            title: m.querySelector('#e_t').value.trim(), category: m.querySelector('#e_c').value,
            duration: +m.querySelector('#e_d').value, intensity: m.querySelector('#e_i').value,
            description: m.querySelector('#e_desc').value.trim(),
            tags: m.querySelector('#e_tags').value.split(',').map(s => s.trim()).filter(Boolean)
          });
          if (!obj.title) return UI.toast(T('training.titleReq'), 'error');
          await Store.save('exercises', obj); close(); UI.toast(T('exercises.saved'), 'success'); render();
        };
      }
    });
  }
  render();
};
