/* mail.js — write an e-mail to one player or the whole squad and choose exactly
   which of their own data travels with it.

   Mail leaves through the club's OWN relay (Settings → Mail server settings):
   a browser cannot open an SMTP socket, so the message is posted to a small
   https endpoint that owns the SMTP login. No mail app is ever opened, and each
   recipient gets their own message so nobody sees another player's address. */
const MAIL = (() => {
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
          t('stat.goals', 'Goals') + ': ' + (s.goals || 0),
          t('stat.assists', 'Assists') + ': ' + (s.assists || 0),
          t('stat.turnovers', 'Turnovers') + ': ' + (s.turnovers || 0),
          t('stat.mvpRating', 'MVP Rating') + ': ' + (s.rating != null ? s.rating : '—')
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

  // ---- Sender identity ---------------------------------------------------
  // Device preferences, so they are read synchronously and stay out of backups.
  // There is no "which mail app" choice any more: everything leaves through the
  // club's own relay, so a message is either sent or it is not.
  const K_NAME = 'stx_mail_name';
  const K_SIGN = 'stx_mail_sign';
  function read(k) { try { return localStorage.getItem(k) || ''; } catch { return ''; } }
  function write(k, v) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch { /* private mode */ } }
  const getSenderName = () => read(K_NAME);
  const getSignature = () => read(K_SIGN);

  // ---- Account setup -----------------------------------------------------
  // onDone runs after the dialog closes so a caller can refresh its status tag.
  function setupDialog(onDone) {
    UI.modal({
      title: t('mail.setup', 'Mail setup'),
      width: 620,
      body: `<p>${esc(t('mail.setupIntro', 'The name and signature SportTactic puts on the messages it writes for you. Where they are sent from is set under Mail server settings.'))}</p>
        <label class="field"><span>${esc(t('mail.senderName', 'Your name'))}</span>
          <input id="ml_name" maxlength="60" value="${esc(getSenderName())}" placeholder="${esc(t('mail.senderNamePh', 'Coach Steen'))}"></label>
        <label class="field"><span>${esc(t('mail.signature', 'Signature'))}</span>
          <textarea id="ml_sign" rows="3" maxlength="300" placeholder="${esc(t('mail.signaturePh', 'Metropolis HC \u2014 see you at training'))}">${esc(getSignature())}</textarea>
          <span class="hint">${esc(t('mail.signatureHint', 'Added to the bottom of every message SportTactic writes for you.'))}</span></label>
        <p class="hint">${esc(t('mail.setupPrivacy', 'No password is asked for and none is stored. Your mail account stays entirely between you and your mail provider.'))}</p>`,
      footer: `<button class="btn ghost" data-close2>${esc(T('common.cancel'))}</button>
        <button class="btn" data-servers>${esc(t('mailsrv.title', 'Mail server settings'))}</button>
        <button class="btn primary" data-save>${esc(T('common.save'))}</button>`,
      onOpen: (m, close) => {
        m.querySelector('[data-close2]').onclick = close;
        m.querySelector('[data-servers]').onclick = () => { close(); serverDialog(); };
        m.querySelector('[data-save]').onclick = () => {
          write(K_NAME, m.querySelector('#ml_name').value.trim().slice(0, 60));
          write(K_SIGN, m.querySelector('#ml_sign').value.trim().slice(0, 300));
          close();
          UI.toast(t('mail.setupSaved', 'Mail setup saved'), 'success');
          if (typeof onDone === 'function') onDone();
        };
      }
    });
  }

  function signature(sender) {
    const parts = [(sender && sender.name) || getSenderName(), getSignature()].filter(Boolean);
    return parts.length ? '\n\n--\n' + parts.join('\n') : '';
  }

  // ---- Sending: EmailJS ---------------------------------------------------
  // A browser may not open an SMTP socket, so the message is handed to EmailJS,
  // which exists for exactly that. Device settings, so localStorage — and no
  // password is ever asked for, so there is nothing here worth stealing.
  const S = {
    addr: 'stx_mailsrv_addr',
    ejService: 'stx_emailjs_service', ejTemplate: 'stx_emailjs_template', ejKey: 'stx_emailjs_key'
  };
  // The IMAP/POP3/SMTP form and the self-hosted relay are gone; clear what they left.
  ['stx_mailsrv_preset', 'stx_mailsrv_auth', 'stx_mailsrv_inproto', 'stx_mailsrv_inhost',
    'stx_mailsrv_inport', 'stx_mailsrv_insec', 'stx_mailsrv_inuser', 'stx_mailsrv_outhost',
    'stx_mailsrv_outport', 'stx_mailsrv_outsec', 'stx_mailsrv_outuser', 'stx_mailsrv_url',
    'stx_mailsrv_mode'].forEach(k => write(k, ''));

  const EMAILJS_API = 'https://api.emailjs.com/api/v1.0/email/send';
  const EMAILJS_SITE = 'https://www.emailjs.com/';

  function serverSettings() {
    return { addr: read(S.addr), ejService: read(S.ejService), ejTemplate: read(S.ejTemplate), ejKey: read(S.ejKey) };
  }
  const canSendDirect = () => !!(read(S.ejService) && read(S.ejTemplate) && read(S.ejKey));
  const sendDirect = (to, subject, body, sender) => sendViaEmailJs(to, subject, body, sender);

  // ---- Who the mail comes from -------------------------------------------
  // Staff members with an address can send as themselves, so a player answering
  // writes back to the coach who wrote, not to whoever set the app up.
  const K_SENDER = 'stx_mail_sender';
  function senders() {
    const list = Store.coaches().filter(c => normEmail(c.email))
      .map(c => ({ id: c.id, name: c.name || '', email: normEmail(c.email), role: c.role || '' }));
    const own = read(S.addr);
    if (own && !list.some(x => x.email === own)) {
      list.unshift({ id: '', name: getSenderName(), email: own, role: t('mail.ownAccount', 'My own account') });
    }
    return list;
  }
  function currentSender() {
    const list = senders();
    if (!list.length) return { id: '', name: getSenderName(), email: read(S.addr) };
    return list.find(x => x.id === read(K_SENDER)) || list[0];
  }

  // The public key is meant to be public — EmailJS gates abuse on the allowed
  // domain list, not on secrecy, which is why this can run from a browser at all.
  function sendViaEmailJs(to, subject, body, sender) {
    const from = sender || currentSender();
    const fromName = (from && from.name) || getSenderName() || 'SportTactic';
    const fromMail = (from && from.email) || read(S.addr) || '';
    return post(EMAILJS_API, {
      service_id: read(S.ejService),
      template_id: read(S.ejTemplate),
      user_id: read(S.ejKey),
      // The recipient is sent under every name EmailJS templates commonly use,
      // so the mail reaches the player whichever one the template was built with.
      // {{name}} is the sender, which is what most EmailJS starter templates show.
      template_params: {
        to_email: to, email: to, user_email: to, to: to, recipient: to,
        to_name: to,
        subject: subject, message: body,
        name: fromName, from_name: fromName, sender_name: fromName,
        from_email: fromMail, reply_to: fromMail
      }
    });
  }
  async function post(url, payload) {
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch (e) {
      // fetch only rejects on a network/CORS failure, and that is the usual cause.
      let host = url;
      try { host = new URL(url).host; } catch (e2) { /* show the raw string instead */ }
      throw new Error(t('mailsrv.blocked', 'The address could not be reached. Check it is correct and that it allows requests from this site.') + ' (' + host + ')');
    }
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.text()).slice(0, 200); } catch (e) { /* body already consumed */ }
      throw new Error('HTTP ' + res.status + (detail ? ' \u2014 ' + detail : ''));
    }
  }

  // ---- The setup dialog ---------------------------------------------------
  function serverDialog(onDone) {
    const s = serverSettings();
    UI.modal({
      title: t('mailsrv.title', 'E-mail sending'),
      width: 640,
      body: `<p>${esc(t('mailsrv.intro', 'A browser is not allowed to talk to a mail server, so SportTactic sends through EmailJS — a free service that connects to your own mail account and passes the message on. There is nothing to install, and your mail password never touches this device.'))}</p>
        <div class="row" style="flex:0;margin-bottom:12px;flex-wrap:wrap">
          <a class="btn sm" href="${EMAILJS_SITE}" target="_blank" rel="noopener noreferrer">emailjs.com \u2197</a>
          <button type="button" class="btn sm" id="ms_ejguide">\u2753 ${esc(t('mailsrv.ejGuide', 'How to set EmailJS up'))}</button>
        </div>
        <div class="row">
          <label class="field"><span>${esc(t('mailsrv.ejService', 'Service ID'))}</span>
            <input id="ms_ejservice" autocomplete="off" spellcheck="false" value="${esc(s.ejService)}" placeholder="service_ab12cde"></label>
          <label class="field"><span>${esc(t('mailsrv.ejTemplate', 'Template ID'))}</span>
            <input id="ms_ejtemplate" autocomplete="off" spellcheck="false" value="${esc(s.ejTemplate)}" placeholder="template_ab12cde"></label>
        </div>
        <label class="field"><span>${esc(t('mailsrv.ejKey', 'Public key'))}</span>
          <input id="ms_ejkey" autocomplete="off" spellcheck="false" value="${esc(s.ejKey)}" placeholder="AbCdEfGhIjKlMnOp">
          <span class="hint">${esc(t('mailsrv.ejHint', 'All three come from emailjs.com — Email Services, Email Templates and Account. The public key is not a secret; EmailJS blocks every site except the ones you allow.'))}</span></label>
        <label class="field"><span>${esc(t('mailsrv.address', 'Your e-mail address'))}</span>
          <input id="ms_addr" type="email" autocomplete="off" spellcheck="false" value="${esc(s.addr)}" placeholder="traener@klub.dk">
          <span class="hint">${esc(t('mailsrv.addrHint', 'Set as reply-to on every mail, so a player answering writes back to you. The test below is sent here.'))}</span></label>
        <p class="hint mail-note">${esc(t('mailsrv.ejToNote', 'In the EmailJS template, the To Email field must contain {{to_email}} — nothing else. If it holds your own address, every mail is sent to you instead of to the player.'))}</p>`,
      footer: `<button class="btn ghost" data-close2>${esc(T('common.cancel'))}</button>
        <button class="btn" data-test>${esc(t('mailsrv.test', 'Send a test'))}</button>
        <button class="btn primary" data-save>${esc(T('common.save'))}</button>`,
      onOpen: (m, close) => {
        const q = id => m.querySelector('#' + id);
        const persist = () => {
          write(S.ejService, q('ms_ejservice').value.trim().slice(0, 80));
          write(S.ejTemplate, q('ms_ejtemplate').value.trim().slice(0, 80));
          write(S.ejKey, q('ms_ejkey').value.trim().slice(0, 120));
        };

        m.querySelector('[data-close2]').onclick = close;
        q('ms_ejguide').onclick = () => { close(); emailJsGuide(); };

        // One mail to yourself is the only end-to-end check a browser can run.
        m.querySelector('[data-test]').onclick = async () => {
          const addr = normEmail(q('ms_addr').value.trim());
          if (!addr) return UI.toast(t('mailsrv.needAddr', 'Write your own e-mail address first — the test is sent there'), 'error');
          write(S.addr, addr);
          persist();
          if (!canSendDirect()) return UI.toast(t('mailsrv.needEj', 'Fill in all three EmailJS values first'), 'error');
          const btn = m.querySelector('[data-test]');
          btn.disabled = true;
          try {
            await sendDirect(addr, t('mail.testSubject', 'SportTactic test'),
              t('mail.testBody', 'This is a test message from SportTactic.') + signature());
            UI.toast(t('mailsrv.testSent', 'Test mail sent — check your inbox'), 'success');
          } catch (e) {
            UI.toast(t('mailsrv.testFailed', 'It was refused') + ': ' + String(e && e.message ? e.message : e).slice(0, 160), 'error');
          } finally { btn.disabled = false; }
        };

        m.querySelector('[data-save]').onclick = () => {
          const addr = q('ms_addr').value.trim();
          if (addr && !normEmail(addr)) return UI.toast(t('mailsrv.badAddr', 'That does not look like an e-mail address'), 'error');
          write(S.addr, addr);
          persist();
          close();
          UI.toast(t('mailsrv.saved', 'Saved'), 'success');
          if (typeof onDone === 'function') onDone();
        };
      }
    });
  }

  // Short status line for the settings card.
  function serverLabel() {
    if (!canSendDirect()) return t('mailsrv.sendOff', 'Sending is not set up yet');
    const a = read(S.addr);
    return t('mailsrv.modeEjsShort', 'Sends via EmailJS') + (a ? ' \u00b7 ' + a : '');
  }

  function emailJsGuide() {
    const li = (k, f) => `<li>${esc(t(k, f))}</li>`;
    UI.modal({
      title: t('mailsrv.ejGuide', 'How to set EmailJS up'),
      width: 720,
      body: `<p>${esc(t('mailsrv.ejIntro', 'EmailJS is a small service built for exactly this: letting a web app send mail through your own account without a server of your own. The free tier covers a couple of hundred messages a month, which is more than most clubs send.'))}</p>
        <p><a class="btn sm" href="${EMAILJS_SITE}" target="_blank" rel="noopener noreferrer">emailjs.com \u2197</a></p>
        <ol class="ai-guide">
          ${li('mailsrv.ej1', 'Go to emailjs.com and create a free account.')}
          ${li('mailsrv.ej2', 'Email Services → Add New Service. Pick Gmail, Outlook or Other SMTP and sign in with the club address. Copy the Service ID.')}
          ${li('mailsrv.ej3', 'Email Templates → Create New Template. Set the To Email field to {{to_email}}, the Subject to {{subject}} and the content to {{message}}. Save and copy the Template ID.')}
          ${li('mailsrv.ej4', 'Account → General. Copy the Public Key.')}
          ${li('mailsrv.ej5', 'Account → Security. Add the address this app runs on under the allowed domains, so nobody else can use your quota.')}
          ${li('mailsrv.ej6', 'Paste the three values above and press Send a test.')}
        </ol>
        <h4>${esc(t('mailsrv.ejToTitle', 'If the mail arrives in your own inbox'))}</h4>
        <p>${esc(t('mailsrv.ejToBody', 'That is the To Email field of the template. EmailJS sends to whatever stands there, so if it holds your address every player mail comes back to you. Open the template, clear that field and write {{to_email}} — with the double braces — then save. SportTactic fills it with the player’s address on every send.'))}</p>
        <h4>${esc(t('mailsrv.ejTroubleTitle', 'If the test is refused'))}</h4>
        <ul class="ai-guide">
          ${li('mailsrv.ejT1', 'The template variables must be spelled exactly {{to_email}}, {{subject}} and {{message}} — EmailJS refuses a recipient it was not given.')}
          ${li('mailsrv.ejT2', 'API calls are disabled: turn OFF “Use Private Key” under Account → Security, or the browser cannot call it.')}
          ${li('mailsrv.ejT3', 'The address this app runs on is not in the allowed list, or you are opening the file from disk instead of over http(s).')}
        </ul>
        <p class="hint">${esc(t('mailsrv.ejPrivacy', 'The public key is designed to be visible in a web page; EmailJS protects the account with the allowed-domain list instead. Your mail password is only ever given to EmailJS when you connect the service, never to SportTactic.'))}</p>`,
      footer: `<button class="btn" data-back>${esc(t('mailsrv.title', 'E-mail sending'))}</button>
        <button class="btn primary" data-close2>${esc(T('common.close'))}</button>`,
      onOpen: (m, close) => {
        m.querySelector('[data-close2]').onclick = close;
        m.querySelector('[data-back]').onclick = () => { close(); serverDialog(); };
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

    const ready = canSendDirect();
    const from = senders();
    const cur = currentSender();
    UI.modal({
      title: opts.title || t('mail.title', 'Send e-mail'),
      width: 660,
      body: `
        ${from.length ? `<label class="field"><span>${esc(t('mail.sendAs', 'Send as'))}</span>
          <select id="mail_from">${from.map(x => `<option value="${esc(x.id)}" ${x.id === cur.id ? 'selected' : ''}>${esc(x.name || x.role || x.email)}${x.name && x.role ? ' \u00b7 ' + esc(x.role) : ''} \u2014 ${esc(x.email)}</option>`).join('')}</select>
          <span class="hint">${esc(t('mail.sendAsHint', 'The player sees this name and answers to this address. Staff get an address under Teams & Players \u2192 Staff.'))}</span></label>` : ''}
        <label class="field"><span>${esc(t('mail.recipients', 'Recipients'))}</span></label>
        <div class="pick-list">
          ${able.map((p, i) => `<label class="pick-row"><input type="checkbox" data-to="${esc(normEmail(p.email))}" data-pid="${esc(p.id)}" ${i < MAX_TO ? 'checked' : ''}>
            <span class="pick-name">${esc(label(p))}</span><span class="pick-sub">${esc(normEmail(p.email))}</span></label>`).join('')}
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
        <p class="hint">${esc(ready ? t('mail.howReady', 'Each recipient gets their own mail, sent through your own mail account. Nobody sees another player\u2019s address.') : t('mail.howNoRelay', 'Sending is switched off until EmailJS is set up under Settings \u2192 Send e-mail \u2192 E-mail sending.'))}</p>`,
      footer: `<button class="btn ghost" data-close2>${esc(T('common.cancel'))}</button>
        <button class="btn" data-setup>${esc(t('mailsrv.title', 'E-mail sending'))}</button>
        <button class="btn primary" data-direct ${ready ? '' : 'disabled'}>${esc(t('mail.sendMail', 'Send mail'))}</button>`,
      onOpen: (m, close) => {
        const picked = () => [...m.querySelectorAll('[data-blk]:checked')].map(c => c.dataset.blk);
        const rows = () => [...m.querySelectorAll('[data-to]:checked')].slice(0, MAX_TO);
        const chosen = () => rows().map(c => all.find(p => p.id === c.dataset.pid)).filter(Boolean);
        const subject = () => m.querySelector('#mail_subj').value.trim();
        const message = () => m.querySelector('#mail_body').value.trim();
        const sender = () => {
          const sel = m.querySelector('#mail_from');
          if (!sel) return currentSender();
          write(K_SENDER, sel.value);
          return from.find(x => x.id === sel.value) || currentSender();
        };

        m.querySelector('[data-close2]').onclick = close;
        m.querySelector('[data-setup]').onclick = () => { close(); serverDialog(); };

        // Straight out through EmailJS: no length cap, and every recipient gets
        // their OWN mail, so nobody sees another player's address or numbers.
        const direct = m.querySelector('[data-direct]');
        direct.onclick = async () => {
          const people = chosen();
          if (!people.length) return UI.toast(t('mail.pickOne', 'Pick at least one player'), 'error');
          if (!subject()) return UI.toast(t('mail.needSubject', 'Write a subject first'), 'error');
          const blocks = picked();
          const me = sender();
          direct.disabled = true;
          let sent = 0; let failed = '';
          for (const p of people) {
            try {
              await sendDirect(normEmail(p.email), subject(), buildText(p, message(), blocks) + signature(me), me);
              sent++;
            } catch (e) { failed = String(e && e.message ? e.message : e).slice(0, 160); }
          }
          direct.disabled = false;
          if (sent) UI.toast(t('mail.sentN', 'Mail sent') + ' (' + sent + '/' + people.length + ')', 'success');
          if (failed) UI.toast(t('mail.sendFailed', 'Some mail could not be sent') + ': ' + failed, 'error');
          if (sent === people.length) close();
        };
      }
    });
  }

  // Markup for the button every view mounts, so they all look the same.
  function btn(attr, text, cls) {
    return `<button class="btn ${cls || 'sm'}" ${attr}>\u2709 ${esc(text || t('mail.mail', 'Mail'))}</button>`;
  }

  return {
    compose, btn, normEmail, withEmail, setupDialog,
    serverDialog, emailJsGuide, serverSettings, serverLabel,
    canSendDirect, sendDirect
  };
})();
if (typeof window !== 'undefined') window.MAIL = MAIL;
