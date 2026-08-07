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

  function signature() {
    const parts = [getSenderName(), getSignature()].filter(Boolean);
    return parts.length ? '\n\n--\n' + parts.join('\n') : '';
  }

  // ---- Your own mail server ----------------------------------------------
  // A browser cannot open an IMAP, POP3 or SMTP socket, so these settings are
  // not used to send anything: they are the club's own account details, kept in
  // one place so they can be typed into Outlook, Apple Mail or Thunderbird once
  // and read back on the next device. Device settings, so localStorage — and a
  // password is never asked for, so there is nothing here worth stealing.
  const S = {
    addr: 'stx_mailsrv_addr', preset: 'stx_mailsrv_preset', auth: 'stx_mailsrv_auth',
    inProto: 'stx_mailsrv_inproto', inHost: 'stx_mailsrv_inhost', inPort: 'stx_mailsrv_inport',
    inSec: 'stx_mailsrv_insec', inUser: 'stx_mailsrv_inuser',
    outHost: 'stx_mailsrv_outhost', outPort: 'stx_mailsrv_outport',
    outSec: 'stx_mailsrv_outsec', outUser: 'stx_mailsrv_outuser',
    url: 'stx_mailsrv_url', mode: 'stx_mailsrv_mode',
    ejService: 'stx_emailjs_service', ejTemplate: 'stx_emailjs_template', ejKey: 'stx_emailjs_key'
  };
  const SEC = { ssl: 'SSL/TLS', starttls: 'STARTTLS', none: 'None' };
  // [imapHost, imapPort, imapSec, popHost, popPort, popSec, smtpHost, smtpPort, smtpSec, auth]
  const PRESETS = {
    gmail: ['imap.gmail.com', 993, 'ssl', 'pop.gmail.com', 995, 'ssl', 'smtp.gmail.com', 587, 'starttls', 'app'],
    outlook: ['outlook.office365.com', 993, 'ssl', 'outlook.office365.com', 995, 'ssl', 'smtp-mail.outlook.com', 587, 'starttls', 'modern'],
    office: ['outlook.office365.com', 993, 'ssl', 'outlook.office365.com', 995, 'ssl', 'smtp.office365.com', 587, 'starttls', 'modern'],
    icloud: ['imap.mail.me.com', 993, 'ssl', '', '', 'ssl', 'smtp.mail.me.com', 587, 'starttls', 'app'],
    yahoo: ['imap.mail.yahoo.com', 993, 'ssl', 'pop.mail.yahoo.com', 995, 'ssl', 'smtp.mail.yahoo.com', 465, 'ssl', 'app']
  };
  const PRESET_LABEL = {
    own: ['mailsrv.pOwn', 'Own domain (fill in from my address)'],
    gmail: ['mailsrv.pGmail', 'Gmail / Google Workspace'],
    outlook: ['mailsrv.pOutlook', 'Outlook.com / Hotmail'],
    office: ['mailsrv.pOffice', 'Microsoft 365 / Exchange Online'],
    icloud: ['mailsrv.pIcloud', 'iCloud Mail'],
    yahoo: ['mailsrv.pYahoo', 'Yahoo Mail'],
    custom: ['mailsrv.pCustom', 'Something else (type it in myself)']
  };
  // The domains people actually write, so the form fills itself in the moment an
  // address is typed and nobody has to know what IMAP is.
  const DOMAIN_PRESET = {
    'gmail.com': 'gmail', 'googlemail.com': 'gmail',
    'outlook.com': 'outlook', 'hotmail.com': 'outlook', 'hotmail.co.uk': 'outlook',
    'live.com': 'outlook', 'live.dk': 'outlook', 'msn.com': 'outlook', 'outlook.dk': 'outlook',
    'icloud.com': 'icloud', 'me.com': 'icloud', 'mac.com': 'icloud',
    'yahoo.com': 'yahoo', 'yahoo.co.uk': 'yahoo', 'yahoo.dk': 'yahoo', 'ymail.com': 'yahoo'
  };
  const presetForAddress = a => DOMAIN_PRESET[domainOf(a)] || '';

  const domainOf = a => { const i = String(a || '').indexOf('@'); return i > 0 ? a.slice(i + 1).trim().toLowerCase() : ''; };
  // Accepts a hostname or a bare IPv4 literal; anything with a scheme, a path,
  // a space or a port glued on is rejected rather than silently stored wrong.
  const okHost = h => !h || /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(h);
  const okPort = p => !p || (/^\d{1,5}$/.test(String(p)) && +p >= 1 && +p <= 65535);

  // An earlier build proposed https://<your domain>/sporttactic-mail in the relay
  // field. Nobody ever built that endpoint, so every mail was posted into thin air
  // and came back as "the address could not be reached". Drop it once.
  const GUESSED_RELAY = addr => { const d = domainOf(addr); return d ? 'https://' + d + '/sporttactic-mail' : ''; };
  (function dropGuessedRelay() {
    const u = read(S.url);
    if (u && u === GUESSED_RELAY(read(S.addr))) {
      write(S.url, '');
      if (read(S.mode) === 'relay') write(S.mode, '');
    }
  })();

  function serverSettings() {
    return {
      addr: read(S.addr), preset: read(S.preset) || 'own', auth: read(S.auth) || 'password',
      inProto: read(S.inProto) === 'pop3' ? 'pop3' : 'imap',
      inHost: read(S.inHost), inPort: read(S.inPort), inSec: read(S.inSec) || 'ssl', inUser: read(S.inUser),
      outHost: read(S.outHost), outPort: read(S.outPort), outSec: read(S.outSec) || 'starttls', outUser: read(S.outUser),
      url: read(S.url), mode: sendMode(),
      ejService: read(S.ejService), ejTemplate: read(S.ejTemplate), ejKey: read(S.ejKey)
    };
  }
  const serverConfigured = () => !!(read(S.inHost) && read(S.outHost));

  // ---- Sending straight from the app ------------------------------------
  // A browser cannot open an SMTP socket, so the message has to be handed to
  // something that can. Two ways, and both keep the SMTP password off this
  // device: EmailJS, which is built for browsers and needs nothing installed,
  // or a small relay of the club's own.
  const EMAILJS_API = 'https://api.emailjs.com/api/v1.0/email/send';
  const okRelay = u => { try { return new URL(u).protocol === 'https:'; } catch (e) { return false; } };
  function sendMode() {
    const m = read(S.mode);
    if (m === 'emailjs' || m === 'relay' || m === 'off') return m;
    // Saved before the picker existed — go by whichever is actually filled in.
    if (read(S.ejService) && read(S.ejTemplate) && read(S.ejKey)) return 'emailjs';
    return okRelay(read(S.url)) ? 'relay' : 'off';
  }
  function canSendDirect() {
    const m = sendMode();
    if (m === 'emailjs') return !!(read(S.ejService) && read(S.ejTemplate) && read(S.ejKey));
    if (m === 'relay') return okRelay(read(S.url));
    return false;
  }
  async function sendDirect(to, subject, body) {
    if (sendMode() === 'emailjs') return sendViaEmailJs(to, subject, body);
    const url = read(S.url);
    if (!okRelay(url)) throw new Error(t('mailsrv.badUrl', 'The relay address must start with https://'));
    return post(url, { to, subject, text: body, from: read(S.addr), fromName: getSenderName() });
  }
  // The public key is meant to be public — EmailJS gates abuse on the allowed
  // domain list, not on secrecy, which is why this can run from a browser at all.
  function sendViaEmailJs(to, subject, body) {
    return post(EMAILJS_API, {
      service_id: read(S.ejService),
      template_id: read(S.ejTemplate),
      user_id: read(S.ejKey),
      // The recipient is sent under every name EmailJS templates commonly use,
      // so the mail reaches the player whichever one the template was built with.
      template_params: {
        to_email: to, email: to, user_email: to, to: to, recipient: to,
        to_name: to,
        subject: subject, message: body,
        from_name: getSenderName() || 'SportTactic',
        reply_to: read(S.addr) || ''
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

  // What the form should hold for a given provider — used by the preset picker
  // and by "fill in from my address", which is the whole "easy" part: almost
  // every hosting company answers on imap./pop./smtp.<your domain>.
  function presetValues(id, addr) {
    const proto = read(S.inProto) === 'pop3' ? 'pop3' : 'imap';
    const p = PRESETS[id];
    if (p) {
          const inc = proto === 'pop3' ? [p[3], p[4], p[5]] : [p[0], p[1], p[2]];
      return { inHost: inc[0], inPort: inc[1], inSec: inc[2], outHost: p[6], outPort: p[7], outSec: p[8], auth: p[9] };
    }
    if (id === 'own') {
      const d = domainOf(addr);
      if (!d) return null;
      return {
        inHost: (proto === 'pop3' ? 'pop.' : 'imap.') + d, inPort: proto === 'pop3' ? 995 : 993, inSec: 'ssl',
        outHost: 'smtp.' + d, outPort: 587, outSec: 'starttls', auth: 'password'
      };
    }
    return null;
  }

  function serverText() {
    const s = serverSettings();
    const secL = k => t('mailsrv.sec' + (k === 'ssl' ? 'Ssl' : k === 'starttls' ? 'Start' : 'None'), SEC[k] || k);
    return [
      'SportTactic — ' + t('mailsrv.title', 'Mail server settings'),
      t('mailsrv.address', 'E-mail address') + ': ' + (s.addr || '—'),
      '',
      (s.inProto === 'pop3' ? 'POP3' : 'IMAP') + ' (' + t('mailsrv.incoming', 'Incoming mail') + ')',
      '  ' + t('mailsrv.host', 'Server') + ': ' + (s.inHost || '—'),
      '  ' + t('mailsrv.port', 'Port') + ': ' + (s.inPort || '—'),
      '  ' + t('mailsrv.security', 'Encryption') + ': ' + secL(s.inSec),
      '  ' + t('mailsrv.user', 'User name') + ': ' + (s.inUser || s.addr || '—'),
      '',
      'SMTP (' + t('mailsrv.outgoing', 'Outgoing mail') + ')',
      '  ' + t('mailsrv.host', 'Server') + ': ' + (s.outHost || '—'),
      '  ' + t('mailsrv.port', 'Port') + ': ' + (s.outPort || '—'),
      '  ' + t('mailsrv.security', 'Encryption') + ': ' + secL(s.outSec),
      '  ' + t('mailsrv.user', 'User name') + ': ' + (s.outUser || s.inUser || s.addr || '—'),
      '',
      t('mailsrv.noPw', 'No password is stored here — type it into your mail program yourself.')
    ].join('\n');
  }

  // The editable form. onDone runs after it closes so a caller can refresh.
  function serverDialog(onDone) {
    const s = serverSettings();
    const opt = (v, cur, label) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(label)}</option>`;
    const secSel = (id, cur) => `<select id="${id}">
      ${opt('ssl', cur, t('mailsrv.secSsl', 'SSL/TLS (recommended)'))}
      ${opt('starttls', cur, t('mailsrv.secStart', 'STARTTLS'))}
      ${opt('none', cur, t('mailsrv.secNone', 'None (not recommended)'))}</select>`;

    UI.modal({
      title: t('mailsrv.title', 'Mail server settings'),
      width: 720,
      body: `<p>${esc(t('mailsrv.intro', 'Your club\u2019s own mail account, kept in one place. Pick your provider or let SportTactic fill the servers in from your address, then type the same values into Outlook, Apple Mail or Thunderbird once.'))}</p>
        <div class="row">
          <label class="field"><span>${esc(t('mailsrv.address', 'E-mail address'))}</span>
            <input id="ms_addr" type="email" autocomplete="off" spellcheck="false" value="${esc(s.addr)}" placeholder="traener@klub.dk"></label>
          <label class="field"><span>${esc(t('mailsrv.preset', 'Provider'))}</span>
            <select id="ms_preset">${Object.keys(PRESET_LABEL).map(k => opt(k, s.preset, t(PRESET_LABEL[k][0], PRESET_LABEL[k][1]))).join('')}</select></label>
        </div>
        <div class="row" style="flex:0;margin:-4px 0 10px;flex-wrap:wrap">
          <button type="button" class="btn sm" id="ms_fill">${esc(t('mailsrv.fill', 'Fill in servers for me'))}</button>
          <button type="button" class="btn sm" id="ms_guide">\u2753 ${esc(t('mailsrv.reference', 'Reference table'))}</button>
        </div>

        <h4 class="mailsrv-h">${esc(t('mailsrv.incoming', 'Incoming mail'))}</h4>
        <div class="row">
          <label class="field"><span>${esc(t('mailsrv.protocol', 'Protocol'))}</span>
            <select id="ms_proto">
              ${opt('imap', s.inProto, 'IMAP — ' + t('mailsrv.imapShort', 'mail stays on the server'))}
              ${opt('pop3', s.inProto, 'POP3 — ' + t('mailsrv.popShort', 'mail is downloaded to one machine'))}
            </select></label>
          <label class="field"><span>${esc(t('mailsrv.host', 'Server'))}</span>
            <input id="ms_inhost" autocomplete="off" spellcheck="false" value="${esc(s.inHost)}" placeholder="imap.klub.dk"></label>
        </div>
        <div class="row">
          <label class="field"><span>${esc(t('mailsrv.port', 'Port'))}</span>
            <input id="ms_inport" type="number" min="1" max="65535" value="${esc(s.inPort)}" placeholder="993"></label>
          <label class="field"><span>${esc(t('mailsrv.security', 'Encryption'))}</span>${secSel('ms_insec', s.inSec)}</label>
          <label class="field"><span>${esc(t('mailsrv.user', 'User name'))}</span>
            <input id="ms_inuser" autocomplete="off" spellcheck="false" value="${esc(s.inUser)}" placeholder="${esc(t('mailsrv.userPh', 'Usually your full e-mail address'))}"></label>
        </div>

        <h4 class="mailsrv-h">${esc(t('mailsrv.outgoing', 'Outgoing mail'))} (SMTP)</h4>
        <div class="row">
          <label class="field"><span>${esc(t('mailsrv.host', 'Server'))}</span>
            <input id="ms_outhost" autocomplete="off" spellcheck="false" value="${esc(s.outHost)}" placeholder="smtp.klub.dk"></label>
          <label class="field"><span>${esc(t('mailsrv.port', 'Port'))}</span>
            <input id="ms_outport" type="number" min="1" max="65535" value="${esc(s.outPort)}" placeholder="587"></label>
        </div>
        <div class="row">
          <label class="field"><span>${esc(t('mailsrv.security', 'Encryption'))}</span>${secSel('ms_outsec', s.outSec)}</label>
          <label class="field"><span>${esc(t('mailsrv.user', 'User name'))}</span>
            <input id="ms_outuser" autocomplete="off" spellcheck="false" value="${esc(s.outUser)}" placeholder="${esc(t('mailsrv.sameAsIn', 'Leave empty to reuse the incoming user name'))}"></label>
          <label class="field"><span>${esc(t('mailsrv.auth', 'Sign-in method'))}</span>
            <select id="ms_auth">
              ${opt('password', s.auth, t('mailsrv.aPassword', 'Normal password'))}
              ${opt('app', s.auth, t('mailsrv.aApp', 'App password (Gmail, iCloud, Yahoo)'))}
              ${opt('modern', s.auth, t('mailsrv.aModern', 'Microsoft sign-in window'))}
            </select></label>
        </div>
        <p class="hint">${esc(t('mailsrv.privacy', 'SportTactic cannot open a mail connection from a browser and never tries to: it only remembers these values for you. No password is asked for, stored or sent, and none of this leaves the device.'))}</p>

        <h4 class="mailsrv-h">${esc(t('mailsrv.directTitle', 'Send straight from the app'))}</h4>
        <p class="hint">${esc(t('mailsrv.directIntro2', 'Pick how the mail actually leaves. EmailJS needs nothing installed and connects to the account above; a relay is a few lines of code on a server you own. Either way the SMTP password never touches this browser.'))}</p>
        <label class="field"><span>${esc(t('mailsrv.mode', 'Send with'))}</span>
          <select id="ms_mode">
            ${opt('off', s.mode, t('mailsrv.modeOff', 'Not set up \u2014 sending is switched off'))}
            ${opt('emailjs', s.mode, t('mailsrv.modeEjs', 'EmailJS \u2014 nothing to install (recommended)'))}
            ${opt('relay', s.mode, t('mailsrv.modeRelay', 'My own relay \u2014 needs a server'))}
          </select></label>

        <div id="ms_ejs" class="send-mode">
          <div class="row">
            <label class="field"><span>${esc(t('mailsrv.ejService', 'Service ID'))}</span>
              <input id="ms_ejservice" autocomplete="off" spellcheck="false" value="${esc(s.ejService)}" placeholder="service_ab12cde"></label>
            <label class="field"><span>${esc(t('mailsrv.ejTemplate', 'Template ID'))}</span>
              <input id="ms_ejtemplate" autocomplete="off" spellcheck="false" value="${esc(s.ejTemplate)}" placeholder="template_ab12cde"></label>
          </div>
          <label class="field"><span>${esc(t('mailsrv.ejKey', 'Public key'))}</span>
            <input id="ms_ejkey" autocomplete="off" spellcheck="false" value="${esc(s.ejKey)}" placeholder="AbCdEfGhIjKlMnOp">
            <span class="hint">${esc(t('mailsrv.ejHint', 'From emailjs.com \u2014 Email Services, Email Templates and Account. The public key is not a secret; EmailJS blocks every site except the ones you allow.'))}</span></label>
          <p class="hint mail-note">${esc(t('mailsrv.ejToNote', 'In the EmailJS template, the To Email field must contain {{to_email}} \u2014 nothing else. If it holds your own address, every mail is sent to you instead of to the player.'))}</p>
          <div class="row" style="flex:0;flex-wrap:wrap">
            <button type="button" class="btn sm" id="ms_ejguide">\u2753 ${esc(t('mailsrv.ejGuide', 'How to set EmailJS up'))}</button>
          </div>
        </div>

        <div id="ms_relay" class="send-mode">
          <label class="field"><span>${esc(t('mailsrv.url', 'Relay address'))}</span>
            <input id="ms_url" type="url" autocomplete="off" spellcheck="false" value="${esc(s.url)}" placeholder="https://klub.dk/sporttactic-mail">
            <span class="hint">${esc(t('mailsrv.urlHint', 'An https:// address that accepts a POST. Press the guide for the ten lines of code it needs.'))}</span></label>
          <div class="row" style="flex:0;flex-wrap:wrap">
            <button type="button" class="btn sm" id="ms_fnguide">\u2753 ${esc(t('mailsrv.fnGuide', 'How to set the mail relay up'))}</button>
          </div>
        </div>`,
      footer: `<button class="btn ghost" data-close2>${esc(T('common.cancel'))}</button>
        <button class="btn" data-copy>${esc(t('mailsrv.copy', 'Copy settings'))}</button>
        <button class="btn" data-test>${esc(t('mailsrv.test', 'Send a test'))}</button>
        <button class="btn primary" data-save>${esc(T('common.save'))}</button>`,
      onOpen: (m, close) => {
        const q = id => m.querySelector('#' + id);
        const apply = v => {
          if (!v) return false;
          q('ms_inhost').value = v.inHost; q('ms_inport').value = v.inPort; q('ms_insec').value = v.inSec;
          q('ms_outhost').value = v.outHost; q('ms_outport').value = v.outPort; q('ms_outsec').value = v.outSec;
          q('ms_auth').value = v.auth;
          return true;
        };
        const fill = () => {
          write(S.inProto, q('ms_proto').value);      // presetValues reads the stored protocol
          if (!apply(presetValues(q('ms_preset').value, q('ms_addr').value)))
            UI.toast(t('mailsrv.needAddr', 'Write your e-mail address first, or pick a provider'), 'error');
        };
        // Typing traener@gmail.com is enough: the provider is recognised and every
        // server, port and encryption box fills itself in.
        let lastAuto = presetForAddress(s.addr) || (s.inHost ? '' : domainOf(s.addr));
        const autoFill = () => {
          const addr = q('ms_addr').value.trim();
          const dom = domainOf(addr);
          if (!dom) return;
          const guess = DOMAIN_PRESET[dom];
          if (guess) {
            q('ms_preset').value = guess;
            write(S.inProto, q('ms_proto').value);
            if (apply(presetValues(guess, addr))) {
              UI.toast(t('mailsrv.autoFilled', 'Filled in from your address') + ': ' + t(PRESET_LABEL[guess][0], PRESET_LABEL[guess][1]), 'success');
            }
            lastAuto = dom;
            return;
          }
          // An unknown domain is almost always the club's own. Guess imap./smtp. when
          // nothing is filled in yet, and also when the coach corrects an address we
          // had already auto-filled from — otherwise the old provider would linger.
          if (!q('ms_inhost').value || (lastAuto && lastAuto !== dom)) {
            q('ms_preset').value = 'own';
            fill();
          }
          lastAuto = dom;
        };
        q('ms_addr').onchange = autoFill;
        q('ms_addr').onblur = autoFill;
        q('ms_fill').onclick = fill;
        q('ms_preset').onchange = fill;
        q('ms_proto').onchange = fill;
        if (!s.inHost && s.addr) autoFill();

        const showMode = () => {
          const mode = q('ms_mode').value;
          q('ms_ejs').classList.toggle('hidden', mode !== 'emailjs');
          q('ms_relay').classList.toggle('hidden', mode !== 'relay');
        };
        q('ms_mode').onchange = showMode;
        showMode();

        m.querySelector('[data-close2]').onclick = close;
        q('ms_guide').onclick = () => { close(); serverGuide(); };
        q('ms_fnguide').onclick = () => { close(); functionGuide(); };
        q('ms_ejguide').onclick = () => { close(); emailJsGuide(); };

        // Persist whatever the send section holds, so Send a test uses it too.
        const persistSend = () => {
          write(S.mode, q('ms_mode').value);
          write(S.url, q('ms_url').value.trim());
          write(S.ejService, q('ms_ejservice').value.trim().slice(0, 80));
          write(S.ejTemplate, q('ms_ejtemplate').value.trim().slice(0, 80));
          write(S.ejKey, q('ms_ejkey').value.trim().slice(0, 120));
        };

        // One mail to yourself is the only end-to-end check a browser can run.
        m.querySelector('[data-test]').onclick = async () => {
          const addr = normEmail(q('ms_addr').value.trim());
          if (!addr) return UI.toast(t('mailsrv.needAddr', 'Write your e-mail address first, or pick a provider'), 'error');
          write(S.addr, addr);
          persistSend();
          if (!canSendDirect()) return UI.toast(t('mailsrv.needRelay', 'Fill in the send method above first \u2014 that is what actually sends the mail'), 'error');
          const subject = t('mail.testSubject', 'SportTactic test');
          const body = t('mail.testBody', 'This is a test message from SportTactic.') + '\n\n' + serverText() + signature();
          const btn = m.querySelector('[data-test]');
          btn.disabled = true;
          try {
            await sendDirect(addr, subject, body);
            UI.toast(t('mailsrv.testSent', 'Test mail sent \u2014 check your inbox'), 'success');
          } catch (e) {
            UI.toast(t('mailsrv.testFailed', 'It was refused') + ': ' + String(e && e.message ? e.message : e).slice(0, 160), 'error');
          } finally { btn.disabled = false; }
        };

        m.querySelector('[data-copy]').onclick = async () => {
          const text = serverText();
          try { await navigator.clipboard.writeText(text); UI.toast(t('mailsrv.copied', 'Settings copied'), 'success'); }
          catch { UI.toast(t('mailsrv.copyFailed', 'Could not copy \u2014 select the text yourself'), 'error'); }
        };
        m.querySelector('[data-save]').onclick = () => {
          const inHost = q('ms_inhost').value.trim().toLowerCase();
          const outHost = q('ms_outhost').value.trim().toLowerCase();
          const inPort = q('ms_inport').value.trim();
          const outPort = q('ms_outport').value.trim();
          if (!okHost(inHost) || !okHost(outHost)) return UI.toast(t('mailsrv.badHost', 'That does not look like a server name \u2014 write just the host, e.g. imap.klub.dk'), 'error');
          if (!okPort(inPort) || !okPort(outPort)) return UI.toast(t('mailsrv.badPort', 'A port must be a number between 1 and 65535'), 'error');
          const addr = q('ms_addr').value.trim();
          if (addr && !normEmail(addr)) return UI.toast(t('mailsrv.badAddr', 'That does not look like an e-mail address'), 'error');
          write(S.addr, addr);
          write(S.preset, q('ms_preset').value);
          write(S.auth, q('ms_auth').value);
          write(S.inProto, q('ms_proto').value);
          write(S.inHost, inHost); write(S.inPort, inPort); write(S.inSec, q('ms_insec').value);
          write(S.inUser, q('ms_inuser').value.trim().slice(0, 120));
          write(S.outHost, outHost); write(S.outPort, outPort); write(S.outSec, q('ms_outsec').value);
          write(S.outUser, q('ms_outuser').value.trim().slice(0, 120));
          const relay = q('ms_url').value.trim();
          if (q('ms_mode').value === 'relay' && relay && !okRelay(relay)) return UI.toast(t('mailsrv.badUrl', 'The relay address must start with https://'), 'error');
          persistSend();
          close();
          UI.toast(t('mailsrv.saved', 'Mail server settings saved'), 'success');
          if (typeof onDone === 'function') onDone();
        };
      }
    });
  }
  // Short status line for the settings card.
  function serverLabel() {
    const s = serverSettings();
    const how = canSendDirect()
      ? (s.mode === 'emailjs' ? t('mailsrv.modeEjsShort', 'sends via EmailJS') : t('mailsrv.directOn', 'sends from the app'))
      : t('mailsrv.sendOff', 'sending not set up');
    if (!serverConfigured()) return t('mailsrv.notSet', 'No mail server set up') + ' \u00b7 ' + how;
    return (s.inProto === 'pop3' ? 'POP3' : 'IMAP') + ' ' + s.inHost + ' \u00b7 SMTP ' + s.outHost + ' \u00b7 ' + how;
  }

  function emailJsGuide() {
    const li = (k, f) => `<li>${esc(t(k, f))}</li>`;
    UI.modal({
      title: t('mailsrv.ejGuide', 'How to set EmailJS up'),
      width: 720,
      body: `<p>${esc(t('mailsrv.ejIntro', 'EmailJS is a small service built for exactly this: letting a web app send mail through your own account without a server of your own. The free tier covers a couple of hundred messages a month, which is more than most clubs send.'))}</p>
        <ol class="ai-guide">
          ${li('mailsrv.ej1', 'Go to emailjs.com and create a free account.')}
          ${li('mailsrv.ej2', 'Email Services \u2192 Add New Service. Pick Gmail, Outlook or Other SMTP and sign in with the club address you filled in above. Copy the Service ID.')}
          ${li('mailsrv.ej3', 'Email Templates \u2192 Create New Template. Set the To Email field to {{to_email}}, the Subject to {{subject}} and the content to {{message}}. Save and copy the Template ID.')}
          ${li('mailsrv.ej4', 'Account \u2192 General. Copy the Public Key.')}
          ${li('mailsrv.ej5', 'Account \u2192 Security. Add the address this app runs on under the allowed domains, so nobody else can use your quota.')}
          ${li('mailsrv.ej6', 'Paste the three values above and press Send a test.')}
        </ol>
        <h4>${esc(t('mailsrv.ejToTitle', 'If the mail arrives in your own inbox'))}</h4>
        <p>${esc(t('mailsrv.ejToBody', 'That is the To Email field of the template. EmailJS sends to whatever stands there, so if it holds your address every player mail comes back to you. Open the template, clear that field and write {{to_email}} \u2014 with the double braces \u2014 then save. SportTactic fills it with the player\u2019s address on every send.'))}</p>
        <h4>${esc(t('mailsrv.ejTroubleTitle', 'If the test is refused'))}</h4>
        <ul class="ai-guide">
          ${li('mailsrv.ejT1', 'The template variables must be spelled exactly {{to_email}}, {{subject}} and {{message}} \u2014 EmailJS refuses a recipient it was not given.')}
          ${li('mailsrv.ejT2', 'API calls are disabled: turn OFF \u201cUse Private Key\u201d under Account \u2192 Security, or the browser cannot call it.')}
          ${li('mailsrv.ejT3', 'The address this app runs on is not in the allowed list, or you are opening the file from disk instead of over http(s).')}
        </ul>
        <p class="hint">${esc(t('mailsrv.ejPrivacy', 'The public key is designed to be visible in a web page; EmailJS protects the account with the allowed-domain list instead. Your mail password is only ever given to EmailJS when you connect the service, never to SportTactic.'))}</p>`,
      footer: `<button class="btn" data-back>${esc(t('mailsrv.title', 'Mail server settings'))}</button>
        <button class="btn primary" data-close2>${esc(T('common.close'))}</button>`,
      onOpen: (m, close) => {
        m.querySelector('[data-close2]').onclick = close;
        m.querySelector('[data-back]').onclick = () => { close(); serverDialog(); };
      }
    });
  }

  // The ten lines of server code that turn "open my mail app" into "send now".
  const FN_CODE = `import nodemailer from 'nodemailer';

// POST { to, subject, text, from, fromName }  ->  200 on success.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://YOUR-SPORTTACTIC-ADDRESS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { to, subject, text, from, fromName } = req.body;
  if (!to || !subject) return res.status(400).send('to and subject are required');

  await nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'ssl',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  }).sendMail({
    from: fromName ? '"' + fromName + '" <' + from + '>' : from,
    to, subject, text
  });

  return res.status(200).send('ok');
}`;

  function functionGuide() {
    const li = (k, f) => `<li>${esc(t(k, f))}</li>`;
    UI.modal({
      title: t('mailsrv.fnGuide', 'How to set the mail relay up'),
      width: 760,
      body: `<p>${esc(t('mailsrv.fnIntro', 'A browser is not allowed to open an SMTP connection \u2014 no browser on earth is. To send without opening a mail app, the message has to pass through something that can. This is the smallest possible version of that: one address that owns your SMTP login and does nothing else.'))}</p>
        <ol class="ai-guide">
          ${li('mailsrv.fn1', 'Pick anywhere that runs a little code for free: a Vercel or Netlify function, a Cloudflare Worker, an Appwrite function, or a PHP file on the club\u2019s own web host.')}
          ${li('mailsrv.fn2', 'Add nodemailer as a dependency and paste the code below (or the equivalent in your language).')}
          ${li('mailsrv.fn3', 'Set SMTP_HOST, SMTP_PORT, SMTP_SECURE (ssl or starttls), SMTP_USER and SMTP_PASS as environment variables \u2014 the same values as above, plus the password. They stay on the server.')}
          ${li('mailsrv.fn4', 'Replace YOUR-SPORTTACTIC-ADDRESS with the address this app runs on. Without that line the browser refuses the request, and with it no other site can use your relay.')}
          ${li('mailsrv.fn5', 'Deploy it and copy the https:// address it answers on.')}
          ${li('mailsrv.fn6', 'Paste the address into the field above and press Send a test.')}
        </ol>
        <pre class="code-block">${esc(FN_CODE)}</pre>
        <p class="hint">${esc(t('mailsrv.fnPrivacy', 'The password only ever exists on the relay. SportTactic sends it a recipient, a subject and a body, and gets back nothing but success or an error. Anyone who finds the address could send mail as you, so keep it to yourself and restrict it to this app\u2019s address.'))}</p>`,
      footer: `<button class="btn" data-copy>${esc(t('mailsrv.fnCopy', 'Copy the code'))}</button>
        <button class="btn" data-back>${esc(t('mailsrv.title', 'Mail server settings'))}</button>
        <button class="btn primary" data-close2>${esc(T('common.close'))}</button>`,
      onOpen: (m, close) => {
        m.querySelector('[data-close2]').onclick = close;
        m.querySelector('[data-back]').onclick = () => { close(); serverDialog(); };
        m.querySelector('[data-copy]').onclick = async () => {
          try { await navigator.clipboard.writeText(FN_CODE); UI.toast(t('mailsrv.copied', 'Settings copied'), 'success'); }
          catch { UI.toast(t('mailsrv.copyFailed', 'Could not copy \u2014 select the text yourself'), 'error'); }
        };
      }
    });
  }

  // ---- Mail server reference --------------------------------------------
  // Known-good values for the coach's own desktop or phone client.
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
      title: t('mailsrv.reference', 'Reference table'),
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
        <button class="btn" data-own>${esc(t('mailsrv.title', 'Mail server settings'))}</button>
        <button class="btn primary" data-close2>${esc(T('common.close'))}</button>`,
      onOpen: (m, close) => {
        m.querySelector('[data-close2]').onclick = close;
        m.querySelector('[data-own]').onclick = () => { close(); serverDialog(); };
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

    const ready = canSendDirect();
    UI.modal({
      title: opts.title || t('mail.title', 'Send e-mail'),
      width: 660,
      body: `
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
        <p class="hint">${esc(ready ? t('mail.howReady', 'Each recipient gets their own mail, sent through your own mail server. Nobody sees another player\u2019s address.') : t('mail.howNoRelay', 'Sending is switched off until a relay address is set under Settings \u2192 Send e-mail \u2192 Mail server settings.'))}</p>`,
      footer: `<button class="btn ghost" data-close2>${esc(T('common.cancel'))}</button>
        <button class="btn" data-setup>${esc(t('mailsrv.title', 'Mail server settings'))}</button>
        <button class="btn primary" data-direct ${ready ? '' : 'disabled'}>${esc(t('mail.sendMail', 'Send mail'))}</button>`,
      onOpen: (m, close) => {
        const picked = () => [...m.querySelectorAll('[data-blk]:checked')].map(c => c.dataset.blk);
        const rows = () => [...m.querySelectorAll('[data-to]:checked')].slice(0, MAX_TO);
        const chosen = () => rows().map(c => all.find(p => p.id === c.dataset.pid)).filter(Boolean);
        const subject = () => m.querySelector('#mail_subj').value.trim();
        const message = () => m.querySelector('#mail_body').value.trim();

        m.querySelector('[data-close2]').onclick = close;
        m.querySelector('[data-setup]').onclick = () => { close(); serverDialog(); };

        // Straight out through the relay: no length cap, and every recipient gets
        // their OWN mail, so nobody sees another player's address or numbers.
        const direct = m.querySelector('[data-direct]');
        direct.onclick = async () => {
          const people = chosen();
          if (!people.length) return UI.toast(t('mail.pickOne', 'Pick at least one player'), 'error');
          if (!subject()) return UI.toast(t('mail.needSubject', 'Write a subject first'), 'error');
          const blocks = picked();
          direct.disabled = true;
          let sent = 0; let failed = '';
          for (const p of people) {
            try {
              await sendDirect(normEmail(p.email), subject(), buildText(p, message(), blocks) + signature());
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
    serverGuide, serverDialog, functionGuide, emailJsGuide, serverSettings, serverConfigured, serverLabel, serverText,
    canSendDirect, sendDirect
  };
})();
if (typeof window !== 'undefined') window.MAIL = MAIL;
