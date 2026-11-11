// store.ts
// D1 persistence for the chat (conversations, messages, leads, feedback).
//
// Every write here is best-effort: callers run it inside ctx.waitUntil (or after
// the response is already decided) and each function swallows its own errors, so
// a D1 outage can never break the chat.

import type { PageContext } from './page';

const MAX_CONTENT = 4000;
const DAY_MS = 24 * 3600_000;
const RETENTION_CHAT_DAYS = 90;
const RETENTION_LEADS_DAYS = 365;
// A page view of the same session+url inside this window is not stored again.
const VISIT_DEDUPE_MS = 30 * 60_000;

export interface StoreEnv {
  DB?: D1Database;
  // Secret (wrangler secret put IP_SALT). Without it no ip_hash is stored:
  // a public salt would let anyone with D1 access brute-force IPv4.
  IP_SALT?: string;
}

export function isValidId(v: unknown): v is string {
  return typeof v === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(v);
}

// sha256(ip | UTC date | secret salt), hex. The date makes it rotate daily, so
// it cannot follow anybody across days. The raw IP is never stored.
export async function ipHash(ip: string, salt: string | undefined, now = new Date()): Promise<string | null> {
  if (!salt) return null;
  const day = now.toISOString().slice(0, 10);
  const data = new TextEncoder().encode(`${ip}|${day}|${salt}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Reads a (teed) OpenAI-style SSE stream and rebuilds the assistant text.
export async function readSseText(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let text = '';
  const feed = (line: string) => {
    line = line.trim();
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return;
    try {
      const j = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> };
      const c = j.choices?.[0]?.delta?.content;
      if (typeof c === 'string') text += c;
    } catch {
      // partial / non-JSON frame: ignore
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const l of lines) feed(l);
  }
  buf += dec.decode();
  if (buf) feed(buf);
  return text;
}

export interface ChatTurn {
  sessionId: string;
  userContent: string;
  assistantId: string;
  stream: ReadableStream<Uint8Array>;
  page: PageContext | null;
  lang: string;
  ip: string;
  ragHits: number;
  provider: string;
  startedAt: number;
  // Coarse, derived from the request (see device.ts); only used when the conversation is created.
  country: string | null;
  city: string | null;
  device: string | null;
  os: string | null;
  browser: string | null;
}

export interface PersistResult {
  // True when this turn created the conversation row (first turn of the session).
  isNew: boolean;
}

// Consumes the teed response branch, then writes the user message, the
// assistant message and the conversation upsert in one batch. Returns null when
// nothing was stored.
export async function persistChatTurn(env: StoreEnv, turn: ChatTurn): Promise<PersistResult | null> {
  const db = env.DB;
  if (!db) return null;
  try {
    const raw = await readSseText(turn.stream);
    const latency = Date.now() - turn.startedAt;
    const handoff = /\[\[HANDOFF\]\]/.test(raw) ? 1 : 0;
    const assistant = raw.replace(/\[\[HANDOFF\]\]/g, '').trim().slice(0, MAX_CONTENT);
    const now = Date.now();
    const hash = await ipHash(turn.ip, env.IP_SALT);

    const stmts: D1PreparedStatement[] = [
      db
        .prepare('INSERT INTO messages (id, session_id, role, content, created_at, page_url) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(crypto.randomUUID(), turn.sessionId, 'user', turn.userContent.slice(0, MAX_CONTENT), now, turn.page?.url ?? null),
    ];
    let added = 1;
    if (assistant) {
      stmts.push(
        db
          .prepare(
            'INSERT INTO messages (id, session_id, role, content, created_at, provider, rag_hits, handoff, latency_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .bind(turn.assistantId, turn.sessionId, 'assistant', assistant, now + 1, turn.provider, turn.ragHits, handoff, latency),
      );
      added = 2;
    }
    stmts.push(
      db
        .prepare(
          `INSERT INTO conversations (id, created_at, updated_at, page_url, product, lang, ip_hash, msg_count, country, city, device, os, browser)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             updated_at = excluded.updated_at,
             page_url = COALESCE(excluded.page_url, conversations.page_url),
             product = COALESCE(excluded.product, conversations.product),
             lang = excluded.lang,
             msg_count = conversations.msg_count + excluded.msg_count,
             country = COALESCE(conversations.country, excluded.country),
             city = COALESCE(conversations.city, excluded.city),
             device = COALESCE(conversations.device, excluded.device),
             os = COALESCE(conversations.os, excluded.os),
             browser = COALESCE(conversations.browser, excluded.browser)
           RETURNING created_at`,
        )
        .bind(
          turn.sessionId, now, now, turn.page?.url ?? null, turn.page?.product ?? null, turn.lang, hash, added,
          turn.country, turn.city, turn.device, turn.os, turn.browser,
        ),
    );
    const res = await db.batch(stmts);
    // created_at only equals `now` when this very statement inserted the row.
    const row = res[res.length - 1].results?.[0] as { created_at?: number } | undefined;
    return { isNew: row?.created_at === now };
  } catch (e) {
    console.error('d1 persistChatTurn failed:', (e as Error)?.message);
    return null;
  }
}

// Records a page the visitor opened after using the chat. The row is written
// only when the conversation exists and the same session+url was not recorded
// in the last 30 minutes. Callers answer 204 either way: no existence oracle.
export async function saveVisit(env: StoreEnv, sessionId: string, url: string, title: string, now = Date.now()): Promise<boolean> {
  if (!env.DB) return false;
  try {
    const res = await env.DB
      .prepare(
        `INSERT INTO page_views (session_id, url, title, created_at)
         SELECT ?1, ?2, ?3, ?4
         WHERE EXISTS (SELECT 1 FROM conversations WHERE id = ?1)
           AND NOT EXISTS (SELECT 1 FROM page_views WHERE session_id = ?1 AND url = ?2 AND created_at > ?5)`,
      )
      .bind(sessionId, url, title, now, now - VISIT_DEDUPE_MS)
      .run();
    return (res.meta?.changes ?? 0) > 0;
  } catch (e) {
    console.error('d1 saveVisit failed:', (e as Error)?.message);
    return false;
  }
}

export interface LeadRow {
  id: string;
  sessionId: string | null;
  name: string;
  email: string;
  phone: string;
  channel: string;
  message: string;
  lang: string;
  pageUrl: string | null;
}

// Returns true when the lead row was stored.
export async function saveLead(env: StoreEnv, lead: LeadRow): Promise<boolean> {
  if (!env.DB) return false;
  try {
    await env.DB
      .prepare(
        'INSERT INTO leads (id, created_at, session_id, name, email, phone, channel, message, lang, page_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(lead.id, Date.now(), lead.sessionId, lead.name, lead.email, lead.phone, lead.channel, lead.message, lead.lang, lead.pageUrl)
      .run();
    return true;
  } catch (e) {
    console.error('d1 saveLead failed:', (e as Error)?.message);
    return false;
  }
}

export async function saveLeadNotify(env: StoreEnv, id: string, results: unknown): Promise<void> {
  if (!env.DB) return;
  try {
    await env.DB.prepare('UPDATE leads SET notify = ? WHERE id = ?').bind(JSON.stringify(results).slice(0, 2000), id).run();
  } catch (e) {
    console.error('d1 saveLeadNotify failed:', (e as Error)?.message);
  }
}

// Upserts the rating for an assistant message of this session. Returns false
// when the message is unknown (or D1 is unavailable).
export async function saveFeedback(env: StoreEnv, sessionId: string, messageId: string, rating: 1 | -1): Promise<boolean> {
  if (!env.DB) return false;
  try {
    const res = await env.DB
      .prepare(
        `INSERT INTO feedback (message_id, session_id, rating, created_at)
         SELECT ?1, ?2, ?3, ?4
         WHERE EXISTS (SELECT 1 FROM messages WHERE id = ?1 AND session_id = ?2 AND role = 'assistant')
         ON CONFLICT(message_id) DO UPDATE SET rating = excluded.rating, created_at = excluded.created_at`,
      )
      .bind(messageId, sessionId, rating, Date.now())
      .run();
    return (res.meta?.changes ?? 0) > 0;
  } catch (e) {
    console.error('d1 saveFeedback failed:', (e as Error)?.message);
    return false;
  }
}

// Retention: chat data 90 days, leads 365 days.
export async function purgeOld(env: StoreEnv, now = Date.now()): Promise<void> {
  if (!env.DB) return;
  try {
    const chatCut = now - RETENTION_CHAT_DAYS * DAY_MS;
    const leadCut = now - RETENTION_LEADS_DAYS * DAY_MS;
    const res = await env.DB.batch([
      env.DB.prepare('DELETE FROM messages WHERE created_at < ?').bind(chatCut),
      env.DB.prepare('DELETE FROM conversations WHERE updated_at < ?').bind(chatCut),
      env.DB.prepare('DELETE FROM feedback WHERE created_at < ?').bind(chatCut),
      env.DB.prepare('DELETE FROM leads WHERE created_at < ?').bind(leadCut),
    ]);
    console.log('retention purge ok', JSON.stringify(res.map((r) => r.meta?.changes ?? 0)));
  } catch (e) {
    console.error('retention purge failed:', (e as Error)?.message);
  }
  // Separate from the batch above: page_views comes from migration 0002, and a
  // missing table (or any failure here) must not stop the chat/lead purge.
  try {
    const res = await env.DB.prepare('DELETE FROM page_views WHERE created_at < ?').bind(now - RETENTION_CHAT_DAYS * DAY_MS).run();
    console.log('retention purge page_views ok', res.meta?.changes ?? 0);
  } catch (e) {
    console.error('retention purge page_views failed:', (e as Error)?.message);
  }
}
