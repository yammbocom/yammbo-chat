// presence.ts
// "Visitors online" and messages the team writes first (see migrations/0004_live.sql).
//
// Visitor side (called by the widget, CORS allow-list, VISIT_LIMITER):
//   POST /api/presence          heartbeat {presenceId, sessionId?, url, title, lang, ref}
//                               -> {ok, messages:[{id,text}]} (team messages not delivered yet)
//   POST /api/presence/leave    {presenceId}: the page is closing, drop the row
//   POST /api/proactive/accept  {presenceId, sessionId}: the visitor opened the teaser;
//                               the pending messages become role 'agent' messages of a
//                               conversation in mode 'human'
// Team side (called by panel.ts, session + anti-CSRF already checked):
//   GET  /panel/api/presence             visitors seen in the last 90 s
//   POST /panel/api/presence/:id/message {text}
//
// Privacy by design: presence_id is made in the widget's memory for ONE page load and
// is never stored in the browser. Without a conversation the row carries no session id.
// The widget sends nothing when the browser sends Global Privacy Control or Do Not
// Track (unless the visitor already uses the chat) and stops after 30 minutes without
// interaction. Rows are deleted 15 minutes after the last heartbeat (at most about 30
// minutes, the cron runs every 15 minutes). Every query uses bound parameters.

import { cleanCity, cleanCountry, parseUserAgent } from './device';
import { SYS, isStrongId } from './inbox';
import { hit } from './limit';
import { sanitizePage, productFromUrl } from './page';
import { ipHash, type StoreEnv } from './store';
import type { Out } from './panel-inbox';

// A visitor counts as "online" when the last heartbeat is younger than this
// (the widget beats every 30 s).
export const ONLINE_MS = 90_000;
const PURGE_MS = 15 * 60_000;
// Team messages are kept this long after their creation or delivery, even when the presence row is gone.
const INBOX_KEEP_MS = 3600_000;
// New presence rows per minute across all visitors. Anti-flood cap only: a flood of random ids
// cannot grow the table, and the worst it does is degrade presence (the "En linea" list), never the chat.
const NEW_ROWS_PER_MINUTE = 600;
const MAX_PENDING_PER_VISITOR = 5;
const MAX_PROACTIVE_TEXT = 600;
const PROACTIVE_PER_HOUR = 120;
const GONE_MS = 3 * 60_000;

export function isPresenceId(v: unknown): v is string {
  return typeof v === 'string' && /^[A-Za-z0-9_-]{22,64}$/.test(v);
}

// Hostname of an external referrer. Anything on yammbo.com is internal and ignored.
export function cleanReferrerHost(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const h = v.trim().toLowerCase().replace(/^www\./, '');
  if (h.length < 3 || h.length > 100 || !/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(h) || !h.includes('.')) return null;
  if (h === 'yammbo.com' || h.endsWith('.yammbo.com')) return null;
  return h;
}

export interface PresenceBody {
  presenceId?: unknown;
  sessionId?: unknown;
  url?: unknown;
  title?: unknown;
  lang?: unknown;
  ref?: unknown;
}

export interface Heartbeat {
  ok: boolean;
  messages: Array<{ id: string; text: string }>;
}

// Upserts the visitor's row and hands back the team messages not delivered yet.
// A call for a page that is not a Yammbo page is accepted and ignored.
export async function heartbeat(env: StoreEnv, request: Request, b: PresenceBody, now = Date.now()): Promise<Heartbeat> {
  const db = env.DB!;
  if (!isPresenceId(b.presenceId)) return { ok: false, messages: [] };
  const page = sanitizePage({ url: b.url, title: b.title });
  if (!page) return { ok: true, messages: [] };
  const id = b.presenceId;
  const lang = b.lang === 'es' || b.lang === 'en' ? b.lang : null;
  const ref = cleanReferrerHost(b.ref);
  const sid = isStrongId(b.sessionId) ? b.sessionId : null;

  // session_id only sticks when that conversation exists (a made-up id links nothing). It is
  // replaced on every beat, not kept: after "New conversation" (or a beat without sessionId)
  // the row must stop pointing at the old conversation.
  const touched = await db
    .prepare(
      `UPDATE presence SET url = ?2, title = ?3, lang = ?4, last_seen = ?5,
         session_id = (SELECT id FROM conversations WHERE id = ?6),
         referrer_host = COALESCE(referrer_host, ?7)
       WHERE presence_id = ?1 RETURNING first_seen`,
    )
    .bind(id, page.url, page.title, lang, now, sid, ref)
    .first<{ first_seen: number }>();

  if (!touched) {
    if ((await hit(db, 'presence_new', 60_000, now)) > NEW_ROWS_PER_MINUTE) return { ok: true, messages: [] };
    const client = parseUserAgent(request.headers.get('user-agent'));
    await db
      .prepare(
        `INSERT INTO presence (presence_id, session_id, url, title, lang, country, city, device, os, browser, first_seen, last_seen, referrer_host)
         VALUES (?1, (SELECT id FROM conversations WHERE id = ?2), ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11, ?12)
         ON CONFLICT(presence_id) DO UPDATE SET url = excluded.url, title = excluded.title, lang = excluded.lang, last_seen = excluded.last_seen,
           session_id = excluded.session_id`,
      )
      .bind(
        id, sid, page.url, page.title, lang, cleanCountry(request.cf?.country), cleanCity(request.cf?.city),
        client.device, client.os, client.browser, now, ref,
      )
      .run();
  }

  // Marked delivered in the same statement that returns them: each message goes out once.
  const rows = await db
    .prepare('UPDATE proactive_inbox SET delivered_at = ?1 WHERE presence_id = ?2 AND delivered_at IS NULL RETURNING id, text, created_at')
    .bind(now, id)
    .all<{ id: string; text: string; created_at: number }>();
  const messages = (rows.results ?? []).sort((a, c) => a.created_at - c.created_at).map((m) => ({ id: m.id, text: m.text }));
  return { ok: true, messages };
}

export async function leave(env: StoreEnv, presenceId: unknown): Promise<void> {
  if (!env.DB || !isPresenceId(presenceId)) return;
  await env.DB.prepare('DELETE FROM presence WHERE presence_id = ?').bind(presenceId).run();
}

export interface AcceptResult {
  status: number;
  data: unknown;
}

// The visitor opened the teaser. The pending team messages move into `messages` as
// role 'agent' (with the same ids) and the conversation goes to mode 'human', so the
// team continues there. Claiming the rows is one DELETE ... RETURNING: when two
// requests race, only one gets the rows. The conversation is created if it is new
// (location and client come from this very request, the page from the presence row when
// it still exists). The claim is validated against proactive_inbox + presenceId only, so it
// works after the presence row was purged. An existing conversation keeps its unread count.
export async function acceptProactive(env: StoreEnv, request: Request, presenceId: unknown, sessionId: unknown, now = Date.now()): Promise<AcceptResult> {
  const db = env.DB!;
  if (!isPresenceId(presenceId) || !isStrongId(sessionId)) return { status: 400, data: { error: 'invalid_request' } };

  const claimed = await db
    .prepare('DELETE FROM proactive_inbox WHERE presence_id = ? RETURNING id, text, created_at')
    .bind(presenceId)
    .all<{ id: string; text: string; created_at: number }>();
  const rows = (claimed.results ?? []).sort((a, c) => a.created_at - c.created_at);
  if (!rows.length) return { status: 404, data: { error: 'nothing_pending' } };

  try {
    const pres = await db
      .prepare('SELECT url, lang FROM presence WHERE presence_id = ?')
      .bind(presenceId)
      .first<{ url: string; lang: string | null }>();
    const client = parseUserAgent(request.headers.get('user-agent'));
    const hash = await ipHash(request.headers.get('cf-connecting-ip') || 'unknown', env.IP_SALT, new Date(now));
    const lastAt = now + rows.length;
    const joinedId = crypto.randomUUID();

    const stmts: D1PreparedStatement[] = [
      db
        .prepare(
          `INSERT INTO conversations (id, created_at, updated_at, page_url, product, lang, ip_hash, msg_count, country, city, device, os, browser, mode, status, last_agent_at, unread)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, 'human', 'open', ?3, 0)
           ON CONFLICT(id) DO UPDATE SET
             mode = 'human', status = 'open', updated_at = ?3, last_agent_at = ?3,
             msg_count = conversations.msg_count + ?8`,
        )
        .bind(
          sessionId, now, lastAt, pres?.url ?? null, pres?.url ? productFromUrl(pres.url) : null, pres?.lang ?? null, hash, rows.length,
          cleanCountry(request.cf?.country), cleanCity(request.cf?.city), client.device, client.os, client.browser,
        ),
      db
        .prepare('INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)')
        .bind(joinedId, sessionId, 'system', SYS.joined, now),
      ...rows.map((r, i) =>
        db
          .prepare('INSERT OR IGNORE INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)')
          .bind(r.id, sessionId, 'agent', r.text, now + 1 + i),
      ),
      db.prepare('UPDATE presence SET session_id = ?1 WHERE presence_id = ?2').bind(sessionId, presenceId),
    ];
    await db.batch(stmts);
    return {
      status: 200,
      data: {
        ok: true,
        mode: 'human',
        status: 'open',
        csat: false,
        messages: [
          { id: joinedId, role: 'system', content: SYS.joined, created_at: now },
          ...rows.map((r, i) => ({ id: r.id, role: 'agent', content: r.text, created_at: now + 1 + i })),
        ],
      },
    };
  } catch (e) {
    // Give the messages back so a retry (or the team) does not lose them.
    console.error('proactive accept failed:', (e as Error)?.message);
    try {
      await db.batch(
        rows.map((r) =>
          db.prepare('INSERT OR IGNORE INTO proactive_inbox (id, presence_id, text, created_at, delivered_at) VALUES (?, ?, ?, ?, ?)').bind(r.id, presenceId, r.text, r.created_at, now),
        ),
      );
    } catch {
      // nothing else to do
    }
    return { status: 502, data: { error: 'unavailable' } };
  }
}

// Retention: presence rows 15 minutes after their last heartbeat (the cron runs every
// 15 minutes, so a row lives at most about 30 minutes after the last signal). Team messages
// do NOT go with their presence row: they stay until 1 hour after their creation or
// delivery, so a visitor who opens the teaser late can still accept them.
export async function purgeLive(env: StoreEnv, now = Date.now()): Promise<void> {
  if (!env.DB) return;
  try {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM presence WHERE last_seen < ?').bind(now - PURGE_MS),
      env.DB
        .prepare('DELETE FROM proactive_inbox WHERE MAX(created_at, COALESCE(delivered_at, 0)) < ?')
        .bind(now - INBOX_KEEP_MS),
    ]);
  } catch (e) {
    console.error('purgeLive failed:', (e as Error)?.message);
  }
}

// Team side ------------------------------------------------------------------------------------------

const ok = (data: unknown, status = 200): Out => ({ status, data });
const fail = (error: string, status: number): Out => ({ status, data: { error } });

interface OnlineRow {
  presence_id: string;
  session_id: string | null;
  url: string;
  title: string | null;
  lang: string | null;
  country: string | null;
  city: string | null;
  device: string | null;
  os: string | null;
  browser: string | null;
  first_seen: number;
  last_seen: number;
  referrer_host: string | null;
  conv_mode: string | null;
  pending: number;
}

// Visitors seen in the last 90 s, newest first. Stale rows are purged on the way
// (that is the opportunistic purge: the panel polls this every 10 s while open).
export async function listOnline(env: StoreEnv, now = Date.now()): Promise<Out> {
  const db = env.DB!;
  await purgeLive(env, now);
  const r = await db
    .prepare(
      `SELECT p.presence_id, p.session_id, p.url, p.title, p.lang, p.country, p.city, p.device, p.os, p.browser,
              p.first_seen, p.last_seen, p.referrer_host, c.mode AS conv_mode,
              (SELECT COUNT(*) FROM proactive_inbox q WHERE q.presence_id = p.presence_id) AS pending
       FROM presence p LEFT JOIN conversations c ON c.id = p.session_id
       WHERE p.last_seen >= ?1 ORDER BY p.first_seen DESC LIMIT 200`,
    )
    .bind(now - ONLINE_MS)
    .all<OnlineRow>();
  return ok({
    now,
    items: (r.results ?? []).map((p) => ({
      id: p.presence_id,
      sessionId: p.session_id,
      url: p.url,
      title: p.title,
      lang: p.lang,
      country: p.country,
      city: p.city,
      device: p.device,
      os: p.os,
      browser: p.browser,
      firstSeen: p.first_seen,
      lastSeen: p.last_seen,
      referrerHost: p.referrer_host,
      convMode: p.conv_mode,
      pending: p.pending,
    })),
  });
}

// The team writes first. The message waits in proactive_inbox until the widget's next
// heartbeat collects it; nothing is created in `messages` unless the visitor opens it.
export async function sendProactive(env: StoreEnv, presenceId: string, body: { text?: unknown }, now = Date.now()): Promise<Out> {
  const db = env.DB!;
  const text = typeof body.text === 'string' ? body.text.replace(/\r\n?/g, '\n').trim() : '';
  if (!text || text.length > MAX_PROACTIVE_TEXT) return fail('invalid_text', 400);
  if (!isPresenceId(presenceId)) return fail('not_found', 404);
  const here = await db.prepare('SELECT last_seen FROM presence WHERE presence_id = ?').bind(presenceId).first<{ last_seen: number }>();
  if (!here) return fail('not_found', 404);
  if (here.last_seen < now - GONE_MS) return fail('visitor_gone', 410);
  if ((await hit(db, 'proactive', 3600_000, now)) > PROACTIVE_PER_HOUR) return fail('rate_limited', 429);
  // The cap and the insert are one statement, so parallel sends cannot pass it.
  const res = await db
    .prepare(
      `INSERT INTO proactive_inbox (id, presence_id, text, created_at)
       SELECT ?1, ?2, ?3, ?4 WHERE (SELECT COUNT(*) FROM proactive_inbox WHERE presence_id = ?2) < ${MAX_PENDING_PER_VISITOR}`,
    )
    .bind(crypto.randomUUID(), presenceId, text, now)
    .run();
  if ((res.meta?.changes ?? 0) === 0) return fail('too_many_pending', 409);
  return ok({ ok: true }, 201);
}
