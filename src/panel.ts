// panel.ts
// Team panel at /panel (same Worker, same origin). No new secrets and no
// Cloudflare Access: login is a one-time 8-character code sent to the team's
// Telegram chat; a successful login sets an HttpOnly session cookie backed by KV.
// The login state itself (pending codes, attempt counters) lives in D1, never in
// KV: KV is not atomic, D1 serialises writes (see migrations/0002_panel.sql).
//
//   GET  /panel, /panel/        SPA shell (assets: app.js, app.css, sw.js, manifest, icons)
//   POST /panel/api/login/start    sends the code to Telegram
//   POST /panel/api/login/verify   {code} -> session cookie
//   POST /panel/api/logout
//   GET  /panel/api/stats | conversations | conversations/:id | leads | unanswered
//   GET  /panel/api/push/key       POST /panel/api/push/subscribe | unsubscribe
//
// Every query uses bound parameters. Every /panel/api route except login needs a
// valid session (401) and every POST needs the x-requested-with: panel header
// (anti-CSRF on top of SameSite=Strict). There is no CORS here on purpose.

import { escapeHtml, sendTelegram, type NotifyEnv } from './notify';
import { PRODUCT_NAMES } from './page';
import { isValidId, type StoreEnv } from './store';
import { hit, isRateLimited } from './limit';
import { b64urlDecode, b64urlEncode, getVapidKeys, type PushEnv } from './push';
import { PANEL_CSS, PANEL_HTML, PANEL_ICON_SVG, PANEL_MANIFEST, PANEL_SW_JS } from './panel-ui';
import { PANEL_APP_JS } from './panel-app';
import icon192 from './panel-icons/icon-192.png';
import icon512 from './panel-icons/icon-512.png';

export interface PanelEnv extends NotifyEnv, StoreEnv, PushEnv {
  CHAT_LIMITER?: RateLimit;
  // Local development only (.dev.vars, never in wrangler.toml): a fixed login
  // code so the flow can be tested without Telegram. Ignored unless the request
  // is addressed to localhost/127.0.0.1, so a stray production value is inert.
  PANEL_DEV_CODE?: string;
}

const DAY_MS = 24 * 3600_000;
const COOKIE = '__Host-yc_panel';
const SESSION_TTL_SECONDS = 30 * 24 * 3600;
// No 0/O/1/I/L: the code is read off a phone screen and typed by hand.
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const CODE_LENGTH = 8;
const CODE_TTL_MS = 10 * 60_000;
const HOUR_MS = 3600_000;
// Global caps (not per IP): they bound how many guesses exist per hour no matter
// how many addresses the attacker has.
const START_MAX_PER_HOUR = 6;
const VERIFY_MAX_PER_HOUR = 30;
// Per IP, on top of the native CHAT_LIMITER.
const START_IP_MAX = 3;
const START_IP_WINDOW_MS = 10 * 60_000;
const RATE_LIMITED_MSG = 'Demasiadas solicitudes, prueba más tarde';
const PAGE_SIZE = 30;
const MAX_PUSH_SUBS = 20;

const SESSION_PREFIX = '__panel_sess:';

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const SECURITY_HEADERS: Record<string, string> = {
  'content-security-policy': CSP,
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-robots-tag': 'noindex, nofollow',
};

interface StaticAsset {
  body: string | ArrayBuffer;
  type: string;
}

const ASSETS: Record<string, StaticAsset> = {
  '/panel': { body: PANEL_HTML, type: 'text/html; charset=utf-8' },
  '/panel/': { body: PANEL_HTML, type: 'text/html; charset=utf-8' },
  '/panel/app.js': { body: PANEL_APP_JS, type: 'application/javascript; charset=utf-8' },
  '/panel/app.css': { body: PANEL_CSS, type: 'text/css; charset=utf-8' },
  '/panel/sw.js': { body: PANEL_SW_JS, type: 'application/javascript; charset=utf-8' },
  '/panel/manifest.webmanifest': { body: PANEL_MANIFEST, type: 'application/manifest+json; charset=utf-8' },
  '/panel/icon.svg': { body: PANEL_ICON_SVG, type: 'image/svg+xml' },
  '/panel/icon-192.png': { body: icon192, type: 'image/png' },
  '/panel/icon-512.png': { body: icon512, type: 'image/png' },
};

function jsonResponse(data: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...SECURITY_HEADERS, ...extra },
  });
}

// Crypto helpers -------------------------------------------------------------

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Constant-time comparison. Callers compare fixed-length digests, so the early
// length return reveals nothing.
function ctEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Uniform code over CODE_ALPHABET. Bytes at or above `limit` are rejected so
// every symbol is equally likely (no modulo bias).
function randomCode(): string {
  const limit = 256 - (256 % CODE_ALPHABET.length);
  const buf = new Uint8Array(16);
  let out = '';
  while (out.length < CODE_LENGTH) {
    crypto.getRandomValues(buf);
    for (const b of buf) {
      if (b < limit && out.length < CODE_LENGTH) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
    }
  }
  return out;
}

// What the user typed -> canonical code, or null when it cannot be a code.
// Case-insensitive; spaces and hyphens are ignored (so "abcd-2345" works).
function normalizeCode(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 40 || /[^A-Za-z0-9\s-]/.test(raw)) return null;
  const code = raw.toUpperCase().replace(/[\s-]/g, '');
  return new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`).test(code) ? code : null;
}

function rateLimited(): Response {
  return jsonResponse({ error: 'rate_limited', message: RATE_LIMITED_MSG }, 429);
}

// The IP never goes into D1 as-is: a salted hash is enough to count attempts.
async function ipKey(request: Request, salt: string | undefined): Promise<string> {
  return (await sha256Hex(`panel|${request.headers.get('cf-connecting-ip') || 'unknown'}|${salt || ''}`)).slice(0, 32);
}

function devCode(env: PanelEnv, url: URL): string | null {
  const c = env.PANEL_DEV_CODE;
  const code = c ? normalizeCode(c) : null;
  if (!code) return null;
  return url.hostname === 'localhost' || url.hostname === '127.0.0.1' ? code : null;
}

// Sessions -------------------------------------------------------------------------

function readCookie(request: Request, name: string): string | null {
  const raw = request.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

async function hasSession(request: Request, env: PanelEnv): Promise<boolean> {
  const token = readCookie(request, COOKIE);
  if (!token || !env.CHAT_SESSIONS || !/^[A-Za-z0-9_-]{20,100}$/.test(token)) return false;
  return (await env.CHAT_SESSIONS.get(SESSION_PREFIX + (await sha256Hex(token)))) !== null;
}

function sessionCookie(value: string, maxAge: number): string {
  return `${COOKIE}=${value}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`;
}

async function createSession(kv: KVNamespace): Promise<Response> {
  const token = b64urlEncode(crypto.getRandomValues(new Uint8Array(32)));
  await kv.put(SESSION_PREFIX + (await sha256Hex(token)), JSON.stringify({ at: Date.now() }), { expirationTtl: SESSION_TTL_SECONDS });
  return jsonResponse({ ok: true }, 200, { 'set-cookie': sessionCookie(token, SESSION_TTL_SECONDS) });
}

// Login ------------------------------------------------------------------------------

async function loginStart(request: Request, env: PanelEnv, url: URL): Promise<Response> {
  const db = env.DB;
  if (!db) return jsonResponse({ error: 'unavailable' }, 503);
  if (await isRateLimited(env.CHAT_LIMITER, request)) return rateLimited();
  // Per-IP first, so an address that is over its own cap does not burn the global one.
  if ((await hit(db, `start_ip:${await ipKey(request, env.IP_SALT)}`, START_IP_WINDOW_MS)) > START_IP_MAX) return rateLimited();
  if ((await hit(db, 'start', HOUR_MS)) > START_MAX_PER_HOUR) return rateLimited();

  // Housekeeping on every start: expired codes, and counters whose window (at most
  // one hour) is over. Pending codes of other requests are left alone.
  const now = Date.now();
  await db.batch([
    db.prepare('DELETE FROM panel_codes WHERE expires_at <= ?').bind(now),
    db.prepare('DELETE FROM panel_throttle WHERE window_start <= ?').bind(now - HOUR_MS),
  ]);
  if (devCode(env, url)) return jsonResponse({ ok: true });

  const code = randomCode();
  const codeHash = await sha256Hex(code);
  await db.prepare('INSERT INTO panel_codes (code_hash, expires_at, created_at) VALUES (?, ?, ?)').bind(codeHash, now + CODE_TTL_MS, now).run();
  let sent = false;
  try {
    sent = (
      await sendTelegram(
        env,
        `<b>🔐 Código de acceso al panel</b>\n<code>${escapeHtml(code)}</code>\nCaduca en 10 minutos. Si no has sido tú, ignora este mensaje.`,
      )
    ).ok;
  } catch (e) {
    console.error('panel login code send failed:', (e as Error)?.message);
  }
  if (!sent) {
    await db.prepare('DELETE FROM panel_codes WHERE code_hash = ?').bind(codeHash).run();
    return jsonResponse({ error: 'send_failed' }, 502);
  }
  return jsonResponse({ ok: true });
}

async function loginVerify(request: Request, env: PanelEnv, url: URL): Promise<Response> {
  const db = env.DB;
  const kv = env.CHAT_SESSIONS;
  if (!db || !kv) return jsonResponse({ error: 'unavailable' }, 503);
  if (await isRateLimited(env.CHAT_LIMITER, request)) return rateLimited();
  let body: { code?: unknown };
  try {
    body = (await request.json()) as { code?: unknown };
  } catch {
    return jsonResponse({ error: 'invalid_code' }, 400);
  }
  const code = normalizeCode(body.code);
  if (!code) return jsonResponse({ error: 'invalid_code' }, 400);

  // The global attempt is counted BEFORE the code is looked at, so once the hour's
  // budget is spent even the right code is refused. Parallel guesses cannot slip
  // past the cap: every call gets its own count from the atomic UPSERT.
  if ((await hit(db, 'verify', HOUR_MS)) > VERIFY_MAX_PER_HOUR) return rateLimited();

  const codeHash = await sha256Hex(code);
  const dev = devCode(env, url);
  let ok = dev !== null && ctEqual(codeHash, await sha256Hex(dev));
  if (!ok) {
    // Spending the code and checking it are one statement: only the request whose
    // DELETE returns the row gets a session (no double use, no expired code).
    const spent = await db
      .prepare('DELETE FROM panel_codes WHERE code_hash = ? AND expires_at > ? RETURNING code_hash')
      .bind(codeHash, Date.now())
      .first<{ code_hash: string }>();
    ok = spent !== null;
  }
  if (!ok) return jsonResponse({ error: 'invalid_code' }, 400);

  // Only failed attempts count against the cap: give this one back.
  await db.prepare('UPDATE panel_throttle SET count = MAX(count - 1, 0) WHERE bucket = ?').bind('verify').run();
  return createSession(kv);
}

async function logout(request: Request, env: PanelEnv): Promise<Response> {
  const token = readCookie(request, COOKIE);
  if (token && env.CHAT_SESSIONS && /^[A-Za-z0-9_-]{20,100}$/.test(token)) {
    await env.CHAT_SESSIONS.delete(SESSION_PREFIX + (await sha256Hex(token)));
  }
  return jsonResponse({ ok: true }, 200, { 'set-cookie': sessionCookie('', 0) });
}

// Data API ------------------------------------------------------------------------------

function intParam(v: string | null, min: number, max: number, fallback: number): number {
  const n = v === null ? NaN : parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function beforeParam(url: URL): number | null {
  const v = url.searchParams.get('before');
  const n = v === null ? NaN : parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

interface CountRow {
  n: number;
}
interface KeyCount {
  key: string | null;
  n: number;
}

async function stats(env: PanelEnv, url: URL): Promise<Response> {
  const db = env.DB!;
  const requested = parseInt(url.searchParams.get('days') || '', 10);
  const days = [7, 30, 90].includes(requested) ? requested : 30;
  const tz = intParam(url.searchParams.get('tz'), -840, 840, 0);
  const tzMs = tz * 60_000;
  const now = Date.now();
  const since = now - days * DAY_MS;

  // `col` is one of three constants from this file, never request input.
  const top = (col: 'country' | 'device' | 'page_url', limit: number) =>
    db
      .prepare(`SELECT ${col} AS key, COUNT(*) AS n FROM conversations WHERE created_at >= ? AND ${col} IS NOT NULL GROUP BY ${col} ORDER BY n DESC LIMIT ${limit}`)
      .bind(since);

  const res = await db.batch([
    db.prepare('SELECT COUNT(*) AS n FROM conversations WHERE created_at >= ?').bind(since), // 0
    db.prepare('SELECT COUNT(*) AS n FROM messages WHERE created_at >= ?').bind(since), // 1
    db.prepare('SELECT COUNT(*) AS n FROM leads WHERE created_at >= ?').bind(since), // 2
    db.prepare('SELECT COALESCE(SUM(rating = 1), 0) AS up, COALESCE(SUM(rating = -1), 0) AS down FROM feedback WHERE created_at >= ?').bind(since), // 3
    db.prepare("SELECT COUNT(*) AS n FROM messages WHERE role = 'assistant' AND handoff = 1 AND created_at >= ?").bind(since), // 4
    db
      .prepare("SELECT strftime('%Y-%m-%d', (created_at + ?) / 1000, 'unixepoch') AS day, COUNT(*) AS n FROM conversations WHERE created_at >= ? GROUP BY day")
      .bind(tzMs, since), // 5
    db
      .prepare('SELECT product AS key, COUNT(*) AS n FROM conversations WHERE created_at >= ? GROUP BY product ORDER BY n DESC LIMIT 8')
      .bind(since), // 6
    top('country', 10), // 7
    top('device', 5), // 8
    top('page_url', 8), // 9
    db
      .prepare("SELECT CAST(strftime('%H', (created_at + ?) / 1000, 'unixepoch') AS INTEGER) AS hour, COUNT(*) AS n FROM conversations WHERE created_at >= ? GROUP BY hour")
      .bind(tzMs, since), // 10
  ]);
  const rows = <T>(i: number) => (res[i].results ?? []) as T[];

  const byDay = new Map(rows<{ day: string; n: number }>(5).map((r) => [r.day, r.n]));
  const series: Array<{ day: string; conversations: number }> = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(now + tzMs - i * DAY_MS).toISOString().slice(0, 10);
    series.push({ day, conversations: byDay.get(day) ?? 0 });
  }
  const hours = new Array<number>(24).fill(0);
  for (const r of rows<{ hour: number; n: number }>(10)) if (r.hour >= 0 && r.hour < 24) hours[r.hour] = r.n;
  const fb = rows<{ up: number; down: number }>(3)[0] ?? { up: 0, down: 0 };

  return jsonResponse({
    days,
    totals: {
      conversations: rows<CountRow>(0)[0]?.n ?? 0,
      messages: rows<CountRow>(1)[0]?.n ?? 0,
      leads: rows<CountRow>(2)[0]?.n ?? 0,
      thumbsUp: fb.up,
      thumbsDown: fb.down,
      handoffs: rows<CountRow>(4)[0]?.n ?? 0,
    },
    series,
    products: rows<KeyCount>(6),
    countries: rows<KeyCount>(7),
    devices: rows<KeyCount>(8),
    pages: rows<KeyCount>(9),
    hours,
  });
}

function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, '\\$&')}%`;
}

async function listConversations(env: PanelEnv, url: URL): Promise<Response> {
  const db = env.DB!;
  const before = beforeParam(url);
  const q = (url.searchParams.get('q') || '').trim().slice(0, 100);
  const productParam = url.searchParams.get('product') || '';
  const product = Object.prototype.hasOwnProperty.call(PRODUCT_NAMES, productParam) ? productParam : null;
  const countryParam = (url.searchParams.get('country') || '').toUpperCase();
  const country = /^[A-Z]{2}$/.test(countryParam) ? countryParam : null;

  const stmts = [
    db
      .prepare(
        `SELECT c.id, c.created_at, c.updated_at, c.product, c.country, c.city, c.device, c.os, c.browser, c.lang, c.msg_count,
                (SELECT m.content FROM messages m WHERE m.session_id = c.id AND m.role = 'user' ORDER BY m.created_at ASC LIMIT 1) AS first_question,
                EXISTS (SELECT 1 FROM leads l WHERE l.session_id = c.id) AS has_lead,
                (SELECT COUNT(*) FROM feedback f WHERE f.session_id = c.id AND f.rating = 1) AS up,
                (SELECT COUNT(*) FROM feedback f WHERE f.session_id = c.id AND f.rating = -1) AS down
         FROM conversations c
         WHERE (?1 IS NULL OR c.updated_at < ?1)
           AND (?2 IS NULL OR c.product = ?2)
           AND (?3 IS NULL OR c.country = ?3)
           AND (?4 IS NULL OR EXISTS (SELECT 1 FROM messages m WHERE m.session_id = c.id AND m.content LIKE ?4 ESCAPE '\\'))
         ORDER BY c.updated_at DESC
         LIMIT ${PAGE_SIZE + 1}`,
      )
      .bind(before, product, country, q ? likePattern(q) : null),
  ];
  // Country options for the filter: only needed once, with the first page.
  if (before === null) {
    stmts.push(db.prepare('SELECT country AS key, COUNT(*) AS n FROM conversations WHERE country IS NOT NULL GROUP BY country ORDER BY n DESC LIMIT 40'));
  }
  const res = await db.batch(stmts);
  const rows = (res[0].results ?? []) as Array<Record<string, unknown>>;
  const page = rows.slice(0, PAGE_SIZE);
  return jsonResponse({
    items: page.map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      product: r.product,
      country: r.country,
      city: r.city,
      device: r.device,
      os: r.os,
      browser: r.browser,
      lang: r.lang,
      msgCount: r.msg_count,
      firstQuestion: typeof r.first_question === 'string' ? r.first_question.slice(0, 300) : null,
      hasLead: r.has_lead === 1,
      up: r.up,
      down: r.down,
    })),
    next: rows.length > PAGE_SIZE ? page[page.length - 1].updated_at : null,
    ...(before === null ? { countries: res[1]?.results ?? [] } : {}),
  });
}

async function conversationDetail(env: PanelEnv, id: string): Promise<Response> {
  const db = env.DB!;
  if (!isValidId(id)) return jsonResponse({ error: 'not_found' }, 404);
  const res = await db.batch([
    db.prepare('SELECT id, created_at, updated_at, page_url, product, lang, msg_count, country, city, device, os, browser FROM conversations WHERE id = ?').bind(id),
    db
      .prepare(
        `SELECT m.id, m.role, m.content, m.created_at, m.provider, m.rag_hits, m.handoff, m.page_url, f.rating
         FROM messages m LEFT JOIN feedback f ON f.message_id = m.id
         WHERE m.session_id = ? ORDER BY m.created_at ASC LIMIT 500`,
      )
      .bind(id),
    db.prepare('SELECT url, title, created_at FROM page_views WHERE session_id = ? ORDER BY created_at ASC LIMIT 200').bind(id),
    db
      .prepare('SELECT id, created_at, name, email, phone, channel, message, page_url FROM leads WHERE session_id = ? ORDER BY created_at DESC LIMIT 1')
      .bind(id),
  ]);
  const conv = (res[0].results ?? [])[0] as Record<string, unknown> | undefined;
  if (!conv) return jsonResponse({ error: 'not_found' }, 404);
  const messages = (res[1].results ?? []) as Array<Record<string, unknown>>;
  const lead = (res[3].results ?? [])[0] as Record<string, unknown> | undefined;
  return jsonResponse({
    conversation: {
      id: conv.id,
      createdAt: conv.created_at,
      updatedAt: conv.updated_at,
      pageUrl: conv.page_url,
      product: conv.product,
      lang: conv.lang,
      msgCount: conv.msg_count,
      country: conv.country,
      city: conv.city,
      device: conv.device,
      os: conv.os,
      browser: conv.browser,
    },
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.created_at,
      provider: m.provider,
      ragHits: m.rag_hits,
      handoff: m.handoff === 1,
      pageUrl: m.page_url,
      rating: m.rating ?? null,
    })),
    votes: {
      up: messages.filter((m) => m.rating === 1).length,
      down: messages.filter((m) => m.rating === -1).length,
    },
    pageViews: ((res[2].results ?? []) as Array<Record<string, unknown>>).map((v) => ({ url: v.url, title: v.title, createdAt: v.created_at })),
    lead: lead
      ? { id: lead.id, createdAt: lead.created_at, name: lead.name, email: lead.email, phone: lead.phone, channel: lead.channel, message: lead.message, pageUrl: lead.page_url }
      : null,
  });
}

// notify column: JSON of { channel: { ok, info } }. Only the ok flags leave the server.
function notifyFlags(raw: unknown): Record<string, boolean> | null {
  if (typeof raw !== 'string') return null;
  try {
    const j = JSON.parse(raw) as Record<string, { ok?: boolean }>;
    const out: Record<string, boolean> = {};
    for (const k of ['telegram', 'whatsapp', 'email']) if (j[k]) out[k] = !!j[k].ok;
    return out;
  } catch {
    return null;
  }
}

async function listLeads(env: PanelEnv, url: URL): Promise<Response> {
  const before = beforeParam(url);
  const res = await env
    .DB!.prepare(
      `SELECT id, created_at, session_id, name, email, phone, channel, message, page_url, notify
       FROM leads WHERE (?1 IS NULL OR created_at < ?1) ORDER BY created_at DESC LIMIT ${PAGE_SIZE + 1}`,
    )
    .bind(before)
    .all();
  const rows = (res.results ?? []) as Array<Record<string, unknown>>;
  const page = rows.slice(0, PAGE_SIZE);
  return jsonResponse({
    items: page.map((l) => ({
      id: l.id,
      createdAt: l.created_at,
      sessionId: l.session_id,
      name: l.name,
      email: l.email,
      phone: l.phone,
      channel: l.channel,
      message: l.message,
      pageUrl: l.page_url,
      notified: notifyFlags(l.notify),
    })),
    next: rows.length > PAGE_SIZE ? page[page.length - 1].created_at : null,
  });
}

// Assistant answers worth a human look: thumbs down, handoff, or no KB hit.
async function listUnanswered(env: PanelEnv, url: URL): Promise<Response> {
  const before = beforeParam(url);
  const res = await env
    .DB!.prepare(
      `SELECT m.id, m.session_id, m.created_at, m.content AS answer, m.handoff, m.rag_hits, f.rating,
              (SELECT u.content FROM messages u WHERE u.session_id = m.session_id AND u.role = 'user' AND u.created_at < m.created_at
               ORDER BY u.created_at DESC LIMIT 1) AS question
       FROM messages m LEFT JOIN feedback f ON f.message_id = m.id
       WHERE m.role = 'assistant' AND (f.rating = -1 OR m.handoff = 1 OR m.rag_hits = 0)
         AND (?1 IS NULL OR m.created_at < ?1)
       ORDER BY m.created_at DESC LIMIT ${PAGE_SIZE + 1}`,
    )
    .bind(before)
    .all();
  const rows = (res.results ?? []) as Array<Record<string, unknown>>;
  const page = rows.slice(0, PAGE_SIZE);
  return jsonResponse({
    items: page.map((m) => ({
      id: m.id,
      sessionId: m.session_id,
      createdAt: m.created_at,
      question: typeof m.question === 'string' ? m.question.slice(0, 300) : null,
      answer: typeof m.answer === 'string' ? m.answer.slice(0, 400) : '',
      handoff: m.handoff === 1,
      noKb: m.rag_hits === 0,
      thumbsDown: m.rating === -1,
    })),
    next: rows.length > PAGE_SIZE ? page[page.length - 1].created_at : null,
  });
}

// Push subscriptions ---------------------------------------------------------------------

interface SubscribeBody {
  endpoint?: unknown;
  keys?: { p256dh?: unknown; auth?: unknown };
}

// Hosts of the real push services. The Worker POSTs to whatever endpoint is stored,
// so anything else would be a server-side request forgery primitive.
const PUSH_HOSTS = new Set(['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com']);
const PUSH_HOST_SUFFIXES = ['.push.apple.com', '.notify.windows.com'];

function validEndpoint(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > 1000) return null;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.username || u.password) return null;
  const host = u.hostname;
  if (!PUSH_HOSTS.has(host) && !PUSH_HOST_SUFFIXES.some((x) => host.endsWith(x))) return null;
  return u.href;
}

function validKey(v: unknown, bytes: number, firstByte?: number): string | null {
  if (typeof v !== 'string' || v.length > 200 || !/^[A-Za-z0-9_-]+$/.test(v)) return null;
  try {
    const raw = b64urlDecode(v);
    if (raw.length !== bytes || (firstByte !== undefined && raw[0] !== firstByte)) return null;
  } catch {
    return null;
  }
  return v;
}

async function pushSubscribe(request: Request, env: PanelEnv): Promise<Response> {
  let body: SubscribeBody;
  try {
    body = (await request.json()) as SubscribeBody;
  } catch {
    return jsonResponse({ error: 'invalid_body' }, 400);
  }
  const endpoint = validEndpoint(body.endpoint);
  const p256dh = validKey(body.keys?.p256dh, 65, 4);
  const auth = validKey(body.keys?.auth, 16);
  if (!endpoint || !p256dh || !auth) return jsonResponse({ error: 'invalid_subscription' }, 400);
  const db = env.DB!;
  const known = await db.prepare('SELECT 1 AS ok FROM push_subs WHERE endpoint = ?').bind(endpoint).first();
  if (!known) {
    const total = await db.prepare('SELECT COUNT(*) AS n FROM push_subs').first<CountRow>();
    if ((total?.n ?? 0) >= MAX_PUSH_SUBS) return jsonResponse({ error: 'too_many_subscriptions' }, 409);
  }
  await db
    .prepare(
      `INSERT INTO push_subs (endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth`,
    )
    .bind(endpoint, p256dh, auth, Date.now())
    .run();
  return jsonResponse({ ok: true });
}

async function pushUnsubscribe(request: Request, env: PanelEnv): Promise<Response> {
  let body: { endpoint?: unknown };
  try {
    body = (await request.json()) as { endpoint?: unknown };
  } catch {
    return jsonResponse({ error: 'invalid_body' }, 400);
  }
  const endpoint = validEndpoint(body.endpoint);
  if (!endpoint) return jsonResponse({ error: 'invalid_subscription' }, 400);
  await env.DB!.prepare('DELETE FROM push_subs WHERE endpoint = ?').bind(endpoint).run();
  return jsonResponse({ ok: true });
}

// Router -----------------------------------------------------------------------------------

export async function handlePanel(request: Request, env: PanelEnv, url: URL): Promise<Response> {
  const path = url.pathname;
  const method = request.method;

  if (!path.startsWith('/panel/api/')) {
    const asset = ASSETS[path];
    if (!asset || (method !== 'GET' && method !== 'HEAD')) {
      return new Response('Not found', { status: asset ? 405 : 404, headers: { ...SECURITY_HEADERS, 'cache-control': 'no-store' } });
    }
    return new Response(method === 'HEAD' ? null : asset.body, {
      headers: { 'content-type': asset.type, 'cache-control': 'no-cache', ...SECURITY_HEADERS },
    });
  }

  if (method !== 'GET' && method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);
  if (method === 'POST') {
    // Same-origin requests made by the panel itself, nothing else.
    const origin = request.headers.get('origin');
    if (request.headers.get('x-requested-with') !== 'panel' || (origin !== null && origin !== url.origin)) {
      return jsonResponse({ error: 'forbidden' }, 403);
    }
  }

  try {
    if (method === 'POST' && path === '/panel/api/login/start') return await loginStart(request, env, url);
    if (method === 'POST' && path === '/panel/api/login/verify') return await loginVerify(request, env, url);

    if (!(await hasSession(request, env))) return jsonResponse({ error: 'unauthorized' }, 401);
    if (method === 'POST' && path === '/panel/api/logout') return await logout(request, env);
    if (method === 'GET' && path === '/panel/api/push/key') {
      const keys = await getVapidKeys(env.DB);
      return keys ? jsonResponse({ key: keys.publicKey }) : jsonResponse({ error: 'unavailable' }, 503);
    }
    if (!env.DB) return jsonResponse({ error: 'unavailable' }, 503);

    if (method === 'GET' && path === '/panel/api/stats') return await stats(env, url);
    if (method === 'GET' && path === '/panel/api/conversations') return await listConversations(env, url);
    if (method === 'GET' && path.startsWith('/panel/api/conversations/')) {
      let id = '';
      try {
        id = decodeURIComponent(path.slice('/panel/api/conversations/'.length));
      } catch {
        // malformed escape: falls through to the not-found answer below
      }
      return await conversationDetail(env, id);
    }
    if (method === 'GET' && path === '/panel/api/leads') return await listLeads(env, url);
    if (method === 'GET' && path === '/panel/api/unanswered') return await listUnanswered(env, url);
    if (method === 'POST' && path === '/panel/api/push/subscribe') return await pushSubscribe(request, env);
    if (method === 'POST' && path === '/panel/api/push/unsubscribe') return await pushUnsubscribe(request, env);
  } catch (e) {
    console.error('panel error:', path, (e as Error)?.message);
    return jsonResponse({ error: 'server_error' }, 500);
  }
  return jsonResponse({ error: 'not_found' }, 404);
}
