// panel-ui.ts
// Static assets of the team panel (/panel): HTML shell, CSS, web manifest,
// service worker and SVG icon. The JS app lives in panel-app.ts.
//
// Everything is served as separate files so the CSP can forbid inline code.
// The sources use String.raw: backslashes are literal, and the text must not
// contain backticks or the two-character sequence dollar-brace.

export const PANEL_HTML = `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Yammbo Chat · Panel</title>
<meta name="robots" content="noindex,nofollow">
<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#000000" media="(prefers-color-scheme: dark)">
<link rel="manifest" href="/panel/manifest.webmanifest">
<link rel="icon" href="/panel/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/panel/icon-192.png">
<link rel="stylesheet" href="/panel/app.css">
</head>
<body><div id="app"></div><script src="/panel/app.js" defer></script></body></html>`;

export const PANEL_CSS = String.raw`
@font-face{font-family:"YC Geist";font-style:normal;font-weight:300 800;font-display:swap;src:url(/fonts/geist-latin.woff2) format("woff2")}
:root{color-scheme:light dark;--bg:#fff;--fg:#000;--muted:#525252;--soft:#f6f6f6;--soft2:#ededed;--line:#e5e5e5;--line2:#c7c7c7;--accent:#1160d8;--accent-hover:#0d52bd;--accent-text:#1160d8;--navh:58px}
@media (prefers-color-scheme:dark){:root{--bg:#000;--fg:#fff;--muted:#a3a3a3;--soft:#0a0a0a;--soft2:#171717;--line:#262626;--line2:#404040;--accent-text:#6da4ff}}
*{box-sizing:border-box}
[hidden]{display:none!important}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 "YC Geist",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
button,input,select,textarea{font:inherit;color:inherit}
a{color:var(--accent-text)}
:focus-visible{outline:2px solid var(--accent-text);outline-offset:2px}
#app{min-height:100vh;min-height:100dvh;display:flex;flex-direction:column}

.top{position:sticky;top:0;z-index:20;display:flex;align-items:center;gap:6px;padding:max(10px,env(safe-area-inset-top)) max(14px,env(safe-area-inset-right)) 10px max(14px,env(safe-area-inset-left));background:var(--bg);border-bottom:1px solid var(--line)}
.brand{font-weight:650;letter-spacing:-.01em;font-size:16px;flex:1;white-space:nowrap}
.iconbtn{display:inline-flex;align-items:center;gap:6px;background:transparent;border:1px solid transparent;border-radius:10px;padding:7px 9px;cursor:pointer;color:var(--muted)}
.iconbtn:hover{background:var(--soft2);color:var(--fg)}
.iconbtn.on{color:var(--accent-text)}
.iconbtn svg{width:18px;height:18px}
.iconbtn .lbl{font-size:13px;font-weight:550}
a.iconbtn{text-decoration:none}
.iconbtn.current{background:var(--soft2);color:var(--fg)}
.nav a span{white-space:nowrap}

.nav{position:fixed;left:0;right:0;bottom:0;z-index:20;display:flex;background:var(--bg);border-top:1px solid var(--line);padding-bottom:env(safe-area-inset-bottom)}
.nav a{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;padding:9px 0 7px;font-size:11px;font-weight:550;color:var(--muted);text-decoration:none}
.nav a svg{width:20px;height:20px}
.nav a.on{color:var(--accent-text)}

main{flex:1;width:100%;max-width:960px;margin:0 auto;padding:16px max(16px,env(safe-area-inset-right)) calc(88px + env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left))}
h1{font-size:22px;line-height:1.2;letter-spacing:-.02em;margin:4px 0 14px;font-weight:650}
h2{font-size:12px;font-weight:600;color:var(--muted);margin:22px 0 8px;letter-spacing:.04em;text-transform:uppercase}
.muted{color:var(--muted)}
.small{font-size:13px}
.row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.spacer{flex:1}
.top .spacer{display:none}

.card{border:1px solid var(--line);border-radius:12px;padding:14px;background:var(--bg)}
.banner{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px;background:var(--soft)}
.banner p{margin:0;flex:1;min-width:200px}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;background:var(--accent);color:#fff;border:0;border-radius:10px;padding:10px 14px;font-weight:600;cursor:pointer;text-decoration:none}
.btn:hover:not(:disabled){background:var(--accent-hover)}
.btn:disabled{background:var(--soft2);color:var(--muted);cursor:not-allowed}
.btn.ghost{background:transparent;color:var(--fg);border:1px solid var(--line2)}
.btn.ghost:hover:not(:disabled){background:var(--soft2)}
.chips{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}
.chip{background:transparent;border:1px solid var(--line);border-radius:999px;padding:6px 12px;font-size:13px;font-weight:550;cursor:pointer;color:var(--muted)}
.chip.on{background:var(--fg);color:var(--bg);border-color:var(--fg)}
.badge{display:inline-flex;align-items:center;gap:4px;font-size:11.5px;font-weight:600;padding:2px 8px;border-radius:999px;background:var(--soft2);color:var(--muted);white-space:nowrap}
.badge.accent{background:var(--accent);color:#fff}
.badge.warn{background:var(--fg);color:var(--bg)}
.badge.outline{background:transparent;border:1px solid var(--line2)}

.kpis{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}
.kpi{border:1px solid var(--line);border-radius:12px;padding:12px 14px}
.kpi b{display:block;font-size:26px;line-height:1.1;letter-spacing:-.02em;font-weight:650}
.kpi span{font-size:12.5px;color:var(--muted)}
.grid2{display:grid;grid-template-columns:1fr;gap:10px}
@media (min-width:600px){.kpis{grid-template-columns:repeat(3,1fr)}.grid2{grid-template-columns:1fr 1fr}}
@media (min-width:900px){.kpis{grid-template-columns:repeat(4,1fr)}}

.vbars{display:flex;align-items:flex-end;gap:2px;height:96px;margin-top:6px}
.vbars i{flex:1;min-width:1px;background:var(--accent);border-radius:2px 2px 0 0;min-height:2px}
.vbars i.zero{background:var(--soft2)}
.axis{display:flex;justify-content:space-between;font-size:11px;color:var(--muted);margin-top:4px}
.hbar{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr) auto;align-items:center;gap:10px;padding:4px 0;font-size:13.5px}
.hbar .name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hbar .track{height:8px;background:var(--soft2);border-radius:4px;overflow:hidden}
.hbar .track i{display:block;height:100%;background:var(--accent);border-radius:4px}
.hbar .n{font-variant-numeric:tabular-nums;color:var(--muted);min-width:2ch;text-align:right}

.filters{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}
.filters input,.filters select,.field input{background:var(--soft);border:1px solid var(--line);border-radius:10px;padding:9px 11px;min-width:0}
.filters input{flex:1 1 100%}
.filters select{flex:1 1 140px;max-width:100%}
.filters input:focus,.filters select:focus,.field input:focus{border-color:var(--accent-text);outline:none}
.item{display:block;border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin-bottom:8px;color:inherit;text-decoration:none}
a.item:hover{background:var(--soft)}
.item .head{display:flex;align-items:center;gap:8px;margin-bottom:4px}
.item .head .t{flex:1;font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.item .when{font-size:12px;color:var(--muted);white-space:nowrap}
.clamp{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
.item .tags{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
.item.unread{border-left:3px solid var(--accent-text)}
.item.unread .t{font-weight:700}
.banner.alert{background:var(--fg);color:var(--bg);border-color:var(--fg)}
.banner.alert .btn{background:var(--bg);color:var(--fg)}
.more{display:flex;justify-content:center;margin:14px 0}
.empty{padding:36px 12px;text-align:center;color:var(--muted)}

.back{display:inline-flex;align-items:center;gap:4px;color:var(--muted);text-decoration:none;font-size:13.5px;margin-bottom:6px}
.meta{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px}
.msgs{display:flex;flex-direction:column;gap:10px}
.b{max-width:88%;padding:9px 12px;border-radius:14px;white-space:pre-wrap;overflow-wrap:anywhere;font-size:14.5px}
.b.u{align-self:flex-end;background:var(--fg);color:var(--bg);border-bottom-right-radius:4px}
.b.a{align-self:flex-start;background:var(--soft);border:1px solid var(--line);border-bottom-left-radius:4px;white-space:normal}
.b.t{align-self:flex-start;background:var(--bg);border:1.5px solid var(--fg);border-bottom-left-radius:4px}
.sysline{align-self:center;max-width:92%;text-align:center;font-size:12px;color:var(--muted);padding:2px 8px}
.md>:first-child{margin-top:0}.md>:last-child{margin-bottom:0}
.md p,.md ul,.md ol{margin:0 0 .6em}
.md ul,.md ol{padding-left:1.3em}
.md code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.9em;background:var(--soft2);border-radius:4px;padding:1px 5px}
.md a{color:var(--accent-text);text-decoration:underline;text-underline-offset:2px}
.sub{font-size:11.5px;color:var(--muted);margin-top:3px;display:flex;gap:8px;flex-wrap:wrap}
.sub.r{align-self:flex-end;justify-content:flex-end}
.journey{list-style:none;margin:0;padding:0}
.journey li{display:flex;gap:10px;padding:6px 0;border-bottom:1px solid var(--line);font-size:13.5px}
.journey li:last-child{border-bottom:0}
.journey .when{color:var(--muted);white-space:nowrap;font-size:12px;padding-top:1px}
.journey .p{min-width:0;overflow-wrap:anywhere}
.kv{margin:0;display:grid;grid-template-columns:auto 1fr;gap:4px 12px;font-size:14px}
.kv dt{color:var(--muted)}.kv dd{margin:0;overflow-wrap:anywhere}

.login{max-width:380px;margin:12vh auto 0;padding:0 16px;width:100%}
.login h1{margin-bottom:6px}
.login .field{margin:14px 0}
.login .field input{width:100%;font-size:24px;letter-spacing:.3em;text-align:center;text-transform:uppercase;padding:12px}
.err{color:var(--fg);font-weight:600;font-size:13.5px;margin-top:10px;border-left:3px solid var(--fg);padding-left:8px}
.spin{display:block;margin:40px auto;width:22px;height:22px;border:2px solid var(--line2);border-top-color:var(--accent-text);border-radius:50%;animation:spin .8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}

@media (min-width:900px){
  :root{--navh:0px}
  .top{padding-left:24px;padding-right:24px;gap:10px}
  .nav{position:static;border:0;padding:0;background:transparent;gap:2px}
  .nav a{flex:none;flex-direction:row;gap:6px;padding:7px 12px;border-radius:10px;font-size:13.5px}
  .nav a:hover{background:var(--soft2)}
  .nav a.on{background:var(--soft2);color:var(--fg)}
  .nav a svg{width:16px;height:16px}
  .brand{flex:0 0 auto;margin-right:12px}
  .top .spacer{display:block}
  main{padding-bottom:40px}
}
@media (max-width:520px){.iconbtn .lbl{display:none}}

.btn.sm{padding:7px 11px;font-size:13.5px}
.mt{margin-top:8px}
.btn:focus-visible,.chip:focus-visible{outline-offset:2px}
.linkbtn{background:transparent;border:0;padding:0;color:var(--muted);text-decoration:underline;cursor:pointer;font-size:inherit}
.linkbtn:hover{color:var(--fg)}
.inp{width:100%;background:var(--soft);border:1px solid var(--line);border-radius:10px;padding:9px 11px;min-width:0}
.inp:focus{border-color:var(--accent-text);outline:none}
textarea.inp{resize:vertical;min-height:64px}
.controls{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 12px}
.tagrow{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:14px}
.tagchip{display:inline-flex;align-items:center;border:1px solid var(--line2);border-radius:999px;padding:2px 3px 2px 10px;font-size:12.5px;font-weight:550}
.tagchip button{background:transparent;border:0;cursor:pointer;color:var(--muted);padding:1px 7px;border-radius:999px;font-size:16px;line-height:1}
.tagchip button:hover{color:var(--fg);background:var(--soft2)}
.taginput{width:auto;flex:1 1 130px;max-width:220px;padding:6px 10px}
.composer{position:sticky;bottom:calc(var(--navh) + env(safe-area-inset-bottom));z-index:10;background:var(--bg);border:1px solid var(--line2);border-radius:12px;padding:6px;margin:6px 0 14px;display:flex;flex-direction:column;gap:6px;box-shadow:0 -8px 18px rgba(0,0,0,.07)}
.composer-hint{margin:12px 0 0}
.composer-row{display:flex;align-items:flex-end;gap:6px}
.composer textarea.inp{flex:1;resize:none;min-height:0;height:38px;max-height:9.5em;overflow-y:auto;line-height:1.4;padding:8px 11px}
.ibtn{flex:none;width:38px;height:38px;display:inline-flex;align-items:center;justify-content:center;border-radius:10px;border:1px solid var(--line2);background:transparent;color:var(--fg);cursor:pointer;padding:0}
.ibtn:hover:not(:disabled){background:var(--soft2)}
.ibtn:disabled{color:var(--muted);cursor:not-allowed}
.ibtn svg{width:18px;height:18px}
.ibtn.primary{background:var(--accent);border-color:var(--accent);color:#fff}
.ibtn.primary:hover:not(:disabled){background:var(--accent-hover)}
.ibtn.primary:disabled{background:var(--soft2);border-color:var(--line2);color:var(--muted)}
.vh{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.picker{position:absolute;left:0;right:0;bottom:calc(100% + 6px);max-height:240px;overflow:auto;margin:0;padding:4px;list-style:none;background:var(--bg);border:1px solid var(--line2);border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.18);z-index:15}
.picker li{display:flex;gap:10px;align-items:baseline;padding:8px 10px;border-radius:8px;cursor:pointer;min-width:0}
.picker li[aria-selected=true]{background:var(--fg);color:var(--bg)}
.picker .sc{font-weight:650;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;flex:none}
.picker .tt{opacity:.8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.picker .empty-row{cursor:default;color:var(--muted);font-size:13px}
.note{border:1px solid var(--line);border-radius:10px;padding:9px 12px;margin-bottom:8px;background:var(--soft)}
.note .nbody{white-space:pre-wrap;overflow-wrap:anywhere;font-size:14px}
.note .sub{align-items:center}
.stars{font-size:20px;letter-spacing:2px}
.csat-comment{margin:6px 0;white-space:pre-wrap;overflow-wrap:anywhere}
.form{display:flex;flex-direction:column;gap:8px}
.scwrap{display:flex;align-items:center;gap:6px}
.scwrap .slash{font-weight:650;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.scwrap input{flex:1}
code.sc{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;background:var(--soft2);border-radius:6px;padding:1px 7px}
.cbody{white-space:pre-wrap;color:var(--muted);font-size:14px}

/* online visitors */
.live-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--accent-text);margin-right:6px;vertical-align:middle}
.visitor{border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin-bottom:8px}
.visitor .vhead{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px}
.visitor .vplace{font-weight:600}
.visitor .vpage{min-width:0;overflow-wrap:anywhere;font-size:14px}
.visitor .vpage b{font-weight:600}
.visitor .vmeta{font-size:12.5px;color:var(--muted);display:flex;gap:4px 14px;flex-wrap:wrap;margin-top:4px}
.visitor .vtags{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;align-items:center}
.vcomposer{margin-top:10px;display:flex;flex-direction:column;gap:6px}
.vcomposer textarea.inp{min-height:64px}

/* proactive rules */
.rule{border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin-bottom:8px}
.rule.off{opacity:.65}
.rule .rhead{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.rule .rname{font-weight:600;flex:1;min-width:0;overflow-wrap:anywhere}
.rule .rtxt{font-size:13.5px;color:var(--muted);overflow-wrap:anywhere;margin-top:4px}
.rule .rstats{font-size:12.5px;color:var(--muted);margin-top:6px}
.rule .row{margin-top:8px}
.pv{border:1px dashed var(--line2);border-radius:12px;padding:12px;background:var(--soft);display:flex;flex-direction:column;gap:8px}
.pv-card{align-self:flex-start;max-width:300px;width:100%;position:relative;background:var(--bg);color:var(--fg);border:1px solid var(--line2);border-radius:12px;padding:12px 14px;font-size:13.5px;line-height:1.45}
.pv-card b{display:block;font-size:11px;margin-bottom:3px}
.pv-card span{display:block;white-space:pre-wrap;overflow-wrap:anywhere}
.help{font-size:13px;color:var(--muted)}
.help code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px;background:var(--soft2);border-radius:4px;padding:1px 5px}
details.help>summary{cursor:pointer;font-weight:550}
.fgrid{display:grid;grid-template-columns:1fr;gap:8px}
@media (min-width:600px){.fgrid.two{grid-template-columns:1fr 1fr}}

/* help center gaps */
.subtabs{display:flex;gap:6px;margin-bottom:12px}
.subtabs a{text-decoration:none}
.gap{margin-bottom:10px}
.gap .ghead{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px}
.gap ul{margin:6px 0 8px;padding-left:1.2em;font-size:13.5px}
.gap li{overflow-wrap:anywhere}
.gap .gkb{font-size:12.5px;color:var(--muted);overflow-wrap:anywhere}
.draft{margin-top:10px;border:1px solid var(--line2);border-radius:12px;overflow:hidden}
.draft .dbar{display:flex;gap:6px;flex-wrap:wrap;align-items:center;padding:8px 10px;border-bottom:1px solid var(--line);background:var(--soft)}
.formtitle{margin:14px 0 6px}
.draft-warn{margin:8px 10px}
.draft-note{padding:8px 12px 0}
.inp.autow{width:auto}
.draft pre{margin:0;padding:12px;max-height:420px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font:12.5px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
`;

export const PANEL_MANIFEST = JSON.stringify({
  name: 'Yammbo Chat',
  short_name: 'Yammbo Chat',
  description: 'Panel del equipo de Yammbo Chat',
  start_url: '/panel/',
  scope: '/panel/',
  display: 'standalone',
  orientation: 'portrait',
  lang: 'es',
  background_color: '#000000',
  theme_color: '#000000',
  icons: [
    { src: '/panel/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    { src: '/panel/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/panel/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/panel/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
});

// Same "Y" as scripts/make-panel-icons.mjs, on a 100x100 canvas.
export const PANEL_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#000"/><g fill="#fff"><polygon points="22,20 34,20 53,50 44,62"/><polygon points="66,20 78,20 56,56 47,50"/><polygon points="44,50 56,50 56,80 44,80"/></g></svg>`;

export const PANEL_SW_JS = String.raw`// Service worker of the team panel. Scope: /panel/.
// Push: shows the notification and opens/focuses the panel on click.
// Fetch: network-first for the shell so a deploy is never hidden behind a stale cache.
var SHELL_CACHE = 'yc-panel-shell-v1';
var SHELL_PATHS = ['/panel', '/panel/', '/panel/app.js', '/panel/app.css'];

self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== SHELL_CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin || SHELL_PATHS.indexOf(url.pathname) < 0) return;
  e.respondWith(
    fetch(req).then(function (res) {
      if (res.ok) { var copy = res.clone(); caches.open(SHELL_CACHE).then(function (c) { c.put(req, copy); }); }
      return res;
    }).catch(function () { return caches.match(req); })
  );
});

self.addEventListener('push', function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(String(d.title || 'Yammbo Chat'), {
    body: String(d.body || ''),
    icon: '/panel/icon-192.png',
    badge: '/panel/icon-192.png',
    data: { url: String(d.url || '/panel/') }
  }));
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var target;
  try { target = new URL((e.notification.data && e.notification.data.url) || '/panel/', self.location.origin); } catch (_) { target = null; }
  // Only ever open our own panel, whatever the payload says.
  if (!target || target.origin !== self.location.origin || target.pathname.indexOf('/panel') !== 0) target = new URL('/panel/', self.location.origin);
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (new URL(c.url).pathname.indexOf('/panel') === 0) {
          return c.focus().then(function (w) { if (w && 'navigate' in w) return w.navigate(target.href); });
        }
      }
      return self.clients.openWindow(target.href);
    })
  );
});
`;
