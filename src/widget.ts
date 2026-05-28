// widget.ts
// Self-contained vanilla JS widget served by the Worker at GET /widget.js.
//   <script src="https://chat.yammbo.com/widget.js" defer></script>
//
// Multi-view: Home (search + sections) · Help (search results) · Article
// (inline doc) · Blog (recent posts) · Chat (streaming) · Lead form (handoff).
// No dependencies. All class names prefixed `yc-`.

export const WIDGET_JS = `(function () {
  if (window.__yammboChatLoaded) return;
  window.__yammboChatLoaded = true;

  var BASE = 'https://chat.yammbo.com';
  var API = BASE + '/api/chat';
  var STORAGE_KEY = 'yammbo-chat-history-v1';
  var SESSION_KEY = 'yammbo-chat-session-id';
  var LANG_KEY = 'yammbo-chat-lang';
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
      homeHi: 'Hola 👋', homeSub: '¿En qué te ayudamos hoy?',
      search: 'Buscar en la ayuda...',
      navHome: 'Inicio', navChat: 'Chat',
      secHelp: 'Centro de ayuda', secHelpSub: 'Guías y respuestas',
      secBlog: 'Blog', secBlogSub: 'Lo más reciente',
      secChat: 'Chatear con nosotros', secChatSub: 'Respuesta al instante',
      chatPlaceholder: 'Escribí tu pregunta...',
      chatEmpty: 'Preguntame sobre productos, planes o cómo empezar.',
      talkHuman: 'Hablar con una persona',
      noResults: 'Sin resultados. Probá otra búsqueda o chateá con nosotros.',
      readMore: 'Leer en el blog →',
      brand: 'Yammbo · powered by AI',
      formTitle: 'Dejá tus datos', formSub: 'El equipo te contacta a la brevedad.',
      fName: 'Nombre', fEmail: 'Email', fPhone: 'Teléfono / WhatsApp (opcional)',
      fChannel: 'Canal preferido', fMessage: 'Mensaje (opcional)',
      chWhatsApp: 'WhatsApp', chEmail: 'Email', chCall: 'Llamada',
      fSubmit: 'Enviar', fSending: 'Enviando...',
      fOk: '¡Listo! El equipo te contactará pronto.', fErr: 'No se pudo enviar. Intentá de nuevo.',
      fReqName: 'Poné tu nombre', fReqEmail: 'Poné un email válido',
      errGeneric: 'No pude conectarme. Intentá de nuevo.', errNetwork: 'Error de red.', errNoReply: 'No recibí respuesta.'
    },
    en: {
      title: 'Yammbo', open: 'Open chat', close: 'Close', back: 'Back', send: 'Send',
      homeHi: 'Hi 👋', homeSub: 'How can we help today?',
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
      brand: 'Yammbo · powered by AI',
      formTitle: 'Leave your details', formSub: 'The team will reach out shortly.',
      fName: 'Name', fEmail: 'Email', fPhone: 'Phone / WhatsApp (optional)',
      fChannel: 'Preferred channel', fMessage: 'Message (optional)',
      chWhatsApp: 'WhatsApp', chEmail: 'Email', chCall: 'Call',
      fSubmit: 'Send', fSending: 'Sending...',
      fOk: 'Done! The team will contact you soon.', fErr: 'Could not send. Try again.',
      fReqName: 'Enter your name', fReqEmail: 'Enter a valid email',
      errGeneric: 'I could not connect. Try again.', errNetwork: 'Network error.', errNoReply: 'No response received.'
    }
  };
  var lang = detectLang();
  var t = STR[lang];

  // Helpers --------------------------------------------------------------
  function el(html) { var tpl = document.createElement('template'); tpl.innerHTML = html.trim(); return tpl.content.firstElementChild; }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function md(s) {
    var x = esc(s);
    x = x.replace(/\\[([^\\]]+)\\]\\((https?:\\/\\/[^\\s)]+)\\)/g, function (_, txt, u) { return '<a href="' + u + '" target="_blank" rel="noopener">' + txt + '</a>'; });
    x = x.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');
    x = x.replace(/\\n/g, '<br>');
    return x;
  }
  function uuid() { return (crypto && crypto.randomUUID) ? crypto.randomUUID() : 'xxxxxxxxxxxx'.replace(/x/g, function () { return ((Math.random()*16)|0).toString(16); }); }
  function sessionId() { try { var v = localStorage.getItem(SESSION_KEY); if (!v) { v = uuid(); localStorage.setItem(SESSION_KEY, v); } return v; } catch (_) { return uuid(); } }
  function loadHistory() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch (_) { return []; } }
  function saveHistory(h) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(h.slice(-MAX_HISTORY))); } catch (_) {} }
  function friendlyErr(raw) { if (!raw) return t.errGeneric; try { var j = JSON.parse(raw); if (j && j.error) return j.error; } catch (_) {} return raw.length > 200 ? t.errGeneric : raw; }
  async function getJSON(path) { var r = await fetch(BASE + path, { headers: { 'accept': 'application/json' } }); if (!r.ok) throw new Error('http ' + r.status); return r.json(); }

  // Styles ---------------------------------------------------------------
  var css = [
    '#yammbo-chat-root *{box-sizing:border-box}',
    '.yc-bubble{position:fixed;right:20px;bottom:20px;width:56px;height:56px;border-radius:50%;background:#000;color:#fff;border:none;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center;z-index:2147483646;transition:transform .15s}',
    '.yc-bubble:hover{transform:scale(1.06)}.yc-bubble svg{width:26px;height:26px}',
    '.yc-panel{position:fixed;right:20px;bottom:90px;width:384px;max-width:calc(100vw - 24px);height:600px;max-height:calc(100vh - 110px);background:#fff;border:1px solid #e5e5e5;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.18);display:flex;flex-direction:column;overflow:hidden;z-index:2147483646;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#111;animation:yc-in .18s ease-out}',
    '@keyframes yc-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}',
    '.yc-panel.yc-hidden{display:none}',
    '.yc-head{padding:14px 16px;border-bottom:1px solid #eee;display:flex;align-items:center;gap:10px;flex-shrink:0;background:#fff;min-height:54px}',
    '.yc-head h3{margin:0;font-size:15px;font-weight:600;line-height:1.2;color:#111;flex:1}',
    '.yc-head p{margin:2px 0 0;font-size:12px;color:#777}',
    '.yc-iconbtn{background:transparent;border:none;cursor:pointer;color:#777;padding:5px;border-radius:6px;display:flex;align-items:center}.yc-iconbtn:hover{background:#f3f3f3;color:#111}',
    '.yc-view{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;background:#fafafa}',
    '.yc-view.yc-chatview{display:flex;flex-direction:column;padding:0}',
    // home
    '.yc-hero{padding:22px 18px 10px;background:#000;color:#fff}',
    '.yc-hero h2{margin:0;font-size:22px;font-weight:700;letter-spacing:-.01em}',
    '.yc-hero p{margin:4px 0 0;font-size:14px;color:#cfcfcf}',
    '.yc-searchwrap{padding:14px 16px;background:#000}',
    '.yc-search{width:100%;border:none;border-radius:10px;padding:11px 13px;font-size:14px;font-family:inherit;outline:none;color:#111}',
    '.yc-cards{padding:14px 16px;display:flex;flex-direction:column;gap:10px}',
    '.yc-card{display:flex;align-items:center;gap:12px;background:#fff;border:1px solid #ececec;border-radius:12px;padding:14px;cursor:pointer;text-align:left;width:100%;font-family:inherit;transition:border-color .12s,transform .12s}',
    '.yc-card:hover{border-color:#111;transform:translateY(-1px)}',
    '.yc-card .yc-ci{width:36px;height:36px;border-radius:9px;background:#f1f1f1;display:flex;align-items:center;justify-content:center;flex-shrink:0}',
    '.yc-card .yc-ct{flex:1}.yc-card .yc-ct b{display:block;font-size:14px;color:#111}.yc-card .yc-ct span{font-size:12px;color:#888}',
    '.yc-card .yc-chev{color:#bbb}',
    // list (docs/blog)
    '.yc-list{padding:10px 12px;display:flex;flex-direction:column;gap:6px}',
    '.yc-li{display:flex;gap:10px;align-items:center;background:#fff;border:1px solid #ececec;border-radius:10px;padding:11px 13px;cursor:pointer;text-align:left;width:100%;font-family:inherit}',
    '.yc-li:hover{border-color:#111}',
    '.yc-li img{width:46px;height:46px;border-radius:8px;object-fit:cover;flex-shrink:0;background:#eee}',
    '.yc-li .yc-lt{flex:1;min-width:0}.yc-li .yc-lt b{display:block;font-size:13px;color:#111;line-height:1.3}.yc-li .yc-lt span{display:block;font-size:11px;color:#999;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.yc-muted{padding:24px 18px;color:#888;font-size:13px;text-align:center;line-height:1.5}',
    // article
    '.yc-article{padding:18px;color:#222;font-size:14px;line-height:1.6}',
    '.yc-article h1{font-size:19px;margin:0 0 12px;color:#111}',
    '.yc-article p{margin:0 0 12px}.yc-article a{color:#111}.yc-article ul,.yc-article ol{padding-left:20px;margin:0 0 12px}.yc-article code{background:#f1f1f1;padding:1px 5px;border-radius:4px;font-size:12px}',
    '.yc-article .yc-readmore{display:inline-block;margin-top:8px;font-size:13px;color:#111;font-weight:600}',
    // chat
    '.yc-body{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px;background:#fafafa;-webkit-overflow-scrolling:touch}',
    '.yc-msg{max-width:85%;padding:9px 12px;border-radius:12px;font-size:14px;line-height:1.45;white-space:pre-wrap;word-wrap:break-word}',
    '.yc-msg.yc-user{align-self:flex-end;background:#111;color:#fff;border-bottom-right-radius:4px}',
    '.yc-msg.yc-asst{align-self:flex-start;background:#fff;border:1px solid #ececec;color:#111;border-bottom-left-radius:4px}',
    '.yc-msg a{color:inherit;text-decoration:underline}',
    '.yc-typing{align-self:flex-start;background:#fff;border:1px solid #ececec;border-radius:12px;border-bottom-left-radius:4px;padding:10px 14px;display:inline-flex;gap:4px}',
    '.yc-typing span{width:6px;height:6px;border-radius:50%;background:#bbb;animation:yc-blink 1.2s infinite ease-in-out}',
    '.yc-typing span:nth-child(2){animation-delay:.15s}.yc-typing span:nth-child(3){animation-delay:.3s}',
    '@keyframes yc-blink{0%,80%,100%{opacity:.3}40%{opacity:1}}',
    '.yc-handoff{align-self:flex-start;margin-top:2px}',
    '.yc-handoff button{background:#111;color:#fff;border:none;border-radius:10px;padding:9px 14px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit}',
    '.yc-foot{padding:10px;border-top:1px solid #eee;display:flex;gap:8px;align-items:flex-end;background:#fff;flex-shrink:0}',
    '.yc-input{flex:1;resize:none;border:1px solid #ddd;border-radius:10px;padding:9px 11px;font-size:14px;line-height:1.4;font-family:inherit;max-height:120px;outline:none;color:#111;background:#fff}',
    '.yc-input:focus{border-color:#111}',
    '.yc-send{background:#111;color:#fff;border:none;border-radius:10px;width:38px;height:38px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0}.yc-send:disabled{background:#bbb;cursor:not-allowed}',
    // form
    '.yc-form{padding:16px;display:flex;flex-direction:column;gap:12px}',
    '.yc-form .yc-fh{margin-bottom:2px}.yc-form .yc-fh b{font-size:16px;color:#111}.yc-form .yc-fh p{margin:3px 0 0;font-size:13px;color:#888}',
    '.yc-field label{display:block;font-size:12px;color:#666;margin-bottom:4px}',
    '.yc-field input,.yc-field select,.yc-field textarea{width:100%;border:1px solid #ddd;border-radius:9px;padding:10px 11px;font-size:14px;font-family:inherit;outline:none;color:#111;background:#fff}',
    '.yc-field input:focus,.yc-field select:focus,.yc-field textarea:focus{border-color:#111}',
    '.yc-field textarea{resize:vertical;min-height:64px}',
    '.yc-field.yc-err input{border-color:#d33}',
    '.yc-submit{background:#111;color:#fff;border:none;border-radius:10px;padding:12px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit}.yc-submit:disabled{background:#999;cursor:not-allowed}',
    '.yc-result{padding:24px 18px;text-align:center;font-size:14px;line-height:1.5}',
    // bottom nav
    '.yc-nav{display:flex;border-top:1px solid #eee;background:#fff;flex-shrink:0}',
    '.yc-nav button{flex:1;background:transparent;border:none;cursor:pointer;padding:9px 0 7px;display:flex;flex-direction:column;align-items:center;gap:3px;color:#999;font-size:11px;font-family:inherit}',
    '.yc-nav button.yc-active{color:#111}.yc-nav button svg{width:20px;height:20px}',
    '.yc-brand{font-size:11px;color:#999;text-align:center;padding:6px 0;background:#fff;border-top:1px solid #f0f0f0;flex-shrink:0}',
    '@media (max-width:480px){',
      '.yc-panel{right:0;bottom:0;top:0;left:0;width:100vw;max-width:100vw;height:100vh;height:100dvh;max-height:100dvh;border-radius:0;border:none}',
      '.yc-bubble{right:14px;bottom:14px}',
      '.yc-head{padding-top:max(14px,env(safe-area-inset-top))}',
      '.yc-nav{padding-bottom:max(0px,env(safe-area-inset-bottom))}',
    '}'
  ].join('');

  var style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
  var root = document.createElement('div'); root.id = 'yammbo-chat-root'; document.body.appendChild(root);

  // SVG icons
  var IC = {
    chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>',
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/></svg>',
    help: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
    close: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',
    back: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
    sendIcon: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>',
    chev: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>'
  };

  var bubble = el('<button class="yc-bubble" aria-label="' + t.open + '">' + IC.chat + '</button>');
  root.appendChild(bubble);

  var panel = el('<div class="yc-panel yc-hidden" role="dialog" aria-label="Yammbo"></div>');
  root.appendChild(panel);

  // State ----------------------------------------------------------------
  var chatLog = loadHistory();
  var busy = false;
  var docsCache = null;
  // Navigation stack — drives both rendering and the device back button.
  // Bottom of the stack is always 'home'. Each forward navigation pushes a
  // browser history entry so the hardware/browser Back button unwinds the
  // widget view-by-view, and only closes the site once the widget is closed.
  var stack = [{ v: 'home' }];

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
    h.appendChild(titleEl);
    var c = el('<button class="yc-iconbtn" aria-label="' + t.close + '">' + IC.close + '</button>');
    c.addEventListener('click', close); h.appendChild(c);
    return h;
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

  function render(v, param) {
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

  async function renderHelp(query) {
    panel.appendChild(header(t.secHelp, { back: true }));
    var wrap = el('<div class="yc-view"></div>');
    var sw = el('<div style="padding:12px 12px 4px"></div>');
    var si = el('<input class="yc-search" style="color:#111;border:1px solid #ddd" type="text" placeholder="' + t.search + '" value="' + esc(query) + '">');
    sw.appendChild(si); wrap.appendChild(sw);
    var list = el('<div class="yc-list"></div>'); wrap.appendChild(list);
    panel.appendChild(wrap);
    panel.appendChild(bottomNav('home'));

    if (!docsCache) { try { var r = await getJSON('/api/docs?lang=' + lang); docsCache = r.docs || []; } catch (_) { docsCache = []; } }
    function paint(q) {
      list.innerHTML = '';
      var ql = q.toLowerCase();
      var items = docsCache.filter(function (d) { return !ql || (d.title + ' ' + d.description + ' ' + d.product).toLowerCase().indexOf(ql) >= 0; });
      if (!items.length) { list.appendChild(el('<div class="yc-muted">' + t.noResults + '</div>')); return; }
      items.slice(0, 30).forEach(function (d) {
        var li = el('<button class="yc-li"><span class="yc-lt"><b>' + esc(d.title) + '</b><span>' + esc(d.description || d.product) + '</span></span></button>');
        li.addEventListener('click', function () { go('article', d.slug); });
        list.appendChild(li);
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
      art.innerHTML = '<h1>' + esc(d.title) + '</h1>' + md(d.body) +
        '<a class="yc-readmore" href="https://help.yammbo.com/' + esc(d.slug) + '" target="_blank" rel="noopener">help.yammbo.com →</a>';
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
      var all = el('<button class="yc-li" style="justify-content:center;color:#111;font-weight:600;font-size:13px">' + esc(t.readMore) + '</button>');
      all.addEventListener('click', function () { window.open('https://blog.yammbo.com/', '_blank', 'noopener'); });
      list.appendChild(all);
    } catch (_) { list.innerHTML = '<div class="yc-muted">' + t.errGeneric + '</div>'; }
  }

  // Chat -----------------------------------------------------------------
  var chatBody = null;
  function renderChat() {
    panel.appendChild(header(t.secChat, { back: true, sub: t.secChatSub }));
    var wrap = el('<div class="yc-view yc-chatview"></div>');
    chatBody = el('<div class="yc-body" aria-live="polite"></div>');
    wrap.appendChild(chatBody);
    var foot = el('<div class="yc-foot"></div>');
    var input = el('<textarea class="yc-input" rows="1" placeholder="' + t.chatPlaceholder + '"></textarea>');
    var sendB = el('<button class="yc-send" aria-label="' + t.send + '">' + IC.sendIcon + '</button>');
    foot.appendChild(input); foot.appendChild(sendB);
    wrap.appendChild(foot);
    var brand = el('<div class="yc-brand">' + t.brand + '</div>');
    panel.appendChild(wrap); panel.appendChild(brand); panel.appendChild(bottomNav('chat'));

    input.addEventListener('input', function () { input.style.height = 'auto'; input.style.height = Math.min(120, input.scrollHeight) + 'px'; });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(input); } });
    sendB.addEventListener('click', function () { doSend(input); });

    paintChat();
    setTimeout(function () { input.focus(); }, 50);
  }
  function paintChat() {
    chatBody.innerHTML = '';
    if (!chatLog.length) { chatBody.appendChild(el('<div class="yc-muted">' + t.chatEmpty + '</div>')); return; }
    chatLog.forEach(function (m) { addMsg(m.role, m.content, false); });
    chatBody.scrollTop = chatBody.scrollHeight;
  }
  function addMsg(role, content, persist) {
    var e = document.createElement('div');
    e.className = 'yc-msg ' + (role === 'user' ? 'yc-user' : 'yc-asst');
    e.innerHTML = role === 'user' ? esc(content) : md(content);
    chatBody.appendChild(e); chatBody.scrollTop = chatBody.scrollHeight;
    if (persist) { chatLog.push({ role: role, content: content }); saveHistory(chatLog); }
    return e;
  }
  function addHandoffButton() {
    var w = el('<div class="yc-handoff"><button>' + t.talkHuman + '</button></div>');
    w.querySelector('button').addEventListener('click', function () { go('form'); });
    chatBody.appendChild(w); chatBody.scrollTop = chatBody.scrollHeight;
  }
  function showTyping() { var x = el('<div class="yc-typing"><span></span><span></span><span></span></div>'); chatBody.appendChild(x); chatBody.scrollTop = chatBody.scrollHeight; return x; }

  async function doSend(input) {
    if (busy) return;
    var text = input.value.trim(); if (!text) return;
    busy = true;
    input.value = ''; input.style.height = 'auto';
    if (!chatLog.length) chatBody.innerHTML = '';
    addMsg('user', text, true);
    var typing = showTyping();
    var msgEl = null, buf = '';
    try {
      var res = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: sessionId(), messages: chatLog.map(function (m) { return { role: m.role, content: m.content }; }) }) });
      if (!res.ok || !res.body) { var et = await res.text(); typing.remove(); addMsg('asst', '⚠️ ' + friendlyErr(et), false); busy = false; return; }
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
      if (clean) { chatLog.push({ role: 'assistant', content: clean }); saveHistory(chatLog); }
      if (!msgEl) { typing.remove(); addMsg('asst', '⚠️ ' + t.errNoReply, false); }
      if (hadHandoff) addHandoffButton();
    } catch (e) { typing.remove(); addMsg('asst', '⚠️ ' + t.errNetwork, false); }
    finally { busy = false; input.focus(); }
  }
  function stripHandoff(s) { return s.replace(/\\[\\[HANDOFF\\]\\]/g, '').trim(); }

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
    [fName, fEmail, fPhone, fChan, fMsg].forEach(function (x) { f.appendChild(x); });
    f.appendChild(submit);
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
            transcript: chatLog.slice(-8), lang: lang }) });
        var j = await res.json().catch(function () { return {}; });
        clear(); panel.appendChild(header(t.formTitle, { back: true }));
        var w2 = el('<div class="yc-view"><div class="yc-result">' + (res.ok && j.ok ? '✅ ' + esc(t.fOk) : '⚠️ ' + esc(t.fErr)) + '</div></div>');
        panel.appendChild(w2); panel.appendChild(bottomNav('chat'));
      } catch (e) {
        submit.disabled = false; submit.textContent = t.fSubmit;
        f.appendChild(el('<div class="yc-muted">⚠️ ' + esc(t.fErr) + '</div>'));
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
    }
  });
  bubble.addEventListener('click', function () { isOpen() ? close() : open(); });
})();`;
