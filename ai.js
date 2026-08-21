/* AI assistant (ChatGPT) — one shared panel reused by every view.
   The API key lives in localStorage, NOT in the settings store, so it can
   never leak through a full JSON backup. */
window.AI = (() => {
  const ENDPOINT = 'https://api.openai.com/v1/chat/completions';
  const MODEL = 'gpt-4o-mini';
  const KEY_LS = 'stx_ai_key';
  const TOPICS = ['play', 'injuries', 'analytics', 'training'];
  const MAX_TURNS = 6;          // history turns sent back to the model
  const chats = {};             // topic -> [{role, content}], kept for the session
  const busy = {};              // topic -> bool

  const esc = s => UI.esc(String(s == null ? '' : s));

  function getKey() { try { return localStorage.getItem(KEY_LS) || ''; } catch (e) { return ''; } }
  function setKey(v) { try { v ? localStorage.setItem(KEY_LS, v) : localStorage.removeItem(KEY_LS); } catch (e) { } }

  // ---- Context: a compact snapshot of the club's own data ----
  function line(p, st) {
    const pos = p.position || '?';
    return `#${p.number || '-'} ${p.firstName || ''} ${p.lastName || ''} — ${pos} — ${p.status || 'active'}`
      + ` — ${st.goals}G ${st.assists}A ${st.turnovers}TO ${st.saves}SV, shot ${st.shotPct}%`;
  }
  function context() {
    const sportId = (window.App && App.getSport && App.getSport()) || 'handball';
    const team = Store.activeTeam();
    const players = Store.players(team ? team.id : null);
    const matches = Store.matches().slice().sort((a, b) => b.date - a.date);
    const done = matches.filter(m => m.status === 'finished');
    const agg = { goals: 0, shots: 0, assists: 0, turnovers: 0, fastbreaks: 0, saves: 0, suspensions: 0 };
    done.forEach(m => { const s = Store.teamStats(m.id); Object.keys(agg).forEach(k => agg[k] += s[k]); });
    const injured = players.filter(p => p.status === 'injured');
    const notActive = players.filter(p => p.status === 'suspended');
    const sessions = Store.scoped('training').slice().sort((a, b) => b.date - a.date).slice(0, 8);
    const drills = Store.all('exercises').slice(0, 20);

    const L = [];
    L.push(`Sport: ${SPORTS.name(sportId, 'en')}`);
    L.push(`Drill categories in this sport: ${SPORTS.exerciseCategories(sportId).join(', ')}`);
    L.push(`Positions in this sport: ${(SPORTS.positions(sportId) || []).join(', ') || 'none'}`);
    L.push(`Formations / styles in this sport: ${(SPORTS.oppFormations(sportId) || []).join(', ')}`);
    L.push(`Team: ${team ? team.name : 'unnamed'}${team && team.division ? ' (' + team.division + ')' : ''}`);
    L.push(`Squad (${players.length}):`);
    players.slice(0, 30).forEach(p => L.push('  ' + line(p, Store.playerStats(p.id))));
    L.push(`Injured (${injured.length}): ` + (injured.map(p => `#${p.number} ${p.lastName}${p.injuryNote ? ' (' + p.injuryNote + ')' : ''}`).join('; ') || 'none')
      + `. Not active (${notActive.length}): ` + (notActive.map(p => `#${p.number} ${p.lastName}`).join('; ') || 'none'));
    L.push(`Season totals over ${done.length} finished matches: ${agg.goals} goals, ${agg.shots} shots`
      + ` (${agg.shots ? Math.round(agg.goals / agg.shots * 100) : 0}%), ${agg.assists} assists, ${agg.turnovers} turnovers,`
      + ` ${agg.fastbreaks} fast breaks, ${agg.saves} saves, ${agg.suspensions} suspensions.`);
    L.push('Recent matches:');
    matches.slice(0, 8).forEach(m => L.push(`  ${new Date(m.date).toISOString().slice(0, 10)} ${m.home ? 'vs' : 'at'} ${m.opponent} — ${m.status}`
      + (m.status === 'finished' ? ` ${m.homeScore}:${m.awayScore}` : '')));
    L.push('Planned training sessions:');
    sessions.forEach(s => L.push(`  ${new Date(s.date).toISOString().slice(0, 10)} ${s.title} — focus ${s.focus}, ${s.duration} min`));
    L.push('Drill library (video = link the coach can open):');
    if (!drills.length) L.push('  empty');
    drills.forEach(d => L.push(`  ${d.title} (${d.category}, ${d.duration || 0} min, ${d.intensity || 'Low'})`
      + ((d.videos && d.videos[0]) || d.videoYt || d.videoUrl ? ` — video: ${(d.videos && d.videos[0]) || d.videoYt || d.videoUrl}` : '')));
    return L.join('\n');
  }

  function systemPrompt() {
    const sportId = (window.App && App.getSport && App.getSport()) || 'handball';
    return [
      `You are an experienced ${SPORTS.name(sportId, 'en')} head coach, performance analyst and strength & conditioning adviser.`
    ].concat(langLines(), [
      'Be concrete and practical: short bullet points, no filler, at most ~200 words unless asked for more.',
      `Stay inside ${SPORTS.name(sportId, 'en')}: use only the drill categories, positions and formations listed in TEAM DATA, that sport's own rules, scoring and vocabulary, and never borrow drills or terms from another sport.`,
      'Use the team data below — cite real shirt numbers and names when you name players.',
      'When you name a drill from the drill library, write the exercise video link from TEAM DATA on the same line so the coach can open it.',
      'Only use links that appear in TEAM DATA. Never invent, guess or shorten a URL, and never link to anything else.',
      'If the data is thin, say what to record next instead of inventing numbers.',
      'On injuries you are NOT a doctor: give load management, modified-training and return-to-play structure only, and tell the coach to clear everything with medical staff.',
      'Whenever a drawing helps (formation, court positions, a movement pattern, a bar chart of the numbers), include it as inline SVG.',
      'SVG rules: one <svg> element with a viewBox and no width/height, drawn for a dark background (stroke #ffffff or a clear colour, fill none or a solid colour, font-size 12+).'
      + ' Use only svg, g, path, line, polyline, polygon, circle, ellipse, rect, text and tspan. No script, no style, no image, no external links, no event attributes. Put a short caption in the text above or below the drawing.',
      '',
      'TEAM DATA',
      context()
    ]).join('\n');
  }

  // ---- Rendering ----
  // Illustrations come back as inline SVG, which is markup we did not write —
  // it is rebuilt from a strict tag/attribute allow-list before it reaches the DOM.
  const SVG_TAGS = new Set(['svg', 'g', 'path', 'line', 'polyline', 'polygon', 'circle', 'ellipse', 'rect', 'text', 'tspan', 'title', 'desc']);
  const SVG_ATTRS = new Set(['viewbox', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'd', 'points', 'dx', 'dy',
    'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin',
    'opacity', 'transform', 'font-size', 'font-family', 'font-weight', 'text-anchor', 'dominant-baseline']);

  function safeSvg(markup) {
    let root;
    try {
      // Parsed in an inert document: nothing loads or executes while we filter it.
      root = new DOMParser().parseFromString(markup, 'text/html').body.querySelector('svg');
    } catch (e) { return ''; }
    if (!root) return '';
    const clean = el => {
      Array.prototype.slice.call(el.attributes).forEach(a => {
        if (!SVG_ATTRS.has(a.name.toLowerCase())) el.removeAttribute(a.name);
      });
      Array.prototype.slice.call(el.children).forEach(c => {
        if (SVG_TAGS.has(c.nodeName.toLowerCase())) clean(c); else c.remove();
      });
    };
    clean(root);
    if (!root.getAttribute('viewBox')) root.setAttribute('viewBox', '0 0 400 260');
    root.removeAttribute('width');
    root.removeAttribute('height');
    return '<div class="ai-fig">' + new XMLSerializer().serializeToString(root) + '</div>';
  }

  // Turn plain http(s) addresses in the reply into links. The text is already
  // escaped here, so the URL is safe both as href and as link text, and the
  // pattern itself only ever matches http/https. `&amp;` is part of a real
  // query string; any other entity (a quote, a tag) ends the address.
  const LINK_RE = /https?:\/\/(?:&amp;|[\w\-.~:/?#[\]@!$'()*+,;=%])+/g;
  const linkify = s => s.replace(LINK_RE, m => {
    const url = m.replace(/[.,]+$/, '');
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>` + m.slice(url.length);
  });

  // The model reply is escaped first, then a tiny subset of markdown is
  // re-introduced — never inject the raw text.
  function fmt(text) {
    const figs = [];
    const src = String(text)
      .replace(/<svg[\s\S]*?<\/svg>/gi, m => { const html = safeSvg(m); return html ? '\u0000' + (figs.push(html) - 1) + '\u0000' : ''; })
      .replace(/^[ \t]*```[a-z]*[ \t]*$/gim, '');
    const out = [];
    let list = false;
    src.split('\n').forEach(raw => {
      const t = raw.trim();
      const fig = /^\u0000(\d+)\u0000$/.exec(t);
      if (fig) {
        if (list) { out.push('</ul>'); list = false; }
        out.push(figs[+fig[1]]);
        return;
      }
      const bullet = /^([-*•]|\d+[.)])\s+/.test(t);
      if (bullet && !list) { out.push('<ul>'); list = true; }
      if (!bullet && list) { out.push('</ul>'); list = false; }
      if (!t) { if (!list) out.push('<br>'); return; }
      const body = linkify(esc(t.replace(/^([-*•]|\d+[.)])\s+/, '')).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
        .replace(/\u0000(\d+)\u0000/g, ''));
      out.push(bullet ? `<li>${body}</li>` : `<p>${body}</p>`);
    });
    if (list) out.push('</ul>');
    return out.join('');
  }

  function renderLog(root) {
    const topic = root.dataset.ai;
    const log = root.querySelector('[data-ai-log]');
    const msgs = chats[topic] || [];
    if (!msgs.length && !busy[topic]) {
      log.innerHTML = `<p class="ai-empty">${esc(T('ai.empty'))}</p>`;
      return;
    }
    log.innerHTML = msgs.map(m => `
      <div class="ai-msg ${m.role === 'user' ? 'me' : 'bot'}">
        <span class="ai-who">${esc(m.role === 'user' ? T('ai.you') : T('ai.coach'))}</span>
        <div class="ai-text">${m.role === 'user' ? '<p>' + esc(m.content) + '</p>' : fmt(m.content)}</div>
      </div>`).join('')
      + (busy[topic] ? `<div class="ai-msg bot"><span class="ai-who">${esc(T('ai.coach'))}</span><div class="ai-text"><p class="ai-dots">${esc(T('ai.asking'))}</p></div></div>` : '');
    log.scrollTop = log.scrollHeight;
  }

  function syncState(root) {
    const topic = root.dataset.ai;
    const has = !!getKey();
    root.querySelector('[data-ai-send]').disabled = !has || !!busy[topic];
    root.querySelector('[data-ai-input]').disabled = !has;
    root.querySelectorAll('[data-ai-topic]').forEach(b => { b.disabled = !has || !!busy[topic]; b.classList.toggle('active', b.dataset.aiTopic === topic); });
    root.querySelector('[data-ai-nokey]').hidden = has;
  }

  // ---- Request ----
  async function ask(root, question) {
    const topic = root.dataset.ai;
    const q = String(question || '').trim();
    if (!q || busy[topic]) return;
    const key = getKey();
    if (!key) return keyDialog(root);
    if (navigator.onLine === false) return UI.toast(T('ai.offline'), 'error');

    const hist = chats[topic] || (chats[topic] = []);
    hist.push({ role: 'user', content: q });
    busy[topic] = true;
    renderLog(root); syncState(root);

    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
        body: JSON.stringify({
          model: MODEL,
          temperature: 0.4,
          max_tokens: 700,
          messages: [{ role: 'system', content: systemPrompt() }].concat(hist.slice(-MAX_TURNS))
        })
      });
      if (!res.ok) {
        const msg = res.status === 401 ? T('ai.badKey') : res.status === 429 ? T('ai.rate') : T('ai.failed') + ' (' + res.status + ')';
        throw new Error(msg);
      }
      const data = await res.json();
      const answer = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      if (!answer) throw new Error(T('ai.failed'));
      hist.push({ role: 'assistant', content: answer });
    } catch (err) {
      hist.pop();
      UI.toast(err && err.message ? err.message : T('ai.failed'), 'error');
    } finally {
      busy[topic] = false;
      renderLog(root); syncState(root);
    }
  }

  function keyDialog(root) {
    UI.modal({
      title: T('ai.keyTitle'),
      width: 520,
      body: `<p style="color:var(--muted);font-size:13px">${esc(T('ai.keyIntro'))}</p>
        <label class="field"><span>${esc(T('ai.key'))}</span>
          <input id="aiKeyIn" type="password" autocomplete="off" spellcheck="false" placeholder="sk-..." value="${esc(getKey())}"></label>
        <p style="color:var(--muted);font-size:12px">${esc(T('ai.keyStore'))}</p>`,
      footer: `<button class="btn ghost" data-close2>${esc(T('common.cancel'))}</button>
        <button class="btn danger" data-ai-keydel>${esc(T('ai.keyRemove'))}</button>
        <button class="btn primary" data-ai-keysave>${esc(T('common.save'))}</button>`,
      onOpen: (m, close) => {
        m.querySelector('[data-close2]').onclick = close;
        m.querySelector('[data-ai-keydel]').onclick = () => { setKey(''); close(); if (root) syncState(root); UI.toast(T('ai.keyCleared'), 'success'); };
        m.querySelector('[data-ai-keysave]').onclick = () => {
          setKey(m.querySelector('#aiKeyIn').value.trim());
          close(); if (root) syncState(root); UI.toast(T('ai.keySaved'), 'success');
        };
      }
    });
  }

  // The language the coach picked in the app, spelled out for the model. Read at
  // ASK time, so switching language mid-session takes effect on the next answer.
  function langLines() {
    const da = window.I18N && I18N.getLang() === 'da';
    const lang = da ? 'Danish' : 'English';
    return [
      `Write your entire answer in ${lang} — this is the language the coach selected in the app.`,
      `Use ${lang} for every heading, label, list item and caption, even when the data you are given is in another language.`,
      da ? 'Svar udelukkende på dansk.' : 'Answer only in English.'
    ];
  }

  // One-shot call for other views (e.g. the drill generator) — no chat history, no team data.
  async function complete(system, user, maxTokens) {
    const key = getKey();
    if (!key) { keyDialog(); return null; }
    if (navigator.onLine === false) { UI.toast(T('ai.offline'), 'error'); return null; }
    // Every caller gets the language rule, whatever prompt it built.
    const sys = langLines().join('\n') + '\n' + String(system || '');
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
        body: JSON.stringify({
          model: MODEL, temperature: 0.7, max_tokens: maxTokens || 600,
          messages: [{ role: 'system', content: sys }, { role: 'user', content: user }]
        })
      });
      if (!res.ok) {
        UI.toast(res.status === 401 ? T('ai.badKey') : res.status === 429 ? T('ai.rate') : `${T('ai.failed')} (${res.status})`, 'error');
        return null;
      }
      const data = await res.json();
      return String((data.choices && data.choices[0] && data.choices[0].message.content) || '').trim();
    } catch (e) {
      UI.toast(T('ai.failed'), 'error');
      return null;
    }
  }

  // One-shot answer shown in its own dialog — same team data, language and
  // link rules as the panel, but nothing is added to a conversation.
  // opts.actions = [{label, cls, onClick(text, close)}] — extra footer buttons,
  // disabled until the answer has actually arrived.
  async function report(opts) {
    if (!getKey()) { keyDialog(); return; }
    let body = null, actionBtns = [];
    const acts = Array.isArray(opts.actions) ? opts.actions : [];
    let answer = '';
    UI.modal({
      title: opts.title,
      width: 720,
      body: `<div class="ai-text" data-report><p class="ai-dots">${esc(T('ai.asking'))}</p></div>`,
      footer: `<button class="btn ${acts.length ? 'ghost' : 'primary'}" data-close2>${esc(acts.length ? T('common.cancel') : T('common.close'))}</button>`
        + acts.map((a, i) => `<button class="btn ${a.cls || 'primary'}" data-act="${i}" disabled>${esc(a.label)}</button>`).join(''),
      onOpen: (m, close) => {
        body = m.querySelector('[data-report]');
        m.querySelector('[data-close2]').onclick = close;
        actionBtns = [...m.querySelectorAll('[data-act]')];
        actionBtns.forEach(b => b.onclick = () => acts[+b.dataset.act].onClick(answer, close));
      }
    });
    const text = await complete(systemPrompt(), opts.task, opts.maxTokens || 900);
    if (!body || !body.isConnected) return;
    answer = text || '';
    // opts.hide strips a machine-readable trailer the coach should not have to read.
    const shown = text && opts.hide ? text.replace(opts.hide, '').trim() : text;
    body.innerHTML = shown ? fmt(shown) : `<p>${esc(T('ai.noAnswer'))}</p>`;
    if (text) actionBtns.forEach(b => { b.disabled = false; });
  }

  // The club's own drill videos, for prompts that should hand the coach a link.
  function videos() {
    const safe = u => {
      const s = String(u || '').trim();
      if (!s) return '';
      try { const p = new URL(s); return (p.protocol === 'http:' || p.protocol === 'https:') ? p.href : ''; }
      catch (e) { return ''; }
    };
    return Store.all('exercises')
      .map(e => ({ title: e.title, url: safe((e.videos || [])[0]) || safe(e.videoYt) || safe(e.videoUrl) }))
      .filter(e => e.url).slice(0, 30);
  }

  // A model will happily invent a YouTube address that 404s. YouTube's oEmbed
  // endpoint answers 200 with the real title for a video that exists and 404 for
  // one that does not, and it allows cross-origin reads — so a suggested link is
  // only kept when it actually resolves.
  const ytChecked = new Map();
  async function checkVideo(url) {
    const u = String(url || '').trim();
    if (!u || !/^https:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\//i.test(u)) return null;
    if (ytChecked.has(u)) return ytChecked.get(u);
    if (navigator.onLine === false) return null;
    let out = null;
    try {
      const r = await fetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent(u), { cache: 'no-store' });
      if (r.ok) {
        const j = await r.json();
        if (j && j.title) out = { url: u, title: String(j.title).slice(0, 120) };
      }
    } catch (e) { out = null; }        // offline or blocked — treat as unverified
    ytChecked.set(u, out);
    return out;
  }
  // Takes the addresses a model suggested and returns the first that really
  // exists, or '' when none do.
  async function pickVideo(list) {
    for (const u of (list || []).slice(0, 5)) {
      const ok = await checkVideo(u);
      if (ok) return ok.url;
    }
    return '';
  }

  // A live web search, folded into a drill/session prompt as one more source
  // alongside the club's own data. Silent on failure — the generator still
  // works from the club's own information alone.
  const SEARCH_MODEL = 'gpt-5-search-api';
  async function webFindings(query) {
    const key = getKey();
    if (!key || navigator.onLine === false || !String(query || '').trim()) return '';
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
        body: JSON.stringify({
          model: SEARCH_MODEL,
          web_search_options: {},
          messages: [
            { role: 'system', content: 'Search the web for this. Answer in short, concrete bullet points only — no preamble, max 150 words.' },
            { role: 'user', content: String(query).slice(0, 300) }
          ]
        })
      });
      if (!res.ok) return '';
      const data = await res.json();
      const msg = data && data.choices && data.choices[0] && data.choices[0].message;
      const text = String((msg && msg.content) || '').trim();
      if (!text) return '';
      // The sources the search just cited are worth keeping alongside the summary.
      const urls = [...new Set((msg.annotations || []).map(a => a && a.url_citation && a.url_citation.url).filter(Boolean))].slice(0, 5);
      return text + (urls.length ? '\nSources: ' + urls.join(', ') : '');
    } catch (e) { return ''; }
  }

  function helpDialog() {
    const li = k => `<li>${esc(T(k))}</li>`;
    UI.modal({
      title: T('ai.helpTitle'),
      width: 640,
      body: `<p>${esc(T('ai.helpIntro'))}</p>
        <h4>${esc(T('ai.helpStepsTitle'))}</h4>
        <p><a class="btn sm primary" href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">${esc(T('ai.helpLink'))}</a></p>
        <ol class="ai-guide ai-steps">${['ai.helpS1', 'ai.helpS2', 'ai.helpS3', 'ai.helpS4', 'ai.helpS5', 'ai.helpS6'].map(li).join('')}</ol>
        <p class="ai-ready">${esc(T('ai.helpReady'))}</p>
        <h4>${esc(T('ai.helpCostTitle'))}</h4>
        <p>${esc(T('ai.helpCost'))}</p>
        <h4>${esc(T('ai.helpSafeTitle'))}</h4>
        <p>${esc(T('ai.helpSafe'))}</p>
        <h4>${esc(T('ai.helpTroubleTitle'))}</h4>
        <ul class="ai-guide">${['ai.helpT1', 'ai.helpT2', 'ai.helpT3'].map(li).join('')}</ul>
        <p class="hint">${esc(T('ai.helpPrivacy'))}</p>`,
      footer: `<button class="btn primary" data-close2>${esc(T('common.close'))}</button>`,
      onOpen: (m, close) => { m.querySelector('[data-close2]').onclick = close; }
    });
  }

  // ---- Public: markup + wiring ----
  function section(topic = 'play') {
    const t = TOPICS.indexOf(topic) > -1 ? topic : 'play';
    return `
      <section class="card ai-card" data-ai="${t}">
        <div class="ai-head">
          <div class="ai-title"><span class="ai-ico">🤖</span>
            <div><h3>${esc(T('ai.title'))}</h3><p>${esc(T('ai.subtitle'))}</p></div>
          </div>
          <div class="ai-head-acts">
            <button class="btn sm" data-ai-help type="button">❔ ${esc(T('ai.help'))}</button>
            <button class="btn sm" data-ai-key type="button">🔑 ${esc(T('ai.key'))}</button>
            <button class="btn sm" data-ai-clear type="button">${esc(T('ai.clear'))}</button>
          </div>
        </div>
        <div class="ai-topics">
          ${TOPICS.map(k => `<button class="pill" type="button" data-ai-topic="${k}">${esc(T('ai.t.' + k))}</button>`).join('')}
        </div>
        <div class="ai-log" data-ai-log></div>
        <div class="ai-ask">
          <textarea data-ai-input rows="2" placeholder="${esc(T('ai.placeholder'))}"></textarea>
          <button class="btn primary" data-ai-send type="button">${esc(T('ai.ask'))}</button>
        </div>
        <p class="hint" data-ai-nokey hidden>${esc(T('ai.noKey'))}</p>
        <p class="hint">${esc(T('ai.dataHint'))}</p>
      </section>`;
  }

  // Wires every AI panel inside `host` (call right after setting innerHTML).
  function bind(host) {
    host.querySelectorAll('[data-ai]').forEach(root => {
      const input = root.querySelector('[data-ai-input]');
      root.querySelector('[data-ai-help]').onclick = () => helpDialog();
      root.querySelector('[data-ai-key]').onclick = () => keyDialog(root);
      root.querySelector('[data-ai-clear]').onclick = () => { chats[root.dataset.ai] = []; renderLog(root); };
      root.querySelector('[data-ai-send]').onclick = () => { const q = input.value; input.value = ''; ask(root, q); };
      input.onkeydown = e => {
        if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
        e.preventDefault();
        const q = input.value; input.value = ''; ask(root, q);
      };
      root.querySelectorAll('[data-ai-topic]').forEach(b => b.onclick = () => {
        root.dataset.ai = b.dataset.aiTopic;
        renderLog(root); syncState(root);
        ask(root, T('ai.q.' + b.dataset.aiTopic));
      });
      renderLog(root);
      syncState(root);
    });
  }

  return {
    section, bind, complete, report, videos, render: fmt, checkVideo, pickVideo, webFindings,
    keyDialog: () => keyDialog(), hasKey: () => !!getKey()
  };
})();
