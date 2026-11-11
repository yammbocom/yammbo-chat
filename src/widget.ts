// widget.ts
// Self-contained vanilla JS widget served by the Worker at GET /widget.js.
//   <script src="https://chat.yammbo.com/widget.js" defer></script>
//
// Multi-view: Home (search + sections) · Help (search results) · Article
// (inline doc) · Blog (recent posts) · Chat (streaming) · Lead form (handoff).
// Live inbox: when the visitor asks for a person the conversation moves to the
// team; the widget then polls /api/messages (see "Live conversation" below) and
// shows the team's messages, system lines and a one-time rating card.
// No dependencies. All class names prefixed `yc-`.

export const WIDGET_JS = `(function () {
  if (window.__yammboChatLoaded) return;
  window.__yammboChatLoaded = true;

  var BASE = 'https://chat.yammbo.com';
  var API = BASE + '/api/chat';
  var STORAGE_KEY = 'yammbo-chat-history-v1';
  var SESSION_KEY = 'yammbo-chat-session-id';
  var LANG_KEY = 'yammbo-chat-lang';
  var MODE_KEY = 'yammbo-chat-mode';
  var AFTER_KEY = 'yammbo-chat-after';
  var MAX_HISTORY = 20;

  // i18n -----------------------------------------------------------------
  function detectLang() {
    try { var o = localStorage.getItem(LANG_KEY); if (o === 'es' || o === 'en') return o; } catch (_) {}
    var d = (document.documentElement.getAttribute('lang') || '').toLowerCase();
    if (d.indexOf('es') === 0) return 'es';
    if (d.indexOf('en') === 0) return 'en';
    var n = (navigator.language || 'en').toLowerCase();
    return n.indexOf('es') === 0 ? 'es' : 'en';
  }
  var STR = {
    es: {
      title: 'Yammbo', open: 'Abrir chat', close: 'Cerrar', back: 'Volver', send: 'Enviar',
      homeHi: 'Hola', homeSub: '¿En qué te ayudamos hoy?',
      search: 'Buscar en la ayuda...',
      navHome: 'Inicio', navChat: 'Chat',
      secHelp: 'Centro de ayuda', secHelpSub: 'Guías y respuestas',
      secBlog: 'Blog', secBlogSub: 'Lo más reciente',
      secChat: 'Chatear con nosotros', secChatSub: 'Respuesta al instante',
      chatPlaceholder: 'Escribe tu pregunta...',
      chatEmpty: 'Pregúntame sobre productos, planes o cómo empezar.',
      talkHuman: 'Hablar con una persona',
      noResults: 'Sin resultados. Prueba otra búsqueda o chatea con nosotros.',
      readMore: 'Leer en el blog →',
      formTitle: 'Déjanos tus datos', formSub: 'El equipo te contactará pronto.',
      fName: 'Nombre', fEmail: 'Email', fPhone: 'Teléfono / WhatsApp (opcional)',
      fChannel: 'Canal preferido', fMessage: 'Mensaje (opcional)',
      chWhatsApp: 'WhatsApp', chEmail: 'Email', chCall: 'Llamada',
      fSubmit: 'Enviar', fSending: 'Enviando...',
      fOk: '¡Listo! El equipo te contactará pronto.', fErr: 'No se pudo enviar. Inténtalo de nuevo.',
      fReqName: 'Escribe tu nombre', fReqEmail: 'Escribe un email válido',
      errGeneric: 'No pude conectarme. Inténtalo de nuevo.', errNetwork: 'Error de red.', errNoReply: 'No recibí respuesta.',
      newChat: 'Nueva conversación',
      suggGen: ['¿Qué productos tiene Yammbo?', '¿Cuánto cuesta?', 'Quiero hablar con una persona'],
      suggWhat: '¿Qué es {X}?', suggStart: '¿Cómo empiezo con {X}?', suggPrice: '¿Cuánto cuesta {X}?',
      reachDirect: '¿Prefieres escribir directo?', ctWhatsApp: 'WhatsApp', ctEmail: 'Email',
      privacy: 'Guardamos las conversaciones 90 días para mejorar las respuestas.', privacyLink: 'Privacidad',
      fbUp: 'Respuesta útil', fbDown: 'Respuesta no útil',
      humanHere: 'Hablar con una persona aquí', leaveData: 'Dejar mis datos',
      waitingMsg: 'Te avisamos aquí en cuanto alguien del equipo responda.',
      waitingEmail: 'Si te vas, deja tu email y te escribimos.',
      humanOn: 'Estás hablando con el equipo.',
      teamLabel: 'Equipo Yammbo', subWaiting: 'Esperando al equipo', subHuman: 'Equipo Yammbo',
      handoffErr: 'No pudimos avisar al equipo. Inténtalo de nuevo o déjanos tus datos.',
      newMsg: 'mensaje nuevo del equipo',
      sys: { 'sys:waiting': 'Pediste hablar con una persona', 'sys:joined': 'El equipo se unió', 'sys:returned': 'Conversación devuelta al asistente', 'sys:resolved': 'Conversación resuelta' },
      csatTitle: '¿Te ayudamos?', starLabel: '{n} de 5 estrellas', csatComment: 'Comentario (opcional)',
      csatSend: 'Enviar valoración', csatThanks: '¡Gracias por tu valoración!', csatErr: 'No se pudo enviar. Inténtalo de nuevo.'
    },
    en: {
      title: 'Yammbo', open: 'Open chat', close: 'Close', back: 'Back', send: 'Send',
      homeHi: 'Hi', homeSub: 'How can we help today?',
      search: 'Search help...',
      navHome: 'Home', navChat: 'Chat',
      secHelp: 'Help Center', secHelpSub: 'Guides and answers',
      secBlog: 'Blog', secBlogSub: 'Latest posts',
      secChat: 'Chat with us', secChatSub: 'Instant answers',
      chatPlaceholder: 'Type your question...',
      chatEmpty: 'Ask me about products, plans, or how to get started.',
      talkHuman: 'Talk to a person',
      noResults: 'No results. Try another search or chat with us.',
      readMore: 'Read on the blog →',
      formTitle: 'Leave your details', formSub: 'The team will reach out shortly.',
      fName: 'Name', fEmail: 'Email', fPhone: 'Phone / WhatsApp (optional)',
      fChannel: 'Preferred channel', fMessage: 'Message (optional)',
      chWhatsApp: 'WhatsApp', chEmail: 'Email', chCall: 'Call',
      fSubmit: 'Send', fSending: 'Sending...',
      fOk: 'Done! The team will contact you soon.', fErr: 'Could not send. Try again.',
      fReqName: 'Enter your name', fReqEmail: 'Enter a valid email',
      errGeneric: 'I could not connect. Try again.', errNetwork: 'Network error.', errNoReply: 'No response received.',
      newChat: 'New conversation',
      suggGen: ['What products does Yammbo have?', 'How much does it cost?', 'I want to talk to a person'],
      suggWhat: 'What is {X}?', suggStart: 'How do I get started with {X}?', suggPrice: 'How much does {X} cost?',
      reachDirect: 'Prefer to reach us directly?', ctWhatsApp: 'WhatsApp', ctEmail: 'Email',
      privacy: 'We keep conversations for 90 days to improve answers.', privacyLink: 'Privacy',
      fbUp: 'Helpful answer', fbDown: 'Not helpful',
      humanHere: 'Talk to a person here', leaveData: 'Leave my details',
      waitingMsg: 'We will let you know here as soon as someone from the team replies.',
      waitingEmail: 'If you leave, share your email and we will write to you.',
      humanOn: 'You are talking to the team.',
      teamLabel: 'Yammbo team', subWaiting: 'Waiting for the team', subHuman: 'Yammbo team',
      handoffErr: 'We could not notify the team. Try again or leave your details.',
      newMsg: 'new message from the team',
      sys: { 'sys:waiting': 'You asked to talk to a person', 'sys:joined': 'The team joined', 'sys:returned': 'Conversation handed back to the assistant', 'sys:resolved': 'Conversation resolved' },
      csatTitle: 'Did we help?', starLabel: '{n} of 5 stars', csatComment: 'Comment (optional)',
      csatSend: 'Send rating', csatThanks: 'Thanks for your rating!', csatErr: 'Could not send. Try again.'
    }
  };
  var lang = detectLang();
  var t = STR[lang];

  // Helpers --------------------------------------------------------------
  function el(html) { var tpl = document.createElement('template'); tpl.innerHTML = html.trim(); return tpl.content.firstElementChild; }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
  // Minimal safe Markdown: everything is HTML-escaped first, then block/inline rules apply.
  function safeHref(u) {
    if (/^https?:\\/\\//i.test(u)) return u;
    if (u.indexOf('/docs/') === 0) return 'https://help.yammbo.com' + u;
    return '';
  }
  function inl(s) {
    var stash = [];
    function hold(h) { stash.push(h); return '\\u0000' + (stash.length - 1) + '\\u0001'; }
    function fmt(x) {
      x = x.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');
      x = x.replace(/(^|[\\s(])\\*([^*\\s](?:[^*]*[^*\\s])?)\\*(?=$|[\\s).,;:!?])/g, '$1<em>$2</em>');
      return x;
    }
    var x = esc(String(s).replace(/[\\u0000\\u0001]/g, ''));
    x = x.replace(/\\x60([^\\x60]+)\\x60/g, function (_, c) { return hold('<code>' + c + '</code>'); });
    x = x.replace(/\\[([^\\]]+)\\]\\(([^\\s)]+)\\)/g, function (m, txt, u) {
      var h = safeHref(u); if (!h) return m;
      return hold('<a href="' + h + '" target="_blank" rel="noopener">' + fmt(txt) + '</a>');
    });
    x = fmt(x);
    var guard = 0;
    while (/\\u0000\\d+\\u0001/.test(x) && guard++ < 5) x = x.replace(/\\u0000(\\d+)\\u0001/g, function (_, k) { return stash[+k]; });
    return x;
  }
  function md(s) {
    var L = String(s == null ? '' : s).replace(/\\r\\n?/g, '\\n').split('\\n');
    var out = [], i = 0, n = L.length;
    function isFence(l) { return /^\\s*\\x60\\x60\\x60/.test(l); }
    function isSep(l) { return l.indexOf('|') >= 0 && l.indexOf('-') >= 0 && /^[\\s|:-]+$/.test(l); }
    function cells(l) { l = l.trim().replace(/^\\|/, '').replace(/\\|$/, ''); return l.split('|').map(function (c) { return c.trim(); }); }
    function isUl(l) { return /^\\s*[-*]\\s+\\S/.test(l); }
    function isOl(l) { return /^\\s*\\d+[.)]\\s+\\S/.test(l); }
    function isHead(l) { return /^#{1,6}\\s+\\S/.test(l); }
    function isHr(l) { return /^\\s*([-*_])(\\s*\\1){2,}\\s*$/.test(l); }
    function isTbl(k) { return k + 1 < n && L[k].indexOf('|') >= 0 && isSep(L[k + 1]); }
    function starts(k) { return isFence(L[k]) || isHead(L[k]) || isHr(L[k]) || isUl(L[k]) || isOl(L[k]) || isTbl(k); }
    while (i < n) {
      var l = L[i];
      if (!l.trim()) { i++; continue; }
      if (isFence(l)) {
        var code = []; i++;
        while (i < n && !isFence(L[i])) { code.push(L[i]); i++; }
        i++;
        out.push('<pre><code>' + esc(code.join('\\n')) + '</code></pre>');
        continue;
      }
      var hm = /^(#{1,6})\\s+(.*)$/.exec(l);
      if (hm) {
        var lv = Math.min(hm[1].length, 3) + 2;
        out.push('<h' + lv + '>' + inl(hm[2].replace(/\\s+#+\\s*$/, '')) + '</h' + lv + '>');
        i++; continue;
      }
      if (isHr(l)) { out.push('<hr>'); i++; continue; }
      if (isTbl(i)) {
        var hd = cells(L[i]); i += 2;
        var rows = [];
        while (i < n && L[i].trim() && L[i].indexOf('|') >= 0) { rows.push(cells(L[i])); i++; }
        out.push('<div class="yc-tablewrap"><table><thead><tr>' +
          hd.map(function (c) { return '<th>' + inl(c) + '</th>'; }).join('') + '</tr></thead><tbody>' +
          rows.map(function (r) { return '<tr>' + hd.map(function (_, c) { return '<td>' + inl(r[c] || '') + '</td>'; }).join('') + '</tr>'; }).join('') +
          '</tbody></table></div>');
        continue;
      }
      if (isUl(l) || isOl(l)) {
        var ord = isOl(l), items = [], olStart = ord ? parseInt(l.trim(), 10) : 1;
        while (i < n) {
          if (ord ? isOl(L[i]) : isUl(L[i])) items.push([L[i].replace(ord ? /^\\s*\\d+[.)]\\s+/ : /^\\s*[-*]\\s+/, '')]);
          else if (/^\\s{2,}\\S/.test(L[i]) && !isUl(L[i]) && !isOl(L[i])) items[items.length - 1].push(L[i].trim()); // indented continuation of the step
          else break;
          i++;
        }
        var tag = ord ? 'ol' : 'ul';
        out.push('<' + tag + (ord && olStart > 1 ? ' start="' + olStart + '"' : '') + '>' + items.map(function (x) { return '<li>' + x.map(inl).join('<br>') + '</li>'; }).join('') + '</' + tag + '>');
        continue;
      }
      var para = [l]; i++;
      while (i < n && L[i].trim() && !starts(i)) { para.push(L[i]); i++; }
      out.push('<p>' + para.map(function (x) { return inl(x); }).join('<br>') + '</p>');
    }
    return out.join('');
  }
  // The session id is the credential of the live-chat endpoints, so a new one is 192
  // random bits (24 bytes from crypto.getRandomValues -> 32 base64url chars). Ids
  // minted by older versions (UUIDs) keep working. The Math.random fallback only runs
  // where getRandomValues does not exist; its short id never gets live features.
  function newSessionId() {
    try {
      var a = new Uint8Array(24); crypto.getRandomValues(a);
      var s = ''; for (var i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
      return btoa(s).replace(/\\+/g, '-').replace(/\\//g, '_');
    } catch (_) { return 'xxxxxxxxxxxx'.replace(/x/g, function () { return ((Math.random()*16)|0).toString(16); }); }
  }
  function sessionId() { try { var v = localStorage.getItem(SESSION_KEY); if (!v) { v = newSessionId(); localStorage.setItem(SESSION_KEY, v); } return v; } catch (_) { return newSessionId(); } }
  // Live features (takeover, polling, rating) need an id the server accepts as a credential.
  function canLive() { return sessionId().length >= 32; }
  var ROLES = { user: 1, assistant: 1, agent: 1, system: 1 };
  function loadHistory() {
    try {
      var a = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(a) ? a.filter(function (m) { return m && typeof m.content === 'string' && own(ROLES, m.role); }) : [];
    } catch (_) { return []; }
  }
  function saveHistory(h) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(h.slice(-MAX_HISTORY))); } catch (_) {} }
  function friendlyErr(raw) { if (!raw) return t.errGeneric; try { var j = JSON.parse(raw); if (j && j.error) return j.error; } catch (_) {} return raw.length > 200 ? t.errGeneric : raw; }
  // Product of the page the widget is on (same mapping as the server, simplified).
  var PAGE_HOST = { 'pos.yammbo.com': 'pos', 'store.yammbo.com': 'store', 'web.yammbo.com': 'web', 'bot.yammbo.com': 'yammbot', 'music.yammbo.com': 'music', 'tv.yammbo.com': 'tv', 'food.yammbo.com': 'food' };
  var PAGE_PATH = { web: 'web', store: 'store', pos: 'pos', music: 'music', tv: 'tv', food: 'food', bot: 'yammbot', yammbot: 'yammbot' };
  var PAGE_NAME = { pos: 'Yammbo POS', store: 'Yammbo Store', web: 'Yammbo Web', yammbot: 'Yammbot', music: 'Yammbo Music', tv: 'Yammbo TV', food: 'Yammbo Food' };
  function pageProduct() {
    var host = String(location.hostname || '').toLowerCase();
    var segs = String(location.pathname || '').toLowerCase().split('/').filter(Boolean);
    if (own(PAGE_HOST, host)) return PAGE_HOST[host];
    if (host === 'yammbo.com' || host === 'www.yammbo.com') return own(PAGE_PATH, segs[0] || '') ? PAGE_PATH[segs[0]] : null;
    if (host === 'help.yammbo.com' && segs[0] === 'docs') return own(PAGE_PATH, segs[2] || '') ? PAGE_PATH[segs[2]] : null;
    return null;
  }
  function pageInfo() { return { url: location.origin + location.pathname, title: String(document.title || '').slice(0, 120) }; }
  async function getJSON(path) { var r = await fetch(BASE + path, { headers: { 'accept': 'application/json' } }); if (!r.ok) throw new Error('http ' + r.status); return r.json(); }

  // Styles ---------------------------------------------------------------
  var T_DARK = '--yc-bg:#000000;--yc-fg:#ffffff;--yc-muted:#a3a3a3;--yc-soft:#0a0a0a;--yc-soft2:#171717;--yc-line:#262626;--yc-line-strong:#404040;--yc-hover:#141414;--yc-inverse-bg:#ffffff;--yc-inverse-fg:#000000;--yc-accent:#1160d8;--yc-accent-hover:#0d52bd;--yc-accent-text:#6da4ff;--yc-accent-fg:#ffffff;--yc-focus:#6da4ff;';
  var T_LIGHT = '--yc-bg:#ffffff;--yc-fg:#000000;--yc-muted:#525252;--yc-soft:#f6f6f6;--yc-soft2:#ededed;--yc-line:#e5e5e5;--yc-line-strong:#c7c7c7;--yc-hover:#f5f5f5;--yc-inverse-bg:#000000;--yc-inverse-fg:#ffffff;--yc-accent:#1160d8;--yc-accent-hover:#0d52bd;--yc-accent-text:#1160d8;--yc-accent-fg:#ffffff;--yc-focus:#1160d8;';
  var FONT = '"YC Geist",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';
  var css = [
    '@font-face{font-family:"YC Geist";font-style:normal;font-weight:300 800;font-display:swap;src:url(' + BASE + '/fonts/geist-latin-ext.woff2) format("woff2");unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C4,U+2113,U+2C60-2C7F,U+A720-A7FF}',
    '@font-face{font-family:"YC Geist";font-style:normal;font-weight:300 800;font-display:swap;src:url(' + BASE + '/fonts/geist-latin.woff2) format("woff2");unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}',
    '#yammbo-chat-root,#yammbo-chat-root[data-yc-theme="dark"]{' + T_DARK + '}',
    '#yammbo-chat-root[data-yc-theme="light"]{' + T_LIGHT + '}',
    '#yammbo-chat-root *{box-sizing:border-box}',
    '#yammbo-chat-root button,#yammbo-chat-root input,#yammbo-chat-root textarea,#yammbo-chat-root select{font-family:inherit}',
    '#yammbo-chat-root button:focus-visible,#yammbo-chat-root input:focus-visible,#yammbo-chat-root textarea:focus-visible,#yammbo-chat-root select:focus-visible{outline:2px solid var(--yc-focus);outline-offset:2px}',
    '.yc-bubble{position:fixed;right:20px;bottom:20px;width:56px;height:56px;border-radius:999px;background:var(--yc-accent);color:var(--yc-accent-fg);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:2147483646;transition:background-color .15s}',
    '.yc-bubble:hover{background:var(--yc-accent-hover)}.yc-bubble svg{width:26px;height:26px}',
    '.yc-dot{position:absolute;top:1px;right:1px;width:15px;height:15px;border-radius:50%;background:var(--yc-inverse-bg);border:2px solid var(--yc-accent)}.yc-dot[hidden]{display:none}',
    '.yc-panel{position:fixed;right:20px;bottom:90px;width:384px;max-width:calc(100vw - 24px);height:600px;max-height:calc(100vh - 110px);background:var(--yc-bg);border:1px solid var(--yc-line-strong);border-radius:12px;display:flex;flex-direction:column;overflow:hidden;z-index:2147483646;font-family:' + FONT + ';color:var(--yc-fg);animation:yc-in .18s ease-out}',
    '@keyframes yc-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}',
    '.yc-panel.yc-hidden{display:none}',
    '.yc-head{padding:14px 16px;border-bottom:1px solid var(--yc-line);display:flex;align-items:center;gap:10px;flex-shrink:0;background:var(--yc-bg);min-height:54px}',
    '.yc-head h3{margin:0;font-size:15px;font-weight:600;line-height:1.2;color:var(--yc-fg);flex:1}',
    '.yc-head p{margin:2px 0 0;font-size:12px;color:var(--yc-muted)}',
    '.yc-iconbtn{background:transparent;border:none;cursor:pointer;color:var(--yc-muted);padding:5px;border-radius:8px;display:flex;align-items:center}.yc-iconbtn:hover{background:var(--yc-hover);color:var(--yc-fg)}',
    '.yc-iconbtn[hidden]{display:none}',
    '.yc-lang{display:flex;gap:2px;align-items:center;border:1px solid var(--yc-line);border-radius:8px;padding:2px}',
    '.yc-lang button{background:transparent;border:none;cursor:pointer;font-size:11px;font-weight:600;color:var(--yc-muted);padding:3px 7px;border-radius:6px;letter-spacing:.03em}',
    '.yc-lang button.yc-langon{color:var(--yc-fg);background:var(--yc-soft2)}',
    '.yc-view{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;background:var(--yc-bg)}',
    '.yc-view.yc-chatview{display:flex;flex-direction:column;padding:0}',
    // home
    '.yc-hero{padding:24px 18px 4px;color:var(--yc-fg)}',
    '.yc-hero h2{margin:0;font-size:28px;font-weight:600;letter-spacing:-.02em;line-height:1.15}',
    '.yc-hero p{margin:6px 0 0;font-size:14px;color:var(--yc-muted)}',
    '.yc-searchwrap{padding:14px 16px 6px}',
    '.yc-search{width:100%;background:var(--yc-soft);border:1px solid var(--yc-line);border-radius:12px;padding:11px 13px;font-size:14px;color:var(--yc-fg)}',
    '.yc-search::placeholder,.yc-input::placeholder{color:var(--yc-muted)}',
    '.yc-search:focus,.yc-input:focus,.yc-field input:focus,.yc-field select:focus,.yc-field textarea:focus{border-color:var(--yc-focus)}',
    '.yc-cards{padding:10px 16px 14px;display:flex;flex-direction:column;gap:10px}',
    '.yc-card{display:flex;align-items:center;gap:12px;background:var(--yc-bg);border:1px solid var(--yc-line);border-radius:12px;padding:14px;cursor:pointer;text-align:left;width:100%;color:var(--yc-fg);transition:background-color .12s,border-color .12s}',
    '.yc-card:hover{background:var(--yc-hover);border-color:var(--yc-line-strong)}',
    '.yc-card .yc-ci{width:36px;height:36px;border-radius:8px;background:var(--yc-soft2);color:var(--yc-fg);display:flex;align-items:center;justify-content:center;flex-shrink:0}',
    '.yc-card .yc-ct{flex:1}.yc-card .yc-ct b{display:block;font-size:14px;font-weight:600;color:var(--yc-fg)}.yc-card .yc-ct span{font-size:12px;color:var(--yc-muted)}',
    '.yc-card .yc-chev{color:var(--yc-muted);display:flex}',
    // list (docs/blog)
    '.yc-list{padding:10px 12px;display:flex;flex-direction:column;gap:6px}',
    '.yc-grp{font-size:11px;font-weight:600;color:var(--yc-muted);padding:10px 4px 2px}',
    '.yc-li{display:flex;gap:10px;align-items:center;background:var(--yc-bg);border:1px solid var(--yc-line);border-radius:12px;padding:11px 13px;cursor:pointer;text-align:left;width:100%;color:var(--yc-fg);transition:background-color .12s,border-color .12s}',
    '.yc-li:hover{background:var(--yc-hover);border-color:var(--yc-line-strong)}',
    '.yc-li.yc-more{justify-content:center;color:var(--yc-accent-text);font-weight:600;font-size:13px}',
    '.yc-li img{width:46px;height:46px;border-radius:8px;object-fit:cover;flex-shrink:0;background:var(--yc-soft2)}',
    '.yc-li .yc-lt{flex:1;min-width:0}.yc-li .yc-lt b{display:block;font-size:13px;font-weight:600;color:var(--yc-fg);line-height:1.3}.yc-li .yc-lt span{display:block;font-size:11px;color:var(--yc-muted);margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.yc-muted{padding:24px 18px;color:var(--yc-muted);font-size:13px;text-align:center;line-height:1.5}',
    // markdown content (articles + assistant messages)
    '.yc-md{word-wrap:break-word;overflow-wrap:anywhere}',
    '.yc-md>:first-child{margin-top:0}.yc-md>:last-child{margin-bottom:0}',
    '.yc-md p{margin:0 0 10px}',
    '.yc-md h3{font-size:16px;font-weight:600;line-height:1.3;margin:16px 0 8px;color:var(--yc-fg)}',
    '.yc-md h4{font-size:14.5px;font-weight:600;line-height:1.3;margin:14px 0 6px;color:var(--yc-fg)}',
    '.yc-md h5{font-size:13px;font-weight:600;line-height:1.3;margin:12px 0 4px;color:var(--yc-fg)}',
    '.yc-md ul,.yc-md ol{padding-left:20px;margin:0 0 10px}.yc-md li{margin:2px 0}',
    '.yc-md a{color:var(--yc-accent-text);text-decoration:underline}',
    '.yc-md hr{border:none;border-top:1px solid var(--yc-line);margin:12px 0}',
    '.yc-md code{background:var(--yc-soft2);color:var(--yc-fg);padding:1px 5px;border-radius:4px;font-size:12px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}',
    '.yc-md pre{background:var(--yc-soft2);border:1px solid var(--yc-line);border-radius:8px;padding:10px 12px;margin:0 0 10px;overflow-x:auto;white-space:pre}',
    '.yc-md pre code{background:none;padding:0;border-radius:0;font-size:12px;line-height:1.5}',
    '.yc-tablewrap{overflow-x:auto;margin:0 0 10px;-webkit-overflow-scrolling:touch}',
    '.yc-md table{border-collapse:collapse;font-size:12.5px;min-width:100%}',
    '.yc-md th,.yc-md td{border:1px solid var(--yc-line);padding:6px 9px;text-align:left;vertical-align:top}',
    '.yc-md th{background:var(--yc-soft);font-weight:600;color:var(--yc-fg)}',
    // article
    '.yc-article{padding:18px;color:var(--yc-fg);font-size:14px;line-height:1.6}',
    '.yc-article h1{font-size:19px;font-weight:600;letter-spacing:-.01em;margin:0 0 12px;color:var(--yc-fg)}',
    '.yc-article .yc-readmore{display:inline-block;margin-top:8px;font-size:13px;color:var(--yc-accent-text);font-weight:600}',
    // chat
    '.yc-body{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px;background:var(--yc-bg);-webkit-overflow-scrolling:touch}',
    '.yc-msg{max-width:85%;padding:9px 12px;border-radius:12px;font-size:14px;line-height:1.45;word-wrap:break-word}',
    '.yc-msg.yc-user{align-self:flex-end;background:var(--yc-inverse-bg);color:var(--yc-inverse-fg);border-bottom-right-radius:4px;white-space:pre-wrap}',
    '.yc-msg.yc-asst{align-self:flex-start;background:var(--yc-soft);border:1px solid var(--yc-line);color:var(--yc-fg);border-bottom-left-radius:4px}',
    // live conversation: team bubble, system lines, status strip, rating card
    '.yc-msg.yc-agent{align-self:flex-start;background:var(--yc-bg);border:1px solid var(--yc-fg);color:var(--yc-fg);border-bottom-left-radius:4px}',
    '.yc-who{font-size:11px;font-weight:700;letter-spacing:.02em;margin-bottom:3px}.yc-atext{white-space:pre-wrap;overflow-wrap:anywhere}',
    '.yc-sys{align-self:center;max-width:92%;text-align:center;font-size:11.5px;line-height:1.35;color:var(--yc-muted);padding:2px 8px}',
    '.yc-live{flex-shrink:0;display:flex;align-items:center;gap:8px 10px;flex-wrap:wrap;padding:8px 14px;border-top:1px solid var(--yc-line);background:var(--yc-soft);font-size:12.5px;line-height:1.4;color:var(--yc-fg)}.yc-live[hidden]{display:none}.yc-live>span{flex:1 1 190px}',
    '.yc-csat{align-self:stretch;border:1px solid var(--yc-line-strong);border-radius:12px;background:var(--yc-soft);padding:14px;display:flex;flex-direction:column;gap:10px;font-size:13.5px;color:var(--yc-fg)}.yc-csat>b{font-size:14px;font-weight:600}',
    '.yc-stars{display:flex;gap:2px}.yc-star{background:transparent;border:none;cursor:pointer;color:var(--yc-muted);padding:4px;border-radius:8px;display:flex}.yc-star svg{width:28px;height:28px;fill:none}.yc-star:hover{color:var(--yc-fg)}.yc-star.yc-on{color:var(--yc-fg)}.yc-star.yc-on svg{fill:currentColor}',
    '.yc-csat textarea{width:100%;resize:vertical;min-height:52px;background:var(--yc-bg);border:1px solid var(--yc-line);border-radius:8px;padding:8px 10px;font-size:13.5px;color:var(--yc-fg)}',
    '.yc-note{align-self:flex-start;font-size:13px;line-height:1.45;color:var(--yc-muted)}.yc-note.yc-bad{color:var(--yc-fg);font-weight:600}',
    '.yc-typing{align-self:flex-start;background:var(--yc-soft);border:1px solid var(--yc-line);border-radius:12px;border-bottom-left-radius:4px;padding:10px 14px;display:inline-flex;gap:4px}',
    '.yc-typing span{width:6px;height:6px;border-radius:50%;background:var(--yc-muted);animation:yc-blink 1.2s infinite ease-in-out}',
    '.yc-typing span:nth-child(2){animation-delay:.15s}.yc-typing span:nth-child(3){animation-delay:.3s}',
    '@keyframes yc-blink{0%,80%,100%{opacity:.3}40%{opacity:1}}',
    '.yc-handoff{align-self:flex-start;margin-top:2px}',
    '.yc-hbtns{display:flex;flex-wrap:wrap;gap:8px}',
    '.yc-hbtn,.yc-submit{background:var(--yc-accent);color:var(--yc-accent-fg);border:none;border-radius:12px;padding:9px 14px;font-size:13px;font-weight:600;cursor:pointer;transition:background-color .12s}',
    '.yc-hbtn:hover:not(:disabled),.yc-submit:hover:not(:disabled){background:var(--yc-accent-hover)}.yc-hbtn:disabled{background:var(--yc-soft2);color:var(--yc-muted);cursor:not-allowed}',
    '.yc-sugg{display:flex;flex-direction:column;gap:8px;align-items:flex-start;margin-top:4px}',
    '.yc-chip{background:var(--yc-bg);border:1px solid var(--yc-line);border-radius:999px;padding:8px 13px;font-size:13px;line-height:1.3;color:var(--yc-fg);cursor:pointer;text-align:left;transition:background-color .12s,border-color .12s}',
    '.yc-chip:hover{background:var(--yc-hover);border-color:var(--yc-line-strong)}',
    '.yc-fb{align-self:flex-start;display:flex;gap:2px;margin:-6px 0 0 4px}',
    '.yc-fb button{background:transparent;border:none;cursor:pointer;color:var(--yc-muted);padding:4px;border-radius:6px;display:flex}.yc-fb button:hover{background:var(--yc-hover);color:var(--yc-fg)}.yc-fb button[aria-pressed="true"]{color:var(--yc-accent-text)}',
    '.yc-direct{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:10px}.yc-direct>span{flex-basis:100%;font-size:12px;color:var(--yc-muted)}',
    '.yc-ghost{display:inline-flex;align-items:center;gap:6px;background:transparent;color:var(--yc-fg);border:1px solid var(--yc-line-strong);border-radius:12px;padding:8px 12px;font-size:13px;font-weight:600;text-decoration:none;cursor:pointer;transition:background-color .12s}.yc-ghost:hover{background:var(--yc-hover)}',
    '.yc-privacy{flex-shrink:0;padding:0 14px 8px;font-size:11px;line-height:1.35;color:var(--yc-muted);text-align:center;background:var(--yc-bg)}.yc-privacy a{color:var(--yc-muted);text-decoration:underline}',
    '.yc-hp{position:absolute;left:-9999px;top:auto;width:1px;height:1px;overflow:hidden}',
    '.yc-foot{padding:10px;border-top:1px solid var(--yc-line);display:flex;gap:8px;align-items:flex-end;background:var(--yc-bg);flex-shrink:0}',
    '.yc-input{flex:1;resize:none;background:var(--yc-soft);border:1px solid var(--yc-line);border-radius:12px;padding:9px 11px;font-size:14px;line-height:1.4;max-height:120px;color:var(--yc-fg)}',
    '.yc-send{background:var(--yc-accent);color:var(--yc-accent-fg);border:none;border-radius:12px;width:38px;height:38px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:background-color .12s}.yc-send:hover:not(:disabled){background:var(--yc-accent-hover)}.yc-send:disabled{background:var(--yc-soft2);color:var(--yc-muted);cursor:not-allowed}',
    // form
    '.yc-form{padding:16px;display:flex;flex-direction:column;gap:12px}',
    '.yc-form .yc-fh{margin-bottom:2px}.yc-form .yc-fh b{font-size:16px;font-weight:600;color:var(--yc-fg)}.yc-form .yc-fh p{margin:3px 0 0;font-size:13px;color:var(--yc-muted)}',
    '.yc-field label{display:block;font-size:12px;color:var(--yc-muted);margin-bottom:4px}',
    '.yc-field input,.yc-field select,.yc-field textarea{width:100%;background:var(--yc-soft);border:1px solid var(--yc-line);border-radius:8px;padding:10px 11px;font-size:14px;color:var(--yc-fg)}',
    '.yc-field textarea{resize:vertical;min-height:64px}',
    '.yc-field.yc-err input{border-color:var(--yc-fg);box-shadow:0 0 0 1px var(--yc-fg)}',
    '.yc-submit{padding:12px;font-size:14px}.yc-submit:disabled{background:var(--yc-soft2);color:var(--yc-muted);cursor:not-allowed}',
    '.yc-result{padding:24px 18px;text-align:center;font-size:14px;line-height:1.5;color:var(--yc-fg)}',
    // bottom nav
    '.yc-nav{display:flex;border-top:1px solid var(--yc-line);background:var(--yc-bg);flex-shrink:0}',
    '.yc-nav button{flex:1;background:transparent;border:none;cursor:pointer;padding:9px 0 7px;display:flex;flex-direction:column;align-items:center;gap:3px;color:var(--yc-muted);font-size:11px}',
    '.yc-nav button.yc-active{color:var(--yc-accent-text)}.yc-nav button svg{width:20px;height:20px}',
    '@media (max-width:480px){',
      '.yc-panel{right:0;bottom:0;top:0;left:0;width:100vw;max-width:100vw;height:100vh;height:100dvh;max-height:100dvh;border-radius:0;border:none}',
      '.yc-bubble{right:14px;bottom:14px}',
      '.yc-head{padding-top:max(14px,env(safe-area-inset-top))}',
      '.yc-nav{padding-bottom:max(0px,env(safe-area-inset-bottom))}',
    '}',
    '@media (prefers-reduced-motion: reduce){#yammbo-chat-root *{animation:none!important;transition:none!important}}'
  ].join('');

  var style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
  var root = document.createElement('div'); root.id = 'yammbo-chat-root'; document.body.appendChild(root);

  // Theme: follow the host site (class/data-theme on <html>/<body>, else OS preference).
  function hostTheme() {
    var els = [document.documentElement, document.body];
    for (var k = 0; k < els.length; k++) {
      var e = els[k]; if (!e) continue;
      var dt = (e.getAttribute('data-theme') || '').toLowerCase();
      if (e.classList.contains('dark') || dt === 'dark') return 'dark';
      if (e.classList.contains('light') || dt === 'light') return 'light';
    }
    // No explicit marker (help, tv, link, music/web in light mode): read the
    // painted background so a white page never gets a black panel.
    for (var b = 0; b < els.length; b++) {
      if (!els[b]) continue;
      var lum = bgLightness(getComputedStyle(els[b]).backgroundColor);
      if (lum !== null) return lum < 0.5 ? 'dark' : 'light';
    }
    return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  }
  // Perceived lightness 0..1 of a computed background colour, or null when
  // transparent/unknown. Handles rgb()/rgba() and oklch()/oklab() (tv uses oklch).
  function bgLightness(c) {
    c = String(c || '').trim().toLowerCase();
    var m = c.match(/^rgba?\\(([^)]+)\\)/);
    if (m) {
      var v = m[1].split(/[\\s,\\/]+/).filter(Boolean).map(parseFloat);
      if (v.length > 3 && v[3] === 0) return null;
      return (0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]) / 255;
    }
    m = c.match(/^okl(?:ch|ab)\\(\\s*([\\d.]+)(%?)([^)]*)\\)/);
    if (m) {
      if (/\\/\\s*0(?:%|\\.0*)?\\s*$/.test(m[3])) return null;
      var L = parseFloat(m[1]); return m[2] ? L / 100 : L;
    }
    return null;
  }
  function applyTheme() { root.setAttribute('data-yc-theme', hostTheme()); }
  applyTheme();
  try {
    var mo = new MutationObserver(applyTheme);
    [document.documentElement, document.body].forEach(function (e) { if (e) mo.observe(e, { attributes: true, attributeFilter: ['class', 'data-theme'] }); });
  } catch (_) {}
  try {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    if (mq.addEventListener) mq.addEventListener('change', applyTheme); else if (mq.addListener) mq.addListener(applyTheme);
  } catch (_) {}


  // SVG icons
  var IC = {
    chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>',
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/></svg>',
    help: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
    close: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',
    back: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
    sendIcon: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>',
    newchat: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
    thumbUp: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>',
    thumbDown: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/></svg>',
    wa: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>',
    mail: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/><path d="M22 6l-10 7L2 6"/></svg>',
    star: '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>',
    chev: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>'
  };

  var bubble = el('<button class="yc-bubble" aria-label="' + t.open + '">' + IC.chat + '</button>');
  var dotEl = el('<span class="yc-dot" hidden></span>');
  bubble.appendChild(dotEl);
  root.appendChild(bubble);

  var panel = el('<div class="yc-panel yc-hidden" role="dialog" aria-label="Yammbo"></div>');
  root.appendChild(panel);

  // State ----------------------------------------------------------------
  var chatLog = loadHistory();
  var busy = false;
  var docsCache = null;
  var newChatBtn = null; // header button, only visible when the chat has messages
  var chatInput = null;
  var liveMode = loadMode(); // 'bot' | 'waiting' | 'human', as last reported by the server
  var lastAt = loadLastAt(); // created_at (ms) of the newest team message already received
  var csatPending = false; // the team asked for a rating and it is still unanswered
  var chatSubEl = null, liveBar = null; // header subtitle and status strip of the chat view
  // Navigation stack — drives both rendering and the device back button.
  // Bottom of the stack is always 'home'. Each forward navigation pushes a
  // browser history entry so the hardware/browser Back button unwinds the
  // widget view-by-view, and only closes the site once the widget is closed.
  var stack = [{ v: 'home' }];

  function loadMode() { try { var v = localStorage.getItem(MODE_KEY); return v === 'waiting' || v === 'human' ? v : 'bot'; } catch (_) { return 'bot'; } }
  function loadLastAt() { try { return parseInt(localStorage.getItem(AFTER_KEY) || '0', 10) || 0; } catch (_) { return 0; } }

  function isOpen() { return !panel.classList.contains('yc-hidden'); }
  function topView() { return stack[stack.length - 1]; }
  function renderTop() { var s = topView(); render(s.v, s.param); }

  // Render scaffolding ---------------------------------------------------
  function clear() { panel.innerHTML = ''; }
  function header(title, opts) {
    opts = opts || {};
    var h = el('<div class="yc-head"></div>');
    if (opts.back) {
      var b = el('<button class="yc-iconbtn" aria-label="' + t.back + '">' + IC.back + '</button>');
      b.addEventListener('click', navBack);
      h.appendChild(b);
    }
    var titleEl = el('<div style="flex:1"><h3 style="margin:0">' + esc(title) + '</h3>' + (opts.sub ? '<p>' + esc(opts.sub) + '</p>' : '') + '</div>');
    if (opts.newChat) chatSubEl = titleEl.querySelector('p');
    h.appendChild(titleEl);
    newChatBtn = null;
    if (opts.newChat) {
      newChatBtn = el('<button class="yc-iconbtn" aria-label="' + t.newChat + '" title="' + t.newChat + '">' + IC.newchat + '</button>');
      newChatBtn.hidden = !chatLog.length;
      newChatBtn.addEventListener('click', newConversation);
      h.appendChild(newChatBtn);
    }
    var langTog = el('<div class="yc-lang"></div>');
    ['es', 'en'].forEach(function (L) {
      var lb = el('<button class="' + (lang === L ? 'yc-langon' : '') + '" aria-label="' + L + '">' + L.toUpperCase() + '</button>');
      lb.addEventListener('click', function () { if (lang !== L) setLang(L); });
      langTog.appendChild(lb);
    });
    h.appendChild(langTog);
    var c = el('<button class="yc-iconbtn" aria-label="' + t.close + '">' + IC.close + '</button>');
    c.addEventListener('click', close); h.appendChild(c);
    return h;
  }
  // Manual language override — persists and re-renders the current view.
  function setLang(L) {
    lang = L; t = STR[L];
    try { localStorage.setItem(LANG_KEY, L); } catch (_) {}
    docsCache = null; // doc index was fetched in the previous language
    renderTop();
  }
  function bottomNav(active) {
    var nav = el('<div class="yc-nav"></div>');
    var bHome = el('<button class="' + (active === 'home' ? 'yc-active' : '') + '">' + IC.home + '<span>' + t.navHome + '</span></button>');
    bHome.addEventListener('click', navToHome);
    var bChat = el('<button class="' + (active === 'chat' ? 'yc-active' : '') + '">' + IC.chat + '<span>' + t.navChat + '</span></button>');
    bChat.addEventListener('click', function () { if (topView().v !== 'chat') go('chat'); });
    nav.appendChild(bHome); nav.appendChild(bChat);
    return nav;
  }

  // Navigation -----------------------------------------------------------
  // Forward navigation: push a view and a matching browser history entry.
  function go(v, param) {
    stack.push({ v: v, param: param });
    window.history.pushState({ yc: stack.length }, '');
    render(v, param);
  }
  // Back arrow / device back: ask the browser to go back; popstate unwinds.
  function navBack() { window.history.back(); }
  // Bottom-nav Home: collapse the stack down to home in one shot.
  function navToHome() {
    var extra = stack.length - 1;
    if (extra > 0) window.history.go(-extra); // popstate handler unwinds each level
  }

  // Every view change can change the polling cadence (chat visible or not).
  function render(v, param) { renderView(v, param); schedulePoll(); }
  function renderView(v, param) {
    clear();
    if (v === 'home') return renderHome();
    if (v === 'help') return renderHelp(param || '');
    if (v === 'article') return renderArticle(param);
    if (v === 'blog') return renderBlog();
    if (v === 'chat') return renderChat();
    if (v === 'form') return renderForm();
    renderHome();
  }

  function renderHome() {
    panel.appendChild(header(t.title, {}));
    var wrap = el('<div class="yc-view"></div>');
    var hero = el('<div class="yc-hero"><h2>' + t.homeHi + '</h2><p>' + esc(t.homeSub) + '</p></div>');
    wrap.appendChild(hero);
    var sw = el('<div class="yc-searchwrap"></div>');
    var si = el('<input class="yc-search" type="text" placeholder="' + t.search + '">');
    si.addEventListener('keydown', function (e) { if (e.key === 'Enter' && si.value.trim()) go('help', si.value.trim()); });
    si.addEventListener('focus', function () { go('help', ''); });
    sw.appendChild(si); wrap.appendChild(sw);
    var cards = el('<div class="yc-cards"></div>');
    cards.appendChild(card(IC.help, t.secHelp, t.secHelpSub, function () { go('help', ''); }));
    cards.appendChild(card(IC.book, t.secBlog, t.secBlogSub, function () { go('blog'); }));
    cards.appendChild(card(IC.chat, t.secChat, t.secChatSub, function () { go('chat'); }));
    wrap.appendChild(cards);
    panel.appendChild(wrap);
    panel.appendChild(bottomNav('home'));
  }
  function card(icon, title, sub, onClick) {
    var c = el('<button class="yc-card"><span class="yc-ci">' + icon + '</span><span class="yc-ct"><b>' + esc(title) + '</b><span>' + esc(sub) + '</span></span><span class="yc-chev">' + IC.chev + '</span></button>');
    c.querySelector('.yc-ci svg').style.width = '18px'; c.querySelector('.yc-ci svg').style.height = '18px';
    c.addEventListener('click', onClick); return c;
  }

  // Help-center product groups: canonical id, display order and labels.
  var PROD_ORDER = ['start', 'pos', 'food', 'store', 'web', 'yammbot', 'music', 'tv', 'account', 'trouble'];
  var PROD_ALIAS = { 'empezar': 'start', 'getting-started': 'start', 'cuenta': 'account', 'account': 'account', 'solucion-de-problemas': 'trouble', 'troubleshooting': 'trouble' };
  var PROD_LABEL = {
    start: { es: 'Empezar', en: 'Getting started' },
    pos: { es: 'POS', en: 'POS' }, food: { es: 'Food', en: 'Food' }, store: { es: 'Store', en: 'Store' }, web: { es: 'Web', en: 'Web' },
    yammbot: { es: 'Yammbot', en: 'Yammbot' }, music: { es: 'Music', en: 'Music' }, tv: { es: 'TV', en: 'TV' },
    account: { es: 'Cuenta', en: 'Account' },
    trouble: { es: 'Solución de problemas', en: 'Troubleshooting' }
  };
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function prodKey(p) { var k = String(p || '').toLowerCase().trim(); return own(PROD_ALIAS, k) ? PROD_ALIAS[k] : k; }
  function prodRank(k) { var r = PROD_ORDER.indexOf(k); return r < 0 ? 99 : r; }

  async function renderHelp(query) {
    panel.appendChild(header(t.secHelp, { back: true }));
    var wrap = el('<div class="yc-view"></div>');
    var sw = el('<div class="yc-searchwrap"></div>');
    var si = el('<input class="yc-search" type="text" placeholder="' + t.search + '" value="' + esc(query) + '">');
    sw.appendChild(si); wrap.appendChild(sw);
    var list = el('<div class="yc-list"></div>'); wrap.appendChild(list);
    panel.appendChild(wrap);
    panel.appendChild(bottomNav('home'));

    if (!docsCache) { try { var r = await getJSON('/api/docs?lang=' + lang); docsCache = r.docs || []; } catch (_) { docsCache = []; } }
    function docItem(d) {
      var li = el('<button class="yc-li"><span class="yc-lt"><b>' + esc(d.title) + '</b><span>' + esc(d.description || d.product) + '</span></span></button>');
      li.addEventListener('click', function () { go('article', d.slug); });
      return li;
    }
    function paint(q) {
      list.innerHTML = '';
      var ql = q.toLowerCase();
      var items = docsCache.filter(function (d) { return !ql || (d.title + ' ' + d.description + ' ' + d.product).toLowerCase().indexOf(ql) >= 0; });
      if (!items.length) { list.appendChild(el('<div class="yc-muted">' + t.noResults + '</div>')); return; }
      if (ql) { items.slice(0, 50).forEach(function (d) { list.appendChild(docItem(d)); }); return; }
      var groups = {}, keys = [], raw = {};
      items.forEach(function (d) {
        var k = prodKey(d.product);
        if (!own(groups, k)) { groups[k] = []; keys.push(k); raw[k] = d.product; }
        groups[k].push(d);
      });
      var first = keys.slice();
      keys.sort(function (a, b) { return (prodRank(a) - prodRank(b)) || (first.indexOf(a) - first.indexOf(b)); });
      keys.forEach(function (k) {
        var label = own(PROD_LABEL, k) ? PROD_LABEL[k][lang] : (raw[k] || '');
        if (label) list.appendChild(el('<div class="yc-grp">' + esc(label) + '</div>'));
        groups[k].forEach(function (d) { list.appendChild(docItem(d)); });
      });
    }
    paint(query);
    si.addEventListener('input', function () { paint(si.value.trim()); });
    setTimeout(function () { si.focus(); }, 50);
  }

  async function renderArticle(slug) {
    panel.appendChild(header(t.secHelp, { back: true }));
    var wrap = el('<div class="yc-view"></div>');
    var art = el('<div class="yc-article"><div class="yc-muted">…</div></div>'); wrap.appendChild(art);
    panel.appendChild(wrap); panel.appendChild(bottomNav('home'));
    try {
      var d = await getJSON('/api/docs?lang=' + lang + '&slug=' + encodeURIComponent(slug));
      art.className = 'yc-article yc-md';
      art.innerHTML = '<h1>' + esc(d.title) + '</h1>' + md(d.body) +
        '<a class="yc-readmore" href="https://help.yammbo.com/docs/' + esc(String(d.slug || slug).replace(/^\\/+|\\/+$/g, '')) + '/" target="_blank" rel="noopener">help.yammbo.com →</a>';
    } catch (_) { art.innerHTML = '<div class="yc-muted">' + t.errGeneric + '</div>'; }
  }

  async function renderBlog() {
    panel.appendChild(header(t.secBlog, { back: true }));
    var wrap = el('<div class="yc-view"></div>');
    var list = el('<div class="yc-list"><div class="yc-muted">…</div></div>'); wrap.appendChild(list);
    panel.appendChild(wrap); panel.appendChild(bottomNav('home'));
    try {
      var r = await getJSON('/api/blog'); var posts = r.posts || [];
      list.innerHTML = '';
      if (!posts.length) { list.appendChild(el('<div class="yc-muted">—</div>')); return; }
      posts.forEach(function (p) {
        var img = p.image ? '<img src="' + esc(p.image) + '" alt="" loading="lazy">' : '';
        var li = el('<button class="yc-li">' + img + '<span class="yc-lt"><b>' + esc(p.title) + '</b><span>' + esc(p.description) + '</span></span></button>');
        li.addEventListener('click', function () { window.open(p.link, '_blank', 'noopener'); });
        list.appendChild(li);
      });
      var all = el('<button class="yc-li yc-more">' + esc(t.readMore) + '</button>');
      all.addEventListener('click', function () { window.open('https://blog.yammbo.com/', '_blank', 'noopener'); });
      list.appendChild(all);
    } catch (_) { list.innerHTML = '<div class="yc-muted">' + t.errGeneric + '</div>'; }
  }

  // Chat -----------------------------------------------------------------
  var chatBody = null;
  function renderChat() {
    panel.appendChild(header(t.secChat, { back: true, sub: t.secChatSub, newChat: true }));
    var wrap = el('<div class="yc-view yc-chatview"></div>');
    chatBody = el('<div class="yc-body" aria-live="polite"></div>');
    wrap.appendChild(chatBody);
    liveBar = el('<div class="yc-live" role="status" hidden></div>');
    wrap.appendChild(liveBar);
    var foot = el('<div class="yc-foot"></div>');
    var input = el('<textarea class="yc-input" rows="1" maxlength="2000" placeholder="' + t.chatPlaceholder + '"></textarea>');
    chatInput = input;
    var sendB = el('<button class="yc-send" aria-label="' + t.send + '">' + IC.sendIcon + '</button>');
    foot.appendChild(input); foot.appendChild(sendB);
    wrap.appendChild(foot);
    wrap.appendChild(el('<div class="yc-privacy">' + esc(t.privacy) + ' <a href="https://chat.yammbo.com/privacy#' + lang + '" target="_blank" rel="noopener">' + esc(t.privacyLink) + '</a></div>'));
    panel.appendChild(wrap); panel.appendChild(bottomNav('chat'));

    input.addEventListener('input', function () { input.style.height = 'auto'; input.style.height = Math.min(120, input.scrollHeight) + 'px'; });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(input); } });
    sendB.addEventListener('click', function () { doSend(input); });

    paintChat();
    paintLive();
    // Opening the chat: the visitor sees everything pending, so the dot goes, and
    // the server is asked once whether the team took the conversation over.
    setDot(false);
    if (hasConv() && Date.now() - lastPollAt > 3000) poll();
    setTimeout(function () { input.focus(); }, 50);
  }
  function paintChat() {
    chatBody.innerHTML = '';
    if (newChatBtn) newChatBtn.hidden = !chatLog.length;
    if (!chatLog.length) {
      chatBody.appendChild(el('<div class="yc-muted">' + t.chatEmpty + '</div>'));
      var sg = el('<div class="yc-sugg"></div>');
      suggestions().forEach(function (q) {
        var c = el('<button class="yc-chip">' + esc(q) + '</button>');
        c.addEventListener('click', function () { if (chatInput) doSend(chatInput, q); });
        sg.appendChild(c);
      });
      chatBody.appendChild(sg);
      return;
    }
    chatLog.forEach(function (m) {
      if (m.role === 'agent') addAgent(m.content);
      else if (m.role === 'system') addSys(m.content);
      else { addMsg(m.role, m.content, false); if (m.role === 'assistant' && m.id) addThumbs(m); }
    });
    if (csatPending) addCsat();
    chatBody.scrollTop = chatBody.scrollHeight;
  }
  // Empty-chat chips: product-specific when the page maps to a product.
  function suggestions() {
    var p = pageProduct();
    if (!p) return t.suggGen;
    var X = PAGE_NAME[p];
    return [t.suggWhat, t.suggStart, t.suggPrice].map(function (s) { return s.replace('{X}', X); });
  }
  // Wipes the conversation: history, stored session id (a new one is minted) and view.
  function newConversation() {
    if (busy) return;
    chatLog = [];
    liveMode = 'bot'; lastAt = 0; csatPending = false;
    try { localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(MODE_KEY); localStorage.removeItem(AFTER_KEY); localStorage.setItem(SESSION_KEY, newSessionId()); } catch (_) {}
    setDot(false);
    paintChat();
    paintLive();
    if (chatInput) chatInput.focus();
  }
  // Thumbs under an assistant answer. m is the chatLog entry (m.id, m.rating).
  function addThumbs(m) {
    var row = el('<div class="yc-fb"></div>');
    var up = el('<button aria-label="' + t.fbUp + '" title="' + t.fbUp + '">' + IC.thumbUp + '</button>');
    var down = el('<button aria-label="' + t.fbDown + '" title="' + t.fbDown + '">' + IC.thumbDown + '</button>');
    function sync() { up.setAttribute('aria-pressed', m.rating === 1 ? 'true' : 'false'); down.setAttribute('aria-pressed', m.rating === -1 ? 'true' : 'false'); }
    function vote(r) {
      if (m.rating === r) return;
      m.rating = r; saveHistory(chatLog); sync();
      try {
        fetch(BASE + '/api/feedback', { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId: sessionId(), messageId: m.id, rating: r }) }).catch(function () {});
      } catch (_) {}
    }
    up.addEventListener('click', function () { vote(1); });
    down.addEventListener('click', function () { vote(-1); });
    sync();
    row.appendChild(up); row.appendChild(down);
    chatBody.appendChild(row); chatBody.scrollTop = chatBody.scrollHeight;
    return row;
  }
  // "Prefer to reach us directly?" row: WhatsApp + email, secondary buttons.
  function contactRow() {
    var r = el('<div class="yc-direct"><span>' + esc(t.reachDirect) + '</span></div>');
    r.appendChild(el('<a class="yc-ghost" href="https://wa.me/15623464876" target="_blank" rel="noopener">' + IC.wa + esc(t.ctWhatsApp) + '</a>'));
    r.appendChild(el('<a class="yc-ghost" href="mailto:support@yammbo.com">' + IC.mail + esc(t.ctEmail) + '</a>'));
    return r;
  }
  function addMsg(role, content, persist) {
    var e = document.createElement('div');
    e.className = 'yc-msg ' + (role === 'user' ? 'yc-user' : 'yc-asst yc-md');
    e.innerHTML = role === 'user' ? esc(content) : md(content);
    chatBody.appendChild(e); chatBody.scrollTop = chatBody.scrollHeight;
    if (persist) { chatLog.push({ role: role, content: content }); saveHistory(chatLog); }
    return e;
  }
  function addNote(text, bad) {
    var n = el('<div class="yc-note' + (bad ? ' yc-bad' : '') + '">' + esc(text) + '</div>');
    chatBody.appendChild(n); chatBody.scrollTop = chatBody.scrollHeight;
    return n;
  }
  // The assistant offered a person: talk to the team right here (live chat) or leave
  // contact details (the form). Live chat needs a strong session id (see canLive).
  function addHandoffButton() {
    var w = el('<div class="yc-handoff"></div>');
    var btns = el('<div class="yc-hbtns"></div>');
    if (canLive() && liveMode === 'bot') {
      var live = el('<button class="yc-hbtn">' + esc(t.humanHere) + '</button>');
      live.addEventListener('click', function () { startLive(live, w); });
      btns.appendChild(live);
    }
    var leave = el('<button class="' + (btns.firstChild ? 'yc-ghost' : 'yc-hbtn') + '">' + esc(t.leaveData) + '</button>');
    leave.addEventListener('click', function () { go('form'); });
    btns.appendChild(leave);
    w.appendChild(btns);
    w.appendChild(contactRow());
    chatBody.appendChild(w); chatBody.scrollTop = chatBody.scrollHeight;
  }
  async function startLive(btn, wrapEl) {
    btn.disabled = true;
    try {
      var res = await fetch(BASE + '/api/handoff', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: sessionId(), lang: lang }) });
      var j = await res.json().catch(function () { return {}; });
      if (res.ok && j.ok) {
        wrapEl.remove();
        setMode(j.mode === 'human' ? 'human' : 'waiting');
        poll(); // brings the "you asked for a person" line
      } else {
        btn.disabled = false;
        addNote(res.status === 429 && j.error ? j.error : t.handoffErr, true);
      }
    } catch (_) { btn.disabled = false; addNote(t.errNetwork, true); }
  }
  // Team message: own bubble with a label. Plain text only (textContent via esc).
  function addAgent(text) {
    var e = el('<div class="yc-msg yc-agent"><div class="yc-who">' + esc(t.teamLabel) + '</div><div class="yc-atext">' + esc(text) + '</div></div>');
    chatBody.appendChild(e); chatBody.scrollTop = chatBody.scrollHeight;
    return e;
  }
  // System line: only known codes are shown, as translated constants.
  function addSys(code) {
    if (!own(t.sys, code)) return null;
    var e = el('<div class="yc-sys">' + esc(t.sys[code]) + '</div>');
    chatBody.appendChild(e); chatBody.scrollTop = chatBody.scrollHeight;
    return e;
  }
  // One-time rating card: 5 star buttons + optional comment -> POST /api/csat.
  function addCsat() {
    if (!chatBody || chatBody.querySelector('.yc-csat')) return;
    var card = el('<div class="yc-csat" role="group" aria-label="' + esc(t.csatTitle) + '"><b>' + esc(t.csatTitle) + '</b><div class="yc-stars"></div>' +
      '<textarea maxlength="500" rows="2" aria-label="' + esc(t.csatComment) + '" placeholder="' + esc(t.csatComment) + '"></textarea>' +
      '<button class="yc-submit" disabled>' + esc(t.csatSend) + '</button></div>');
    var stars = card.querySelector('.yc-stars'), send = card.querySelector('.yc-submit'), box = card.querySelector('textarea');
    var score = 0, btns = [];
    function paint() { btns.forEach(function (b, k) { b.classList.toggle('yc-on', k < score); b.setAttribute('aria-pressed', k === score - 1 ? 'true' : 'false'); }); send.disabled = !score; }
    for (var i = 1; i <= 5; i++) (function (n) {
      var b = el('<button type="button" class="yc-star" aria-pressed="false" aria-label="' + esc(t.starLabel.replace('{n}', n)) + '">' + IC.star + '</button>');
      b.addEventListener('click', function () { score = n; paint(); });
      btns.push(b); stars.appendChild(b);
    })(i);
    send.addEventListener('click', async function () {
      if (!score) return;
      send.disabled = true;
      var old = card.querySelector('.yc-note'); if (old) old.remove();
      try {
        var res = await fetch(BASE + '/api/csat', { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId: sessionId(), score: score, comment: box.value.trim().slice(0, 500) }) });
        if (res.ok || res.status === 409) { csatPending = false; card.innerHTML = '<span class="yc-note">' + esc(t.csatThanks) + '</span>'; }
        else { send.disabled = false; card.appendChild(el('<span class="yc-note yc-bad">' + esc(t.csatErr) + '</span>')); }
      } catch (_) { send.disabled = false; card.appendChild(el('<span class="yc-note yc-bad">' + esc(t.csatErr) + '</span>')); }
    });
    chatBody.appendChild(card); chatBody.scrollTop = chatBody.scrollHeight;
  }
  function showTyping() { var x = el('<div class="yc-typing"><span></span><span></span><span></span></div>'); chatBody.appendChild(x); chatBody.scrollTop = chatBody.scrollHeight; return x; }

  async function doSend(input, preset) {
    if (busy) return;
    var text = (preset || input.value).trim().slice(0, 2000); if (!text) return;
    busy = true;
    input.value = ''; input.style.height = 'auto';
    if (!chatLog.length) chatBody.innerHTML = '';
    addMsg('user', text, true);
    if (newChatBtn) newChatBtn.hidden = false;
    var typing = showTyping();
    var msgEl = null, buf = '';
    try {
      var res = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: sessionId(), lang: lang, page: pageInfo(), messages: apiMessages(12), text: text }) });
      if (!res.ok || !res.body) { var et = await res.text(); typing.remove(); addNote(friendlyErr(et), true); busy = false; return; }
      // The team is in charge: the server kept the message and did not call the model.
      if (res.headers.get('x-chat-mode') === 'human') {
        typing.remove();
        if (liveMode === 'bot') setMode('human');
        poll();
        return;
      }
      var reader = res.body.getReader(), dec = new TextDecoder(), sse = '';
      while (true) {
        var ch = await reader.read(); if (ch.done) break;
        sse += dec.decode(ch.value, { stream: true });
        var parts = sse.split('\\n\\n'); sse = parts.pop() || '';
        for (var i = 0; i < parts.length; i++) {
          var line = parts[i].trim(); if (!line.startsWith('data: ')) continue;
          var data = line.slice(6); if (data === '[DONE]') continue;
          try { var j = JSON.parse(data); var dl = j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content;
            if (dl) { if (!msgEl) { typing.remove(); msgEl = addMsg('asst', '', false); } buf += dl; msgEl.innerHTML = md(stripHandoff(buf)); chatBody.scrollTop = chatBody.scrollHeight; } } catch (_) {}
        }
      }
      var hadHandoff = /\\[\\[HANDOFF\\]\\]/.test(buf);
      var clean = stripHandoff(buf);
      if (msgEl) msgEl.innerHTML = md(clean);
      var msgId = res.headers.get('x-chat-msg-id');
      var entry = null;
      if (clean) { entry = { role: 'assistant', content: clean }; if (msgId) entry.id = msgId; chatLog.push(entry); saveHistory(chatLog); }
      if (!msgEl) { typing.remove(); addNote(t.errNoReply, true); }
      if (entry && entry.id) addThumbs(entry);
      if (hadHandoff) addHandoffButton();
    } catch (e) { typing.remove(); addNote(t.errNetwork, true); }
    finally { busy = false; input.focus(); }
  }
  function stripHandoff(s) { return s.replace(/\\[\\[HANDOFF\\]\\]/g, '').trim(); }
  // History for the model: team messages count as assistant turns (the API only takes
  // user/assistant), system lines are dropped, and neighbours with the same role are
  // merged so the model never sees two assistant turns in a row.
  function apiMessages(n) {
    var out = [];
    chatLog.filter(function (m) { return m.role !== 'system'; }).slice(-n).forEach(function (m) {
      var role = m.role === 'user' ? 'user' : 'assistant';
      var c = String(m.content || '').slice(0, 2000), last = out[out.length - 1];
      if (last && last.role === role) last.content = (last.content + '\\n\\n' + c).slice(-2000); // keep the newest end
      else out.push({ role: role, content: c });
    });
    return out;
  }

  // Lead form ------------------------------------------------------------
  function renderForm() {
    panel.appendChild(header(t.formTitle, { back: true }));
    var wrap = el('<div class="yc-view"></div>');
    var f = el('<div class="yc-form"></div>');
    f.appendChild(el('<div class="yc-fh"><b>' + esc(t.formTitle) + '</b><p>' + esc(t.formSub) + '</p></div>'));
    var fName = field('text', t.fName, 'name');
    var fEmail = field('email', t.fEmail, 'email');
    var fPhone = field('tel', t.fPhone, 'phone');
    var fChan = el('<div class="yc-field"><label>' + esc(t.fChannel) + '</label><select><option value="WhatsApp">' + esc(t.chWhatsApp) + '</option><option value="Email">' + esc(t.chEmail) + '</option><option value="Llamada">' + esc(t.chCall) + '</option></select></div>');
    var fMsg = el('<div class="yc-field"><label>' + esc(t.fMessage) + '</label><textarea></textarea></div>');
    var submit = el('<button class="yc-submit">' + t.fSubmit + '</button>');
    // Honeypot: off-screen, not focusable, ignored by assistive tech. Bots fill it.
    var hp = el('<div class="yc-hp" aria-hidden="true"><input type="text" name="website" tabindex="-1" autocomplete="off"></div>');
    [fName, fEmail, fPhone, fChan, fMsg, hp].forEach(function (x) { f.appendChild(x); });
    f.appendChild(submit);
    f.appendChild(contactRow());
    wrap.appendChild(f); panel.appendChild(wrap); panel.appendChild(bottomNav('chat'));

    submit.addEventListener('click', async function () {
      var name = fName.querySelector('input').value.trim();
      var email = fEmail.querySelector('input').value.trim();
      fName.classList.toggle('yc-err', !name);
      var emailOk = /^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(email);
      fEmail.classList.toggle('yc-err', !emailOk);
      if (!name) { return; }
      if (!emailOk) { return; }
      submit.disabled = true; submit.textContent = t.fSending;
      try {
        var res = await fetch(BASE + '/api/lead', { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: name, email: email, phone: fPhone.querySelector('input').value.trim(),
            channel: fChan.querySelector('select').value, message: fMsg.querySelector('textarea').value.trim(),
            transcript: apiMessages(8), lang: lang,
            sessionId: sessionId(), page: pageInfo(), website: hp.querySelector('input').value }) });
        var j = await res.json().catch(function () { return {}; });
        clear(); panel.appendChild(header(t.formTitle, { back: true }));
        var w2 = el('<div class="yc-view"><div class="yc-result">' + (res.ok && j.ok ? '<span class="yc-note">' + esc(t.fOk) + '</span>' : '<span class="yc-note yc-bad">' + esc(res.status === 429 && j.error ? j.error : t.fErr) + '</span>') + '</div></div>');
        panel.appendChild(w2); panel.appendChild(bottomNav('chat'));
      } catch (e) {
        submit.disabled = false; submit.textContent = t.fSubmit;
        f.appendChild(el('<div class="yc-note yc-bad">' + esc(t.fErr) + '</div>'));
      }
    });
    setTimeout(function () { fName.querySelector('input').focus(); }, 50);
  }
  function field(type, label, key) {
    return el('<div class="yc-field" data-k="' + key + '"><label>' + esc(label) + '</label><input type="' + type + '"></div>');
  }

  // Open/close -----------------------------------------------------------
  function open() {
    if (isOpen()) return;
    panel.classList.remove('yc-hidden');
    stack = [{ v: 'home' }];
    window.history.pushState({ yc: 1 }, ''); // sentinel: widget open at home
    render('home');
  }
  function close() {
    if (!isOpen()) return;
    var depth = stack.length; // number of history entries we pushed
    panel.classList.add('yc-hidden');
    stack = [{ v: 'home' }];
    schedulePoll();
    // Unwind the entries we added so the site's own history stays intact.
    if (depth > 0) window.history.go(-depth);
  }
  // Device / browser Back button: unwind the widget view-by-view, then close.
  window.addEventListener('popstate', function () {
    if (!isOpen()) return; // not ours — let the browser navigate the site
    if (stack.length > 1) {
      stack.pop();
      renderTop();
    } else {
      // At home: the browser already consumed our sentinel; just hide.
      panel.classList.add('yc-hidden');
      stack = [{ v: 'home' }];
      schedulePoll();
    }
  });
  bubble.addEventListener('click', function () { isOpen() ? close() : open(); });

  // Live conversation ------------------------------------------------------
  // The server is asked for the team's messages only when it can matter:
  //   team in charge (waiting/human): every 4 s with the chat visible, 25 s otherwise
  //     (a dot on the bubble flags unread team messages);
  //   assistant in charge: one check when the chat is opened, then every 60 s while it
  //     stays open (to notice that the team took the conversation over);
  //   never while the tab is hidden, and never without a conversation.
  // Errors and 429s stretch the interval (x2 per failure, up to x8).
  var pollTimer = null, pollBusy = false, pollFails = 0, lastPollAt = 0;
  function hasConv() { return chatLog.length > 0 && canLive(); }
  function chatActive() { return isOpen() && topView().v === 'chat' && !!chatBody; }
  function pollDelay() {
    if (!hasConv()) return 0;
    var base = liveMode === 'bot' ? (chatActive() ? 60000 : 0) : (chatActive() ? 4000 : 25000);
    return base ? base * Math.min(8, Math.pow(2, pollFails)) : 0;
  }
  function schedulePoll() {
    clearTimeout(pollTimer); pollTimer = null;
    if (document.hidden) return;
    var d = pollDelay();
    if (d) pollTimer = setTimeout(poll, d);
  }
  async function poll() {
    clearTimeout(pollTimer); pollTimer = null;
    if (pollBusy || document.hidden || !hasConv()) return;
    pollBusy = true; lastPollAt = Date.now();
    var sid = sessionId();
    try {
      // 1.5 s of overlap; messages are de-duplicated by id.
      var res = await fetch(BASE + '/api/messages?sessionId=' + encodeURIComponent(sid) + '&after=' + Math.max(0, lastAt - 1500));
      if (sid !== sessionId()) return; // a new conversation started meanwhile
      if (res.status === 404) { pollFails = 0; setMode('bot'); }
      else if (!res.ok) pollFails++;
      else { pollFails = 0; applyPoll(await res.json()); }
    } catch (_) { pollFails++; }
    finally { pollBusy = false; schedulePoll(); }
  }
  function applyPoll(j) {
    var added = [];
    (j.messages || []).forEach(function (m) {
      if (!m || typeof m.id !== 'string' || (m.role !== 'agent' && m.role !== 'system') || typeof m.content !== 'string') return;
      if (typeof m.created_at === 'number' && m.created_at > lastAt) lastAt = m.created_at;
      if (chatLog.some(function (x) { return x.id === m.id; })) return;
      var e = { role: m.role, content: m.content.slice(0, 2000), id: m.id, at: m.created_at };
      chatLog.push(e); added.push(e);
    });
    try { localStorage.setItem(AFTER_KEY, String(lastAt)); } catch (_) {}
    if (added.length) saveHistory(chatLog);
    var newCsat = !!j.csat && !csatPending;
    csatPending = !!j.csat;
    setMode(j.mode === 'waiting' || j.mode === 'human' ? j.mode : 'bot');
    if (chatActive()) {
      added.forEach(function (e) { if (e.role === 'agent') addAgent(e.content); else addSys(e.content); });
      if (csatPending) addCsat();
    } else if (newCsat || added.some(function (e) { return e.role === 'agent'; })) {
      setDot(true);
    }
  }
  function setMode(m) {
    if (m !== liveMode) {
      liveMode = m;
      try { if (m === 'bot') localStorage.removeItem(MODE_KEY); else localStorage.setItem(MODE_KEY, m); } catch (_) {}
    }
    paintLive();
    schedulePoll();
  }
  // Status strip above the input + header subtitle, per mode.
  function paintLive() {
    if (chatSubEl) chatSubEl.textContent = liveMode === 'waiting' ? t.subWaiting : liveMode === 'human' ? t.subHuman : t.secChatSub;
    if (!liveBar) return;
    liveBar.innerHTML = '';
    liveBar.hidden = liveMode === 'bot';
    if (liveMode === 'waiting') {
      liveBar.appendChild(el('<span>' + esc(t.waitingMsg) + ' ' + esc(t.waitingEmail) + '</span>'));
      var leave = el('<button class="yc-ghost">' + esc(t.leaveData) + '</button>');
      leave.addEventListener('click', function () { go('form'); });
      liveBar.appendChild(leave);
    } else if (liveMode === 'human') {
      liveBar.appendChild(el('<span>' + esc(t.humanOn) + '</span>'));
    }
  }
  function setDot(on) {
    dotEl.hidden = !on;
    bubble.setAttribute('aria-label', on ? t.open + ' · ' + t.newMsg : t.open);
  }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { clearTimeout(pollTimer); pollTimer = null; return; }
    if (pollDelay()) poll();
  });
  // Returning visitor whose conversation is with the team: look for news soon after load.
  if (hasConv() && liveMode !== 'bot') setTimeout(poll, 1500);

  // Page visit, reported once per page load and ONLY when this visitor already
  // used the chat (stored history). Nobody else is tracked. The server ignores
  // it unless the conversation exists, and keeps just the URL without query.
  if (chatLog.length) {
    try {
      var pg = pageInfo();
      fetch(BASE + '/api/visit', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: sessionId(), url: pg.url, title: pg.title }) }).catch(function () {});
    } catch (_) {}
  }
})();`;
