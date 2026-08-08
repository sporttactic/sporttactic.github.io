/* Opponent Analysis view */
window.Views = window.Views || {};
Views.opponents = function (mount) {
  const opponents = Store.scoped('opponents');
  const team = Store.activeTeam();
  const sportId = (window.App && App.getSport && App.getSport()) || 'handball';
  // Translate a stored value, falling back to the value itself.
  const tt = (p, v) => { const k = p + '.' + v; const r = T(k); return r === k ? v : r; };
  const cards = `
    <div class="grid cols-2">
      ${opponents.map(o => `
        <div class="card">
          <div style="display:flex;justify-content:space-between"><h3 style="margin:0">${UI.esc(o.name)}</h3><span class="tag amber">${UI.esc(o.formation ? tt('form', o.formation) : '—')}</span></div>
          <p style="margin:8px 0"><strong>${T('opponents.keyPlayers')}:</strong> ${UI.esc(o.keyPlayers || '—')}</p>
          <p style="margin:8px 0;color:var(--text-soft)"><strong>${T('opponents.tendencies')}:</strong> ${UI.esc(o.tendencies || '—')}</p>
          <button class="btn sm" data-edit="${o.id}">${T('common.edit')}</button>
          <button class="btn sm" data-report="${o.id}">${T('opponents.report')}</button>
          <button class="btn sm" data-pdf="${o.id}">⬇ ${T('opponents.pdf')}</button>
          <button class="btn sm" data-aiplan="${o.id}">🤖 ${T('opponents.aiPlan')}</button>
          <button class="btn sm danger" data-del="${o.id}">${T('common.delete')}</button>
        </div>`).join('') || `<div class="empty"><div class="big">${UI.icon('search', 40)}</div>${T('opponents.none')}</div>`}
    </div>`;

  mount.innerHTML = `
    ${AI.section('play')}
    <div class="page-head"><div><h1>${T('opponents.title')}</h1><p>${T('opponents.subtitle')}</p></div></div>
    ${UI.acc('opponents', T('opponents.scouted'), cards, {
    sub: T('opponents.subtitle'),
    actions: `${UI.shareBar('opponents')}
        <button class="btn" id="pdfAll">⬇ ${T('opponents.pdfAll')}</button>
        <button class="btn" id="aiNewOpp">🤖 ${T('opponents.aiNew')}</button>
        <button class="btn" id="aiSuggest">🤖 ${T('opponents.aiSuggest')}</button>
        <button class="btn primary" id="addOpp">+ ${T('opponents.newOpponent')}</button>`
  })}`;
  UI.bindAcc(mount);
  UI.bindShare(mount, 'opponents', () => Views.opponents(mount));

  function form(o = {}) {
    UI.modal({
      title: o.id ? T('opponents.editOpp') : T('opponents.newOpponent'),
      body: `
        <label class="field"><span>${T('opponents.name')}</span><input id="o_n" value="${UI.esc(o.name || '')}"></label>
        <label class="field"><span>${T('opponents.formation')}</span><select id="o_f">${SPORTS.oppFormations(sportId).map(x => `<option value="${UI.esc(x)}" ${x === o.formation ? 'selected' : ''}>${UI.esc(tt('form', x))}</option>`).join('')}</select></label>
        <label class="field"><span>${T('opponents.keyPlayers')}</span><input id="o_k" value="${UI.esc(o.keyPlayers || '')}"></label>
        <label class="field"><span>${T('opponents.tendencies')}</span><textarea id="o_t" rows="4">${UI.esc(o.tendencies || '')}</textarea></label>`,
      footer: `<button class="btn ghost" data-close2>${T('common.cancel')}</button><button class="btn primary" data-save>${T('common.save')}</button>`,
      onOpen: (m, close) => {
        m.querySelector('[data-close2]').onclick = close;
        m.querySelector('[data-save]').onclick = async () => {
          const obj = Object.assign({}, o, {
            name: m.querySelector('#o_n').value.trim(), formation: m.querySelector('#o_f').value,
            keyPlayers: m.querySelector('#o_k').value.trim(), tendencies: m.querySelector('#o_t').value.trim()
          });
          if (!obj.name) return UI.toast(T('opponents.nameReq'), 'error');
          await Store.save('opponents', obj); close(); UI.toast(T('opponents.saved'), 'success'); Views.opponents(mount);
        };
      }
    });
  }
  mount.querySelector('#addOpp').onclick = () => form();
  mount.querySelector('#aiNewOpp').onclick = () => aiOpponentForm();

  // ---- Scouting report ---------------------------------------------------
  function recFor(o) {
    return T('opponents.recPrefix') + ' ' + (o.formation === '6-0' ? T('opponents.recFlat') : T('opponents.recTempo')) + '.';
  }
  function reportBody(o) {
    return `<p><strong>${T('opponents.formationLabel')}:</strong> ${UI.esc(o.formation || '—')}</p>
      <p><strong>${T('opponents.keyPlayers')}:</strong> ${UI.esc(o.keyPlayers || '—')}</p>
      <p style="margin-top:10px">${UI.esc(o.tendencies || '—')}</p>
      <p style="margin-top:12px;color:var(--muted)">${UI.esc(recFor(o))}</p>`;
  }
  // One opponent as printable HTML, reused for a single card and for the
  // "export all" sheet.
  function pdfSection(o) {
    const played = Store.matches().filter(m => (m.opponent || '').toLowerCase() === (o.name || '').toLowerCase());
    return `<section><h2>${UI.esc(o.name)}</h2>`
      + `<table><tr><th>${UI.esc(T('opponents.formationLabel'))}</th><td>${UI.esc(o.formation || '—')}</td></tr>`
      + `<tr><th>${UI.esc(T('opponents.keyPlayers'))}</th><td>${UI.esc(o.keyPlayers || '—')}</td></tr></table>`
      + `<h3>${UI.esc(T('opponents.tendencies'))}</h3><p>${UI.esc(o.tendencies || '—')}</p>`
      + (played.length ? `<h3>${UI.esc(T('opponents.pastMatches'))}</h3><table><thead><tr>`
        + `<th>${UI.esc(T('training.date'))}</th><th>${UI.esc(T('opponents.venue'))}</th><th>${UI.esc(T('opponents.result'))}</th></tr></thead><tbody>`
        + played.map(m => `<tr><td>${UI.esc(UI.fmtDate(m.date))}</td><td>${UI.esc(m.home ? T('opponents.home') : T('opponents.away'))}</td><td>${UI.esc((m.homeScore || 0) + ':' + (m.awayScore || 0))}</td></tr>`).join('')
        + '</tbody></table>' : '')
      + `<h3>${UI.esc(T('opponents.recommendation'))}</h3><p>${UI.esc(recFor(o))}</p></section>`;
  }
  const pdfSub = () => [team && team.name, SPORTS.name(sportId, I18N.getLang())].filter(Boolean).join(' · ');
  // Print view — the browser's own "Save as PDF" is the export.
  function reportPdf(o) {
    UI.printDoc(T('opponents.report') + ' — ' + o.name, pdfSub(), pdfSection(o),
      () => UI.toast(T('opponents.popupBlocked'), 'error'));
  }
  // Every scouted opponent in one document, ready for the pre-season folder.
  function reportPdfAll() {
    const list = Store.scoped('opponents');
    if (!list.length) return UI.toast(T('opponents.none'), 'error');
    UI.printDoc(T('opponents.title'), pdfSub() + ' · ' + list.length + ' ' + T('opponents.scouted'),
      list.map(pdfSection).join(''), () => UI.toast(T('opponents.popupBlocked'), 'error'));
  }
  mount.querySelector('#pdfAll').onclick = reportPdfAll;
  mount.querySelectorAll('[data-pdf]').forEach(b => b.onclick = () => {
    const o = Store.find('opponents', b.dataset.pdf);
    if (o) reportPdf(o);
  });

  // ---- AI-drafted opponent ------------------------------------------------
  // Reads the match list, so the coach can turn a fixture into a scouting card
  // before anyone has watched the opponent play.
  function aiOpponentForm() {
    const matches = Store.matches();
    const known = new Set(Store.scoped('opponents').map(o => (o.name || '').toLowerCase()));
    const names = [...new Set(matches.map(m => (m.opponent || '').trim()).filter(Boolean))];
    if (!names.length) return UI.toast(T('opponents.noMatches'), 'error');
    UI.modal({
      title: T('opponents.aiNew'),
      width: 600,
      body: `<p style="color:var(--muted);font-size:13px">${T('opponents.aiNewIntro')}</p>
        <label class="field"><span>${T('opponents.fromMatch')}</span>
          <select id="ao_name">${names.map(n => `<option value="${UI.esc(n)}">${UI.esc(n)}${known.has(n.toLowerCase()) ? ' · ' + T('opponents.alreadyScouted') : ''}</option>`).join('')}</select></label>
        <label class="field"><span>${T('opponents.aiNewNotes')}</span>
          <textarea id="ao_notes" rows="3" placeholder="${UI.esc(T('opponents.aiNewNotesPh'))}"></textarea></label>
        <p class="hint">${T('opponents.aiNewHint')}</p>`,
      footer: `<button class="btn ghost" data-close2>${T('common.cancel')}</button><button class="btn primary" data-gen>${T('training.aiGenerate')}</button>`,
      onOpen: (m, close) => {
        m.querySelector('[data-close2]').onclick = close;
        const btn = m.querySelector('[data-gen]');
        btn.onclick = async () => {
          const name = m.querySelector('#ao_name').value;
          const notes = m.querySelector('#ao_notes').value.trim().slice(0, 400);
          btn.disabled = true; btn.textContent = T('ai.asking');
          const draft = await draftOpponent(name, notes);
          btn.disabled = false; btn.textContent = T('training.aiGenerate');
          if (draft) { close(); form(draft); UI.toast(T('opponents.aiNewReady'), 'success'); }
        };
      }
    });
  }

  async function draftOpponent(name, notes) {
    const lang = I18N.getLang() === 'da' ? 'Danish' : 'English';
    const formations = SPORTS.oppFormations(sportId);
    const played = Store.matches().filter(m => (m.opponent || '').toLowerCase() === name.toLowerCase());
    const history = played.map(m => {
      const s = Store.teamStats(m.id);
      return `- ${new Date(m.date).toISOString().slice(0, 10)} ${m.home ? 'home' : 'away'} ${m.homeScore || 0}:${m.awayScore || 0}`
        + ` (${m.status || 'scheduled'}) — we scored ${s.goals} from ${s.shots} shots, ${s.turnovers} turnovers, ${s.saves} saves`;
    }).join('\n') || '- no result recorded yet';
    const existing = Store.scoped('opponents').map(o => `- ${o.name}: ${o.formation || '?'} | ${o.tendencies || ''}`).join('\n') || '- none';

    const system = [
      `You scout ${SPORTS.name(sportId, 'en')} opponents for a coach.`,
      `Write keyPlayers and tendencies in ${lang}.`,
      'Answer with one JSON object and nothing else — no markdown, no code fence, no commentary.',
      'Shape: {"name":"","formation":"","keyPlayers":"","tendencies":""}',
      `formation must be exactly one of: ${formations.join(', ')}.`,
      'keyPlayers: one line, the shirt numbers and roles to watch, max 140 characters.',
      'tendencies: 3 to 5 short lines on how they play and how we beat them, max 600 characters.',
      'Base it on the match history given. Where the data does not say, write what is typical for that level and mark it as an assumption.'
    ].join('\n');
    const user = [
      `Opponent: ${name}`,
      'Our matches against them:', history,
      'Other opponents we have already scouted:', existing,
      notes ? 'What the coach already knows: ' + notes : ''
    ].filter(Boolean).join('\n');

    const raw = await AI.complete(system, user, 700);
    if (!raw) return null;
    let d;
    try { d = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)); }
    catch { UI.toast(T('opponents.aiBad'), 'error'); return null; }
    return {
      name: String(d.name || name).trim().slice(0, 80) || name,
      formation: formations.includes(d.formation) ? d.formation : formations[0],
      keyPlayers: String(d.keyPlayers || '').trim().slice(0, 200),
      tendencies: String(d.tendencies || '').trim().slice(0, 800)
    };
  }

  // One suggestion across the whole scouting board: what the coming opponents
  // have in common and what that means for this week's work.
  mount.querySelector('#aiSuggest').onclick = () => {
    if (!opponents.length) return UI.toast(T('opponents.none'), 'error');
    const list = opponents.map(o => `- ${o.name} | formation: ${o.formation || 'unknown'} | key players: ${o.keyPlayers || 'unknown'} | tendencies: ${o.tendencies || 'unknown'}`).join('\n');
    AI.report({
      title: T('opponents.aiSuggest'),
      task: [
        'Look at every scouted opponent below together and suggest how we should prepare.',
        'Cover: the pattern they share and the single biggest threat to us, the formation and defence that works best against most of them,'
        + ' the matchups to protect using our own shirt numbers, two set plays worth drilling, what to scout next on the thinnest profiles,'
        + ' and which exercises from our library to train this week — add the video link for every exercise you name.',
        'Scouted opponents:',
        list
      ].join('\n'),
      maxTokens: 1100
    });
  };
  AI.bind(mount);
  mount.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => form(Store.find('opponents', b.dataset.edit)));
  mount.querySelectorAll('[data-del]').forEach(b => b.onclick = () => UI.confirm(T('opponents.delOpp'), async () => { await Store.remove('opponents', b.dataset.del); Views.opponents(mount); }));
  mount.querySelectorAll('[data-aiplan]').forEach(b => b.onclick = () => {
    const o = Store.find('opponents', b.dataset.aiplan);
    AI.report({
      title: T('opponents.aiPlan') + ' — ' + o.name,
      task: [
        `Build a match plan against ${o.name}.`,
        `Their formation: ${o.formation || 'unknown'}.`,
        `Their key players: ${o.keyPlayers || 'unknown'}.`,
        `Their tendencies: ${o.tendencies || 'unknown'}.`,
        'Cover: how we attack that formation, our defensive setup and the matchups using our own shirt numbers,'
        + ' two set plays, what to avoid, and which drills from our library to train this week — add the video link for every drill you name.'
      ].join('\n')
    });
  });
  mount.querySelectorAll('[data-report]').forEach(b => b.onclick = () => {
    const o = Store.find('opponents', b.dataset.report);
    UI.modal({
      title: T('opponents.report') + ' — ' + o.name,
      body: reportBody(o),
      footer: `<button class="btn sm" data-imp>${T('opponents.importOne')}</button>
        <button class="btn sm" data-pdf>⬇ ${T('opponents.pdf')}</button>
        <button class="btn primary" data-close2>${T('opponents.close')}</button>`,
      onOpen: (m, close) => {
        m.querySelector('[data-close2]').onclick = close;
        m.querySelector('[data-pdf]').onclick = () => reportPdf(o);
        // Reuses the share bar's own file input, so the import path stays in one place.
        m.querySelector('[data-imp]').onclick = () => {
          close();
          const inp = mount.querySelector('[data-pack-imp="opponents"]');
          if (inp) inp.click();
        };
      }
    });
  });
};
