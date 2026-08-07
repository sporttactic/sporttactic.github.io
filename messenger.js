/* messenger.js — Peer-to-Peer, end-to-end encrypted private messenger.

   Privacy-focused, Signal-like, and serverless where it counts:
   • Identity keys (ECDH P-256) are generated on-device with the Web Crypto API,
     stored in an ISOLATED IndexedDB, and never leave the device (the private
     key is non-extractable, so it cannot be exported or uploaded).
   • WebRTC carries everything directly between the two browsers: text, files,
     voice and video. PeerJS is only the switchboard that introduces them, and
     it is handed nothing but a hash of the shared key.
   • Text and files are end-to-end encrypted with AES-GCM under a key derived
     from the shared room key, on top of the DTLS/SRTP encryption WebRTC already
     applies to every byte and every call.
   • Messages are encrypted at rest and support disappearing timers.
   • Safety numbers let two people verify no key was swapped (anti-impersonation).

   Hardening notes:
   • Shared-key rooms run PBKDF2 (310k) into HKDF, giving the chat key, the local
     room id and the PeerJS rendezvous address as independent values, so the
     address the broker sees costs a full KDF run per guess to walk back.
   • Weak shared keys are refused outright — the key is the only access control.
   • The shared key is held in memory and stored encrypted at rest, never in clear.
   • A connection is not "connected" until the far end returns a frame that
     decrypts under the shared key; AES-GCM is authenticated, so that is proof.
     Calls are only answered from a peer that has already passed that check, and
     the media path's DTLS fingerprint is compared with the one the peer
     published over the encrypted channel.
   • Chat bubbles are built with DOM APIs; nothing a peer sends is parsed as HTML.
   • Every data-channel frame is size- and shape-checked before it can allocate
     memory, and a session locks onto a single peer.
*/
window.Views = window.Views || {};
Views.messenger = function (mount, params) {
  const subtle = (window.crypto && crypto.subtle) || null;
  // Opened from Teams & Players with a member context (player or staff), or from Team Sync settings.
  const peer = (params && params.playerId)
    ? { id: params.playerId, name: String(params.playerName || ''), store: params.memberStore === 'coaches' ? 'coaches' : 'players' }
    : null;
  const backRoute = (params && params.from) || 'settings';
  // A view can hand over a ready-written message (a report line, a tactic note).
  let draft = String((params && params.draft) || '').slice(0, 4000);
  const back = () => (window.App && App.go ? App.go(backRoute) : null);

  // Unsupported (very old browsers / insecure context) — fail gracefully.
  if (!subtle || !window.RTCPeerConnection) {
    mount.innerHTML = `
      <div class="page-head"><div><h1>${tx('title')}</h1><p>${tx('subtitle')}</p></div>
        <div class="row" style="flex:0"><button class="btn" id="mBack">← ${tx('back')}</button></div></div>
      <div class="card"><p>${tx('unsupported')}</p></div>`;
    const b = mount.querySelector('#mBack'); if (b) b.onclick = back;
    return;
  }

  // ---------- tiny local translations (self-contained; EN + DA) ----------
  function tx(k) {
    const da = (window.I18N && I18N.getLang && I18N.getLang() === 'da');
    const EN = {
      title: 'Secure Messenger', subtitle: 'Peer-to-peer, end-to-end encrypted — no server, no account.',
      back: 'Team Sync', unsupported: 'This browser cannot run the secure messenger (Web Crypto / WebRTC unavailable). Use a modern browser over HTTPS.',
      you: 'Your identity', displayName: 'Display name', yourName: 'Your name', save: 'Save', fingerprint: 'Your safety fingerprint',
      yourLink: 'Your contact link', copy: 'Copy', copied: 'Copied to clipboard', share: 'Share this link so others can add you. It only contains your public key.',
      contacts: 'Contacts', addContact: 'Add contact', pasteLink: 'Paste a contact link…', add: 'Add', noContacts: 'No contacts yet. Share your link or paste someone else’s.',
      added: 'Contact added', invalidLink: 'That is not a valid contact link', selfLink: 'That link is your own identity',
      pick: 'Enter a shared key and tap Connect to start a private chat.', verified: 'Verified', unverified: 'Unverified',
      safety: 'Safety number', safetyHint: 'Compare these numbers out loud with your contact. If they match, no one is intercepting your keys.', markVerified: 'Mark verified', markUnverified: 'Mark unverified',
      connection: 'Connection', mode: 'Mode', chat: 'Chat only', voice: 'Voice call', video: 'Video call',
      createInvite: 'Create invite', inviteMade: 'Invite created — send this code to your contact:',
      haveInvite: 'I received an invite', pasteInvite: 'Paste the invite code you received…', accept: 'Accept invite',
      replyMade: 'Reply created — send this code back to your contact:', pasteReply: 'Paste their reply code…', complete: 'Complete connection',
      status: 'Status', disconnected: 'Disconnected', connecting: 'Connecting…', connected: 'Connected', closed: 'Connection closed',
      hangup: 'Hang up', attach: 'Attach', send: 'Send', typeMsg: 'Type a message…', notConnected: 'Not connected — create or accept an invite first',
      fileTooBig: 'File is too large (max 8 MB)', camDenied: 'Camera/microphone permission denied',
      disappearing: 'Disappearing messages', off: 'Off', min1: '1 minute', hour1: '1 hour', day1: '1 day', week1: '1 week',
      invalidCode: 'Invalid or corrupt code', badReply: 'That is not a reply code', badInvite: 'That is not an invite code',
      download: 'Download', encrypted: 'end-to-end encrypted', delete: 'Delete', deleted: 'Contact deleted', clearChat: 'Clear chat',
      inviteFriend: 'Invite a friend', haveInvitation: 'I have an invitation', sendInvitation: 'Send invitation', sendReply: 'Send the reply',
      pasteReplyBtn: 'Paste their reply', pasteInviteBtn: 'Paste the invitation', showCode: 'Show code / copy manually', orPasteBelow: 'Trouble sharing? Paste it here instead',
      step1Send: 'Send this invitation to your friend — by WhatsApp, SMS or e-mail.', step2Reply: 'Your friend will send a reply back. Paste it here to connect.',
      stepPasteInvite: 'Paste the invitation your friend sent you.', stepSendReply: 'Send this reply back to your friend. You will connect automatically.',
      waitingReply: 'Waiting for your friend’s reply…', waitingConnect: 'Almost done — connecting when your friend receives the reply…', nowConnected: 'You are connected — start chatting!',
      shareLink: 'Share my link', paste: 'Paste', pasteEmpty: 'Nothing to paste yet — copy your friend’s code first.', pasteBlocked: 'Couldn’t read the clipboard. Paste the code in the box instead.',
      shareLinkMsg: 'Add me on SportTactic Secure Messenger (private & end-to-end encrypted). My contact link:', shareInviteMsg: 'Let’s chat privately on SportTactic. Open Secure Messenger → “I have an invitation” → paste this code:', shareReplyMsg: 'Here is my reply code — paste it into your Secure Messenger to finish connecting:',
      quickConnect: 'Quick connect', quickConnectDesc: 'Both people type the same key and connect automatically. Tap the dice for a fresh key.',
      chatWith: 'Chat with', playerKeyHint: 'This key belongs to this member. Share it with them once — then you both connect straight away.',
      roster: 'Team chat setup', rosterDesc: 'Give each player or staff member their own key. Share it once, then one tap opens a private chat.',
      rosterEmpty: 'No players or staff yet. Add them under Teams & Players.', rosterStaff: 'Staff', rosterPlayers: 'Players',
      rosterSetup: 'Set up', rosterReady: 'Ready', rosterChat: 'Chat', rosterShare: 'Share key', rosterNewKey: 'New key',
      rosterCreated: 'Chat key created', rosterRotated: 'New chat key created — share it again',
      rosterRotateAsk: 'Create a new chat key? The old key stops working for this person.',
      generateKey: 'Generate a key', keyPlaceholder: 'Enter a shared key…', connect: 'Connect', keyChat: 'Shared-key chat', sharedKey: 'Shared key',
      reconnect: 'Reconnect', revealKey: 'Show key', connectingRelay: 'Connecting…', waitingPeer: 'Waiting for the other person to enter the same key…',
      noPeerYet: 'No one joined yet. Share the key, then tap Reconnect when they’re ready.', relayUnavailable: 'Couldn’t reach the connection helper. Check your internet and try again, or use “Invite a friend”.',
      keyNeeded: 'Type a key first, or tap the dice to create one.', keyHint: 'Both people must enter the exact same key. Anyone with the key can join — keep it private.',
      keyTooWeak: 'That key is too easy to guess. Use at least 12 varied characters — tap the dice for a strong one.',
      verifying: 'Checking you both hold the same key…', askingMedia: 'Waiting for microphone / camera permission…',
      noCamera: 'No microphone or camera was found on this device.',
      voiceCall: 'Start a voice call', videoCall: 'Start a video call', endCall: 'End call', calling: 'Calling…',
      callFailed: 'The call could not be started', micOn: 'Mic on', micOff: 'Mic off', camOn: 'Camera on', camOff: 'Camera off',
      callMitm: 'The call did not come from the device holding your key — it was dropped. Make a new key before trying again.',
      shareKeyMsg: 'Let’s chat privately on SportTactic. Open Secure Messenger → Quick connect → enter this key:'
    };
    const DA = {
      title: 'Sikre Beskeder', subtitle: 'Peer-to-peer, end-to-end krypteret — ingen server, ingen konto.',
      back: 'Holdsynk', unsupported: 'Denne browser kan ikke køre den sikre messenger (Web Crypto / WebRTC mangler). Brug en moderne browser over HTTPS.',
      you: 'Din identitet', displayName: 'Vist navn', yourName: 'Dit navn', save: 'Gem', fingerprint: 'Dit sikkerheds-fingeraftryk',
      yourLink: 'Dit kontakt-link', copy: 'Kopiér', copied: 'Kopieret', share: 'Del dette link, så andre kan tilføje dig. Det indeholder kun din offentlige nøgle.',
      contacts: 'Kontakter', addContact: 'Tilføj kontakt', pasteLink: 'Indsæt et kontakt-link…', add: 'Tilføj', noContacts: 'Ingen kontakter endnu. Del dit link eller indsæt en andens.',
      added: 'Kontakt tilføjet', invalidLink: 'Det er ikke et gyldigt kontakt-link', selfLink: 'Det link er din egen identitet',
      pick: 'Indtast en fælles nøgle og tryk Forbind for at starte en privat chat.', verified: 'Verificeret', unverified: 'Ikke verificeret',
      safety: 'Sikkerhedsnummer', safetyHint: 'Sammenlign disse tal højt med din kontakt. Hvis de matcher, opsnapper ingen jeres nøgler.', markVerified: 'Markér verificeret', markUnverified: 'Fjern verificering',
      connection: 'Forbindelse', mode: 'Tilstand', chat: 'Kun chat', voice: 'Taleopkald', video: 'Videoopkald',
      createInvite: 'Opret invitation', inviteMade: 'Invitation oprettet — send denne kode til din kontakt:',
      haveInvite: 'Jeg har modtaget en invitation', pasteInvite: 'Indsæt invitationskoden…', accept: 'Acceptér invitation',
      replyMade: 'Svar oprettet — send denne kode tilbage til din kontakt:', pasteReply: 'Indsæt deres svarkode…', complete: 'Fuldfør forbindelse',
      status: 'Status', disconnected: 'Afbrudt', connecting: 'Forbinder…', connected: 'Forbundet', closed: 'Forbindelse lukket',
      hangup: 'Læg på', attach: 'Vedhæft', send: 'Send', typeMsg: 'Skriv en besked…', notConnected: 'Ikke forbundet — opret eller acceptér en invitation først',
      fileTooBig: 'Filen er for stor (maks 8 MB)', camDenied: 'Kamera/mikrofon-tilladelse nægtet',
      disappearing: 'Forsvindende beskeder', off: 'Fra', min1: '1 minut', hour1: '1 time', day1: '1 dag', week1: '1 uge',
      invalidCode: 'Ugyldig eller beskadiget kode', badReply: 'Det er ikke en svarkode', badInvite: 'Det er ikke en invitationskode',
      download: 'Download', encrypted: 'end-to-end krypteret', delete: 'Slet', deleted: 'Kontakt slettet', clearChat: 'Ryd chat',
      inviteFriend: 'Inviter en ven', haveInvitation: 'Jeg har en invitation', sendInvitation: 'Send invitation', sendReply: 'Send svaret',
      pasteReplyBtn: 'Indsæt deres svar', pasteInviteBtn: 'Indsæt invitationen', showCode: 'Vis kode / kopiér manuelt', orPasteBelow: 'Problemer med at dele? Indsæt den her i stedet',
      step1Send: 'Send denne invitation til din ven — via WhatsApp, SMS eller e-mail.', step2Reply: 'Din ven sender et svar tilbage. Indsæt det her for at forbinde.',
      stepPasteInvite: 'Indsæt invitationen, din ven har sendt dig.', stepSendReply: 'Send dette svar tilbage til din ven. I forbindes automatisk.',
      waitingReply: 'Venter på din vens svar…', waitingConnect: 'Næsten færdig — forbinder når din ven modtager svaret…', nowConnected: 'I er forbundet — begynd at skrive!',
      shareLink: 'Del mit link', paste: 'Indsæt', pasteEmpty: 'Intet at indsætte endnu — kopiér din vens kode først.', pasteBlocked: 'Kunne ikke læse udklipsholderen. Indsæt koden i feltet i stedet.',
      shareLinkMsg: 'Tilføj mig på SportTactic Sikre Beskeder (privat & end-to-end krypteret). Mit kontakt-link:', shareInviteMsg: 'Lad os chatte privat på SportTactic. Åbn Sikre Beskeder → “Jeg har en invitation” → indsæt denne kode:', shareReplyMsg: 'Her er min svarkode — indsæt den i dine Sikre Beskeder for at fuldføre forbindelsen:',
      quickConnect: 'Hurtig forbindelse', quickConnectDesc: 'Begge skriver samme nøgle og forbindes automatisk. Tryk på terningen for en ny nøgle.',
      chatWith: 'Chat med', playerKeyHint: 'Denne nøgle hører til dette medlem. Del den én gang — så forbindes I med det samme.',
      roster: 'Opsæt holdchat', rosterDesc: 'Giv hver spiller eller træner sin egen nøgle. Del den én gang, så åbner ét tryk en privat chat.',
      rosterEmpty: 'Ingen spillere eller trænere endnu. Tilføj dem under Hold & Spillere.', rosterStaff: 'Trænerstab', rosterPlayers: 'Spillere',
      rosterSetup: 'Opsæt', rosterReady: 'Klar', rosterChat: 'Chat', rosterShare: 'Del nøgle', rosterNewKey: 'Ny nøgle',
      rosterCreated: 'Chat-nøgle oprettet', rosterRotated: 'Ny chat-nøgle oprettet — del den igen',
      rosterRotateAsk: 'Lav en ny chat-nøgle? Den gamle nøgle virker ikke længere for denne person.',
      generateKey: 'Lav en nøgle', keyPlaceholder: 'Indtast en fælles nøgle…', connect: 'Forbind', keyChat: 'Nøgle-chat', sharedKey: 'Fælles nøgle',
      reconnect: 'Forbind igen', revealKey: 'Vis nøgle', connectingRelay: 'Forbinder…', waitingPeer: 'Venter på at den anden indtaster samme nøgle…',
      noPeerYet: 'Ingen er kommet endnu. Del nøglen, og tryk Forbind igen, når de er klar.', relayUnavailable: 'Kunne ikke nå forbindelses-hjælperen. Tjek internettet og prøv igen, eller brug “Inviter en ven”.',
      keyNeeded: 'Skriv en nøgle først, eller tryk på terningen for at lave en.', keyHint: 'Begge skal indtaste præcis samme nøgle. Alle med nøglen kan deltage — hold den privat.',
      keyTooWeak: 'Den nøgle er for nem at gætte. Brug mindst 12 varierede tegn — tryk på terningen for en stærk nøgle.',
      verifying: 'Tjekker at I begge har samme nøgle…', askingMedia: 'Venter på tilladelse til mikrofon / kamera…',
      noCamera: 'Der blev ikke fundet nogen mikrofon eller kamera på denne enhed.',
      voiceCall: 'Start et taleopkald', videoCall: 'Start et videoopkald', endCall: 'Afslut opkald', calling: 'Ringer op…',
      callFailed: 'Opkaldet kunne ikke startes', micOn: 'Mikrofon til', micOff: 'Mikrofon fra', camOn: 'Kamera til', camOff: 'Kamera fra',
      callMitm: 'Opkaldet kom ikke fra enheden med din nøgle — det blev afvist. Lav en ny nøgle, før du prøver igen.',
      shareKeyMsg: 'Lad os chatte privat på SportTactic. Åbn Sikre Beskeder → Hurtig forbindelse → indtast denne nøgle:'
    };
    return (da ? DA : EN)[k] || k;
  }
  const toast = (m, t) => (window.UI && UI.toast ? UI.toast(m, t) : null);
  // Escape locally — never depend on an optional global for HTML safety.
  const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"'`]/g, ch => ESC_MAP[ch]);

  // ---------- limits & sanitisers: everything a peer or relay sends is hostile until validated ----------
  const LIMITS = {
    text: 4096,               // characters per chat message
    file: 8 * 1024 * 1024,    // bytes per file
    chunk: 32 * 1024,         // base64 characters per file-chunk frame
    transfers: 3,             // concurrent inbound transfers
    frame: 96 * 1024,         // bytes per data-channel frame
    sdp: 64 * 1024,           // characters of SDP accepted from the relay
    relay: 256 * 1024,        // bytes per relay payload
    ice: 64,                  // queued ICE candidates
    fileName: 64,             // characters of a file name
    peerName: 32,             // characters of a display name
    minKey: 12                // normalised characters of a shared key
  };
  // Inline preview allow-list. SVG is excluded on purpose: it can carry script.
  const IMG_MIME = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp'];
  // Control characters + bidi overrides (used for filename/name spoofing).
  const BAD_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
  const cleanText = s => String(s == null ? '' : s).replace(BAD_CHARS, '').slice(0, LIMITS.text);
  const cleanName = s => String(s == null ? '' : s).replace(BAD_CHARS, '').trim().slice(0, LIMITS.peerName);
  const safeMime = m => (typeof m === 'string' && IMG_MIME.indexOf(m.toLowerCase()) >= 0) ? m.toLowerCase() : 'application/octet-stream';
  function safeFileName(n) {
    const s = String(n == null ? '' : n).replace(BAD_CHARS, '').replace(/[\\/]+/g, '_').replace(/^[.\s]+/, '').trim().slice(0, LIMITS.fileName);
    return s || 'file';
  }

  // ---------- isolated IndexedDB (never touches the app's data / backups) ----------
  const MDB = (() => {
    const NAME = 'sporttactix-messenger', VER = 1, STORES = ['identity', 'contacts', 'messages'];
    let p = null;
    function open() {
      if (p) return p;
      p = new Promise((res, rej) => {
        const r = indexedDB.open(NAME, VER);
        r.onupgradeneeded = () => { const db = r.result; STORES.forEach(s => { if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' }); }); };
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
      });
      return p;
    }
    const os = async (s, m) => (await open()).transaction(s, m).objectStore(s);
    return {
      async get(s, id) { const o = await os(s, 'readonly'); return new Promise((res, rej) => { const r = o.get(id); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); },
      async getAll(s) { const o = await os(s, 'readonly'); return new Promise((res, rej) => { const r = o.getAll(); r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error); }); },
      async put(s, v) { const o = await os(s, 'readwrite'); return new Promise((res, rej) => { const r = o.put(v); r.onsuccess = () => res(v); r.onerror = () => rej(r.error); }); },
      async del(s, id) { const o = await os(s, 'readwrite'); return new Promise((res, rej) => { const r = o.delete(id); r.onsuccess = () => res(); r.onerror = () => rej(r.error); }); }
    };
  })();

  // ---------- byte / base64 helpers ----------
  const ENC = new TextEncoder(), DEC = new TextDecoder();
  function b64enc(buf) { const b = new Uint8Array(buf); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); }
  function b64dec(str) { const bin = atob(str); const b = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i); return b.buffer; }
  const rid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  async function sha256Hex(str) { const h = await subtle.digest('SHA-256', ENC.encode(str)); return Array.from(new Uint8Array(h)).map(x => x.toString(16).padStart(2, '0')).join(''); }

  // ---------- identity & crypto ----------
  let identity = null;      // { id:'self', name, priv (CryptoKey, non-extractable), pub, pubJwk }
  let atRest = null;        // AES-GCM CryptoKey for encryption-at-rest
  const wireKeys = {};      // contactId -> AES-GCM CryptoKey derived via ECDH

  async function ensureIdentity() {
    let rec = await MDB.get('identity', 'self');
    if (!rec) {
      const kp = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey']); // private key non-extractable
      const pubJwk = await subtle.exportKey('jwk', kp.publicKey);
      rec = { id: 'self', name: '', priv: kp.privateKey, pub: kp.publicKey, pubJwk };
      await MDB.put('identity', rec);
    }
    identity = rec;
    let ar = await MDB.get('identity', 'atrest');
    if (!ar) { const k = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']); ar = { id: 'atrest', key: k }; await MDB.put('identity', ar); }
    atRest = ar.key;
  }
  const importPub = jwk => subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, true, []);
  async function wireKeyFor(c) {
    if (wireKeys[c.id]) return wireKeys[c.id];
    const pub = await importPub(c.pubJwk);
    const key = await subtle.deriveKey({ name: 'ECDH', public: pub }, identity.priv, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    wireKeys[c.id] = key; return key;
  }
  async function aesEnc(key, buf) { const iv = crypto.getRandomValues(new Uint8Array(12)); const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, key, buf); return { iv: b64enc(iv), ct: b64enc(ct) }; }
  async function aesDec(key, ivB64, ctB64) { return subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(b64dec(ivB64)) }, key, b64dec(ctB64)); }
  const encStr = (key, str) => aesEnc(key, ENC.encode(str));
  const decStr = async (key, iv, ct) => DEC.decode(await aesDec(key, iv, ct));

  // 60-digit safety number between me and a contact (order-independent).
  async function safetyNumber(pubJwk) {
    const mine = identity.pubJwk.x + identity.pubJwk.y, theirs = pubJwk.x + pubJwk.y;
    const hex = await sha256Hex([mine, theirs].sort().join('|'));
    let d = '';
    for (let i = 0; i < hex.length && d.length < 60; i += 2) d += (parseInt(hex.substr(i, 2), 16) % 100).toString().padStart(2, '0');
    return d.slice(0, 60).replace(/(\d{5})(?=\d)/g, '$1 ');
  }
  async function myFingerprint() {
    const hex = await sha256Hex(identity.pubJwk.x + identity.pubJwk.y);
    return hex.slice(0, 32).toUpperCase().replace(/(.{4})(?=.)/g, '$1 ');
  }
  const sameKey = (a, b) => a && b && a.x === b.x && a.y === b.y;

  // ---------- link / code encoding ----------
  const contactLink = () => 'stx:contact:' + b64enc(ENC.encode(JSON.stringify({ n: identity.name || '', k: identity.pubJwk })));
  function parseContactLink(s) {
    try { const m = /stx:contact:([A-Za-z0-9+/=]+)/.exec((s || '').trim()); if (!m) return null; const o = JSON.parse(DEC.decode(b64dec(m[1]))); return o && o.k && o.k.x ? o : null; } catch (e) { return null; }
  }
  const packSig = o => 'stx:sig:' + b64enc(ENC.encode(JSON.stringify(o)));
  function parseSig(s) {
    try { const m = /stx:sig:([A-Za-z0-9+/=]+)/.exec((s || '').trim()); if (!m) return null; return JSON.parse(DEC.decode(b64dec(m[1]))); } catch (e) { return null; }
  }

  // ---------- state ----------
  let contacts = [];
  let active = null;                 // active contact id
  let pc = null, dc = null, wireKey = null;
  let dcContact = null;              // contact the open data channel belongs to
  let sig = null;                    // active shared-key rendezvous session
  let localStream = null;
  let peerLib = null;                // cached PeerJS <script> load
  let peerObj = null;                // the PeerJS Peer for this session
  let dataConn = null;               // PeerJS DataConnection (text + files)
  let mediaConn = null;              // PeerJS MediaConnection (voice + video)
  let authed = false;                // the peer has proved it holds the shared key
  let callMode = 'chat';             // what the user asked for when connecting
  let pendingCall = null;            // call to place as soon as the peer is verified
  const incoming = {};               // in-flight file transfers by id
  const roomSecrets = {};            // contactId -> shared key, in memory only (never persisted in clear)
  const blobUrls = [];               // object URLs to revoke
  const contact = id => contacts.find(c => c.id === id);
  // Nothing may be sent before the far end has decrypted a frame under the shared
  // key: an unauthenticated channel is just a stranger who found the same room.
  const dcReady = () => !!(wireKey && authed && ((dataConn && dataConn.open) || (dc && dc.readyState === 'open')));
  function wsend(obj) {
    const s = JSON.stringify(obj);
    if (dataConn && dataConn.open) { dataConn.send(s); return true; }
    if (dc && dc.readyState === 'open') { dc.send(s); return true; }
    return false;
  }
  function trackUrl(u) { blobUrls.push(u); return u; }
  function revokeUrls() { while (blobUrls.length) { try { URL.revokeObjectURL(blobUrls.pop()); } catch (e) { } } }

  async function upsertContactFromKey(name, k) {
    let c = contacts.find(x => sameKey(x.pubJwk, k));
    if (c) { if (name && !c.name) { c.name = name; await MDB.put('contacts', c); } return c; }
    c = { id: rid(), name: name || 'Peer', pubJwk: k, verified: false, ttl: 0 };
    await MDB.put('contacts', c); contacts.push(c); return c;
  }

  // ---------- message persistence (encrypted at rest) ----------
  async function persistMsg(contactId, dir, payload) {
    const blob = await encStr(atRest, JSON.stringify(payload));
    const rec = { id: rid(), contactId, dir, ts: Date.now(), iv: blob.iv, ct: blob.ct };
    await MDB.put('messages', rec); return rec;
  }
  async function loadMessages(contactId) {
    const all = await MDB.getAll('messages');
    const c = contact(contactId);
    const cutoff = c && c.ttl ? Date.now() - c.ttl * 1000 : 0;
    const out = [];
    for (const m of all) {
      if (m.contactId !== contactId) continue;
      if (cutoff && m.ts < cutoff) { MDB.del('messages', m.id); continue; }
      try { const p = JSON.parse(await decStr(atRest, m.iv, m.ct)); out.push(Object.assign({ ts: m.ts, dir: m.dir }, p)); } catch (e) { }
    }
    return out.sort((a, b) => a.ts - b.ts);
  }
  async function purgeExpired() {
    const c = contact(active); if (!c || !c.ttl) return;
    const all = await MDB.getAll('messages'); const cutoff = Date.now() - c.ttl * 1000;
    let changed = false;
    for (const m of all) if (m.contactId === active && m.ts < cutoff) { await MDB.del('messages', m.id); changed = true; }
    if (changed) refreshMessages();
  }

  // ================= rendering =================
  function render() {
    mount.innerHTML = `
      <div class="page-head">
        <div><h1>${tx('title')}</h1><p>${peer && peer.name ? tx('chatWith') + ' ' + esc(peer.name) : tx('subtitle')}</p></div>
        <div class="row" style="flex:0"><button class="btn" id="mBack">← ${esc(backRoute === 'teams' && window.T ? T('teams.title') : tx('back'))}</button></div>
      </div>
      <div class="msg-wrap">
        <div class="msg-side">
          <div class="card quick-card">
            <h3>⚡ ${tx('quickConnect')}</h3>
            <p class="hint" style="margin:2px 0 8px">${tx('quickConnectDesc')}</p>
            <label class="field" style="margin:2px 0 8px"><span>${tx('yourName')}</span>
              <input id="qcName" type="text" maxlength="32" value="${esc(identity.name)}" placeholder="Coach / Player" autocomplete="off">
            </label>
            <div class="row" style="flex:0;gap:6px;align-items:stretch">
              <input id="qcKey" type="text" placeholder="${tx('keyPlaceholder')}" autocomplete="off" spellcheck="false" style="flex:1;min-width:0">
              <button class="btn sm" id="qcGen" title="${tx('generateKey')}" aria-label="${tx('generateKey')}">🎲</button>
            </div>
            <label class="field" style="max-width:200px;margin:8px 0 0"><span>${tx('mode')}</span>
              <select id="qcMode"><option value="chat">${tx('chat')}</option><option value="voice">${tx('voice')}</option><option value="video">${tx('video')}</option></select>
            </label>
            <div class="row" style="flex:0;gap:6px;margin-top:8px">
              <button class="btn sm primary" id="qcConnect">🔗 ${tx('connect')}</button>
              <button class="btn sm" id="qcShare">📤 ${tx('shareLink')}</button>
              <button class="btn sm" id="qcCopy">📋 ${tx('copy')}</button>
            </div>
            <p class="hint" id="qcStatus" style="margin:8px 0 2px"></p>
            <p class="hint">${peer ? tx('playerKeyHint') : tx('keyHint')}</p>
          </div>
          <div class="card roster-card">
            <h3>👥 ${tx('roster')}</h3>
            <p class="hint" style="margin:2px 0 8px">${tx('rosterDesc')}</p>
            <div id="rosterList"></div>
          </div>
        </div>
        <div class="card msg-conv" id="convPane"></div>
      </div>`;
    mount.querySelector('#mBack').onclick = back;
    const saveQcName = async () => { const nm = cleanName(mount.querySelector('#qcName').value); if (nm !== identity.name) { identity.name = nm; await MDB.put('identity', identity); } };
    mount.querySelector('#qcName').onchange = saveQcName;
    mount.querySelector('#qcGen').onclick = () => { const i = mount.querySelector('#qcKey'); i.value = generateKey(); i.focus(); };
    mount.querySelector('#qcConnect').onclick = async () => { const k = mount.querySelector('#qcKey').value; if (!normalizeKey(k)) return toast(tx('keyNeeded'), 'error'); await saveQcName(); keyConnect(k, mount.querySelector('#qcMode').value); };
    mount.querySelector('#qcShare').onclick = () => { const k = mount.querySelector('#qcKey').value.trim(); if (!normalizeKey(k)) return toast(tx('keyNeeded'), 'error'); shareOrCopy(k, 'key'); };
    mount.querySelector('#qcCopy').onclick = () => { const k = mount.querySelector('#qcKey').value.trim(); if (!normalizeKey(k)) return toast(tx('keyNeeded'), 'error'); copy(k); };
    mount.querySelector('#qcKey').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); mount.querySelector('#qcConnect').click(); } });
    renderRoster();
    if (peer) prefillPeerKey();
    renderConversation();
  }

  // ---------- team roster: one shared key per player / staff member ----------
  // The key lives on the squad record (`chatKey`), so it survives app restarts and
  // travels with a normal data backup. It is only a room passphrase — no identity
  // key ever leaves this device.
  function rosterMembers() {
    if (typeof Store === 'undefined') return [];
    const team = Store.activeTeam();
    const mine = (rows, f) => (team ? rows.filter(r => r.teamId === team.id) : rows).map(f);
    const staff = mine(Store.all('coaches'), c => ({ store: 'coaches', id: c.id, name: c.name || '', role: c.role || '', key: c.chatKey || '' }));
    const players = mine(Store.players(), p => ({
      store: 'players', id: p.id, name: ((p.firstName || '') + ' ' + (p.lastName || '')).trim(),
      role: p.position || '', key: p.chatKey || ''
    }));
    return { staff: staff.filter(m => m.name), players: players.filter(m => m.name) };
  }
  function renderRoster() {
    const box = mount.querySelector('#rosterList'); if (!box) return;
    const { staff, players } = rosterMembers();
    if (!staff.length && !players.length) { box.innerHTML = `<p class="hint">${tx('rosterEmpty')}</p>`; return; }
    const row = m => `
      <div class="roster-row">
        <span class="roster-name">${esc(m.name)}</span>
        <span class="tag">${esc(m.role)}</span>
        <span class="tag ${m.key ? 'green' : ''}">${m.key ? '🔑 ' + tx('rosterReady') : tx('rosterSetup')}</span>
        <span class="roster-acts">
          <button class="btn sm primary" data-mchat="${esc(m.store)}:${esc(m.id)}">💬 ${tx('rosterChat')}</button>
          <button class="btn sm" data-mshare="${esc(m.store)}:${esc(m.id)}" title="${tx('rosterShare')}">📤</button>
          <button class="btn sm" data-mnew="${esc(m.store)}:${esc(m.id)}" title="${tx('rosterNewKey')}">🎲</button>
        </span>
      </div>`;
    box.innerHTML =
      (staff.length ? `<h4 class="roster-head">${tx('rosterStaff')}</h4>` + staff.map(row).join('') : '') +
      (players.length ? `<h4 class="roster-head">${tx('rosterPlayers')}</h4>` + players.map(row).join('') : '');
    box.querySelectorAll('[data-mchat]').forEach(b => b.onclick = () => memberChat(b.dataset.mchat));
    box.querySelectorAll('[data-mshare]').forEach(b => b.onclick = () => memberShare(b.dataset.mshare));
    box.querySelectorAll('[data-mnew]').forEach(b => b.onclick = () => memberNewKey(b.dataset.mnew));
  }
  function splitRef(ref) {
    const i = String(ref).indexOf(':');
    return { store: ref.slice(0, i), id: ref.slice(i + 1) };
  }
  // Returns the member's key, creating and saving one on first use.
  async function memberKey(ref, force) {
    const { store, id } = splitRef(ref);
    const rec = Store.find(store, id);
    if (!rec) return '';
    if (force || !normalizeKey(rec.chatKey || '')) {
      rec.chatKey = generateKey();
      await Store.save(store, rec);
      renderRoster();
      toast(tx(force ? 'rosterRotated' : 'rosterCreated'), 'success');
    }
    return rec.chatKey;
  }
  async function memberChat(ref) {
    const key = await memberKey(ref);
    if (!key) return;
    const input = mount.querySelector('#qcKey'); if (input) input.value = key;
    const nm = mount.querySelector('#qcName');
    if (nm) { const clean = cleanName(nm.value); if (clean !== identity.name) { identity.name = clean; await MDB.put('identity', identity); } }
    keyConnect(key, (mount.querySelector('#qcMode') || {}).value || 'chat');
  }
  async function memberShare(ref) {
    const key = await memberKey(ref);
    if (key) shareOrCopy(key, 'key');
  }
  function memberNewKey(ref) {
    const run = () => memberKey(ref, true);
    if (window.UI && UI.confirm) UI.confirm(tx('rosterRotateAsk'), run); else run();
  }

  // A player or staff member opened from Teams & Players or the leaderboard keeps
  // their own shared key, so the coach never has to retype it. It is created once,
  // on first use, and the conversation opens straight away.
  async function prefillPeerKey() {
    const input = mount.querySelector('#qcKey');
    if (!input || typeof Store === 'undefined') return;
    const rec = Store.find(peer.store, peer.id);
    if (!rec) return;
    if (!normalizeKey(rec.chatKey || '')) {
      rec.chatKey = generateKey();
      try { await Store.save(peer.store, rec); } catch (e) { return; }
      renderRoster();
    }
    if (!input.value) input.value = rec.chatKey;
    keyConnect(rec.chatKey, (mount.querySelector('#qcMode') || {}).value || 'chat');
  }

  function renderContacts() {
    const list = mount.querySelector('#contactList'); if (!list) return;
    if (!contacts.length) { list.innerHTML = `<p class="hint">${tx('noContacts')}</p>`; return; }
    list.innerHTML = contacts.map(c => `
      <button class="contact-item ${c.id === active ? 'active' : ''}" data-c="${c.id}">
        <span>${esc(c.name || 'Peer')}</span>
        <span class="tag" style="${c.kind === 'keyroom' ? 'color:var(--accent)' : (c.verified ? 'color:#22c55e' : '')}">${c.kind === 'keyroom' ? '🔑' : (c.verified ? '✓' : '•')}</span>
      </button>`).join('');
    list.querySelectorAll('[data-c]').forEach(b => b.onclick = () => selectContact(b.dataset.c));
  }

  async function onAddContact() {
    const ta = mount.querySelector('#addLink'); const o = parseContactLink(ta.value);
    if (!o) return toast(tx('invalidLink'), 'error');
    if (sameKey(o.k, identity.pubJwk)) return toast(tx('selfLink'), 'error');
    const c = await upsertContactFromKey(o.n, o.k);
    ta.value = ''; renderContacts(); toast(tx('added'), 'success'); selectContact(c.id);
  }

  function selectContact(id) {
    if (active !== id) closeConn();
    active = id; renderContacts(); renderConversation();
  }

  function renderConversation() {
    const pane = mount.querySelector('#convPane'); if (!pane) return;
    const c = contact(active);
    if (!c) { pane.innerHTML = `<div class="empty"><div class="big">🔒</div><p>${tx('pick')}</p></div>`; return; }
    const isRoom = c.kind === 'keyroom';
    const headTag = isRoom
      ? `<span class="tag" style="color:var(--accent)">🔑 ${tx('sharedKey')}</span>`
      : `<span class="tag" id="verBadge" style="${c.verified ? 'color:#22c55e' : ''}">${c.verified ? tx('verified') : tx('unverified')}</span>`;
    const connButtons = isRoom
      ? `<button class="btn primary" id="btnReconnect">🔗 ${tx('reconnect')}</button>
            <button class="btn" id="btnRevealKey">🔑 ${tx('revealKey')}</button>
            <button class="btn sm danger hidden" id="btnHangup">${tx('hangup')}</button>`
      : `<button class="btn primary" id="btnInvite">👋 ${tx('inviteFriend')}</button>
            <button class="btn" id="btnHaveInvite">📨 ${tx('haveInvitation')}</button>
            <button class="btn sm danger hidden" id="btnHangup">${tx('hangup')}</button>`;    const safetyBlock = isRoom ? '' : `
      <details class="msg-fold" style="margin-top:8px"><summary>${tx('safety')}</summary>
        <div style="margin-top:8px">
          <p class="hint">${tx('safetyHint')}</p>
          <div class="safety-num" id="safetyNum">…</div>
          <div class="row" style="flex:0;margin-top:6px"><button class="btn sm" id="btnVerify">${c.verified ? tx('markUnverified') : tx('markVerified')}</button></div>
        </div>
      </details>`;
    pane.innerHTML = `
      <div class="row" style="justify-content:space-between;align-items:center">
        <div><h2 style="margin:0">${esc(c.name || 'Peer')}</h2>
          ${headTag}
          <span class="tag" id="connStatus">${tx('disconnected')}</span></div>
        <div class="row" style="flex:0;gap:6px">
          <button class="btn sm" id="delContact">${tx('delete')}</button>
        </div>
      </div>

      <details class="msg-fold" id="connDetails" open style="margin-top:10px"><summary>${tx('connection')}</summary>
        <div style="margin-top:10px">
          <label class="field" style="max-width:220px"><span>${tx('mode')}</span>
            <select id="connMode"><option value="chat">${tx('chat')}</option><option value="voice">${tx('voice')}</option><option value="video">${tx('video')}</option></select>
          </label>
          <div class="row" style="flex:0;gap:8px;flex-wrap:wrap;margin-top:8px">
            ${connButtons}
          </div>
          <div id="sigArea" style="margin-top:10px"></div>
        </div>
      </details>
      ${safetyBlock}

      <div class="call-area hidden" id="callArea">
        <video id="localVid" autoplay muted playsinline class="hidden"></video>
        <video id="remoteVid" autoplay playsinline></video>
        <div class="call-bar">
          <button class="btn sm hidden" id="btnMic">🎤</button>
          <button class="btn sm hidden" id="btnCam">🎥</button>
          <button class="btn sm danger hidden" id="btnEndCall">📵 ${tx('endCall')}</button>
        </div>
      </div>

      <div class="row" style="justify-content:space-between;align-items:center;margin-top:10px">
        <label class="field" style="max-width:200px;margin:0"><span>${tx('disappearing')}</span>
          <select id="ttlSel">
            <option value="0">${tx('off')}</option><option value="60">${tx('min1')}</option>
            <option value="3600">${tx('hour1')}</option><option value="86400">${tx('day1')}</option><option value="604800">${tx('week1')}</option>
          </select>
        </label>
        <button class="btn sm ghost" id="btnClear">${tx('clearChat')}</button>
      </div>

      <div class="msg-list" id="msgList"></div>
      <div class="composer">
        <label class="btn sm" style="cursor:pointer">${tx('attach')}<input id="fileInput" type="file" hidden></label>
        <button class="btn sm" id="btnVoice" disabled title="${tx('voiceCall')}">📞</button>
        <button class="btn sm" id="btnVideo" disabled title="${tx('videoCall')}">🎥</button>
        <input id="msgInput" type="text" placeholder="${tx('typeMsg')}" autocomplete="off">
        <button class="btn primary" id="btnSend">${tx('send')}</button>
      </div>`;

    mount.querySelector('#btnVoice').onclick = () => startCall('voice');
    mount.querySelector('#btnVideo').onclick = () => startCall('video');
    mount.querySelector('#btnMic').onclick = () => toggleTrack('audio');
    mount.querySelector('#btnCam').onclick = () => toggleTrack('video');
    mount.querySelector('#btnEndCall').onclick = () => endCall(true);
    mount.querySelector('#delContact').onclick = () => deleteContact(c.id);
    mount.querySelector('#btnHangup').onclick = () => { closeConn(); setStatus('closed'); };
    mount.querySelector('#btnClear').onclick = () => clearChat(c.id);
    const modeSel = mount.querySelector('#connMode'); modeSel.value = 'chat';
    if (isRoom) {
      mount.querySelector('#btnReconnect').onclick = async () => keyConnect(await roomSecret(c), modeSel.value);
      mount.querySelector('#btnRevealKey').onclick = async () => {
        const area = mount.querySelector('#sigArea'); const disp = await roomSecret(c);
        area.innerHTML = `<div class="conn-step">
            <p class="step"><span class="num">🔑</span>${tx('sharedKey')}</p>
            <div class="safety-num">${esc(disp)}</div>
            <div class="row" style="flex:0;margin-top:6px;gap:6px"><button class="btn sm primary" id="shareKeyBtn">📤 ${tx('shareLink')}</button><button class="btn sm" id="copyKeyBtn">${tx('copy')}</button></div>
            <p class="hint">${tx('keyHint')}</p>
          </div>`;
        area.querySelector('#shareKeyBtn').onclick = () => shareOrCopy(disp, 'key');
        area.querySelector('#copyKeyBtn').onclick = () => copy(disp);
      };
    } else {
      mount.querySelector('#btnInvite').onclick = createInvite;
      mount.querySelector('#btnHaveInvite').onclick = showAcceptUI;
      mount.querySelector('#btnVerify').onclick = async () => { c.verified = !c.verified; await MDB.put('contacts', c); renderContacts(); renderConversation(); };
      safetyNumber(c.pubJwk).then(sn => { const el = mount.querySelector('#safetyNum'); if (el) el.textContent = sn; });
    }
    const ttl = mount.querySelector('#ttlSel'); ttl.value = String(c.ttl || 0);
    ttl.onchange = async () => { c.ttl = +ttl.value; await MDB.put('contacts', c); purgeExpired(); };
    mount.querySelector('#btnSend').onclick = sendText;
    mount.querySelector('#msgInput').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); sendText(); } });
    mount.querySelector('#fileInput').onchange = e => { const f = e.target.files[0]; if (f) sendFile(f); e.target.value = ''; };
    if (draft) { const i = mount.querySelector('#msgInput'); if (i) { i.value = draft; draft = ''; } }
    if (authed) setStatus('connected'); else if (pc) setStatus(pc.connectionState);
    reattachMedia();
    refreshMessages();
  }

  async function refreshMessages() {
    const list = mount.querySelector('#msgList'); if (!list || !active) return;
    const msgs = await loadMessages(active);
    revokeUrls();
    list.innerHTML = '';
    msgs.forEach(m => addBubble(m, false));
    list.scrollTop = list.scrollHeight;
  }

  // Built with DOM APIs only — no peer-supplied value is ever parsed as HTML.
  function addBubble(m, scroll) {
    const list = mount.querySelector('#msgList'); if (!list) return;
    const div = document.createElement('div');
    div.className = 'bubble ' + (m.dir === 'out' ? 'out' : 'in');
    const time = new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (m.kind === 'file') {
      const name = safeFileName(m.name);
      if (m.url && IMG_MIME.indexOf(String(m.mime).toLowerCase()) >= 0) {
        const img = document.createElement('img'); img.src = m.url; img.alt = name; div.appendChild(img);
      } else {
        div.appendChild(document.createTextNode('📎 ' + name));
      }
      if (m.url) {
        div.appendChild(document.createTextNode(' '));
        const a = document.createElement('a');
        a.href = m.url; a.download = name; a.className = 'tag'; a.rel = 'noopener noreferrer';
        a.textContent = tx('download');
        div.appendChild(a);
      }
    } else {
      div.textContent = m.text || '';
    }
    const meta = document.createElement('span'); meta.className = 'meta'; meta.textContent = time; div.appendChild(meta);
    list.appendChild(div);
    if (scroll !== false) list.scrollTop = list.scrollHeight;
  }

  function setStatus(state) {
    const el = mount.querySelector('#connStatus'); if (!el) return;
    const map = { new: tx('disconnected'), connecting: tx('connecting'), connected: tx('connected'), disconnected: tx('closed'), failed: tx('closed'), closed: tx('closed') };
    el.textContent = map[state] || state;
    const hang = mount.querySelector('#btnHangup'); if (hang) hang.classList.toggle('hidden', state !== 'connected' && state !== 'connecting');
  }

  // ================= WebRTC (serverless copy/paste signaling) =================
  function newPC() {
    const p = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    p.onconnectionstatechange = () => setStatus(p.connectionState);
    p.ontrack = e => { const rv = mount.querySelector('#remoteVid'); if (rv) rv.srcObject = e.streams[0]; const ca = mount.querySelector('#callArea'); if (ca) ca.classList.remove('hidden'); };
    return p;
  }
  function waitIce(p) {
    return new Promise(res => {
      if (p.iceGatheringState === 'complete') return res();
      const done = () => { if (p.iceGatheringState === 'complete') { p.removeEventListener('icegatheringstatechange', done); res(); } };
      p.addEventListener('icegatheringstatechange', done);
      setTimeout(res, 2500); // fall back to whatever candidates we have
    });
  }
  async function addLocalMedia(kind) {
    if (kind === 'chat') return;
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: kind === 'video' });
      localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
      const lv = mount.querySelector('#localVid'); if (lv) { lv.srcObject = localStream; lv.classList.remove('hidden'); }
      const ca = mount.querySelector('#callArea'); if (ca) ca.classList.remove('hidden');
    } catch (e) { toast(tx('camDenied'), 'error'); }
  }
  function reattachMedia() {
    const lv = mount.querySelector('#localVid'), rv = mount.querySelector('#remoteVid');
    if (localStream && lv) { lv.srcObject = localStream; lv.classList.toggle('hidden', !localStream.getVideoTracks().length); showCallArea(true); }
    if (mediaConn && mediaConn.remoteStream && rv) { rv.srcObject = mediaConn.remoteStream; showCallArea(true); }
    updateCallButtons();
  }

  function setupDC(channel) {
    dc = channel;
    dcContact = active;
    dc.onopen = async () => { setSigStatus(tx('verifying')); await sendAuth(); };
    dc.onclose = () => { authed = false; setStatus('closed'); updateCallButtons(); };
    dc.onmessage = onWire;
  }

  async function createInvite() {
    const c = contact(active); if (!c) return;
    const mode = mount.querySelector('#connMode').value;
    closeConn();
    pc = newPC(); wireKey = await wireKeyFor(c);
    setupDC(pc.createDataChannel('chat'));
    await addLocalMedia(mode);
    setStatus('connecting');
    const offer = await pc.createOffer(); await pc.setLocalDescription(offer); await waitIce(pc);
    const code = packSig({ t: 'offer', mode, name: identity.name, k: identity.pubJwk, sdp: pc.localDescription.sdp });
    copySilently(code);
    const applyReply = async (val) => {
      const sig = parseSig(val);
      if (!sig) return toast(tx('invalidCode'), 'error');
      if (sig.t !== 'answer') return toast(tx('badReply'), 'error');
      try { await pc.setRemoteDescription({ type: 'answer', sdp: sig.sdp }); setStatus('connecting'); }
      catch (e) { toast(tx('invalidCode'), 'error'); }
    };
    const area = mount.querySelector('#sigArea');
    area.innerHTML = `
      <div class="conn-step">
        <p class="step"><span class="num">1</span>${tx('step1Send')}</p>
        <button class="btn primary block" id="shareInvite">📤 ${tx('sendInvitation')}</button>
      </div>
      <div class="conn-step" style="margin-top:12px">
        <p class="step"><span class="num">2</span>${tx('step2Reply')}</p>
        <button class="btn primary block" id="pasteReplyBtn">📋 ${tx('pasteReplyBtn')}</button>
        <details style="margin-top:8px"><summary class="hint">${tx('orPasteBelow')}</summary>
          <textarea class="conn-code" id="inReply" placeholder="${tx('pasteReply')}"></textarea>
          <div class="row" style="flex:0;margin-top:6px"><button class="btn sm" id="applyReply">${tx('complete')}</button></div>
        </details>
        <p class="hint conn-wait">${tx('waitingReply')}</p>
      </div>`;
    area.querySelector('#shareInvite').onclick = () => shareOrCopy(code, 'invite');
    area.querySelector('#pasteReplyBtn').onclick = async () => {
      const t = await readClipboard();
      if (t === null) return toast(tx('pasteBlocked'), 'error');
      if (!t.trim()) return toast(tx('pasteEmpty'), 'error');
      applyReply(t);
    };
    area.querySelector('#applyReply').onclick = () => applyReply(area.querySelector('#inReply').value);
  }

  function showAcceptUI() {
    const area = mount.querySelector('#sigArea');
    area.innerHTML = `
      <div class="conn-step">
        <p class="step"><span class="num">1</span>${tx('stepPasteInvite')}</p>
        <button class="btn primary block" id="pasteInviteBtn">📋 ${tx('pasteInviteBtn')}</button>
        <details style="margin-top:8px"><summary class="hint">${tx('orPasteBelow')}</summary>
          <textarea class="conn-code" id="inInvite" placeholder="${tx('pasteInvite')}"></textarea>
          <div class="row" style="flex:0;margin-top:6px"><button class="btn sm" id="doAccept">${tx('accept')}</button></div>
        </details>
      </div>`;
    area.querySelector('#pasteInviteBtn').onclick = async () => {
      const t = await readClipboard();
      if (t === null) return toast(tx('pasteBlocked'), 'error');
      if (!t.trim()) return toast(tx('pasteEmpty'), 'error');
      acceptInvite(t);
    };
    area.querySelector('#doAccept').onclick = () => acceptInvite(area.querySelector('#inInvite').value);
  }

  async function acceptInvite(codeStr) {
    const sig = parseSig(codeStr);
    if (!sig) return toast(tx('invalidCode'), 'error');
    if (sig.t !== 'offer') return toast(tx('badInvite'), 'error');
    const c = await upsertContactFromKey(sig.name, sig.k);
    active = c.id; renderContacts();
    closeConn();
    pc = newPC(); wireKey = await wireKeyFor(c);
    pc.ondatachannel = e => setupDC(e.channel);
    setStatus('connecting');
    await addLocalMedia(sig.mode || 'chat');
    try { await pc.setRemoteDescription({ type: 'offer', sdp: sig.sdp }); } catch (e) { return toast(tx('invalidCode'), 'error'); }
    const ans = await pc.createAnswer(); await pc.setLocalDescription(ans); await waitIce(pc);
    const reply = packSig({ t: 'answer', name: identity.name, k: identity.pubJwk, sdp: pc.localDescription.sdp });
    copySilently(reply);
    renderConversation();
    const details = mount.querySelector('#connDetails'); if (details) details.open = true;
    setStatus('connecting');
    const area = mount.querySelector('#sigArea');
    area.innerHTML = `
      <div class="conn-step">
        <p class="step"><span class="num">2</span>${tx('stepSendReply')}</p>
        <button class="btn primary block" id="shareReply">📤 ${tx('sendReply')}</button>
        <details style="margin-top:8px"><summary class="hint">${tx('showCode')}</summary>
          <textarea class="conn-code" id="outReply" readonly>${reply}</textarea>
          <div class="row" style="flex:0;margin-top:6px"><button class="btn sm" id="copyReply">${tx('copy')}</button></div>
        </details>
        <p class="hint conn-wait">${tx('waitingConnect')}</p>
      </div>`;
    area.querySelector('#shareReply').onclick = () => shareOrCopy(reply, 'reply');
    area.querySelector('#copyReply').onclick = () => copy(reply);
  }

  // ================= shared-key connect over PeerJS =================
  // Both people type the SAME key. PBKDF2 turns it into three independent values:
  // the AES-GCM key that end-to-end encrypts every message and file, the local
  // room id, and the pair of PeerJS addresses the two devices meet on. PeerJS is
  // only a switchboard — it introduces the two browsers and then steps out of the
  // way, and everything it does see is either a hash of the key or ciphertext.
  const PEERJS_SRC = 'https://cdn.jsdelivr.net/npm/peerjs@1.5.5/dist/peerjs.min.js';
  const ICE = {
    iceServers: [
      { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }
    ]
  };
  const KEY_ALPHA = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32 (no I L O U)

  function normalizeKey(s) {
    return String(s == null ? '' : s).trim().toUpperCase()
      .replace(/[^A-Z0-9]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  }
  function generateKey() {
    const b = crypto.getRandomValues(new Uint8Array(16));
    let s = ''; for (let i = 0; i < 16; i++) s += KEY_ALPHA[b[i] & 31];
    return s.replace(/(.{4})(?=.)/g, '$1-'); // XXXX-XXXX-XXXX-XXXX  (~80 bits)
  }
  // A weak key is the whole attack: the rendezvous address is derived from it, so
  // anyone who guesses the key can walk into the room. Refuse what a dictionary finds.
  function weakKey(norm) {
    if (norm.length < LIMITS.minKey) return true;
    if (/^(.)\1*$/.test(norm)) return true;
    if (new Set(norm.split('')).size < 5) return true;
    return false;
  }

  // PBKDF2 (slow) -> one master secret -> HKDF-Expand into independent values, so the
  // address the broker sees can never be walked back to the key without paying the
  // full KDF cost per guess.
  const KDF_ITERATIONS = 310000;
  const KDF_SALT = 'sporttactic-p2p-v2';
  async function hkdfExpand(prkBits, info, bytes) {
    const k = await subtle.importKey('raw', prkBits, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const inf = ENC.encode(info), out = new Uint8Array(bytes);
    let t = new Uint8Array(0), pos = 0, counter = 1;
    while (pos < bytes) {
      const buf = new Uint8Array(t.length + inf.length + 1);
      buf.set(t, 0); buf.set(inf, t.length); buf[buf.length - 1] = counter++;
      t = new Uint8Array(await subtle.sign('HMAC', k, buf));
      out.set(t.subarray(0, Math.min(t.length, bytes - pos)), pos); pos += t.length;
    }
    return out;
  }
  const toHex = b => Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join('');
  async function deriveRoom(norm) {
    const base = await subtle.importKey('raw', ENC.encode(norm), 'PBKDF2', false, ['deriveBits']);
    const prk = await subtle.deriveBits(
      { name: 'PBKDF2', salt: ENC.encode(KDF_SALT), iterations: KDF_ITERATIONS, hash: 'SHA-256' }, base, 256);
    const aes = async info => subtle.importKey('raw', await hkdfExpand(prk, info, 32), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    return {
      msgKey: await aes('stx-msg-v2'),                              // chat, files and the handshake
      roomH: toHex(await hkdfExpand(prk, 'stx-room-v2', 8)),        // local contact id
      peerHex: toHex(await hkdfExpand(prk, 'stx-peer-v3', 12))      // the pair of PeerJS addresses
    };
  }

  function loadPeerJs() {
    if (window.Peer) return Promise.resolve(window.Peer);
    if (peerLib) return peerLib;
    // Pinned exact version: a floating range would let a compromised registry ship new code.
    peerLib = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = PEERJS_SRC; s.async = true; s.crossOrigin = 'anonymous';
      s.onload = () => window.Peer ? resolve(window.Peer) : reject(new Error('peerjs'));
      s.onerror = () => { peerLib = null; reject(new Error('peerjs')); };
      document.head.appendChild(s);
    });
    return peerLib;
  }
  function setSigStatus(msg) { const el = mount.querySelector('#qcStatus'); if (el) el.textContent = msg || ''; }

  // The shared key never touches the database in clear: it is kept in memory for the
  // session and stored encrypted with the device at-rest key so a stolen DB is useless.
  async function ensureKeyroom(roomH, keyText) {
    const id = 'room-' + roomH;
    const clear = String(keyText || '').trim();
    roomSecrets[id] = clear;
    const keyEnc = await encStr(atRest, clear);
    let c = contacts.find(x => x.id === id);
    if (!c) {
      c = { id, name: tx('keyChat'), kind: 'keyroom', keyEnc, ttl: 0, verified: false };
      contacts.push(c);
    } else {
      c.kind = 'keyroom'; c.keyEnc = keyEnc;
      delete c.key; delete c.keyText;   // drop any plaintext written by older versions
    }
    // Opened from a player or staff row: label it now instead of waiting for the
    // peer to connect and send their own name.
    if (peer && peer.name && (!c.name || c.name === tx('keyChat'))) c.name = cleanName(peer.name);
    await MDB.put('contacts', c);
    return c;
  }
  async function roomSecret(c) {
    if (!c) return '';
    if (roomSecrets[c.id]) return roomSecrets[c.id];
    if (c.keyEnc) { try { return (roomSecrets[c.id] = await decStr(atRest, c.keyEnc.iv, c.keyEnc.ct)); } catch (e) { return ''; } }
    return c.keyText || c.key || '';   // legacy record, migrated on next connect
  }

  function closeSig() {
    const s = sig; if (!s) return; sig = null; s.done = true;
    try { clearTimeout(s.waitTimer); } catch (e) { }
    try { clearInterval(s.timer); } catch (e) { }
  }

  // ---- the handshake that turns "same room" into "same key" ----
  // AES-GCM is authenticated, so a frame that decrypts is proof the sender holds the
  // key. Nothing is rendered, stored or answered before that proof arrives.
  async function sendAuth(kind) {
    if (!wireKey) return;
    const blob = await encStr(wireKey, JSON.stringify({
      hello: kind || 'auth', name: identity.name, fp: localFingerprint(), at: Date.now()
    }));
    wsend({ t: 'auth', iv: blob.iv, ct: blob.ct });
  }
  // The DTLS fingerprint of our own connection, sent over the encrypted channel so
  // each side can check the media path really terminates on the peer that has the key.
  function localFingerprint() {
    try {
      const sdp = (pc && pc.localDescription && pc.localDescription.sdp) || '';
      const m = /a=fingerprint:\S+\s+(\S+)/i.exec(sdp);
      return m ? m[1] : '';
    } catch (e) { return ''; }
  }
  function remoteFingerprintOf(conn) {
    try {
      const p = conn && conn.peerConnection;
      const sdp = (p && p.remoteDescription && p.remoteDescription.sdp) || '';
      const m = /a=fingerprint:\S+\s+(\S+)/i.exec(sdp);
      return m ? m[1] : '';
    } catch (e) { return ''; }
  }

  async function setPeerName(nm) {
    const c = contact(active); if (!c) return;
    nm = cleanName(nm); if (!nm || c.name === nm) return;
    c.name = nm;
    try { await MDB.put('contacts', c); } catch (e) { }
    const h = mount.querySelector('#convPane h2'); if (h) h.textContent = nm;
    renderContacts();
  }

  function markConnected() {
    if (authed) return;
    authed = true;
    setStatus('connected'); toast(tx('connected'), 'success'); setSigStatus('');
    closeSig();
    const area = mount.querySelector('#sigArea'); if (area) area.innerHTML = `<p class="conn-ok">✓ ${tx('nowConnected')}</p>`;
    const d = mount.querySelector('#connDetails'); if (d) d.open = false;
    updateCallButtons();
    const input = mount.querySelector('#msgInput'); if (input) input.focus();
    if (pendingCall) { const k = pendingCall; pendingCall = null; startCall(k); }
  }

  // ---- data channel ----
  function attachData(conn) {
    dataConn = conn;
    dcContact = active;
    conn.on('open', async () => {
      pc = conn.peerConnection || null;
      if (pc) pc.onconnectionstatechange = () => { if (!authed) setStatus(pc.connectionState); };
      setSigStatus(tx('verifying'));
      await sendAuth();
    });
    conn.on('data', d => { if (typeof d === 'string') onWire({ data: d }); });
    conn.on('close', () => { if (dataConn === conn) { authed = false; setStatus('closed'); updateCallButtons(); } });
    conn.on('error', () => { });
  }

  // ---- voice / video ----
  async function ensureLocalMedia(kind) {
    const wantVideo = kind === 'video';
    if (localStream && (!wantVideo || localStream.getVideoTracks().length)) return true;
    // The permission prompt is modal to the browser and can sit there for a while,
    // so say what is happening instead of looking like nothing was pressed.
    setSigStatus(tx('askingMedia'));
    ['#btnVoice', '#btnVideo'].forEach(s => { const b = mount.querySelector(s); if (b) b.disabled = true; });
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: wantVideo });
      if (localStream) localStream.getTracks().forEach(t => t.stop());
      localStream = s;
      const lv = mount.querySelector('#localVid');
      if (lv) { lv.srcObject = s; lv.classList.toggle('hidden', !wantVideo); }
      showCallArea(true); setSigStatus('');
      return true;
    } catch (e) {
      setSigStatus('');
      toast(tx(e && e.name === 'NotFoundError' ? 'noCamera' : 'camDenied'), 'error');
      return false;
    } finally { updateCallButtons(); }
  }
  async function startCall(kind) {
    if (!dcReady() || !peerObj || !dataConn) return toast(tx('notConnected'), 'error');
    if (!(await ensureLocalMedia(kind))) return;
    try {
      const call = peerObj.call(dataConn.peer, localStream, { metadata: { kind } });
      attachCall(call, kind);
      setSigStatus(tx('calling'));
    } catch (e) { toast(tx('callFailed'), 'error'); }
  }
  // A call is only answered for a peer that already proved it holds the key.
  async function onIncomingCall(call) {
    if (!authed || !dataConn || call.peer !== dataConn.peer) { try { call.close(); } catch (e) { } return; }
    const kind = (call.metadata && call.metadata.kind) === 'video' ? 'video' : 'voice';
    if (!(await ensureLocalMedia(kind))) { try { call.close(); } catch (e) { } return; }
    try { call.answer(localStream); } catch (e) { return; }
    attachCall(call, kind);
  }
  function attachCall(call, kind) {
    if (mediaConn && mediaConn !== call) { try { mediaConn.close(); } catch (e) { } }
    mediaConn = call;
    call.on('stream', rs => {
      const rv = mount.querySelector('#remoteVid');
      if (rv) { rv.srcObject = rs; rv.classList.toggle('audio-only', kind !== 'video' && !rs.getVideoTracks().length); }
      showCallArea(true); setSigStatus('');
      checkCallFingerprint(call);
      updateCallButtons();
    });
    call.on('close', () => endCall(false));
    call.on('error', () => endCall(false));
  }
  // The broker introduces the two browsers, so in theory it could introduce the wrong
  // one. Each side published its own DTLS fingerprint over the encrypted data channel;
  // if the media path does not present that fingerprint, the call is not the peer.
  function checkCallFingerprint(call) {
    const expect = String(sig && sig.peerFp || '');
    if (!expect) return;
    const got = remoteFingerprintOf(call);
    if (got && got.toLowerCase() !== expect.toLowerCase()) {
      toast(tx('callMitm'), 'error');
      endCall(true);
    }
  }
  function endCall(closeRemote) {
    if (mediaConn) { try { if (closeRemote !== false) mediaConn.close(); } catch (e) { } mediaConn = null; }
    if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
    const lv = mount.querySelector('#localVid'); if (lv) { lv.srcObject = null; lv.classList.add('hidden'); }
    const rv = mount.querySelector('#remoteVid'); if (rv) rv.srcObject = null;
    showCallArea(false);
    updateCallButtons();
  }
  function showCallArea(on) {
    const ca = mount.querySelector('#callArea'); if (ca) ca.classList.toggle('hidden', !on);
  }
  function updateCallButtons() {
    const on = dcReady();
    ['#btnVoice', '#btnVideo'].forEach(s => { const b = mount.querySelector(s); if (b) b.disabled = !on; });
    const end = mount.querySelector('#btnEndCall'); if (end) end.classList.toggle('hidden', !mediaConn);
    const mic = mount.querySelector('#btnMic');
    if (mic) {
      const tr = localStream && localStream.getAudioTracks()[0];
      mic.classList.toggle('hidden', !tr);
      if (tr) mic.textContent = tr.enabled ? '🎤 ' + tx('micOn') : '🔇 ' + tx('micOff');
    }
    const cam = mount.querySelector('#btnCam');
    if (cam) {
      const tr = localStream && localStream.getVideoTracks()[0];
      cam.classList.toggle('hidden', !tr);
      if (tr) cam.textContent = tr.enabled ? '🎥 ' + tx('camOn') : '🚫 ' + tx('camOff');
    }
    const hang = mount.querySelector('#btnHangup'); if (hang) hang.classList.toggle('hidden', !dataConn && !pc);
  }
  function toggleTrack(kind) {
    const tr = localStream && (kind === 'video' ? localStream.getVideoTracks()[0] : localStream.getAudioTracks()[0]);
    if (!tr) return;
    tr.enabled = !tr.enabled;
    updateCallButtons();
  }

  async function keyConnect(keyStr, mode) {
    const norm = normalizeKey(keyStr);
    if (!norm) { toast(tx('keyNeeded'), 'error'); return; }
    if (weakKey(norm)) { toast(tx('keyTooWeak'), 'error'); setSigStatus(tx('keyTooWeak')); return; }
    closeConn();
    setStatus('connecting'); setSigStatus(tx('connectingRelay'));
    const room = await deriveRoom(norm);
    const c = await ensureKeyroom(room.roomH, keyStr);
    active = c.id; renderContacts(); renderConversation();
    const dfold = mount.querySelector('#connDetails'); if (dfold) dfold.open = true;
    setStatus('connecting'); setSigStatus(tx('connectingRelay'));

    let Peer;
    try { Peer = await loadPeerJs(); }
    catch (e) { toast(tx('relayUnavailable'), 'error'); setSigStatus(tx('relayUnavailable')); return; }

    wireKey = room.msgKey; wireKeys[c.id] = room.msgKey;
    callMode = mode || 'chat';
    pendingCall = callMode === 'chat' ? null : callMode;

    const HOST = 'stx-' + room.peerHex + '-a';
    const GUEST = 'stx-' + room.peerHex + '-b';
    const st = { done: false, peerFp: '', waitTimer: null };
    sig = st;

    // Claim the room address; whoever loses the race dials the winner instead.
    const openPeer = id => new Promise(resolve => {
      let p, settled = false;
      const fin = v => { if (!settled) { settled = true; resolve(v); } };
      try { p = id ? new Peer(id, { config: ICE, debug: 0 }) : new Peer({ config: ICE, debug: 0 }); }
      catch (e) { return fin(null); }
      p.on('open', () => fin(p));
      p.on('error', () => { if (!settled) { try { p.destroy(); } catch (e) { } fin(null); } });
      setTimeout(() => { if (!settled) { try { p.destroy(); } catch (e) { } fin(null); } }, 12000);
    });

    let me = await openPeer(HOST);
    let role = 'host';
    if (!me && !st.done) { me = await openPeer(GUEST); role = 'guest'; }
    if (!me && !st.done) { me = await openPeer(null); role = 'guest'; }   // third device: random address
    if (st.done) { try { if (me) me.destroy(); } catch (e) { } return; }
    if (!me) { toast(tx('relayUnavailable'), 'error'); setSigStatus(tx('relayUnavailable')); if (sig === st) sig = null; return; }

    peerObj = me;
    me.on('error', () => { });
    me.on('disconnected', () => { try { if (!st.done) me.reconnect(); } catch (e) { } });
    me.on('connection', conn => {
      if (dataConn && dataConn.open) { try { conn.close(); } catch (e) { } return; }  // one peer per room
      attachData(conn);
    });
    me.on('call', onIncomingCall);

    if (role === 'host') {
      setSigStatus(tx('waitingPeer'));
    } else {
      setSigStatus(tx('connectingRelay'));
      try { attachData(me.connect(HOST, { reliable: true })); }
      catch (e) { toast(tx('relayUnavailable'), 'error'); setSigStatus(tx('relayUnavailable')); return; }
    }
    // Two minutes is long enough for the other person to open the app; after that the
    // rendezvous is dropped rather than left holding an address forever.
    st.waitTimer = setTimeout(() => {
      if (sig === st && !authed) { setSigStatus(tx('noPeerYet')); closeSig(); }
    }, 120000);
  }

  function closeConn() {
    closeSig();
    endCall(true);
    try { if (dataConn) dataConn.close(); } catch (e) { }
    try { if (peerObj) peerObj.destroy(); } catch (e) { }
    try { if (dc) dc.close(); } catch (e) { }
    try { if (pc && pc.close) pc.close(); } catch (e) { }
    if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
    dataConn = null; peerObj = null; mediaConn = null; authed = false; pendingCall = null;
    dc = null; pc = null; wireKey = null; dcContact = null;
    for (const k of Object.keys(incoming)) delete incoming[k];
    updateCallButtons();
    const ca = mount.querySelector('#callArea'); if (ca) ca.classList.add('hidden');
  }

  // ================= wire protocol =================
  // Every frame is validated for type, shape and size before it can allocate memory.
  async function onWire(ev) {
    if (typeof ev.data !== 'string' || ev.data.length > LIMITS.frame) return;
    let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
    if (!m || typeof m.t !== 'string' || !wireKey) return;
    const cid = dcContact || active; if (!cid) return;
    const b64 = v => typeof v === 'string' && v.length <= LIMITS.chunk && /^[A-Za-z0-9+/=]*$/.test(v);

    // The handshake comes first: a frame that decrypts under the shared key is proof
    // the sender has it. Until one arrives nothing else on the wire is looked at.
    if (m.t === 'auth') {
      if (!b64(m.iv) || !b64(m.ct)) return;
      let p; try { p = JSON.parse(await decStr(wireKey, m.iv, m.ct)); } catch (e) { return; }
      if (!p || typeof p !== 'object') return;
      if (sig) sig.peerFp = typeof p.fp === 'string' ? p.fp.slice(0, 200) : '';
      setPeerName(p.name);
      const first = !authed;
      markConnected();
      if (first && p.hello !== 'ack') sendAuth('ack');   // answer once, never in a loop
      return;
    }
    if (!authed) return;

    if (m.t === 'msg') {
      if (!b64(m.iv) || !b64(m.ct)) return;
      try {
        const p = JSON.parse(await decStr(wireKey, m.iv, m.ct));
        const text = cleanText(p && p.text); if (!text) return;
        if (cid === active) addBubble({ dir: 'in', kind: 'text', text, ts: Date.now() });
        persistMsg(cid, 'in', { kind: 'text', text });
      } catch (e) { }
    } else if (m.t === 'file-begin') {
      if (typeof m.id !== 'string' || !m.id || m.id.length > 64 || incoming[m.id]) return;
      if (Object.keys(incoming).length >= LIMITS.transfers) return;
      if (!b64(m.iv)) return;
      const chunks = m.chunks | 0;
      const maxChunks = Math.ceil((LIMITS.file * 4 / 3 + 64) / LIMITS.chunk) + 1;
      if (chunks < 1 || chunks > maxChunks) return;
      incoming[m.id] = { name: safeFileName(m.name), mime: safeMime(m.mime), iv: m.iv, chunks, parts: new Array(chunks), got: 0, bytes: 0 };
    } else if (m.t === 'file-chunk') {
      const inc = incoming[m.id]; if (!inc) return;
      const seq = m.seq | 0;
      if (seq < 0 || seq >= inc.chunks || inc.parts[seq] != null) return;
      if (!b64(m.data)) return;
      inc.bytes += m.data.length;
      if (inc.bytes > LIMITS.file * 4 / 3 + 1024) { delete incoming[m.id]; return; } // over budget: abandon
      inc.parts[seq] = m.data; inc.got++;
    } else if (m.t === 'file-end') {
      const inc = incoming[m.id]; if (!inc) return; delete incoming[m.id];
      if (inc.got !== inc.chunks) return;
      try {
        const pt = await aesDec(wireKey, inc.iv, inc.parts.join(''));
        if (pt.byteLength > LIMITS.file) return;
        const url = trackUrl(URL.createObjectURL(new Blob([pt], { type: inc.mime })));
        if (cid === active) addBubble({ dir: 'in', kind: 'file', name: inc.name, mime: inc.mime, size: pt.byteLength, url, ts: Date.now() });
        persistMsg(cid, 'in', { kind: 'file', name: inc.name, mime: inc.mime, size: pt.byteLength });
      } catch (e) { }
    }
  }

  async function sendText() {
    const input = mount.querySelector('#msgInput'); if (!input) return;
    const text = cleanText(input.value.trim()); if (!text) return;
    if (!dcReady()) return toast(tx('notConnected'), 'error');
    const blob = await encStr(wireKey, JSON.stringify({ text }));
    wsend({ t: 'msg', iv: blob.iv, ct: blob.ct });
    input.value = '';
    addBubble({ dir: 'out', kind: 'text', text, ts: Date.now() });
    persistMsg(active, 'out', { kind: 'text', text });
  }

  async function sendFile(file) {
    if (!dcReady()) return toast(tx('notConnected'), 'error');
    if (file.size > LIMITS.file) return toast(tx('fileTooBig'), 'error');
    const buf = await file.arrayBuffer();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, wireKey, buf);
    const data = b64enc(ct); const id = rid(); const CH = 16000;
    const chunks = Math.ceil(data.length / CH);
    const name = safeFileName(file.name), mime = safeMime(file.type);
    wsend({ t: 'file-begin', id, name, mime, size: file.size, iv: b64enc(iv), chunks });
    for (let i = 0, seq = 0; i < data.length; i += CH, seq++) wsend({ t: 'file-chunk', id, seq, data: data.slice(i, i + CH) });
    wsend({ t: 'file-end', id });
    const url = trackUrl(URL.createObjectURL(file));
    addBubble({ dir: 'out', kind: 'file', name, mime, size: file.size, url, ts: Date.now() });
    persistMsg(active, 'out', { kind: 'file', name, mime, size: file.size });
  }

  // ================= contact / chat management =================
  async function deleteContact(id) {
    const all = await MDB.getAll('messages');
    for (const m of all) if (m.contactId === id) await MDB.del('messages', m.id);
    await MDB.del('contacts', id);
    contacts = contacts.filter(c => c.id !== id);
    delete roomSecrets[id]; delete wireKeys[id];
    if (active === id) { active = null; closeConn(); }
    revokeUrls();
    renderContacts(); renderConversation(); toast(tx('deleted'), 'success');
  }
  async function clearChat(id) {
    const all = await MDB.getAll('messages');
    for (const m of all) if (m.contactId === id) await MDB.del('messages', m.id);
    refreshMessages();
  }

  // ---------- sharing / clipboard helpers (friendly, one-tap) ----------
  async function shareOrCopy(text, kind) {
    const intro = { link: tx('shareLinkMsg'), invite: tx('shareInviteMsg'), reply: tx('shareReplyMsg'), key: tx('shareKeyMsg') }[kind] || '';
    const payload = intro ? intro + '\n\n' + text : text;
    if (navigator.share) {
      try { await navigator.share({ title: tx('title'), text: payload }); return; }
      catch (e) { if (e && e.name === 'AbortError') return; }
    }
    copy(payload);
  }
  async function readClipboard() {
    try { if (navigator.clipboard && navigator.clipboard.readText) return await navigator.clipboard.readText(); } catch (e) { }
    return null; // null = unavailable / blocked
  }
  function copySilently(text) { try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text); } catch (e) { } }

  // ---------- misc ----------
  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => toast(tx('copied'), 'success'), () => fallbackCopy(text));
    else fallbackCopy(text);
  }
  function fallbackCopy(text) {
    const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); toast(tx('copied'), 'success'); } catch (e) { } document.body.removeChild(ta);
  }

  // ---------- boot ----------
  const purgeTimer = setInterval(purgeExpired, 15000);
  (async () => {
    await ensureIdentity();
    contacts = await MDB.getAll('contacts');
    // Migrate rooms saved by older versions: move the plaintext key out of the database.
    for (const c of contacts) {
      if (c.kind !== 'keyroom' || c.keyEnc) continue;
      const clear = String(c.keyText || c.key || '').trim();
      if (clear) roomSecrets[c.id] = clear;
      c.keyEnc = await encStr(atRest, clear);
      delete c.key; delete c.keyText;
      try { await MDB.put('contacts', c); } catch (e) { }
    }
    render();
  })();

  // cleanup when navigating away
  return () => {
    clearInterval(purgeTimer); closeConn(); revokeUrls();
    for (const k of Object.keys(roomSecrets)) delete roomSecrets[k];
  };
};
