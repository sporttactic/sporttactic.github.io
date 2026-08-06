/* mail.js — write an e-mail to one player or the whole squad and choose exactly
   which of their own data travels with it.

   Nothing is sent by SportTactic: the message is handed to the device's own mail
   client through a `mailto:` link, so the coach sees and sends it themselves and
   no address or personal data ever leaves the device on its own. Large exports
   are written to a file instead, because mail clients silently truncate long
   `mailto:` bodies. */
const MAIL = (() => {
  const MAX_BODY = 1800;   // mailto: bodies are truncated well before this in some clients
  const MAX_TO = 50;

  const esc = s => UI.esc(s);
  const t = (k, fallback) => { const r = T(k); return r === k ? fallback : r; };

  // Deliberately permissive: the mail client is the real validator.
  function normEmail(v) {
    const s = String(v == null ? '' : v).trim();
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) ? s : '';
  }
  function withEmail(list) { return (list || []).filter(p => normEmail(p.email)); }
  const label = p => ('#' + (p.number || '?') + ' ' + [p.firstName, p.lastName].filter(Boolean).join(' ')).trim();
  const dt = v => { const d = new Date(v); return isNaN(d) ? '' : d.toISOString().slice(0, 10); };

  // ---- The data blocks a coach can attach --------------------------------
  // Each returns plain text; an empty string means "nothing to say", and the
  // block is then left out of the message entirely.
  const BLOCKS = [
    {
      id: 'profile', key: 'mail.dProfile', def: 'Player profile', perPlayer: true,
      build: p => [
        t('teams.number', 'No.') + ': ' + (p.number || '—'),
        t('teams.position', 'Position') + ': ' + (p.position || '—'),
        t('teams.height', 'Height') + ': ' + (p.height ? p.height + ' cm' : '—'),
        t('teams.weight', 'Weight') + ': ' + (p.weight ? p.weight + ' kg' : '—'),
        t('teams.status', 'Status') + ': ' + (p.status || 'active')
      ].join('\n')
    },
    {
      id: 'stats', key: 'mail.dStats', def: 'Season statistics', perPlayer: true,
      build: p => {
        const s = Store.playerStats(p.id) || {};
        return [
          t('sms.goals', 'goals') + ': ' + (s.goals || 0),
          t('sms.assists', 'assists') + ': ' + (s.assists || 0),
          t('sms.turnovers', 'turnovers') + ': ' + (s.turnovers || 0),
          t('sms.rating', 'rating') + ': ' + (s.rating != null ? s.rating : '—')
        ].join('\n');
      }
    },
    {
      id: 'injury', key: 'mail.dInjury', def: 'Injury note',
      sensitive: true, perPlayer: true,
      build: p => (p.status === 'injured' && p.injuryNote) ? p.injuryNote : ''
    },
    {
      id: 'tests', key: 'mail.dTests', def: 'Personal tests & max results', perPlayer: true,
      build: p => Store.scoped('personal').filter(r => r.playerId === p.id).slice(-6)
        .map(r => dt(r.date) + ' · ' + (r.tests || []).map(x => x.name + ' ' + x.value + ' ' + (x.unit || '')).join(', ')).join('\n')
    },
    {
      id: 'training', key: 'mail.dTraining', def: 'Training plan',
      build: () => Store.scoped('training').slice(-8)
        .map(s => dt(s.date) + ' · ' + (s.title || '')).join('\n')
    },
    {
      id: 'matches', key: 'mail.dMatches', def: 'Match results',
      build: () => Store.matches().slice(-8)
        .map(m => dt(m.date) + ' · ' + (m.opponent || '') + ' ' + (m.homeScore != null ? m.homeScore + ':' + m.awayScore : '')).join('\n')
    },
    {
      id: 'squad', key: 'mail.dSquad', def: 'Squad list',
      build: () => Store.players().map(x => label(x) + ' — ' + (x.position || '')).join('\n')
    },
    {
      id: 'tactics', key: 'mail.dTactics', def: 'Saved animations',
      build: () => Store.all('tactics').filter(x => x.kind === 'system').map(x => '★ ' + x.name).join('\n')
    }
  ];

  function buildText(player, message, picked) {
    const parts = [];
    if (message) parts.push(message);
    for (const b of BLOCKS) {
      if (picked.indexOf(b.id) < 0) continue;
      let body = '';
      try { body = String(b.build(player) || '').trim(); } catch { body = ''; }
      if (body) parts.push('— ' + t(b.key, b.def) + ' —\n' + body);
    }
    return parts.join('\n\n');
  }

  // The full, untruncated payload for coaches who need everything.
  function buildFile(players, message, picked) {
    return {
      app: 'SportTactic', kind: 'player-report', format: 1,
      exportedAt: new Date().toISOString(),
      message: message,
      players: players.map(p => ({
        name: label(p), email: normEmail(p.email),
        data: picked.reduce((acc, id) => {
          const b = BLOCKS.find(x => x.id === id);
          if (b) { const v = String(b.build(p) || '').trim(); if (v) acc[id] = v; }
          return acc;
        }, {})
      }))
    };
  }

  function download(obj, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' }));
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 20000);
  }

  // ---- Which mail client the message is handed to ------------------------
  // A browser cannot speak SMTP, so SportTactic never sends anything itself.
  // It either hands the message to the system mail app (mailto:) or opens the
  // web compose window of a webmail service with everything filled in.
  // Device preference, so it is read synchronously and stays out of backups.
  const K_PROV = 'stx_mail_provider';
  const K_NAME = 'stx_mail_name';
  const K_SIGN = 'stx_mail_sign';
  const PROVIDERS = {
    system: { key: 'mail.pSystem', def: 'System mail app (Outlook, Mail, Thunderbird\u2026)' },
    gmail: { key: 'mail.pGmail', def: 'Gmail in the browser' },
    outlook: { key: 'mail.pOutlook', def: 'Outlook.com / Hotmail in the browser' },
    office: { key: 'mail.pOffice', def: 'Microsoft 365 / Exchange webmail' },
    yahoo: { key: 'mail.pYahoo', def: 'Yahoo Mail in the browser' },
    icloud: { key: 'mail.pIcloud', def: 'iCloud Mail (opens the system app)' }
  };
  function read(k) { try { return localStorage.getItem(k) || ''; } catch { return ''; } }
  function write(k, v) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch { /* private mode */ } }
  const getProvider = () => { const p = read(K_PROV); return PROVIDERS[p] ? p : 'system'; };
  const getSenderName = () => read(K_NAME);
  const getSignature = () => read(K_SIGN);
  function providerLabel() { const p = PROVIDERS[getProvider()]; return t(p.key, p.def); }

  // iCloud has no documented web-compose address, so it uses the system app.
  function composeUrl(to, subject, body) {
    const q = {
      to: encodeURIComponent(to),
      su: encodeURIComponent(subject),
      bo: encodeURIComponent(body)
    };
    switch (getProvider()) {
      case 'gmail':
        return `https://mail.google.com/mail/?view=cm&fs=1&to=${q.to}&su=${q.su}&body=${q.bo}`;
      case 'outlook':
        return `https://outlook.live.com/mail/0/deeplink/compose?to=${q.to}&subject=${q.su}&body=${q.bo}`;
      case 'office':
        return `https://outlook.office.com/mail/deeplink/compose?to=${q.to}&subject=${q.su}&body=${q.bo}`;
      case 'yahoo':
        return `https://compose.mail.yahoo.com/?to=${q.to}&subject=${q.su}&body=${q.bo}`;
      default:
        return `mailto:${q.to}?subject=${q.su}&body=${q.bo}`;
    }
  }
  function handOff(to, subject, body) {
    const url = composeUrl(to, subject, body);
    if (url.indexOf('mailto:') === 0) { window.location.href = url; return true; }
    // A webmail compose window is a normal navigation, so pop-up blockers apply.
    const w = window.open(url, '_blank', 'noopener,noreferrer');
    if (!w) { UI.toast(t('mail.popupBlocked', 'Allow pop-ups for this site, or choose the system mail app in Settings'), 'error'); return false; }
    return true;
  }

  // ---- Account setup -----------------------------------------------------
  // onDone runs after the dialog closes so a caller can refresh its status tag.
  function setupDialog(onDone) {
    const prov = getProvider();
    UI.modal({
      title: t('mail.setup', 'Mail setup'),
      width: 620,
      body: `<p>${esc(t('mail.setupIntro', 'SportTactic never sends mail on its own \u2014 it fills in a message and hands it to the mail you already use. Pick which one.'))}</p>
        <label class="field"><span>${esc(t('mail.provider', 'Send with'))}</span>
          <select id="ml_prov">${Object.keys(PROVIDERS).map(k => `<option value="${k}" ${k === prov ? 'selected' : ''}>${esc(t(PROVIDERS[k].key, PROVIDERS[k].def))}</option>`).join('')}</select>
          <span class="hint">${esc(t('mail.providerHint', 'The system app works everywhere \u2014 Windows Mail, Outlook, Apple Mail, Thunderbird or Evolution. The webmail options open a compose window in a new tab instead.'))}</span></label>
        <label class="field"><span>${esc(t('mail.senderName', 'Your name'))}</span>
          <input id="ml_name" maxlength="60" value="${esc(getSenderName())}" placeholder="${esc(t('mail.senderNamePh', 'Coach Steen'))}"></label>
        <label class="field"><span>${esc(t('mail.signature', 'Signature'))}</span>
          <textarea id="ml_sign" rows="3" maxlength="300" placeholder="${esc(t('mail.signaturePh', 'Metropolis HC \u2014 see you at training'))}">${esc(getSignature())}</textarea>
          <span class="hint">${esc(t('mail.signatureHint', 'Added to the bottom of every message SportTactic writes for you.'))}</span></label>
        <p class="hint">${esc(t('mail.setupPrivacy', 'No password is asked for and none is stored. Your mail account stays entirely between you and your mail provider.'))}</p>`,
      footer: `<button class="btn ghost" data-close2>${esc(T('common.cancel'))}</button>
        <button class="btn" data-servers>${esc(t('mail.serverBtn', 'Mail server settings'))}</button>
        <button class="btn" data-test>${esc(t('mail.test', 'Send a test'))}</button>
        <button class="btn primary" data-save>${esc(T('common.save'))}</button>`,
      onOpen: (m, close) => {
        const done = () => { close(); if (typeof onDone === 'function') onDone(); };
        const persist = () => {
          write(K_PROV, m.querySelector('#ml_prov').value);
          write(K_NAME, m.querySelector('#ml_name').value.trim().slice(0, 60));
          write(K_SIGN, m.querySelector('#ml_sign').value.trim().slice(0, 300));
        };
        m.querySelector('[data-close2]').onclick = close;
        m.querySelector('[data-servers]').onclick = () => { close(); serverGuide(); };
        m.querySelector('[data-test]').onclick = () => {
          persist();
          handOff('', t('mail.testSubject', 'SportTactic test'), t('mail.testBody', 'This is a test message from SportTactic.') + signature());
        };
        m.querySelector('[data-save]').onclick = () => { persist(); done(); UI.toast(t('mail.setupSaved', 'Mail setup saved'), 'success'); };
      }
    });
  }

  function signature() {
    const parts = [getSenderName(), getSignature()].filter(Boolean);
    return parts.length ? '\n\n--\n' + parts.join('\n') : '';
  }

  // ---- Mail server reference --------------------------------------------
  // For the coach's own desktop or phone client — the browser cannot use these.
  const SERVERS = [
    ['Gmail / Google Workspace', 'imap.gmail.com : 993 (SSL/TLS)', 'pop.gmail.com : 995 (SSL/TLS)', 'smtp.gmail.com : 465 (SSL) or 587 (STARTTLS)', 'mail.srvGmail'],
    ['Outlook.com / Hotmail', 'outlook.office365.com : 993 (SSL/TLS)', 'outlook.office365.com : 995 (SSL/TLS)', 'smtp-mail.outlook.com : 587 (STARTTLS)', 'mail.srvOutlook'],
    ['Microsoft 365 / Exchange Online', 'outlook.office365.com : 993 (SSL/TLS)', 'outlook.office365.com : 995 (SSL/TLS)', 'smtp.office365.com : 587 (STARTTLS)', 'mail.srvOffice'],
    ['iCloud Mail', 'imap.mail.me.com : 993 (SSL/TLS)', '\u2014', 'smtp.mail.me.com : 587 (STARTTLS)', 'mail.srvIcloud'],
    ['Exchange (on-premises)', 'mail.<yourclub>.dk : 993 (SSL/TLS)', 'mail.<yourclub>.dk : 995 (SSL/TLS)', 'mail.<yourclub>.dk : 587 (STARTTLS)', 'mail.srvExchange']
  ];
  function serverGuide() {
    const li = (k, f) => `<li>${esc(t(k, f))}</li>`;
    UI.modal({
      title: t('mail.serverTitle', 'Mail server settings'),
      width: 760,
      body: `<p>${esc(t('mail.serverIntro', 'These are for the mail program on your computer or phone \u2014 a browser cannot talk to a mail server itself. Set your account up once there, and SportTactic simply hands its messages to it.'))}</p>
        <div class="table-wrap"><table>
          <thead><tr><th>${esc(t('mail.srvProvider', 'Provider'))}</th><th>IMAP</th><th>POP3</th><th>SMTP</th></tr></thead>
          <tbody>${SERVERS.map(r => `<tr><td><b>${esc(r[0])}</b><div class="hint" style="margin:2px 0 0">${esc(t(r[4], ''))}</div></td>
            <td>${esc(r[1])}</td><td>${esc(r[2])}</td><td>${esc(r[3])}</td></tr>`).join('')}</tbody>
        </table></div>
        <h4>${esc(t('mail.imapPopTitle', 'IMAP or POP?'))}</h4>
        <p>${esc(t('mail.imapPop', 'Use IMAP unless you have a reason not to: the mail stays on the server and every device sees the same mailbox. POP downloads the mail to one machine and usually deletes it from the server \u2014 fine for an old club PC that must keep an offline archive, awkward for everything else.'))}</p>
        <h4>${esc(t('mail.osTitle', 'Making it the default'))}</h4>
        <ul class="ai-guide">
          ${li('mail.osWin', 'Windows: Settings \u2192 Apps \u2192 Default apps \u2192 set Outlook (or Mail) as the handler for MAILTO.')}
          ${li('mail.osMac', 'macOS: Mail \u2192 Settings \u2192 General \u2192 Default email reader.')}
          ${li('mail.osLinux', 'Linux: install Thunderbird or Evolution, then run  xdg-settings set default-url-scheme-handler mailto thunderbird.desktop')}
          ${li('mail.osIos', 'iPhone / iPad: Settings \u2192 Apps \u2192 Mail \u2192 Default Mail App.')}
        </ul>
        <h4>${esc(t('mail.pwTitle', 'Passwords'))}</h4>
        <ul class="ai-guide">
          ${li('mail.pw1', 'Gmail and iCloud reject your normal password from a mail program when two-factor login is on. Create an app password instead \u2014 Google Account \u2192 Security \u2192 App passwords, or appleid.apple.com \u2192 Sign-In and Security.')}
          ${li('mail.pw2', 'Microsoft 365 uses modern authentication: the mail program opens a Microsoft sign-in window instead of asking for a password. If it asks for one anyway, your admin has to allow it.')}
          ${li('mail.pw3', 'For a club Exchange server, ask whoever runs it for the server name \u2014 the autodiscover record usually fills the rest in for you.')}
        </ul>
        <p class="hint">${esc(t('mail.serverPrivacy', 'SportTactic never asks for, stores or transmits a mail password. Nothing on this page is sent anywhere.'))}</p>`,
      footer: `<button class="btn" data-back>${esc(t('mail.setup', 'Mail setup'))}</button>
        <button class="btn primary" data-close2>${esc(T('common.close'))}</button>`,
      onOpen: (m, close) => {
        m.querySelector('[data-close2]').onclick = close;
        m.querySelector('[data-back]').onclick = () => { close(); setupDialog(); };
      }
    });
  }

  // ---- Compose dialog ----------------------------------------------------
  // compose({ players, subject, text, title })
  function compose(opts) {
    opts = opts || {};
    const all = (opts.players || []).slice(0, 200);
    const able = withEmail(all);
    const missing = all.length - able.length;

    if (!all.length) return UI.toast(t('mail.noPlayers', 'No players to write to'), 'error');
    if (!able.length) {
      return UI.modal({
        title: t('mail.title', 'Send e-mail'),
        body: `<p>${esc(t('mail.noAddresses', 'None of these players has an e-mail address yet.'))}</p>
          <p class="hint">${esc(t('mail.addAddressHint', 'Add one under Teams & Players \u2014 edit the player and fill in E-mail.'))}</p>`,
        footer: `<button class="btn primary" data-close2>${esc(T('common.close'))}</button>`,
        onOpen: (m, close) => { m.querySelector('[data-close2]').onclick = close; }
      });
    }

    UI.modal({
      title: opts.title || t('mail.title', 'Send e-mail'),
      width: 660,
      body: `
        <label class="field"><span>${esc(t('mail.recipients', 'Recipients'))}</span></label>
        <div class="sms-list">
          ${able.map((p, i) => `<label class="sms-row"><input type="checkbox" data-to="${esc(normEmail(p.email))}" data-pid="${esc(p.id)}" ${i < MAX_TO ? 'checked' : ''}>
            <span class="sms-name">${esc(label(p))}</span><span class="sms-num">${esc(normEmail(p.email))}</span></label>`).join('')}
        </div>
        ${missing ? `<p class="hint">${esc(t('mail.someMissing', 'Players without an e-mail address are not listed') + ': ' + missing)}</p>` : ''}
        <label class="field"><span>${esc(t('mail.subject', 'Subject'))}</span>
          <input id="mail_subj" maxlength="120" value="${esc(opts.subject || t('mail.subjectDef', 'From your coach'))}"></label>
        <label class="field"><span>${esc(t('mail.message', 'Message'))}</span>
          <textarea id="mail_body" rows="6" maxlength="4000" placeholder="${esc(t('mail.messagePh', 'Write your message\u2026'))}">${esc(opts.text || '')}</textarea></label>
        <label class="field"><span>${esc(t('mail.include', 'Data to send with it'))}</span></label>
        <div class="mail-picker">
          ${BLOCKS.map(b => `<label class="check-row"><input type="checkbox" data-blk="${b.id}"><span>${esc(t(b.key, b.def))}</span></label>`).join('')}
        </div>
        <p class="hint">${esc(t('mail.privacy', 'Injury notes are health data. Only send them to the player they belong to, and never to the whole squad.'))}</p>
        <p class="hint">${esc(t('mail.howHint', 'Send opens your own mail app with everything filled in \u2014 nothing is sent by SportTactic. Long exports are saved as a file you attach yourself.'))} · ${esc(providerLabel())}</p>`,
      footer: `<button class="btn ghost" data-close2>${esc(T('common.cancel'))}</button>
        <button class="btn" data-setup>${esc(t('mail.setup', 'Mail setup'))}</button>
        <button class="btn" data-file>${esc(t('mail.saveFile', 'Save data file'))}</button>
        <button class="btn primary" data-send>${esc(t('mail.send', 'Open in mail app'))}</button>`,
      onOpen: (m, close) => {
        const picked = () => [...m.querySelectorAll('[data-blk]:checked')].map(c => c.dataset.blk);
        const rows = () => [...m.querySelectorAll('[data-to]:checked')].slice(0, MAX_TO);
        const chosen = () => rows().map(c => all.find(p => p.id === c.dataset.pid)).filter(Boolean);
        const subject = () => m.querySelector('#mail_subj').value.trim();
        const message = () => m.querySelector('#mail_body').value.trim();

        m.querySelector('[data-close2]').onclick = close;
        m.querySelector('[data-setup]').onclick = () => { close(); setupDialog(); };

        m.querySelector('[data-file]').onclick = () => {
          const people = chosen();
          if (!people.length) return UI.toast(t('mail.pickOne', 'Pick at least one player'), 'error');
          download(buildFile(people, message(), picked()), 'sporttactic-player-data-' + new Date().toISOString().slice(0, 10) + '.json');
          UI.toast(t('mail.fileSaved', 'Data file saved \u2014 attach it to the mail'), 'success');
        };

        m.querySelector('[data-send]').onclick = () => {
          const people = chosen();
          if (!people.length) return UI.toast(t('mail.pickOne', 'Pick at least one player'), 'error');
          if (!subject()) return UI.toast(t('mail.needSubject', 'Write a subject first'), 'error');
          const blocks = picked();
          // One recipient gets their own numbers; a group only gets the shared blocks,
          // so nobody receives another player's profile, tests or injury note.
          const useBlocks = people.length === 1 ? blocks : blocks.filter(id => !(BLOCKS.find(b => b.id === id) || {}).perPlayer);
          let body = buildText(people[0], message(), useBlocks) + signature();
          let truncated = false;
          if (body.length > MAX_BODY) { body = body.slice(0, MAX_BODY) + '\n\u2026'; truncated = true; }
          const to = people.map(p => normEmail(p.email)).join(',');
          close();
          if (truncated) UI.toast(t('mail.tooLong', 'The message was shortened \u2014 use Save data file for the full export'), 'error');
          handOff(to, subject(), body);
        };
      }
    });
  }

  // Markup for the button every view mounts, so they all look the same.
  function btn(attr, text, cls) {
    return `<button class="btn ${cls || 'sm'}" ${attr}>\u2709 ${esc(text || t('mail.mail', 'Mail'))}</button>`;
  }

  return { compose, btn, normEmail, withEmail, setupDialog, serverGuide, providerLabel };
})();
if (typeof window !== 'undefined') window.MAIL = MAIL;
