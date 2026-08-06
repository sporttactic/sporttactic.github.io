/* sms.js — text a player straight from the squad, the leaderboard or a report.
   There is no SMS gateway and no account: the message and the picked numbers are
   handed to the phone's own messaging app, so nothing leaves the device until
   the coach presses send there, and no API key ever has to be stored. */
const SMS = (() => {
  const MAX_LEN = 480;      // three concatenated SMS parts
  const MAX_TO = 50;        // recipients per send
  // Credentials from the old gateway builds are wiped on load so no access token
  // is left behind on a device that has already run one of them.
  const LEGACY_KEYS = ['stx_sms_provider', 'stx_sinch_plan', 'stx_sinch_token', 'stx_sinch_from',
    'stx_sinch_region', 'stx_brevo_key', 'stx_brevo_from', 'stx_mb_key', 'stx_mb_from'];
  try { LEGACY_KEYS.forEach(k => localStorage.removeItem(k)); } catch { /* private mode */ }

  const esc = s => UI.esc(s);
  const t = (k, fallback) => { const r = T(k); return r === k ? fallback : r; };

  // Accepts what a coach actually types (+45 12 34 56 78, 0045-…, (045)…) and
  // returns E.164 digits, or '' when it cannot be a phone number.
  function normNumber(v) {
    const raw = String(v == null ? '' : v).trim();
    if (!raw) return '';
    const plus = raw[0] === '+' || raw.slice(0, 2) === '00';
    const digits = raw.replace(/\D/g, '').replace(/^00/, '');
    if (digits.length < 8 || digits.length > 15) return '';
    return (plus ? '+' : '') + digits;
  }
  const label = p => ('#' + (p.number || '?') + ' ' + [p.firstName, p.lastName].filter(Boolean).join(' ')).trim();
  // Only players who actually have a usable number can be texted.
  function withPhone(list) { return (list || []).filter(p => normNumber(p.phone)); }

  // ---- Sending -----------------------------------------------------------
  function sendDevice(numbers, text) {
    // "?&body=" is the form both iOS and Android accept.
    window.location.href = 'sms:' + numbers.join(',') + '?&body=' + encodeURIComponent(text);
  }

  // ---- Compose dialog ----------------------------------------------------
  // compose({ players, text, title })
  function compose(opts) {
    opts = opts || {};
    const all = (opts.players || []).slice(0, 200);
    const able = withPhone(all);
    const missing = all.length - able.length;
    const preset = String(opts.text || '').slice(0, MAX_LEN);

    if (!all.length) return UI.toast(t('sms.noPlayers', 'No players to text'), 'error');
    if (!able.length) {
      return UI.modal({
        title: t('sms.title', 'Send SMS'),
        body: `<p>${esc(t('sms.noNumbers', 'None of these players has a phone number yet.'))}</p>
          <p class="hint">${esc(t('sms.addNumberHint', 'Add one under Teams & Players — edit the player and fill in Mobile.'))}</p>`,
        footer: `<button class="btn primary" data-close2>${esc(T('common.close'))}</button>`,
        onOpen: (m, close) => { m.querySelector('[data-close2]').onclick = close; }
      });
    }

    UI.modal({
      title: opts.title || t('sms.title', 'Send SMS'),
      width: 620,
      body: `
        <div class="sms-head">
          <span class="tag">${esc(t('sms.viaPhone', 'Sends through your own phone'))}</span>
          <button type="button" class="btn sm" data-sms-how>${esc(t('sms.how', 'How does this work?'))}</button>
        </div>
        <label class="field"><span>${esc(t('sms.recipients', 'Recipients'))}</span></label>
        <div class="sms-list">
          ${able.map((p, i) => `<label class="sms-row"><input type="checkbox" data-to="${esc(normNumber(p.phone))}" ${i < MAX_TO ? 'checked' : ''}>
            <span class="sms-name">${esc(label(p))}</span><span class="sms-num">${esc(normNumber(p.phone))}</span></label>`).join('')}
        </div>
        ${missing ? `<p class="hint">${esc(t('sms.someMissing', 'Players without a mobile number are not listed') + ': ' + missing)}</p>` : ''}
        <label class="field"><span>${esc(t('sms.message', 'Message'))}</span>
          <textarea id="sms_body" rows="5" maxlength="${MAX_LEN}" placeholder="${esc(t('sms.messagePh', 'Training moved to 18:30 — bring indoor shoes.'))}">${esc(preset)}</textarea></label>
        <p class="hint"><span id="sms_count">0</span>/${MAX_LEN} · ${esc(t('sms.privacy', 'Mobile numbers are personal data — only text what the player has agreed to receive.'))}</p>`,
      footer: `<button class="btn ghost" data-close2>${esc(T('common.cancel'))}</button>
        <button class="btn primary" data-send-phone>${esc(t('sms.sendPhone', 'Open in SMS app'))}</button>`,
      onOpen: (m, close) => {
        const box = m.querySelector('#sms_body');
        const count = m.querySelector('#sms_count');
        const sync = () => { count.textContent = box.value.length; };
        box.oninput = sync; sync();
        const picked = () => [...m.querySelectorAll('[data-to]:checked')].map(c => c.dataset.to).slice(0, MAX_TO);
        const text = () => box.value.trim();

        m.querySelector('[data-close2]').onclick = close;
        m.querySelector('[data-sms-how]').onclick = () => help();

        m.querySelector('[data-send-phone]').onclick = () => {
          const to = picked(); if (!to.length) return UI.toast(t('sms.pickOne', 'Pick at least one player'), 'error');
          if (!text()) return UI.toast(t('sms.needText', 'Write a message first'), 'error');
          close(); sendDevice(to, text());
        };
      }
    });
  }

  // ---- How-to ------------------------------------------------------------
  function help() {
    const li = (k, f) => `<li>${esc(t(k, f))}</li>`;
    UI.modal({
      title: t('sms.howTitle', 'Texting your players'),
      width: 640,
      body: `<p>${esc(t('sms.howIntro', 'Every squad list, the leaderboard and every finished report has an SMS button. Pick who should get the message, write it, and send.'))}</p>
        <h4>${esc(t('sms.howPhoneTitle', 'No account, no subscription'))}</h4>
        <p>${esc(t('sms.howPhone', 'Open in SMS app hands the message and the picked numbers to the phone\u2019s own messaging app. You send it yourself, it costs what your plan costs, and nothing leaves the device before you press send.'))}</p>
        <h4>${esc(t('sms.howStepsTitle', 'Step by step'))}</h4>
        <ol class="ai-guide">
          ${li('sms.howS4', 'Give every player a mobile number in international form (+45\u2026) under Teams & Players.')}
          ${li('sms.howS5', 'Press the SMS button, tick the players who should get the message and write it.')}
          ${li('sms.howS6', 'Press Open in SMS app. Your phone\u2019s messaging app opens with the numbers and the text already filled in.')}
          ${li('sms.howS7', 'Read it through and press send there. The message is sent from your own number, so replies come back to you.')}
        </ol>
        <h4>${esc(t('sms.howTroubleTitle', 'If nothing happens'))}</h4>
        <ul class="ai-guide">
          ${li('sms.howT1', 'On a desktop computer there is usually no SMS app to open. Use a phone or a tablet with a SIM card.')}
          ${li('sms.howT2', 'A number was skipped: it is not in international form. Edit the player and write it as +45\u2026')}
          ${li('sms.howT3', 'Some phones cut long group messages. Send to fewer players at a time if one of them does not receive it.')}
        </ul>
        <p class="hint">${esc(t('sms.howPrivacy', 'Phone numbers and message text are personal data. You are the controller \u2014 only text players who have agreed to it, and never send health or injury details by SMS.'))}</p>`,
      footer: `<button class="btn primary" data-close2>${esc(T('common.close'))}</button>`,
      onOpen: (m, close) => { m.querySelector('[data-close2]').onclick = close; }
    });
  }

  // Markup for the button every view mounts, so they all look the same.
  function btn(attr, text, cls) {
    return `<button class="btn ${cls || 'sm'}" ${attr}>\uD83D\uDCF1 ${esc(text || t('sms.sms', 'SMS'))}</button>`;
  }

  return { compose, help, normNumber, withPhone, btn };
})();
if (typeof window !== 'undefined') window.SMS = SMS;
