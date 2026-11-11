// panel-app.ts
// The panel SPA (served at /panel/app.js): vanilla JS, hash routing, no
// dependencies. Everything that comes from visitors (questions, answers, names,
// URLs) is untrusted: it is only ever inserted with textContent / text nodes,
// never through innerHTML. innerHTML is used solely for the constant SVG icons.
// Assistant answers go through md() below, which builds DOM nodes (still no HTML parsing).
//
// The source uses String.raw: backslashes are literal, and the text must not
// contain backticks or the two-character sequence dollar-brace.

import { PRODUCT_NAMES } from './page';

export const PANEL_APP_JS = 'var PRODUCTS = ' + JSON.stringify(PRODUCT_NAMES) + ';\n' + String.raw`(function () {
  'use strict';

  var app = document.getElementById('app');
  var P = '/panel/api';
  var navToken = 0;
  var TZ = -new Date().getTimezoneOffset(); // minutes east of UTC
  var DEVICES = { mobile: 'Móvil', tablet: 'Tableta', desktop: 'Escritorio' };
  var filters = { q: '', product: '', country: '', status: '', tag: '', mode: '' };
  var statsRange = 30;
  var countryNames = null;
  try { countryNames = new Intl.DisplayNames(['es'], { type: 'region' }); } catch (_) {}

  var IC = {
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/></svg>',
    chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>',
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    help: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
    out: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/></svg>',
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
    spark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.7 1.8L21.5 17.5l-1.8.7L19 20l-.7-1.8-1.8-.7 1.8-.7z"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/></svg>',
    back: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>'
  };

  // DOM helpers ---------------------------------------------------------------
  // h('div', { class: 'x', onclick: fn }, 'text', child, [more]). Strings become
  // text nodes; there is no HTML parsing here.
  function h(tag, attrs) {
    var e = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k.slice(0, 2) === 'on' && typeof v === 'function') e.addEventListener(k.slice(2), v);
        else if (k === 'class') e.className = v;
        else e.setAttribute(k, v === true ? '' : String(v));
      });
    }
    for (var i = 2; i < arguments.length; i++) add(e, arguments[i]);
    return e;
  }
  function add(parent, c) {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { add(parent, x); }); return; }
    parent.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
  }
  function icon(svg, cls) { var s = h('span', { class: cls || 'ico' }); s.innerHTML = svg; return s.firstChild; }
  function mount(nodes) { app.replaceChildren.apply(app, [].concat(nodes)); }

  // Formatting ------------------------------------------------------------------
  function flag(cc) {
    if (!cc || !/^[A-Za-z]{2}$/.test(cc)) return '';
    return String.fromCodePoint.apply(null, cc.toUpperCase().split('').map(function (c) { return 0x1f1e6 + c.charCodeAt(0) - 65; }));
  }
  function countryName(cc) { try { return (countryNames && countryNames.of(cc)) || cc; } catch (_) { return cc; } }
  function place(c) {
    var f = flag(c.country);
    var parts = [];
    if (c.country) parts.push((f ? f + ' ' : '') + countryName(c.country));
    if (c.city) parts.push(c.city);
    return parts.join(' · ');
  }
  var dFmt = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  function fmtDate(ts) { return dFmt.format(new Date(ts)); }
  function ago(ts) {
    var s = Math.max(0, (Date.now() - ts) / 1000);
    if (s < 60) return 'ahora';
    if (s < 3600) return Math.floor(s / 60) + ' min';
    if (s < 86400) return Math.floor(s / 3600) + ' h';
    if (s < 7 * 86400) return Math.floor(s / 86400) + ' d';
    return fmtDate(ts);
  }
  function productName(p) { return p && Object.prototype.hasOwnProperty.call(PRODUCTS, p) ? PRODUCTS[p] : 'General'; }
  function pathOf(u) {
    try { var x = new URL(u); return x.hostname + (x.pathname === '/' ? '' : x.pathname); } catch (_) { return String(u || ''); }
  }
  function isYammboUrl(u) { return /^https:\/\/([a-z0-9-]+\.)*yammbo\.com(\/|$)/i.test(String(u || '')); }
  function link(u) {
    var t = pathOf(u);
    return isYammboUrl(u) ? h('a', { href: u, target: '_blank', rel: 'noopener noreferrer' }, t) : t;
  }
  function clientLabel(c) { return [DEVICES[c.device] || c.device, c.os, c.browser].filter(Boolean).join(' · '); }
  // Minimal, safe markdown for assistant answers: paragraphs / line breaks,
  // **bold**, inline code, "-" and "1." lists, [text](https://...) links.
  // Output is built with h() only, so nothing the model (or a visitor steering it)
  // writes can become markup. Links must be https; anything else stays as text.
  // (\x60 is a backtick: this source sits inside a template literal.)
  function inlineMd(text, noLinks) {
    var re = /\x60([^\x60\n]+)\x60|\*\*([^*\n]+?)\*\*|\[([^\]\n]+)\]\((https:\/\/[^\s()]+)\)/g;
    var out = [], last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) out.push(text.slice(last, m.index));
      if (m[1] !== undefined) out.push(h('code', null, m[1]));
      else if (m[2] !== undefined) out.push(h('strong', null, inlineMd(m[2], noLinks)));
      else {
        var u = null;
        try { u = new URL(m[4]); } catch (_) {}
        if (!u || u.protocol !== 'https:' || noLinks) out.push(m[3]);
        else out.push(h('a', { href: u.href, target: '_blank', rel: 'noopener noreferrer', title: u.href }, m[3]));
      }
      last = re.lastIndex;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
  }
  function md(text) {
    var root = h('div', { class: 'md' });
    var para = null, list = null;
    function flush() { para = null; list = null; }
    String(text || '').replace(/\r\n?/g, '\n').split('\n').forEach(function (line) {
      var ul = /^\s*[-*]\s+(.*)$/.exec(line);
      var ol = !ul && /^\s*\d+[.)]\s+(.*)$/.exec(line);
      if (ul || ol) {
        var tag = ul ? 'ul' : 'ol';
        if (!list || list.tagName.toLowerCase() !== tag) { para = null; list = h(tag); root.appendChild(list); }
        list.appendChild(h('li', null, inlineMd((ul || ol)[1])));
      } else if (!line.trim()) {
        flush();
      } else {
        list = null;
        if (!para) { para = h('p'); root.appendChild(para); } else para.appendChild(h('br'));
        add(para, inlineMd(line.trim()));
      }
    });
    return root;
  }
  function badge(text, cls) { return h('span', { class: 'badge' + (cls ? ' ' + cls : '') }, text); }

  // API --------------------------------------------------------------------------
  function api(path, opts) {
    opts = opts || {};
    var init = { method: opts.method || 'GET', credentials: 'same-origin', headers: { 'x-requested-with': 'panel' } };
    if (opts.body !== undefined) { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
    return fetch(path, init).then(function (r) {
      if (r.status === 401 && !opts.noAuthRedirect) { var a = new Error('auth'); a.auth = true; throw a; }
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { var e = new Error((j && j.error) || 'http ' + r.status); e.status = r.status; throw e; }
        return j;
      });
    });
  }
  function qs(o) {
    var p = [];
    Object.keys(o).forEach(function (k) { if (o[k] !== '' && o[k] !== null && o[k] !== undefined) p.push(encodeURIComponent(k) + '=' + encodeURIComponent(o[k])); });
    return p.length ? '?' + p.join('&') : '';
  }

  // Shell -------------------------------------------------------------------------
  var TABS = [
    { id: 'home', href: '#/', label: 'Inicio', ic: IC.home },
    { id: 'live', href: '#/live', label: 'En línea', ic: IC.eye },
    { id: 'chats', href: '#/c', label: 'Chats', ic: IC.chat },
    { id: 'leads', href: '#/leads', label: 'Contactos', ic: IC.users },
    { id: 'unanswered', href: '#/unanswered', label: 'Sin respuesta', ic: IC.help }
  ];
  var bellBtn = null;
  function shell(active, content) {
    bellBtn = h('button', { class: 'iconbtn', onclick: togglePush, title: 'Notificaciones', 'aria-label': 'Notificaciones' }, icon(IC.bell));
    var nav = h('nav', { class: 'nav', 'aria-label': 'Secciones' }, TABS.map(function (t) {
      var a = h('a', { href: t.href, class: t.id === active ? 'on' : '', 'aria-current': t.id === active ? 'page' : null });
      a.appendChild(icon(t.ic));
      a.appendChild(h('span', null, t.label));
      return a;
    }));
    var top = h('header', { class: 'top' },
      h('span', { class: 'brand' }, 'Yammbo Chat'), nav, h('span', { class: 'spacer' }),
      h('a', { class: 'iconbtn' + (active === 'settings' ? ' current' : ''), href: '#/settings', title: 'Ajustes', 'aria-label': 'Ajustes', 'aria-current': active === 'settings' ? 'page' : null }, icon(IC.gear)),
      bellBtn,
      h('button', { class: 'iconbtn', onclick: logout, title: 'Salir', 'aria-label': 'Salir' }, icon(IC.out)));
    var main = h('main', null, content);
    mount([top, main]);
    refreshBell();
    return main;
  }
  function loading() { return h('div', { class: 'spin', role: 'status', 'aria-label': 'Cargando' }); }
  function failure(msg) { return h('div', { class: 'empty' }, msg || 'No se pudo cargar. Inténtalo de nuevo.'); }

  // Login ---------------------------------------------------------------------------
  function showLogin(note) {
    var msg = h('div', { class: 'err', role: 'alert' }, note || '');
    var body = h('div', { class: 'login' });
    function stepStart() {
      body.replaceChildren(
        h('h1', null, 'Panel de Yammbo Chat'),
        h('p', { class: 'muted' }, 'Te enviaremos un código de 8 caracteres por Telegram.'),
        h('button', { class: 'btn', onclick: send }, 'Enviar código'),
        msg);
    }
    function send(ev) {
      var b = ev.currentTarget; b.disabled = true; msg.textContent = '';
      api(P + '/login/start', { method: 'POST', body: {}, noAuthRedirect: true }).then(stepCode).catch(function (e) {
        b.disabled = false;
        msg.textContent = e.status === 429 ? 'Demasiadas solicitudes, prueba más tarde.' : 'No se pudo enviar el código. Inténtalo de nuevo.';
      });
    }
    function stepCode() {
      var input = h('input', { type: 'text', inputmode: 'text', autocapitalize: 'characters', autocomplete: 'one-time-code', autocorrect: 'off', spellcheck: 'false', maxlength: '12', 'aria-label': 'Código de 8 caracteres' });
      var btn = h('button', { class: 'btn', onclick: verify }, 'Entrar');
      function verify() {
        // Letters and digits only (the server also ignores case, spaces and hyphens).
        var code = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (code.length !== 8) { msg.textContent = 'Escribe los 8 caracteres.'; return; }
        btn.disabled = true; msg.textContent = '';
        api(P + '/login/verify', { method: 'POST', body: { code: code }, noAuthRedirect: true }).then(function () { route(); }).catch(function (e) {
          btn.disabled = false;
          msg.textContent = e.status === 429 ? 'Demasiadas solicitudes, prueba más tarde.' : 'Código incorrecto o caducado. Pide uno nuevo.';
        });
      }
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') verify(); });
      body.replaceChildren(
        h('h1', null, 'Escribe el código'),
        h('p', { class: 'muted' }, 'Lo enviamos al Telegram del equipo. Caduca en 10 minutos.'),
        h('div', { class: 'field' }, input), btn,
        h('button', { class: 'btn ghost', onclick: function () { msg.textContent = ''; stepStart(); } }, 'Pedir otro código'),
        msg);
      input.focus();
    }
    stepStart();
    mount(body);
  }
  function logout() {
    api(P + '/logout', { method: 'POST', body: {}, noAuthRedirect: true }).catch(function () {}).then(function () { showLogin(); });
  }
  function onError(e) {
    if (e && e.auth) { showLogin(); return true; }
    return false;
  }

  // Home --------------------------------------------------------------------------------
  function viewHome() {
    var tok = ++navToken;
    var content = h('div', null, h('h1', null, 'Inicio'));
    var body = h('div', null, loading());
    var chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Periodo' }, [7, 30, 90].map(function (d) {
      return h('button', { class: 'chip' + (statsRange === d ? ' on' : ''), onclick: function () { statsRange = d; viewHome(); } }, d + ' días');
    }));
    content.appendChild(pushBanner());
    content.appendChild(chips);
    content.appendChild(body);
    shell('home', content);
    api(P + '/stats' + qs({ days: statsRange, tz: TZ })).then(function (s) {
      if (tok !== navToken) return;
      body.replaceChildren(waitingBanner(s.waiting), onlineCard(s.online), renderStats(s));
    }).catch(function (e) { if (tok === navToken && !onError(e)) body.replaceChildren(failure()); });
  }
  function waitingBanner(n) {
    if (!n) return h('span');
    return h('div', { class: 'card banner alert' },
      h('p', null, h('strong', null, n === 1 ? '1 conversación espera a una persona' : n + ' conversaciones esperan a una persona')),
      h('a', { class: 'btn', href: '#/c', onclick: function () { filters.mode = 'waiting'; filters.status = ''; } }, 'Ver'));
  }
  function onlineCard(n) {
    if (typeof n !== 'number') return h('span');
    return h('div', { class: 'card banner' },
      h('p', null, h('span', { class: 'live-dot', 'aria-hidden': 'true' }), h('strong', null, n === 1 ? '1 visitante en línea' : n + ' visitantes en línea')),
      h('a', { class: 'btn ghost', href: '#/live' }, 'Ver'));
  }
  function kpi(n, label) { return h('div', { class: 'kpi' }, h('b', null, String(n)), h('span', null, label)); }
  function vbars(values, labels) {
    var max = Math.max.apply(null, values.concat([1]));
    var wrap = h('div', { class: 'vbars' });
    values.forEach(function (v, i) {
      var b = h('i', { class: v ? '' : 'zero', title: labels[i] + ': ' + v });
      b.style.height = Math.max(2, Math.round((v / max) * 100)) + '%';
      wrap.appendChild(b);
    });
    return wrap;
  }
  function hbars(rows, labelFn) {
    if (!rows.length) return h('div', { class: 'muted small' }, 'Sin datos todavía.');
    var max = Math.max.apply(null, rows.map(function (r) { return r.n; }).concat([1]));
    return h('div', null, rows.map(function (r) {
      var fill = h('i');
      fill.style.width = Math.max(3, Math.round((r.n / max) * 100)) + '%';
      var label = labelFn(r);
      return h('div', { class: 'hbar' }, h('span', { class: 'name', title: label }, label), h('span', { class: 'track' }, fill), h('span', { class: 'n' }, String(r.n)));
    }));
  }
  function section(title, node) { return h('div', null, h('h2', null, title), h('div', { class: 'card' }, node)); }
  function renderStats(s) {
    var t = s.totals;
    var days = s.series.map(function (d) { return d.day; });
    var hoursLabels = s.hours.map(function (_, i) { return (i < 10 ? '0' : '') + i + ':00'; });
    return h('div', null,
      h('div', { class: 'kpis' },
        kpi(t.conversations, 'Conversaciones'), kpi(t.messages, 'Mensajes'), kpi(t.leads, 'Contactos'),
        kpi(t.thumbsUp, 'Pulgar arriba'), kpi(t.thumbsDown, 'Pulgar abajo'), kpi(t.handoffs, 'Pasos a persona'),
        kpi(t.csatAvg === null || t.csatAvg === undefined ? '—' : t.csatAvg + ' / 5', 'Valoración media'), kpi(t.csatCount || 0, 'Valoraciones')),
      section('Conversaciones por día', h('div', null,
        vbars(s.series.map(function (d) { return d.conversations; }), days),
        h('div', { class: 'axis' }, h('span', null, days[0] || ''), h('span', null, days[days.length - 1] || '')))),
      h('div', { class: 'grid2' },
        section('Productos', hbars(s.products, function (r) { return productName(r.key); })),
        section('Países', hbars(s.countries, function (r) { return (flag(r.key) + ' ' + countryName(r.key)).trim(); }))),
      h('div', { class: 'grid2' },
        section('Dispositivos', hbars(s.devices, function (r) { return DEVICES[r.key] || r.key; })),
        section('Páginas de origen', hbars(s.pages, function (r) { return pathOf(r.key); }))),
      section('Horas del día (tu hora local)', h('div', null,
        vbars(s.hours, hoursLabels),
        h('div', { class: 'axis' }, h('span', null, '00'), h('span', null, '06'), h('span', null, '12'), h('span', null, '18'), h('span', null, '23')))));
  }

  // Shared pieces of the inbox ---------------------------------------------------------------------
  var MODE_LABEL = { bot: 'Bot', waiting: 'Esperando', human: 'Equipo' };
  // System lines are stored as codes (see inbox.ts); unknown codes are not shown.
  var SYS_TEXT = {
    'sys:waiting': 'Pidió hablar con una persona',
    'sys:joined': 'El equipo se unió',
    'sys:returned': 'Conversación devuelta al asistente',
    'sys:resolved': 'Conversación resuelta'
  };
  function modeBadge(mode) { return badge(MODE_LABEL[mode] || 'Bot', mode === 'waiting' ? 'warn' : mode === 'human' ? 'accent' : ''); }
  function stars(n) { var s = ''; for (var i = 1; i <= 5; i++) s += i <= n ? '★' : '☆'; return s; }

  // Polling: one timer per view, paused while the tab is hidden, stopped on every route change.
  var pollTimer = null, pollFn = null;
  function stopPolling() { clearInterval(pollTimer); pollTimer = null; pollFn = null; }
  function startPolling(fn, ms) {
    stopPolling();
    pollFn = fn;
    pollTimer = setInterval(function () { if (!document.hidden) fn(); }, ms);
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden && pollFn) pollFn(); });

  // Canned replies: {nombre} becomes the lead's first name; without a name the
  // placeholder is removed together with the punctuation and spacing around it.
  function fillVars(body, leadName) {
    var first = String(leadName || '').trim().split(/\s+/)[0] || '';
    var out = String(body);
    if (first) return out.replace(/\{nombre\}/gi, function () { return first; }); // function: a name with $& or $1 stays literal
    out = out.replace(/(^|\n)\{nombre\}[ \t]*[,;:]?[ \t]*/gi, function (m, pre) { return pre + '\u0001'; });
    out = out.replace(/[ \t]*\{nombre\}/gi, '');
    return out.replace(/\u0001([^\s])/g, function (m, c) { return c.toUpperCase(); }).replace(/\u0001/g, '');
  }
  var cannedCache = null;
  function loadCanned(force) {
    if (cannedCache && !force) return Promise.resolve(cannedCache);
    return api(P + '/canned').then(function (r) { cannedCache = r.items || []; return cannedCache; });
  }

  // Conversations -------------------------------------------------------------------------
  function viewChats() {
    var tok = ++navToken;
    var seq = 0, extra = 0;
    var list = h('div', null, loading());
    var more = h('div', { class: 'more' });
    var q = h('input', { type: 'search', placeholder: 'Buscar en mensajes…', 'aria-label': 'Buscar', value: filters.q });
    var prod = h('select', { 'aria-label': 'Producto' }, h('option', { value: '' }, 'Todos los productos'),
      Object.keys(PRODUCTS).map(function (k) { return h('option', { value: k, selected: filters.product === k }, PRODUCTS[k]); }));
    var ctry = h('select', { 'aria-label': 'País' }, h('option', { value: '' }, 'Todos los países'));
    var tagSel = h('select', { 'aria-label': 'Etiqueta' }, h('option', { value: '' }, 'Todas las etiquetas'));
    var modeSel = h('select', { 'aria-label': 'Modo' }, h('option', { value: '' }, 'Todos los modos'),
      Object.keys(MODE_LABEL).map(function (k) { return h('option', { value: k, selected: filters.mode === k }, MODE_LABEL[k]); }));
    var chipDefs = [
      { label: 'Todas', on: function () { return !filters.status && !filters.mode; }, set: function () { filters.status = ''; filters.mode = ''; } },
      { label: 'Esperando una persona', on: function () { return filters.mode === 'waiting'; }, set: function () { filters.mode = filters.mode === 'waiting' ? '' : 'waiting'; } },
      { label: 'Abiertas', on: function () { return filters.status === 'open'; }, set: function () { filters.status = filters.status === 'open' ? '' : 'open'; } },
      { label: 'Resueltas', on: function () { return filters.status === 'resolved'; }, set: function () { filters.status = filters.status === 'resolved' ? '' : 'resolved'; } }
    ];
    var chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Estado' });
    function paintChips() {
      chips.replaceChildren.apply(chips, chipDefs.map(function (d) {
        return h('button', { class: 'chip' + (d.on() ? ' on' : ''), 'aria-pressed': d.on() ? 'true' : 'false', onclick: function () { d.set(); modeSel.value = filters.mode; paintChips(); load(null); } }, d.label);
      }));
    }
    var timer = null;
    function apply() { filters.q = q.value.trim(); filters.product = prod.value; filters.country = ctry.value; filters.tag = tagSel.value; filters.mode = modeSel.value; paintChips(); load(null); }
    q.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(apply, 300); });
    [prod, ctry, tagSel, modeSel].forEach(function (s) { s.addEventListener('change', apply); });
    shell('chats', h('div', null, h('h1', null, 'Conversaciones'), chips, h('div', { class: 'filters' }, q, prod, ctry, tagSel, modeSel), list, more));
    paintChips();
    var countriesFilled = false;
    function fillTags(tags) {
      var cur = filters.tag;
      var keys = tags.map(function (t) { return t.key; });
      if (cur && keys.indexOf(cur) < 0) keys.unshift(cur);
      tagSel.replaceChildren.apply(tagSel, [h('option', { value: '' }, 'Todas las etiquetas')].concat(keys.map(function (k) { return h('option', { value: k, selected: cur === k }, '#' + k); })));
    }
    function load(before, silent) {
      var mine = ++seq;
      if (!before) { extra = 0; if (!silent) list.replaceChildren(loading()); }
      if (!silent) more.replaceChildren();
      api(P + '/conversations' + qs({ before: before, q: filters.q, product: filters.product, country: filters.country, status: filters.status, tag: filters.tag, mode: filters.mode })).then(function (r) {
        if (tok !== navToken || mine !== seq) return;
        if (r.countries && !countriesFilled) {
          countriesFilled = true;
          r.countries.forEach(function (c) { ctry.appendChild(h('option', { value: c.key, selected: filters.country === c.key }, (flag(c.key) + ' ' + countryName(c.key)).trim())); });
        }
        if (r.tags) fillTags(r.tags);
        if (!before) list.replaceChildren();
        if (!before && !r.items.length) list.appendChild(h('div', { class: 'empty' }, 'No hay conversaciones con esos filtros.'));
        r.items.forEach(function (c) { list.appendChild(convItem(c)); });
        more.replaceChildren();
        if (r.next) more.appendChild(h('button', { class: 'btn ghost', onclick: function (ev) { ev.currentTarget.disabled = true; extra++; load(r.next); } }, 'Cargar más'));
      }).catch(function (e) { if (onError(e)) return; if (tok === navToken && mine === seq && !silent) list.replaceChildren(failure()); });
    }
    load(null);
    // Refresh the first page every 15 s (unread counters, new conversations). Once the
    // user paged further down the list stays as is, so nothing jumps under the finger.
    startPolling(function () { if (!extra) load(null, true); }, 15000);
  }
  function convItem(c) {
    var tags = [];
    if (c.unread) tags.push(badge(c.unread + ' sin leer', 'warn'));
    tags.push(modeBadge(c.mode));
    if (c.status === 'resolved') tags.push(badge('Resuelta'));
    tags.push(badge(c.msgCount + ' msj'));
    if (c.hasLead) tags.push(badge('Contacto', 'accent'));
    if (c.csat) tags.push(badge('★ ' + c.csat + '/5'));
    if (c.up) tags.push(badge('👍 ' + c.up));
    if (c.down) tags.push(badge('👎 ' + c.down));
    (c.tags || []).forEach(function (t) { tags.push(badge('#' + t, 'outline')); });
    var cl = clientLabel(c);
    if (cl) tags.push(badge(cl));
    return h('a', { class: 'item' + (c.unread || c.mode === 'waiting' ? ' unread' : ''), href: '#/c/' + encodeURIComponent(c.id) },
      h('div', { class: 'head' }, h('span', { class: 't' }, [place(c) || 'Ubicación desconocida', ' · ', productName(c.product)].join('')), h('span', { class: 'when' }, ago(c.updatedAt))),
      h('div', { class: 'clamp' }, c.firstQuestion || '—'),
      h('div', { class: 'tags' }, tags));
  }

  // Detail ------------------------------------------------------------------------------------
  // The skeleton (header, controls, tags, messages, composer, notes...) is built once;
  // every 5 s the server is asked for what changed (?after=<last message>) and only the
  // affected parts are repainted, so the composer never loses what is being typed.
  function viewDetail(id) {
    var tok = ++navToken;
    var body = h('div', null, loading());
    shell('chats', h('div', null, h('a', { class: 'back', href: '#/c' }, icon(IC.back), 'Conversaciones'), body));
    var ctl = null;
    api(P + '/conversations/' + encodeURIComponent(id)).then(function (r) {
      if (tok !== navToken) return;
      ctl = buildDetail(id, tok, r);
      body.replaceChildren(ctl.root);
      ctl.afterMount();
      startPolling(function () { ctl.refresh(); }, 5000);
    }).catch(function (e) {
      if (tok !== navToken || onError(e)) return;
      body.replaceChildren(failure(e.status === 404 ? 'Esta conversación no existe o ya se borró (90 días).' : null));
    });
  }
  function buildDetail(id, tok, first) {
    var conv = first.conversation;
    var lead = first.lead;
    var lastAt = 0;
    var seen = {};
    var composerErr = h('div', { class: 'err', role: 'alert', hidden: true });

    var title = h('h1');
    var meta = h('div', { class: 'meta' });
    var controls = h('div', { class: 'controls' });
    var tagBox = h('div', { class: 'tagrow' });
    var msgs = h('div', { class: 'msgs', 'aria-live': 'polite' });
    var csatBox = h('div');
    var leadBox = h('div');
    var notesList = h('div');
    var journeyBox = h('div');
    var root = h('div');

    // Header, badges, controls ------------------------------------------------------
    function paintHead() {
      title.textContent = place(conv) || 'Conversación';
      var m = [badge(productName(conv.product), 'accent'), modeBadge(conv.mode)];
      if (conv.status === 'resolved') m.push(badge('Resuelta'));
      if (place(conv)) m.push(badge(place(conv)));
      if (clientLabel(conv)) m.push(badge(clientLabel(conv)));
      if (conv.lang) m.push(badge(conv.lang.toUpperCase()));
      m.push(badge('Inicio ' + fmtDate(conv.createdAt)));
      if (votes.up) m.push(badge('👍 ' + votes.up));
      if (votes.down) m.push(badge('👎 ' + votes.down));
      meta.replaceChildren.apply(meta, m);
      var c = [];
      if (conv.mode !== 'human' && !conv.legacy) c.push(h('button', { class: 'btn sm', onclick: function (ev) { act(ev, '/mode', { mode: 'human' }); } }, 'Tomar conversación'));
      if (conv.mode !== 'bot') c.push(h('button', { class: 'btn ghost sm', onclick: function (ev) { act(ev, '/mode', { mode: 'bot' }); } }, 'Devolver al asistente'));
      c.push(conv.status === 'resolved'
        ? h('button', { class: 'btn ghost sm', onclick: function (ev) { act(ev, '/status', { status: 'open' }); } }, 'Reabrir')
        : h('button', { class: 'btn ghost sm', title: 'Cierra la conversación; si el equipo participó, se pide una valoración al visitante', onclick: function (ev) { act(ev, '/status', { status: 'resolved' }); } }, 'Resolver'));
      controls.replaceChildren.apply(controls, c);
      hint.textContent = conv.mode === 'bot' ? 'Al enviar, tomas la conversación: el asistente deja de responder.'
        : conv.mode === 'waiting' ? 'El visitante espera a una persona. Al enviar, tomas la conversación.'
        : conv.status === 'resolved' ? 'Al enviar, la conversación se reabre.' : 'Hablas con el visitante en directo.';
    }
    var votes = first.votes;
    function act(ev, path, payload) {
      var b = ev.currentTarget; b.disabled = true;
      api(P + '/conversations/' + encodeURIComponent(id) + path, { method: 'POST', body: payload }).then(function () { return refresh(); })
        .catch(function (e) { b.disabled = false; if (!onError(e)) { composerErr.hidden = false; composerErr.textContent = 'No se pudo cambiar el estado. Inténtalo de nuevo.'; } });
    }

    // Messages ------------------------------------------------------------------------------
    function addMessage(m) {
      if (m.id && seen[m.id]) return;
      if (m.id) seen[m.id] = true;
      if (m.createdAt > lastAt) lastAt = m.createdAt;
      if (m.role === 'system') {
        if (!Object.prototype.hasOwnProperty.call(SYS_TEXT, m.content)) return;
        msgs.appendChild(h('div', { class: 'sysline' }, SYS_TEXT[m.content] + ' · ' + fmtDate(m.createdAt)));
        return;
      }
      var user = m.role === 'user', agent = m.role === 'agent';
      msgs.appendChild(h('div', { class: 'b ' + (user ? 'u' : agent ? 't' : 'a') }, user || agent ? m.content : md(m.content)));
      var sub = [];
      if (agent) sub.push(h('span', null, 'Equipo'));
      sub.push(h('span', null, fmtDate(m.createdAt)));
      if (user && m.pageUrl) sub.push(h('span', null, 'desde ', link(m.pageUrl)));
      if (!user && !agent) {
        if (m.provider) sub.push(h('span', null, m.provider));
        if (m.ragHits !== null && m.ragHits !== undefined) sub.push(h('span', null, 'KB: ' + m.ragHits));
        if (m.handoff) sub.push(badge('Pasó a persona', 'warn'));
        if (m.rating === 1) sub.push(h('span', null, '👍'));
        if (m.rating === -1) sub.push(h('span', null, '👎'));
      }
      msgs.appendChild(h('div', { class: 'sub' + (user ? ' r' : '') }, sub));
    }
    function nearBottom() { return window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 240; }

    // Tags (free text, normalised by the server) ------------------------------------------------
    var tagInput = h('input', { class: 'inp taginput', type: 'text', maxlength: '40', list: 'tag-suggest-' + tok, placeholder: 'Añadir etiqueta', 'aria-label': 'Añadir etiqueta', autocomplete: 'off' });
    var tagData = h('datalist', { id: 'tag-suggest-' + tok });
    var tagErr = h('span', { class: 'small muted', role: 'status' });
    function paintTags(tags) {
      var nodes = tags.map(function (t) {
        return h('span', { class: 'tagchip' }, '#' + t,
          h('button', { type: 'button', 'aria-label': 'Quitar etiqueta ' + t, title: 'Quitar', onclick: function () {
            api(P + '/conversations/' + encodeURIComponent(id) + '/tags/' + encodeURIComponent(t), { method: 'DELETE' }).then(function (r) { paintTags(r.tags); }).catch(onError);
          } }, '×'));
      });
      tagBox.replaceChildren.apply(tagBox, nodes.concat([tagInput, h('button', { class: 'btn ghost sm', type: 'button', onclick: addTag }, 'Añadir'), tagErr, tagData]));
    }
    function addTag() {
      var v = tagInput.value.trim();
      if (!v) return;
      tagErr.textContent = '';
      api(P + '/conversations/' + encodeURIComponent(id) + '/tags', { method: 'POST', body: { tag: v } }).then(function (r) {
        tagInput.value = ''; paintTags(r.tags); tagInput.focus();
      }).catch(function (e) {
        if (onError(e)) return;
        tagErr.textContent = e.status === 409 ? 'Máximo 8 etiquetas.' : 'Etiqueta no válida.';
      });
    }
    tagInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); addTag(); } });
    function loadTagSuggestions() {
      api(P + '/tags').then(function (r) {
        tagData.replaceChildren.apply(tagData, (r.tags || []).map(function (t) { return h('option', { value: t.tag }); }));
      }).catch(function () {});
    }

    // Notes (internal, never shown to the visitor) ---------------------------------------------------
    var noteInput = h('textarea', { class: 'inp', rows: '2', maxlength: '2000', placeholder: 'Nota interna (solo la ve el equipo)', 'aria-label': 'Nota interna' });
    var noteErr = h('div', { class: 'err', role: 'alert', hidden: true });
    var notesSig = '';
    function paintNotes(notes) {
      var sig = JSON.stringify(notes);
      if (sig === notesSig) return;
      notesSig = sig;
      notesList.replaceChildren.apply(notesList, notes.map(function (n) {
        return h('div', { class: 'note' },
          h('div', { class: 'nbody' }, n.body),
          h('div', { class: 'sub' }, h('span', null, fmtDate(n.createdAt)),
            h('button', { class: 'linkbtn', type: 'button', onclick: function () {
              api(P + '/conversations/' + encodeURIComponent(id) + '/notes/' + encodeURIComponent(n.id), { method: 'DELETE' }).then(function () { return refresh(); }).catch(onError);
            } }, 'Eliminar')));
      }));
    }
    function addNote(ev) {
      var v = noteInput.value.trim();
      if (!v) return;
      var b = ev.currentTarget; b.disabled = true; noteErr.hidden = true;
      api(P + '/conversations/' + encodeURIComponent(id) + '/notes', { method: 'POST', body: { body: v } }).then(function () {
        noteInput.value = ''; b.disabled = false; return refresh();
      }).catch(function (e) { b.disabled = false; if (!onError(e)) { noteErr.hidden = false; noteErr.textContent = 'No se pudo guardar la nota.'; } });
    }

    // Composer ----------------------------------------------------------------------------------------
    var ta = h('textarea', { class: 'inp', rows: '1', maxlength: '2000', placeholder: 'Escribe una respuesta…', 'aria-label': 'Respuesta al visitante («/» abre las respuestas rápidas)', 'aria-autocomplete': 'list', 'aria-controls': 'picker-' + tok });
    var hint = h('div', { class: 'small muted composer-hint' });
    var aiNote = h('div', { class: 'small muted', hidden: true }, 'Borrador generado por IA: revísalo y edítalo antes de enviar.');
    var picker = h('ul', { class: 'picker', id: 'picker-' + tok, role: 'listbox', 'aria-label': 'Respuestas rápidas', hidden: true });
    var sendBtn = h('button', { class: 'ibtn primary', type: 'button', onclick: send, title: 'Enviar (Ctrl/Cmd + Enter)', 'aria-label': 'Enviar' }, icon(IC.send));
    var draftBtn = h('button', { class: 'ibtn', type: 'button', onclick: suggest, title: 'Sugerir respuesta con IA' }, icon(IC.spark), h('span', { class: 'vh' }, 'Sugerir respuesta con IA'));
    var composer = h('div', { class: 'composer' }, picker, aiNote, h('div', { class: 'composer-row' }, ta, draftBtn, sendBtn), composerErr);
    // One line that grows with the text, up to about six lines (then it scrolls).
    function grow() {
      ta.style.height = 'auto';
      var sh = ta.scrollHeight;
      if (!sh) { ta.style.height = ''; return; }
      ta.style.height = Math.max(38, Math.min(sh + 2, 144)) + 'px';
    }
    ta.addEventListener('input', grow);

    // Short (legacy) session ids cannot go live: the visitor's widget would never see the answer.
    if (conv.legacy) composer = h('div', { class: 'composer' }, h('div', { class: 'small muted', role: 'note' }, 'Esta conversación es de una versión antigua del chat: no se puede responder en vivo.'));

    function send() {
      var text = ta.value.trim();
      if (!text) return;
      sendBtn.disabled = true; composerErr.hidden = true;
      api(P + '/conversations/' + encodeURIComponent(id) + '/reply', { method: 'POST', body: { text: text } }).then(function (r) {
        sendBtn.disabled = false; ta.value = ''; grow(); aiNote.hidden = true; closePicker();
        conv.mode = r.mode; conv.status = r.status;
        r.messages.forEach(addMessage);
        paintHead();
        ta.focus();
        composer.scrollIntoView({ block: 'end' });
      }).catch(function (e) {
        sendBtn.disabled = false;
        if (onError(e)) return;
        composerErr.hidden = false;
        composerErr.textContent = 'No se pudo enviar el mensaje. Inténtalo de nuevo.';
      });
    }
    function suggest() {
      draftBtn.disabled = true; draftBtn.setAttribute('aria-busy', 'true'); draftBtn.title = 'Pensando…'; composerErr.hidden = true;
      api(P + '/conversations/' + encodeURIComponent(id) + '/draft', { method: 'POST', body: {} }).then(function (r) {
        ta.value = ta.value.trim() ? ta.value.replace(/\s+$/, '') + '\n\n' + r.text : r.text;
        ta.value = ta.value.slice(0, 2000); grow();
        aiNote.hidden = false; ta.focus();
      }).catch(function (e) {
        if (onError(e)) return;
        composerErr.hidden = false;
        composerErr.textContent = e.status === 429 ? 'Se alcanzó el límite de borradores por hora.' : 'No se pudo generar el borrador. Inténtalo de nuevo.';
      }).then(function () { draftBtn.disabled = false; draftBtn.removeAttribute('aria-busy'); draftBtn.title = 'Sugerir respuesta con IA'; });
    }

    // "/" picker: filterable list of canned replies, keyboard driven.
    var matches = [], active = 0, token = null;
    function slashToken() {
      var before = ta.value.slice(0, ta.selectionStart);
      var m = /(^|\s)\/([a-z0-9-]*)$/i.exec(before);
      return m ? { start: ta.selectionStart - m[2].length - 1, q: m[2].toLowerCase() } : null;
    }
    function closePicker() {
      picker.hidden = true; token = null; matches = [];
      ta.removeAttribute('aria-activedescendant');
    }
    function paintPicker() {
      picker.replaceChildren();
      if (!matches.length) {
        picker.appendChild(h('li', { class: 'empty-row', role: 'presentation' }, cannedCache && cannedCache.length ? 'Sin coincidencias' : 'No hay respuestas rápidas. Créalas en Ajustes.'));
        ta.removeAttribute('aria-activedescendant');
        return;
      }
      matches.forEach(function (c, i) {
        var li = h('li', { id: 'opt-' + tok + '-' + i, role: 'option', 'aria-selected': i === active ? 'true' : 'false' },
          h('span', { class: 'sc' }, '/' + c.shortcut), h('span', { class: 'tt' }, c.title));
        li.addEventListener('mousedown', function (ev) { ev.preventDefault(); choose(i); });
        picker.appendChild(li);
      });
      ta.setAttribute('aria-activedescendant', 'opt-' + tok + '-' + active);
      var cur = picker.children[active];
      if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
    }
    function updatePicker() {
      token = slashToken();
      if (!token || cannedCache === null) { closePicker(); return; }
      var q = token.q;
      matches = cannedCache.filter(function (c) { return !q || c.shortcut.indexOf(q) >= 0 || c.title.toLowerCase().indexOf(q) >= 0; })
        .sort(function (a, b) { return (a.shortcut.indexOf(q) === 0 ? 0 : 1) - (b.shortcut.indexOf(q) === 0 ? 0 : 1); }).slice(0, 8);
      active = 0;
      picker.hidden = false;
      paintPicker();
    }
    function choose(i) {
      var c = matches[i];
      if (!c || !token) { closePicker(); return; }
      var text = fillVars(c.body, lead && lead.name);
      var end = ta.selectionStart;
      ta.value = (ta.value.slice(0, token.start) + text + ta.value.slice(end)).slice(0, 2000);
      var caret = Math.min(ta.value.length, token.start + text.length);
      ta.setSelectionRange(caret, caret); grow();
      closePicker(); ta.focus();
    }
    ta.addEventListener('input', updatePicker);
    ta.addEventListener('click', updatePicker);
    ta.addEventListener('blur', function () { setTimeout(closePicker, 120); });
    ta.addEventListener('keydown', function (e) {
      if (!picker.hidden) {
        if (e.key === 'ArrowDown') { e.preventDefault(); if (matches.length) { active = (active + 1) % matches.length; paintPicker(); } return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); if (matches.length) { active = (active - 1 + matches.length) % matches.length; paintPicker(); } return; }
        if ((e.key === 'Enter' || e.key === 'Tab') && matches.length) { e.preventDefault(); choose(active); return; }
        if (e.key === 'Escape') { e.preventDefault(); closePicker(); return; }
      }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); }
    });

    // Contact, rating, journey ----------------------------------------------------------------------------
    function paintLead() {
      if (!lead) { leadBox.replaceChildren(); return; }
      leadBox.replaceChildren(h('h2', null, 'Datos de contacto'), h('div', { class: 'card' }, h('dl', { class: 'kv' },
        h('dt', null, 'Nombre'), h('dd', null, lead.name || '—'),
        h('dt', null, 'Email'), h('dd', null, lead.email ? h('a', { href: 'mailto:' + lead.email }, lead.email) : '—'),
        h('dt', null, 'Teléfono'), h('dd', null, lead.phone || '—'),
        h('dt', null, 'Canal'), h('dd', null, lead.channel || '—'),
        h('dt', null, 'Mensaje'), h('dd', null, lead.message || '—'))));
    }
    function paintCsat() {
      var c = conv.csat;
      if (c && c.score) {
        csatBox.replaceChildren(h('h2', null, 'Valoración del visitante'), h('div', { class: 'card' },
          h('div', { class: 'stars', role: 'img', 'aria-label': c.score + ' de 5 estrellas' }, stars(c.score), ' ', h('span', { class: 'muted small' }, c.score + '/5')),
          c.comment ? h('div', { class: 'csat-comment' }, c.comment) : null,
          c.at ? h('div', { class: 'small muted' }, fmtDate(c.at)) : null));
      } else if (c && c.requested) {
        csatBox.replaceChildren(h('h2', null, 'Valoración del visitante'), h('div', { class: 'muted small' }, 'Se pidió una valoración; el visitante aún no ha respondido.'));
      } else csatBox.replaceChildren();
    }
    function paintJourney(views) {
      journeyBox.replaceChildren(h('h2', null, 'Recorrido después de usar el chat'),
        views.length
          ? h('div', { class: 'card' }, h('ul', { class: 'journey' }, views.map(function (v) {
              return h('li', null, h('span', { class: 'when' }, fmtDate(v.createdAt)), h('span', { class: 'p' }, link(v.url), v.title ? h('div', { class: 'muted small' }, v.title) : null));
            })))
          : h('div', { class: 'muted small' }, 'No visitó otras páginas después de escribir.'));
    }
    function paintAll(r) {
      conv = r.conversation; lead = r.lead; votes = r.votes;
      paintHead(); paintCsat(); paintLead(); paintNotes(r.notes); paintJourney(r.pageViews);
    }

    // Poll ------------------------------------------------------------------------------------------------------
    var busy = false;
    function refresh() {
      if (busy || tok !== navToken) return Promise.resolve();
      busy = true;
      return api(P + '/conversations/' + encodeURIComponent(id) + qs({ after: Math.max(0, lastAt - 1500) })).then(function (r) {
        if (tok !== navToken) return;
        var stick = nearBottom();
        var before = msgs.childElementCount;
        r.messages.forEach(addMessage);
        paintAll(r);
        if (r.tags.join(',') !== currentTags) paintTags(r.tags);
        currentTags = r.tags.join(',');
        if (stick && msgs.childElementCount !== before) composer.scrollIntoView({ block: 'end' });
      }).catch(function (e) { onError(e); }).then(function () { busy = false; });
    }
    var currentTags = first.tags.join(',');

    // Initial paint ---------------------------------------------------------------------------------------------
    first.messages.forEach(addMessage);
    paintHead(); paintTags(first.tags); paintCsat(); paintLead(); paintNotes(first.notes); paintJourney(first.pageViews);
    root.appendChild(title); root.appendChild(meta); root.appendChild(controls); root.appendChild(tagBox);
    hint.hidden = !!conv.legacy;
    root.appendChild(msgs); root.appendChild(hint); root.appendChild(composer); root.appendChild(csatBox); root.appendChild(leadBox);
    root.appendChild(h('h2', null, 'Notas internas'));
    root.appendChild(h('div', { class: 'card notes' }, notesList, noteInput,
      h('div', { class: 'row mt' }, h('button', { class: 'btn ghost sm', type: 'button', onclick: addNote }, 'Añadir nota')), noteErr));
    root.appendChild(journeyBox);
    return {
      root: root,
      refresh: refresh,
      afterMount: function () {
        loadCanned().catch(function () { cannedCache = []; });
        loadTagSuggestions();
        if (first.messages.length) composer.scrollIntoView({ block: 'end' });
      }
    };
  }

  // Live: visitors online now --------------------------------------------------------------------------------
  function fmtDur(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    if (s < 60) return s + ' s';
    var m = Math.floor(s / 60);
    if (m < 60) return m + ' min';
    return Math.floor(m / 60) + ' h ' + (m % 60) + ' min';
  }
  var SEND_ERR = {
    410: 'El visitante ya se fue.',
    404: 'El visitante ya no está en línea.',
    409: 'Ya hay demasiados mensajes pendientes para este visitante.',
    429: 'Se alcanzó el límite de mensajes por hora.',
    400: 'Escribe un mensaje (máximo 600 caracteres).'
  };
  function visitorRow(id) {
    var placeEl = h('span', { class: 'vplace' });
    var badges = h('span', { class: 'row' });
    var pageEl = h('div', { class: 'vpage' });
    var metaEl = h('div', { class: 'vmeta' });
    var tagsEl = h('div', { class: 'vtags' });
    var composerBox = h('div', { class: 'vcomposer', hidden: true });
    var ta = h('textarea', { class: 'inp', rows: '3', maxlength: '600', placeholder: 'Escribe el primer mensaje…', 'aria-label': 'Mensaje para el visitante' });
    var status = h('div', { class: 'small muted', role: 'status' });
    var sendBtn = h('button', { class: 'btn sm', type: 'button' }, 'Enviar');
    var cancelBtn = h('button', { class: 'btn ghost sm', type: 'button' }, 'Cancelar');
    composerBox.appendChild(h('div', { class: 'small muted' }, 'El visitante lo verá junto a la burbuja del chat. Solo se crea una conversación si lo abre.'));
    composerBox.appendChild(ta);
    composerBox.appendChild(h('div', { class: 'row' }, sendBtn, cancelBtn));
    composerBox.appendChild(status);
    var openBtn = h('button', { class: 'btn ghost sm', type: 'button', 'aria-expanded': 'false' }, 'Enviar mensaje');
    function setOpen(on) {
      composerBox.hidden = !on;
      openBtn.setAttribute('aria-expanded', on ? 'true' : 'false');
      if (on) ta.focus();
    }
    openBtn.addEventListener('click', function () { setOpen(composerBox.hidden); });
    cancelBtn.addEventListener('click', function () { setOpen(false); });
    sendBtn.addEventListener('click', function () {
      var text = ta.value.trim();
      if (!text) { status.textContent = SEND_ERR[400]; return; }
      sendBtn.disabled = true; status.textContent = '';
      api(P + '/presence/' + encodeURIComponent(id) + '/message', { method: 'POST', body: { text: text } }).then(function () {
        ta.value = ''; setOpen(false);
        status.textContent = '';
        sentNote.textContent = 'Mensaje enviado: le aparecerá en unos 30 s.';
      }).catch(function (e) {
        if (onError(e)) return;
        status.textContent = SEND_ERR[e.status] || 'No se pudo enviar. Inténtalo de nuevo.';
      }).then(function () { sendBtn.disabled = false; });
    });
    var sentNote = h('div', { class: 'small muted', role: 'status' });
    var node = h('div', { class: 'visitor' }, h('div', { class: 'vhead' }, placeEl, badges), pageEl, metaEl, tagsEl, sentNote, composerBox);
    return {
      node: node,
      update: function (v, now) {
        placeEl.textContent = place(v) || 'Ubicación desconocida';
        var bs = [];
        if (v.device) bs.push(badge(DEVICES[v.device] || v.device));
        var sw = [v.os, v.browser].filter(function (x) { return x && x !== 'Otro'; }).join(' · ');
        if (sw) bs.push(badge(sw, 'outline'));
        if (v.lang) bs.push(badge(String(v.lang).toUpperCase(), 'outline'));
        badges.replaceChildren.apply(badges, bs);
        pageEl.replaceChildren.apply(pageEl, v.title ? [h('b', null, v.title), ' · ', pathOf(v.url)] : [pathOf(v.url)]);
        metaEl.replaceChildren(
          h('span', null, 'En la página desde hace ' + fmtDur(now - v.firstSeen)),
          h('span', null, 'Origen: ' + (v.referrerHost || 'directo')));
        var t = [];
        if (v.sessionId && /^[A-Za-z0-9_-]{8,64}$/.test(v.sessionId) && v.convMode) t.push(h('a', { class: 'badge accent', href: '#/c/' + encodeURIComponent(v.sessionId) }, 'Ver conversación'));
        if (v.pending) t.push(badge('Mensaje pendiente de entrega'));
        t.push(openBtn);
        tagsEl.replaceChildren.apply(tagsEl, t);
      }
    };
  }
  function viewLive() {
    var tok = ++navToken;
    var rows = {};
    var list = h('div', null, loading());
    var count = h('p', { class: 'small', 'aria-live': 'polite' });
    shell('live', h('div', null, h('h1', null, 'En línea'),
      h('p', { class: 'muted small' }, 'Visitantes activos en los últimos 90 segundos; se actualiza solo cada 10 s. Solo se ve el país y la ciudad aproximados, el dispositivo, la página y de dónde llegó; no se guarda nada en su navegador (el id vive en la memoria de la pestaña: en sitios de una sola página sigue entre secciones y al cerrar o recargar se genera otro) y la fila se borra como máximo unos 30 minutos después de la última señal. El navegador deja de avisar tras 30 minutos sin interacción. Con «Global Privacy Control» o «no rastrear» no se envía presencia, salvo que ya haya una conversación abierta.'),
      count, list));
    var first = true;
    function paint(r) {
      var items = r.items || [];
      if (first) { list.replaceChildren(); first = false; }
      count.textContent = items.length === 1 ? '1 visitante en línea' : items.length + ' visitantes en línea';
      var seen = {};
      items.forEach(function (v) { seen[v.id] = true; });
      Object.keys(rows).forEach(function (k) { if (!seen[k]) { rows[k].node.remove(); delete rows[k]; } });
      var ref = list.firstChild;
      items.forEach(function (v) {
        var row = rows[v.id] || (rows[v.id] = visitorRow(v.id));
        row.update(v, r.now || Date.now());
        // Keep nodes in place when the order did not change, so an open composer keeps its focus.
        if (row.node === ref) ref = ref.nextSibling; else list.insertBefore(row.node, ref);
      });
      var emptyEl = list.querySelector('.empty');
      if (!items.length && !emptyEl) list.appendChild(h('div', { class: 'empty' }, 'Nadie en línea ahora mismo.'));
      else if (items.length && emptyEl) emptyEl.remove();
    }
    function load() {
      return api(P + '/presence').then(function (r) { if (tok === navToken) paint(r); })
        .catch(function (e) { if (tok === navToken && !onError(e) && first) list.replaceChildren(failure()); });
    }
    load();
    startPolling(load, 10000);
  }

  // Settings: canned replies -----------------------------------------------------------------------------------------
  function viewSettings() {
    var tok = ++navToken;
    var list = h('div', null, loading());
    var editing = null;
    var sc = h('input', { class: 'inp', type: 'text', maxlength: '25', placeholder: 'atajo', 'aria-label': 'Atajo (sin la barra)', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false' });
    var ti = h('input', { class: 'inp', type: 'text', maxlength: '80', placeholder: 'Título', 'aria-label': 'Título', autocomplete: 'off' });
    var bo = h('textarea', { class: 'inp', rows: '5', maxlength: '2000', placeholder: 'Texto de la respuesta. Usa {nombre} para el nombre del contacto.', 'aria-label': 'Texto de la respuesta' });
    var err = h('div', { class: 'err', role: 'alert', hidden: true });
    var saveBtn = h('button', { class: 'btn', type: 'button', onclick: save }, 'Guardar');
    var cancelBtn = h('button', { class: 'btn ghost', type: 'button', hidden: true, onclick: reset }, 'Cancelar edición');
    var formTitle = h('h2', null, 'Nueva respuesta rápida');
    function reset() { editing = null; sc.value = ''; ti.value = ''; bo.value = ''; err.hidden = true; cancelBtn.hidden = true; formTitle.textContent = 'Nueva respuesta rápida'; }
    function save() {
      err.hidden = true; saveBtn.disabled = true;
      var payload = { shortcut: sc.value.trim().replace(/^\//, ''), title: ti.value.trim(), body: bo.value.trim() };
      api(P + '/canned' + (editing ? '/' + encodeURIComponent(editing) : ''), { method: 'POST', body: payload }).then(function () {
        saveBtn.disabled = false; reset(); return refresh();
      }).catch(function (e) {
        saveBtn.disabled = false;
        if (onError(e)) return;
        err.hidden = false;
        err.textContent = e.message === 'shortcut_taken' ? 'Ese atajo ya existe.'
          : e.message === 'invalid_shortcut' ? 'El atajo admite minúsculas, números y guiones (máx. 24).'
          : e.message === 'too_many_canned' ? 'Has llegado al máximo de respuestas rápidas.'
          : 'Revisa el atajo, el título y el texto.';
      });
    }
    function refresh() {
      return loadCanned(true).then(function (items) {
        if (tok !== navToken) return;
        list.replaceChildren();
        if (!items.length) list.appendChild(h('div', { class: 'empty' }, 'Aún no hay respuestas rápidas.'));
        items.forEach(function (c) {
          var del = h('button', { class: 'btn ghost sm', type: 'button' }, 'Eliminar');
          var armed = false;
          del.addEventListener('click', function () {
            if (!armed) { armed = true; del.textContent = '¿Seguro?'; setTimeout(function () { armed = false; del.textContent = 'Eliminar'; }, 3000); return; }
            del.disabled = true;
            api(P + '/canned/' + encodeURIComponent(c.id), { method: 'DELETE' }).then(function () { if (editing === c.id) reset(); return refresh(); }).catch(function (e) { del.disabled = false; onError(e); });
          });
          list.appendChild(h('div', { class: 'item' },
            h('div', { class: 'head' }, h('span', { class: 't' }, c.title), h('code', { class: 'sc' }, '/' + c.shortcut)),
            h('div', { class: 'cbody clamp' }, c.body),
            h('div', { class: 'tags' },
              h('button', { class: 'btn ghost sm', type: 'button', onclick: function () {
                editing = c.id; sc.value = c.shortcut; ti.value = c.title; bo.value = c.body; err.hidden = true; cancelBtn.hidden = false; formTitle.textContent = 'Editar /' + c.shortcut;
                sc.focus(); window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
              } }, 'Editar'), del)));
        });
      }).catch(function (e) { if (tok === navToken && !onError(e)) list.replaceChildren(failure()); });
    }
    shell('settings', h('div', null, h('h1', null, 'Ajustes'),
      h('h2', null, 'Respuestas rápidas'),
      h('p', { class: 'muted small' }, 'En el compositor, escribe «/» para buscarlas e insertarlas. La variable {nombre} se sustituye por el nombre del contacto si lo dejó; si no, se elimina.'),
      list, formTitle,
      h('div', { class: 'card form' }, h('label', { class: 'small muted' }, 'Atajo (minúsculas, números y guiones)'), h('div', { class: 'scwrap' }, h('span', { class: 'slash', 'aria-hidden': 'true' }, '/'), sc),
        h('label', { class: 'small muted' }, 'Título'), ti, h('label', { class: 'small muted' }, 'Texto'), bo,
        h('div', { class: 'row' }, saveBtn, cancelBtn), err),
      rulesSection()));
    refresh();
  }

  // Settings: proactive rules -------------------------------------------------------------------------------
  var RULE_ERR = {
    invalid_name: 'Pon un nombre (máx. 80 caracteres).',
    invalid_pattern: 'Patrón no válido. Usa dominio/ruta, por ejemplo yammbo.com/pos o */precios.',
    invalid_delay: 'La espera debe ser un número entero entre 0 y 300 segundos.',
    invalid_message: 'Escribe el mensaje al menos en un idioma (máx. 240 caracteres).',
    too_many_triggers: 'Ya hay 50 reglas, el máximo. Elimina alguna.'
  };
  function rulesSection() {
    var box = h('div', null, loading());
    var editing = null;
    var nm = h('input', { class: 'inp', type: 'text', maxlength: '80', placeholder: 'Nombre interno (p. ej. Precios de POS)', 'aria-label': 'Nombre de la regla', autocomplete: 'off' });
    var pt = h('input', { class: 'inp', type: 'text', maxlength: '120', placeholder: 'yammbo.com/pos', 'aria-label': 'Patrón de página', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false' });
    var dl = h('input', { class: 'inp', type: 'number', min: '0', max: '300', step: '1', value: '10', inputmode: 'numeric', 'aria-label': 'Segundos de espera' });
    var es = h('textarea', { class: 'inp', rows: '3', maxlength: '240', placeholder: 'Mensaje en español', 'aria-label': 'Mensaje en español' });
    var en = h('textarea', { class: 'inp', rows: '3', maxlength: '240', placeholder: 'Message in English', 'aria-label': 'Message in English' });
    var onChk = h('input', { type: 'checkbox', checked: true, id: 'rule-on' });
    var err = h('div', { class: 'err', role: 'alert', hidden: true });
    var formTitle = h('h3', { class: 'small formtitle' }, 'Nueva regla');
    var saveBtn = h('button', { class: 'btn', type: 'button' }, 'Guardar regla');
    var cancelBtn = h('button', { class: 'btn ghost', type: 'button', hidden: true }, 'Cancelar edición');
    // Preview: the same card the widget shows (text only, via textContent).
    var pvLang = 'es';
    var pvText = h('span');
    var pvEs = h('button', { class: 'chip on', type: 'button', 'aria-pressed': 'true' }, 'ES');
    var pvEn = h('button', { class: 'chip', type: 'button', 'aria-pressed': 'false' }, 'EN');
    function paintPv() {
      var txt = pvLang === 'en' ? (en.value || es.value) : (es.value || en.value);
      pvText.textContent = txt || 'Aquí verás el mensaje.';
      pvEs.className = 'chip' + (pvLang === 'es' ? ' on' : ''); pvEs.setAttribute('aria-pressed', pvLang === 'es' ? 'true' : 'false');
      pvEn.className = 'chip' + (pvLang === 'en' ? ' on' : ''); pvEn.setAttribute('aria-pressed', pvLang === 'en' ? 'true' : 'false');
    }
    pvEs.addEventListener('click', function () { pvLang = 'es'; paintPv(); });
    pvEn.addEventListener('click', function () { pvLang = 'en'; paintPv(); });
    es.addEventListener('input', paintPv); en.addEventListener('input', paintPv);
    function reset() {
      editing = null; nm.value = ''; pt.value = ''; dl.value = '10'; es.value = ''; en.value = ''; onChk.checked = true;
      err.hidden = true; cancelBtn.hidden = true; formTitle.textContent = 'Nueva regla'; paintPv();
    }
    cancelBtn.addEventListener('click', reset);
    function refresh() {
      return api(P + '/triggers').then(function (r) {
        var items = r.items || [];
        box.replaceChildren();
        if (!items.length) box.appendChild(h('div', { class: 'empty' }, 'Aún no hay reglas. El asistente no abre conversaciones por su cuenta.'));
        items.forEach(function (t) {
          var rate = t.shown ? Math.round(t.opened * 1000 / t.shown) / 10 + ' %' : '—';
          var del = h('button', { class: 'btn ghost sm', type: 'button' }, 'Eliminar');
          var armed = false;
          del.addEventListener('click', function () {
            if (!armed) { armed = true; del.textContent = '¿Seguro?'; setTimeout(function () { armed = false; del.textContent = 'Eliminar'; }, 3000); return; }
            del.disabled = true;
            api(P + '/triggers/' + encodeURIComponent(t.id), { method: 'DELETE' }).then(function () { if (editing === t.id) reset(); return refresh(); }).catch(function (e) { del.disabled = false; onError(e); });
          });
          var tog = h('button', { class: 'btn ghost sm', type: 'button', 'aria-pressed': t.enabled ? 'true' : 'false' }, t.enabled ? 'Desactivar' : 'Activar');
          tog.addEventListener('click', function () {
            tog.disabled = true;
            api(P + '/triggers/' + encodeURIComponent(t.id), { method: 'POST', body: { enabled: !t.enabled } }).then(refresh).catch(function (e) { tog.disabled = false; onError(e); });
          });
          box.appendChild(h('div', { class: 'rule' + (t.enabled ? '' : ' off') },
            h('div', { class: 'rhead' }, h('span', { class: 'rname' }, t.name), badge(t.enabled ? 'Activa' : 'Desactivada', t.enabled ? 'accent' : ''), badge(t.delay + ' s', 'outline')),
            h('div', { class: 'small' }, h('code', { class: 'sc' }, t.pattern)),
            t.es ? h('div', { class: 'rtxt' }, 'ES: ' + t.es) : null,
            t.en ? h('div', { class: 'rtxt' }, 'EN: ' + t.en) : null,
            h('div', { class: 'rstats' }, 'Mostrada ' + t.shown + ' · abierta ' + t.opened + ' · tasa de apertura ' + rate),
            h('div', { class: 'row' }, tog,
              h('button', { class: 'btn ghost sm', type: 'button', onclick: function () {
                editing = t.id; nm.value = t.name; pt.value = t.pattern; dl.value = String(t.delay); es.value = t.es; en.value = t.en; onChk.checked = t.enabled;
                err.hidden = true; cancelBtn.hidden = false; formTitle.textContent = 'Editar regla'; paintPv(); nm.focus();
              } }, 'Editar'), del)));
        });
      }).catch(function (e) { if (!onError(e)) box.replaceChildren(failure()); });
    }
    saveBtn.addEventListener('click', function () {
      saveBtn.disabled = true; err.hidden = true;
      var payload = { name: nm.value, pattern: pt.value, delay: dl.value === '' ? '' : Number(dl.value), es: es.value, en: en.value, enabled: onChk.checked };
      api(P + '/triggers' + (editing ? '/' + encodeURIComponent(editing) : ''), { method: 'POST', body: payload }).then(function () { reset(); return refresh(); })
        .catch(function (e) { if (onError(e)) return; err.hidden = false; err.textContent = RULE_ERR[e.message] || 'No se pudo guardar. Inténtalo de nuevo.'; })
        .then(function () { saveBtn.disabled = false; });
    });
    paintPv();
    refresh();
    return h('div', null,
      h('h2', null, 'Mensajes proactivos'),
      h('p', { class: 'muted small' }, 'Muestran un mensaje junto a la burbuja del chat tras unos segundos en ciertas páginas. Solo se muestra una vez por visita, no aparece si el chat está abierto o ya habla una persona, y si el visitante lo cierra no vuelve en esa pestaña. Al abrirlo, el mensaje aparece como mensaje del asistente.'),
      h('details', { class: 'help' }, h('summary', null, 'Cómo escribir el patrón de página'),
        h('p', null, 'Formato: ', h('code', null, 'dominio/ruta'), '. El dominio es ', h('code', null, 'yammbo.com'), ', cualquier subdominio de yammbo.com o ', h('code', null, '*'), ' (cualquiera). Si lo omites, vale cualquiera. La ruta coincide por segmentos completos y sin distinguir mayúsculas: ', h('code', null, '/pos'), ' coincide con /pos, /pos/ y /pos/precios, pero no con /posts. Sin ruta, vale toda la web. No hay otros comodines ni expresiones regulares.'),
        h('p', null, h('code', null, 'yammbo.com/pos'), ' la sección POS · ', h('code', null, '*/precios'), ' /precios en cualquier dominio de Yammbo · ', h('code', null, 'web.yammbo.com'), ' todo web.yammbo.com'),
        h('p', null, 'Si varias reglas coinciden, se usa la primera creada.')),
      box, formTitle,
      h('div', { class: 'card form' },
        h('label', { class: 'small muted' }, 'Nombre'), nm,
        h('div', { class: 'fgrid two' }, h('div', null, h('label', { class: 'small muted' }, 'Página (patrón)'), pt), h('div', null, h('label', { class: 'small muted' }, 'Mostrar tras (segundos, 0 a 300)'), dl)),
        h('div', { class: 'fgrid two' }, h('div', null, h('label', { class: 'small muted' }, 'Mensaje en español'), es), h('div', null, h('label', { class: 'small muted' }, 'Message in English'), en)),
        h('div', { class: 'row' }, onChk, h('label', { class: 'small', for: 'rule-on' }, 'Regla activa')),
        h('div', { class: 'pv', 'aria-label': 'Vista previa' }, h('div', { class: 'row' }, h('span', { class: 'small muted' }, 'Vista previa'), pvEs, pvEn),
          h('div', { class: 'pv-card' }, h('b', null, 'Yammbo'), pvText)),
        h('div', { class: 'row' }, saveBtn, cancelBtn), err));
  }

  // Leads --------------------------------------------------------------------------------------
  function viewLeads() {
    var tok = ++navToken;
    var list = h('div', null, loading());
    var more = h('div', { class: 'more' });
    shell('leads', h('div', null, h('h1', null, 'Contactos'), list, more));
    function load(before) {
      api(P + '/leads' + qs({ before: before })).then(function (r) {
        if (tok !== navToken) return;
        if (!before) list.replaceChildren();
        if (!before && !r.items.length) list.appendChild(h('div', { class: 'empty' }, 'Aún no hay contactos.'));
        r.items.forEach(function (l) { list.appendChild(leadItem(l)); });
        more.replaceChildren();
        if (r.next) more.appendChild(h('button', { class: 'btn ghost', onclick: function (ev) { ev.currentTarget.disabled = true; load(r.next); } }, 'Cargar más'));
      }).catch(function (e) { if (tok === navToken && !onError(e)) list.replaceChildren(failure()); });
    }
    load(null);
  }
  function leadItem(l) {
    var tags = [];
    if (l.channel) tags.push(badge('Prefiere ' + l.channel));
    if (l.notified) {
      ['telegram', 'whatsapp', 'email'].forEach(function (k) {
        if (Object.prototype.hasOwnProperty.call(l.notified, k)) tags.push(badge((l.notified[k] ? '✓ ' : '✗ ') + k, l.notified[k] ? '' : 'warn'));
      });
    }
    var phone = String(l.phone || '').replace(/[^0-9+]/g, '');
    return h('div', { class: 'item' },
      h('div', { class: 'head' }, h('span', { class: 't' }, l.name || '—'), h('span', { class: 'when' }, ago(l.createdAt))),
      h('div', null, l.email ? h('a', { href: 'mailto:' + l.email }, l.email) : '—', l.phone ? [' · ', phone ? h('a', { href: 'tel:' + phone }, l.phone) : l.phone] : null),
      l.message ? h('div', { class: 'clamp muted' }, l.message) : null,
      l.pageUrl ? h('div', { class: 'small muted' }, 'Página: ', link(l.pageUrl)) : null,
      h('div', { class: 'tags' }, tags, l.sessionId ? h('a', { class: 'badge accent', href: '#/c/' + encodeURIComponent(l.sessionId) }, 'Ver conversación') : null));
  }

  // Unanswered: list + Help Center gaps ------------------------------------------------------------------------
  var gapThreshold = 0.82;
  var THRESHOLDS = [[0.7, 'Amplia (0,70)'], [0.76, 'Media-amplia (0,76)'], [0.82, 'Normal (0,82)'], [0.88, 'Estricta (0,88)'], [0.92, 'Muy estricta (0,92)']];
  var WHY_LABEL = { down: 'Pulgar abajo', handoff: 'Pasó a persona', nokb: 'Sin artículos', person: 'Pidió una persona' };
  var DRAFT_WARN = {
    no_frontmatter: 'El borrador no empieza con frontmatter.',
    missing_title: 'Falta title.', missing_description: 'Falta description.', missing_category: 'Falta category.',
    invalid_order: 'order no es un número.'
  };
  function subTabs(active) {
    return h('div', { class: 'subtabs', role: 'tablist', 'aria-label': 'Vista' },
      h('a', { class: 'chip' + (active === 'list' ? ' on' : ''), href: '#/unanswered', role: 'tab', 'aria-selected': active === 'list' ? 'true' : 'false' }, 'Lista'),
      h('a', { class: 'chip' + (active === 'gaps' ? ' on' : ''), href: '#/unanswered/gaps', role: 'tab', 'aria-selected': active === 'gaps' ? 'true' : 'false' }, 'Huecos'));
  }
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      var t = h('textarea', { 'aria-hidden': 'true', class: 'vh' });
      t.value = text; document.body.appendChild(t); t.select();
      var ok = false; try { ok = document.execCommand('copy'); } catch (_) {}
      t.remove(); ok ? resolve() : reject(new Error('copy'));
    });
  }
  function draftViewer(d) {
    var copyBtn = h('button', { class: 'btn ghost sm', type: 'button' }, 'Copiar');
    copyBtn.addEventListener('click', function () {
      copyText(d.mdx).then(function () { copyBtn.textContent = 'Copiado'; }).catch(function () { copyBtn.textContent = 'No se pudo copiar'; })
        .then(function () { setTimeout(function () { copyBtn.textContent = 'Copiar'; }, 2000); });
    });
    var dl = h('button', { class: 'btn ghost sm', type: 'button' }, 'Descargar .mdx');
    dl.addEventListener('click', function () {
      var url = URL.createObjectURL(new Blob([d.mdx], { type: 'text/markdown;charset=utf-8' }));
      var a = h('a', { href: url, download: d.filename || 'borrador.mdx' });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    });
    var warns = (d.warnings || []).map(function (w) { return DRAFT_WARN[w] || w; });
    return h('div', { class: 'draft' },
      h('div', { class: 'dbar' }, h('strong', { class: 'small' }, d.filename || 'borrador.mdx'),
        d.todos ? badge(d.todos + (d.todos === 1 ? ' pendiente (TODO)' : ' pendientes (TODO)'), 'warn') : badge('Sin TODO', 'outline'),
        h('span', { class: 'spacer' }), copyBtn, dl),
      warns.length ? h('div', { class: 'err draft-warn', role: 'alert' }, warns.join(' ')) : null,
      h('div', { class: 'small muted draft-note' }, 'Borrador generado por IA: revisa los datos, resuelve los TODO y publícalo tú en help.yammbo.com. No se publica nada solo.'),
      h('pre', { tabindex: '0', 'aria-label': 'Borrador del artículo' }, d.mdx));
  }
  function gapCard(g) {
    var out = h('div');
    var btn = h('button', { class: 'btn sm', type: 'button' }, 'Proponer artículo');
    var msg = h('div', { class: 'err', role: 'alert', hidden: true });
    btn.addEventListener('click', function () {
      btn.disabled = true; msg.hidden = true; btn.textContent = 'Redactando…';
      api(P + '/gaps/draft', { method: 'POST', body: { questions: g.questions, product: g.product, lang: g.lang } }).then(function (d) {
        out.replaceChildren(draftViewer(d));
      }).catch(function (e) {
        if (onError(e)) return;
        msg.hidden = false;
        msg.textContent = e.status === 429 ? 'Se alcanzó el límite de 20 borradores por hora.' : 'No se pudo generar el borrador. Inténtalo de nuevo.';
      }).then(function () { btn.disabled = false; btn.textContent = 'Proponer artículo'; });
    });
    var tags = [badge(g.size + (g.size === 1 ? ' pregunta' : ' preguntas'), 'accent')];
    if (g.product) tags.push(badge(productName(g.product), 'outline'));
    tags.push(badge(String(g.lang).toUpperCase(), 'outline'));
    Object.keys(WHY_LABEL).forEach(function (k) { if (g.reasons && g.reasons[k]) tags.push(badge(WHY_LABEL[k] + ' · ' + g.reasons[k])); });
    return h('div', { class: 'card gap' },
      h('div', { class: 'ghead' }, tags),
      h('ul', null, (g.examples || []).map(function (q) { return h('li', null, q); })),
      h('div', { class: 'gkb' }, g.kb
        ? 'Artículo más cercano: ' + (g.kb.title || g.kb.slug) + ' (' + g.kb.slug + ') · similitud ' + Math.round(g.kb.score * 100) + ' %'
        : 'No hay ningún artículo cercano en la ayuda.'),
      h('div', { class: 'row mt' }, btn), msg, out);
  }
  function viewGaps() {
    var tok = ++navToken;
    var body = h('div', null, loading());
    var sel = h('select', { class: 'inp autow', 'aria-label': 'Similitud para agrupar' }, THRESHOLDS.map(function (t) { return h('option', { value: String(t[0]), selected: t[0] === gapThreshold }, t[1]); }));
    var recalc = h('button', { class: 'btn ghost sm', type: 'button' }, 'Recalcular');
    var note = h('span', { class: 'small muted', role: 'status' });
    sel.addEventListener('change', function () { gapThreshold = parseFloat(sel.value) || 0.82; load(false); });
    recalc.addEventListener('click', function () { load(true); });
    shell('unanswered', h('div', null, h('h1', null, 'Sin respuesta'), subTabs('gaps'),
      h('p', { class: 'muted small' }, 'Preguntas de los últimos 30 días con pulgar abajo, que pasaron a una persona, sin artículos relacionados o que pedían una persona, agrupadas por parecido. Las más repetidas son los huecos de la ayuda.'),
      h('div', { class: 'row' }, sel, recalc, note), body));
    function load(refresh) {
      recalc.disabled = true; body.replaceChildren(loading());
      api(P + '/gaps' + qs({ threshold: gapThreshold, refresh: refresh ? '1' : '' })).then(function (r) {
        if (tok !== navToken) return;
        note.textContent = 'Calculado ' + (ago(r.generatedAt) === 'ahora' ? 'ahora' : 'hace ' + ago(r.generatedAt)) + (r.total ? ' · ' + r.total + ' preguntas' : '');
        if (!r.groups.length) { body.replaceChildren(h('div', { class: 'empty' }, 'No hay preguntas sin resolver en los últimos 30 días.')); return; }
        var nodes = r.groups.map(gapCard);
        if (r.omitted) nodes.push(h('p', { class: 'small muted' }, r.omitted + ' grupos más pequeños no se muestran.'));
        body.replaceChildren.apply(body, nodes);
      }).catch(function (e) {
        if (tok !== navToken || onError(e)) return;
        body.replaceChildren(failure(e.status === 429 ? 'Se alcanzó el límite de cálculos por hora. Prueba más tarde.' : e.status === 502 ? 'El servicio de IA no está disponible ahora. Inténtalo en unos minutos.' : null));
      }).then(function () { recalc.disabled = false; });
    }
    load(false);
  }

  // Unanswered: list ------------------------------------------------------------------------------------
  function viewUnanswered() {
    var tok = ++navToken;
    var list = h('div', null, loading());
    var more = h('div', { class: 'more' });
    shell('unanswered', h('div', null, h('h1', null, 'Sin respuesta'), subTabs('list'),
      h('p', { class: 'muted small' }, 'Respuestas con pulgar abajo, que pasaron a una persona o sin artículos de ayuda relacionados.'), list, more));
    function load(before) {
      api(P + '/unanswered' + qs({ before: before })).then(function (r) {
        if (tok !== navToken) return;
        if (!before) list.replaceChildren();
        if (!before && !r.items.length) list.appendChild(h('div', { class: 'empty' }, 'Nada pendiente. 🎉'));
        r.items.forEach(function (m) {
          var tags = [];
          if (m.thumbsDown) tags.push(badge('👎 Pulgar abajo', 'warn'));
          if (m.handoff) tags.push(badge('Pasó a persona', 'warn'));
          if (m.noKb) tags.push(badge('Sin artículos de ayuda'));
          list.appendChild(h('a', { class: 'item', href: '#/c/' + encodeURIComponent(m.sessionId) },
            h('div', { class: 'head' }, h('span', { class: 't' }, m.question || '—'), h('span', { class: 'when' }, ago(m.createdAt))),
            h('div', { class: 'clamp muted' }, inlineMd(m.answer.replace(/\s+/g, ' '), true)),
            h('div', { class: 'tags' }, tags)));
        });
        more.replaceChildren();
        if (r.next) more.appendChild(h('button', { class: 'btn ghost', onclick: function (ev) { ev.currentTarget.disabled = true; load(r.next); } }, 'Cargar más'));
      }).catch(function (e) { if (tok === navToken && !onError(e)) list.replaceChildren(failure()); });
    }
    load(null);
  }

  // Push notifications ------------------------------------------------------------------------------
  var pushState = 'unknown'; // unsupported | denied | off | on
  function pushSupported() { return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; }
  function swReady() {
    return navigator.serviceWorker.register('/panel/sw.js', { scope: '/panel/' }).then(function () { return navigator.serviceWorker.ready; });
  }
  function b64urlToBytes(s) {
    var b = atob((s + '===='.slice((s.length + 3) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
    var out = new Uint8Array(b.length);
    for (var i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
    return out;
  }
  function bytesToB64url(buf) {
    var s = '', b = new Uint8Array(buf);
    for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function refreshBell() {
    if (!pushSupported()) pushState = 'unsupported';
    else if (Notification.permission === 'denied') pushState = 'denied';
    if (pushState === 'unknown' && pushSupported()) {
      swReady().then(function (reg) { return reg.pushManager.getSubscription(); }).then(function (sub) {
        pushState = sub && Notification.permission === 'granted' ? 'on' : 'off';
        paintBell();
      }).catch(function () { pushState = 'off'; paintBell(); });
    }
    paintBell();
  }
  function paintBell() {
    if (bellBtn) {
      var on = pushState === 'on';
      bellBtn.classList.toggle('on', on);
      bellBtn.title = on ? 'Notificaciones activas (toca para desactivar)' : 'Activar notificaciones';
      bellBtn.setAttribute('aria-label', bellBtn.title);
      bellBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    var b = document.getElementById('push-banner');
    if (b) b.hidden = pushState === 'on' || pushState === 'unknown';
    var btn = document.getElementById('push-banner-btn');
    if (btn) btn.disabled = pushState === 'unsupported' || pushState === 'denied';
    var txt = document.getElementById('push-banner-txt');
    if (txt) {
      txt.textContent = pushState === 'unsupported' ? 'Este navegador no admite notificaciones. En iPhone, instala el panel en la pantalla de inicio primero.'
        : pushState === 'denied' ? 'Las notificaciones están bloqueadas en este navegador. Actívalas desde los ajustes del sitio.'
        : 'Recibe un aviso en este dispositivo con cada conversación y contacto nuevo.';
    }
  }
  function pushBanner() {
    return h('div', { class: 'card banner', id: 'push-banner', hidden: true },
      h('p', { id: 'push-banner-txt' }, ''),
      h('button', { class: 'btn', id: 'push-banner-btn', onclick: enablePush }, 'Activar notificaciones'));
  }
  function enablePush() {
    if (!pushSupported()) return;
    Notification.requestPermission().then(function (perm) {
      if (perm !== 'granted') { refreshBell(); return; }
      return subscribeAndSync().then(function () { pushState = 'on'; paintBell(); });
    }).catch(function (e) { if (!onError(e)) { pushState = 'off'; paintBell(); } });
  }
  // Subscribes (or re-uses the subscription) and tells the server. If the server
  // key changed since the subscription was made, the old one is replaced.
  function subscribeAndSync() {
    return Promise.all([swReady(), api(P + '/push/key')]).then(function (res) {
      var reg = res[0], key = res[1].key;
      return reg.pushManager.getSubscription().then(function (sub) {
        if (sub && sub.options && sub.options.applicationServerKey && bytesToB64url(sub.options.applicationServerKey) !== key) {
          return sub.unsubscribe().then(function () { return null; });
        }
        return sub;
      }).then(function (sub) {
        return sub || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToBytes(key) });
      });
    }).then(function (sub) {
      var j = sub.toJSON();
      return api(P + '/push/subscribe', { method: 'POST', body: { endpoint: j.endpoint, keys: j.keys } });
    });
  }
  function disablePush() {
    return swReady().then(function (reg) { return reg.pushManager.getSubscription(); }).then(function (sub) {
      if (!sub) return;
      var endpoint = sub.endpoint;
      return sub.unsubscribe().then(function () { return api(P + '/push/unsubscribe', { method: 'POST', body: { endpoint: endpoint } }); });
    }).then(function () { pushState = 'off'; paintBell(); });
  }
  function togglePush() {
    if (pushState === 'on') disablePush().catch(function (e) { onError(e); });
    else if (pushState === 'off') enablePush();
    else paintBell();
  }

  // Router --------------------------------------------------------------------------------------------
  function route() {
    stopPolling();
    var hash = location.hash.replace(/^#/, '') || '/';
    var m;
    if (hash === '/' || hash === '') return viewHome();
    if (hash === '/c') return viewChats();
    if ((m = /^\/c\/([A-Za-z0-9_-]{8,64})$/.exec(hash))) return viewDetail(m[1]);
    if (hash === '/leads') return viewLeads();
    if (hash === '/unanswered') return viewUnanswered();
    if (hash === '/unanswered/gaps') return viewGaps();
    if (hash === '/live') return viewLive();
    if (hash === '/settings') return viewSettings();
    location.replace('#/');
  }
  window.addEventListener('hashchange', route);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/panel/sw.js', { scope: '/panel/' }).catch(function () {});
  // A granted subscription that the server lost (410 cleanup, key change) heals itself on open.
  window.addEventListener('load', function () {
    if (pushSupported() && Notification.permission === 'granted') subscribeAndSync().catch(function () {});
  });
  route();
})();
`;
