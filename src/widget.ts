// widget.ts
// Self-contained vanilla JS widget served by the Worker at GET /widget.js.
// Drop into any allow-listed Yammbo site:
//   <script src="https://chat.yammbo.com/widget.js" defer></script>
//
// All HTML/CSS/JS lives in this single string. No dependencies. Class names
// are prefixed `yc-` to avoid colliding with the host page.

export const WIDGET_JS = `(function () {
  if (window.__yammboChatLoaded) return;
  window.__yammboChatLoaded = true;

  var API = 'https://chat.yammbo.com/api/chat';
  var STORAGE_KEY = 'yammbo-chat-history-v1';
  var SESSION_KEY = 'yammbo-chat-session-id';
  var LANG_KEY = 'yammbo-chat-lang';
  var MAX_HISTORY = 20;

  // i18n -----------------------------------------------------------------
  function detectLang() {
    try {
      var override = localStorage.getItem(LANG_KEY);
      if (override === 'es' || override === 'en') return override;
    } catch (_) {}
    var docLang = (document.documentElement.getAttribute('lang') || '').toLowerCase();
    if (docLang.indexOf('es') === 0) return 'es';
    if (docLang.indexOf('en') === 0) return 'en';
    var nav = (navigator.language || 'en').toLowerCase();
    return nav.indexOf('es') === 0 ? 'es' : 'en';
  }
  var STR = {
    es: {
      title: 'Yammbo',
      subtitle: 'Pregunta lo que necesites',
      placeholder: 'Escribí tu pregunta...',
      empty: 'Hola 👋<br>Soy el asistente de Yammbo. Preguntame sobre nuestros productos, planes o cómo empezar.',
      brand: 'Yammbo · powered by AI',
      open: 'Abrir chat',
      close: 'Cerrar chat',
      send: 'Enviar',
      errGeneric: 'No pude conectarme. Intentá de nuevo en un momento.',
      errNetwork: 'Error de red. Revisá tu conexión.',
      errNoReply: 'No recibí respuesta. Probá de nuevo.'
    },
    en: {
      title: 'Yammbo',
      subtitle: 'Ask anything',
      placeholder: 'Type your question...',
      empty: 'Hi 👋<br>I\\'m the Yammbo assistant. Ask me about our products, plans, or how to get started.',
      brand: 'Yammbo · powered by AI',
      open: 'Open chat',
      close: 'Close chat',
      send: 'Send',
      errGeneric: 'I could not connect. Please try again in a moment.',
      errNetwork: 'Network error. Check your connection.',
      errNoReply: 'No response received. Please try again.'
    }
  };
  var lang = detectLang();
  var t = STR[lang];

  // Helpers --------------------------------------------------------------
  function $(html) { var tpl = document.createElement('template'); tpl.innerHTML = html.trim(); return tpl.content.firstElementChild; }
  function escape(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function mdInline(s) {
    var safe = escape(s);
    safe = safe.replace(/\\[([^\\]]+)\\]\\((https?:\\/\\/[^\\s)]+)\\)/g, function (_, txt, u) {
      return '<a href="' + u + '" target="_blank" rel="noopener">' + txt + '</a>';
    });
    safe = safe.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');
    safe = safe.replace(/\\n/g, '<br>');
    return safe;
  }
  function uuid() {
    if (crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxxxxxxxxxx'.replace(/x/g, function () { return ((Math.random() * 16) | 0).toString(16); });
  }
  function sessionId() {
    try {
      var v = localStorage.getItem(SESSION_KEY);
      if (!v) { v = uuid(); localStorage.setItem(SESSION_KEY, v); }
      return v;
    } catch (_) { return uuid(); }
  }
  function loadHistory() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch (_) { return []; }
  }
  function saveHistory(h) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(h.slice(-MAX_HISTORY))); } catch (_) {}
  }
  function friendlyError(raw) {
    // Server replies with JSON {error:"..."} on 4xx and plain text on 5xx.
    if (!raw) return t.errGeneric;
    try {
      var j = JSON.parse(raw);
      if (j && j.error) return j.error;
    } catch (_) {}
    if (raw.length > 200) return t.errGeneric;
    return raw;
  }

  // Styles ---------------------------------------------------------------
  var css = [
    '.yc-bubble{position:fixed;right:20px;bottom:20px;width:56px;height:56px;border-radius:50%;background:#000;color:#fff;border:none;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center;z-index:2147483646;transition:transform .15s ease}',
    '.yc-bubble:hover{transform:scale(1.06)}',
    '.yc-bubble svg{width:26px;height:26px}',
    '.yc-panel{position:fixed;right:20px;bottom:90px;width:380px;max-width:calc(100vw - 24px);height:560px;max-height:calc(100vh - 110px);background:#fff;border:1px solid #e5e5e5;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.18);display:flex;flex-direction:column;overflow:hidden;z-index:2147483646;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#111;animation:yc-in .18s ease-out}',
    '@keyframes yc-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}',
    '.yc-panel.yc-hidden{display:none}',
    '.yc-head{padding:14px 16px;border-bottom:1px solid #eee;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;background:#fff;position:relative;z-index:1}',
    '.yc-head h3{margin:0;font-size:15px;font-weight:600;line-height:1.2;color:#111}',
    '.yc-head p{margin:2px 0 0;font-size:12px;color:#777}',
    '.yc-close{background:transparent;border:none;cursor:pointer;color:#777;padding:4px;border-radius:6px;display:flex;align-items:center}',
    '.yc-close:hover{background:#f3f3f3;color:#111}',
    '.yc-body{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px;background:#fafafa;-webkit-overflow-scrolling:touch}',
    '.yc-empty{color:#777;font-size:13px;text-align:center;padding:24px 8px;line-height:1.5}',
    '.yc-msg{max-width:85%;padding:9px 12px;border-radius:12px;font-size:14px;line-height:1.45;white-space:pre-wrap;word-wrap:break-word}',
    '.yc-msg.yc-user{align-self:flex-end;background:#111;color:#fff;border-bottom-right-radius:4px}',
    '.yc-msg.yc-asst{align-self:flex-start;background:#fff;border:1px solid #ececec;color:#111;border-bottom-left-radius:4px}',
    '.yc-msg a{color:inherit;text-decoration:underline}',
    '.yc-typing{align-self:flex-start;background:#fff;border:1px solid #ececec;border-radius:12px;border-bottom-left-radius:4px;padding:10px 14px;display:inline-flex;gap:4px}',
    '.yc-typing span{width:6px;height:6px;border-radius:50%;background:#bbb;animation:yc-blink 1.2s infinite ease-in-out}',
    '.yc-typing span:nth-child(2){animation-delay:.15s}.yc-typing span:nth-child(3){animation-delay:.3s}',
    '@keyframes yc-blink{0%,80%,100%{opacity:.3}40%{opacity:1}}',
    '.yc-foot{padding:10px;border-top:1px solid #eee;display:flex;gap:8px;align-items:flex-end;background:#fff;flex-shrink:0}',
    '.yc-input{flex:1;resize:none;border:1px solid #ddd;border-radius:10px;padding:9px 11px;font-size:14px;line-height:1.4;font-family:inherit;max-height:120px;outline:none;color:#111;background:#fff}',
    '.yc-input:focus{border-color:#111}',
    '.yc-send{background:#111;color:#fff;border:none;border-radius:10px;width:38px;height:38px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0}',
    '.yc-send:hover{background:#000}',
    '.yc-send:disabled{background:#bbb;cursor:not-allowed}',
    '.yc-brand{font-size:11px;color:#888;text-align:center;padding:6px 0 0;flex-shrink:0;background:#fff}',
    '@media (max-width:480px){',
      '.yc-panel{right:0;bottom:0;top:0;left:0;width:100vw;max-width:100vw;height:100vh;height:100dvh;max-height:100dvh;border-radius:0;border:none}',
      '.yc-bubble{right:14px;bottom:14px}',
      '.yc-head{padding-top:max(14px,env(safe-area-inset-top))}',
      '.yc-foot{padding-bottom:max(10px,env(safe-area-inset-bottom))}',
    '}'
  ].join('\\n');

  // Mount ----------------------------------------------------------------
  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  var root = document.createElement('div');
  root.id = 'yammbo-chat-root';
  document.body.appendChild(root);

  var bubble = $('<button class="yc-bubble" aria-label="' + t.open + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg></button>');
  root.appendChild(bubble);

  var panel = $(
    '<div class="yc-panel yc-hidden" role="dialog" aria-label="Yammbo support chat">' +
      '<div class="yc-head">' +
        '<div><h3>' + t.title + '</h3><p>' + t.subtitle + '</p></div>' +
        '<button class="yc-close" aria-label="' + t.close + '"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button>' +
      '</div>' +
      '<div class="yc-body" aria-live="polite"></div>' +
      '<div class="yc-foot">' +
        '<textarea class="yc-input" rows="1" placeholder="' + t.placeholder + '" aria-label="' + t.placeholder + '"></textarea>' +
        '<button class="yc-send" aria-label="' + t.send + '"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg></button>' +
      '</div>' +
      '<div class="yc-brand">' + t.brand + '</div>' +
    '</div>'
  );
  root.appendChild(panel);

  var body = panel.querySelector('.yc-body');
  var input = panel.querySelector('.yc-input');
  var sendBtn = panel.querySelector('.yc-send');
  var closeBtn = panel.querySelector('.yc-close');

  // State ----------------------------------------------------------------
  var history = loadHistory();
  var busy = false;

  function renderEmpty() {
    body.innerHTML = '<div class="yc-empty">' + t.empty + '</div>';
  }
  function renderHistory() {
    if (!history.length) { renderEmpty(); return; }
    body.innerHTML = '';
    history.forEach(function (m) { appendMsg(m.role, m.content, false); });
    body.scrollTop = body.scrollHeight;
  }
  function appendMsg(role, content, persist) {
    var el = document.createElement('div');
    el.className = 'yc-msg ' + (role === 'user' ? 'yc-user' : 'yc-asst');
    el.innerHTML = role === 'user' ? escape(content) : mdInline(content);
    body.appendChild(el);
    body.scrollTop = body.scrollHeight;
    if (persist) { history.push({ role: role, content: content }); saveHistory(history); }
    return el;
  }
  function showTyping() {
    var tEl = document.createElement('div');
    tEl.className = 'yc-typing';
    tEl.innerHTML = '<span></span><span></span><span></span>';
    body.appendChild(tEl);
    body.scrollTop = body.scrollHeight;
    return tEl;
  }

  // Panel open/close -----------------------------------------------------
  function open() {
    panel.classList.remove('yc-hidden');
    if (!body.children.length) renderHistory();
    setTimeout(function () { input.focus(); }, 50);
  }
  function close() { panel.classList.add('yc-hidden'); }

  bubble.addEventListener('click', function () {
    panel.classList.contains('yc-hidden') ? open() : close();
  });
  closeBtn.addEventListener('click', close);

  // Auto-grow textarea ---------------------------------------------------
  input.addEventListener('input', function () {
    input.style.height = 'auto';
    input.style.height = Math.min(120, input.scrollHeight) + 'px';
  });

  // Send -----------------------------------------------------------------
  async function send() {
    if (busy) return;
    var text = input.value.trim();
    if (!text) return;

    busy = true;
    sendBtn.disabled = true;
    input.value = '';
    input.style.height = 'auto';

    if (!history.length) body.innerHTML = '';

    appendMsg('user', text, true);
    var typing = showTyping();

    var msgEl = null;
    var assistantBuf = '';
    try {
      var res = await fetch(API, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId: sessionId(),
          messages: history.map(function (m) { return { role: m.role, content: m.content }; }),
        }),
      });

      if (!res.ok || !res.body) {
        var errText = await res.text();
        typing.remove();
        appendMsg('asst', '⚠️ ' + friendlyError(errText), false);
        busy = false; sendBtn.disabled = false; return;
      }

      var reader = res.body.getReader();
      var dec = new TextDecoder();
      var sseBuf = '';

      while (true) {
        var chunk = await reader.read();
        if (chunk.done) break;
        sseBuf += dec.decode(chunk.value, { stream: true });
        var parts = sseBuf.split('\\n\\n');
        sseBuf = parts.pop() || '';
        for (var i = 0; i < parts.length; i++) {
          var line = parts[i].trim();
          if (!line.startsWith('data: ')) continue;
          var data = line.slice(6);
          if (data === '[DONE]') continue;
          try {
            var j = JSON.parse(data);
            var delta = j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content;
            if (delta) {
              if (!msgEl) { typing.remove(); msgEl = appendMsg('asst', '', false); }
              assistantBuf += delta;
              msgEl.innerHTML = mdInline(assistantBuf);
              body.scrollTop = body.scrollHeight;
            }
          } catch (_) { /* ignore */ }
        }
      }

      if (assistantBuf) { history.push({ role: 'assistant', content: assistantBuf }); saveHistory(history); }
      if (!msgEl) { typing.remove(); appendMsg('asst', '⚠️ ' + t.errNoReply, false); }
    } catch (e) {
      typing.remove();
      appendMsg('asst', '⚠️ ' + t.errNetwork, false);
    } finally {
      busy = false; sendBtn.disabled = false;
      input.focus();
    }
  }

  sendBtn.addEventListener('click', send);
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });

  renderHistory();
})();`;
