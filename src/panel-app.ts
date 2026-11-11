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
  var filters = { q: '', product: '', country: '' };
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
      h('span', { class: 'brand' }, 'Yammbo Chat'), nav, h('span', { class: 'spacer' }), bellBtn,
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
      body.replaceChildren(renderStats(s));
    }).catch(function (e) { if (tok === navToken && !onError(e)) body.replaceChildren(failure()); });
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
        kpi(t.thumbsUp, 'Pulgar arriba'), kpi(t.thumbsDown, 'Pulgar abajo'), kpi(t.handoffs, 'Pasos a persona')),
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

  // Conversations -------------------------------------------------------------------------
  function viewChats() {
    ++navToken;
    var list = h('div', null, loading());
    var more = h('div', { class: 'more' });
    var q = h('input', { type: 'search', placeholder: 'Buscar en mensajes…', 'aria-label': 'Buscar', value: filters.q });
    var prod = h('select', { 'aria-label': 'Producto' }, h('option', { value: '' }, 'Todos los productos'),
      Object.keys(PRODUCTS).map(function (k) { return h('option', { value: k, selected: filters.product === k }, PRODUCTS[k]); }));
    var ctry = h('select', { 'aria-label': 'País' }, h('option', { value: '' }, 'Todos los países'));
    var timer = null;
    function apply() { filters.q = q.value.trim(); filters.product = prod.value; filters.country = ctry.value; load(null); }
    q.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(apply, 300); });
    prod.addEventListener('change', apply);
    ctry.addEventListener('change', apply);
    shell('chats', h('div', null, h('h1', null, 'Conversaciones'), h('div', { class: 'filters' }, q, prod, ctry), list, more));
    var countriesFilled = false;
    function load(before) {
      var mine = ++navToken;
      if (!before) list.replaceChildren(loading());
      more.replaceChildren();
      api(P + '/conversations' + qs({ before: before, q: filters.q, product: filters.product, country: filters.country })).then(function (r) {
        if (mine !== navToken) return;
        if (r.countries && !countriesFilled) {
          countriesFilled = true;
          r.countries.forEach(function (c) { ctry.appendChild(h('option', { value: c.key, selected: filters.country === c.key }, (flag(c.key) + ' ' + countryName(c.key)).trim())); });
        }
        if (!before) list.replaceChildren();
        if (!before && !r.items.length) list.appendChild(h('div', { class: 'empty' }, 'No hay conversaciones con esos filtros.'));
        r.items.forEach(function (c) { list.appendChild(convItem(c)); });
        if (r.next) more.appendChild(h('button', { class: 'btn ghost', onclick: function (ev) { ev.currentTarget.disabled = true; load(r.next); } }, 'Cargar más'));
      }).catch(function (e) { if (mine === navToken && !onError(e)) list.replaceChildren(failure()); });
    }
    load(null);
  }
  function convItem(c) {
    var tags = [];
    tags.push(badge(c.msgCount + ' msj'));
    if (c.hasLead) tags.push(badge('Contacto', 'accent'));
    if (c.up) tags.push(badge('👍 ' + c.up));
    if (c.down) tags.push(badge('👎 ' + c.down, 'warn'));
    var cl = clientLabel(c);
    if (cl) tags.push(badge(cl));
    return h('a', { class: 'item', href: '#/c/' + encodeURIComponent(c.id) },
      h('div', { class: 'head' }, h('span', { class: 't' }, [place(c) || 'Ubicación desconocida', ' · ', productName(c.product)].join('')), h('span', { class: 'when' }, ago(c.updatedAt))),
      h('div', { class: 'clamp' }, c.firstQuestion || '—'),
      h('div', { class: 'tags' }, tags));
  }

  // Detail ------------------------------------------------------------------------------------
  function viewDetail(id) {
    var tok = ++navToken;
    var body = h('div', null, loading());
    shell('chats', h('div', null, h('a', { class: 'back', href: '#/c' }, icon(IC.back), 'Conversaciones'), body));
    api(P + '/conversations/' + encodeURIComponent(id)).then(function (r) {
      if (tok !== navToken) return;
      body.replaceChildren(renderDetail(r));
    }).catch(function (e) {
      if (tok !== navToken || onError(e)) return;
      body.replaceChildren(failure(e.status === 404 ? 'Esta conversación no existe o ya se borró (90 días).' : null));
    });
  }
  function renderDetail(r) {
    var c = r.conversation;
    var meta = [badge(productName(c.product), 'accent')];
    if (place(c)) meta.push(badge(place(c)));
    if (clientLabel(c)) meta.push(badge(clientLabel(c)));
    if (c.lang) meta.push(badge(c.lang.toUpperCase()));
    meta.push(badge('Inicio ' + fmtDate(c.createdAt)));
    if (r.votes.up) meta.push(badge('👍 ' + r.votes.up));
    if (r.votes.down) meta.push(badge('👎 ' + r.votes.down, 'warn'));
    var msgs = h('div', { class: 'msgs' });
    r.messages.forEach(function (m) {
      var user = m.role === 'user';
      msgs.appendChild(h('div', { class: 'b ' + (user ? 'u' : 'a') }, user ? m.content : md(m.content)));
      var sub = [];
      sub.push(h('span', null, fmtDate(m.createdAt)));
      if (user && m.pageUrl) sub.push(h('span', null, 'desde ', link(m.pageUrl)));
      if (!user) {
        if (m.provider) sub.push(h('span', null, m.provider));
        if (m.ragHits !== null && m.ragHits !== undefined) sub.push(h('span', null, 'KB: ' + m.ragHits));
        if (m.handoff) sub.push(badge('Pasó a persona', 'warn'));
        if (m.rating === 1) sub.push(h('span', null, '👍'));
        if (m.rating === -1) sub.push(h('span', null, '👎'));
      }
      msgs.appendChild(h('div', { class: 'sub' + (user ? ' r' : '') }, sub));
    });
    var out = h('div', null, h('h1', null, place(c) || 'Conversación'), h('div', { class: 'meta' }, meta), msgs);
    if (r.lead) {
      var l = r.lead;
      out.appendChild(h('h2', null, 'Datos de contacto'));
      out.appendChild(h('div', { class: 'card' }, h('dl', { class: 'kv' },
        h('dt', null, 'Nombre'), h('dd', null, l.name || '—'),
        h('dt', null, 'Email'), h('dd', null, l.email ? h('a', { href: 'mailto:' + l.email }, l.email) : '—'),
        h('dt', null, 'Teléfono'), h('dd', null, l.phone || '—'),
        h('dt', null, 'Canal'), h('dd', null, l.channel || '—'),
        h('dt', null, 'Mensaje'), h('dd', null, l.message || '—'))));
    }
    out.appendChild(h('h2', null, 'Recorrido después de usar el chat'));
    out.appendChild(r.pageViews.length
      ? h('div', { class: 'card' }, h('ul', { class: 'journey' }, r.pageViews.map(function (v) {
          return h('li', null, h('span', { class: 'when' }, fmtDate(v.createdAt)), h('span', { class: 'p' }, link(v.url), v.title ? h('div', { class: 'muted small' }, v.title) : null));
        })))
      : h('div', { class: 'muted small' }, 'No visitó otras páginas después de escribir.'));
    return out;
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

  // Unanswered ------------------------------------------------------------------------------------
  function viewUnanswered() {
    var tok = ++navToken;
    var list = h('div', null, loading());
    var more = h('div', { class: 'more' });
    shell('unanswered', h('div', null, h('h1', null, 'Sin respuesta'),
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
    var hash = location.hash.replace(/^#/, '') || '/';
    var m;
    if (hash === '/' || hash === '') return viewHome();
    if (hash === '/c') return viewChats();
    if ((m = /^\/c\/([A-Za-z0-9_-]{8,64})$/.exec(hash))) return viewDetail(m[1]);
    if (hash === '/leads') return viewLeads();
    if (hash === '/unanswered') return viewUnanswered();
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
