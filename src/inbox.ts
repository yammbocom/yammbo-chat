// inbox.ts
// Visitor-facing half of the shared inbox (see migrations/0003_inbox.sql): the team
// takes a conversation over, the widget polls for the team's messages, and the
// visitor rates the conversation once it is resolved. The team-facing half lives in
// panel-inbox.ts.
//
// The sessionId is the only credential of these endpoints, so they require a
// "strong" id (>= 32 URL-safe chars: the widget mints 192 random bits, a UUID is
// 36 chars). Older short ids keep working for the chat itself but cannot be taken
// over or polled. Every query uses bound parameters.

import type { StoreEnv } from './store';

export type Mode = 'bot' | 'waiting' | 'human';

// System message codes (messages.role = 'system'). The clients translate them, so
// the stored text does not depend on the visitor's language.
export const SYS = {
  waiting: 'sys:waiting',
  joined: 'sys:joined',
  returned: 'sys:returned',
  resolved: 'sys:resolved',
} as const;

export function isStrongId(v: unknown): v is string {
  return typeof v === 'string' && /^[A-Za-z0-9_-]{32,64}$/.test(v);
}

export interface LiveHit {
  city: string | null;
  country: string | null;
}

// A visitor message that arrives while the team is in charge. One conditional
// UPDATE decides: it only matches when the conversation is 'waiting' or 'human'
// at that very instant (check and act are the same statement), so a request never
// lands half in the LLM path and half here. Null means "bot mode, carry on".
export async function takeLiveMessage(
  env: StoreEnv,
  m: { sessionId: string; content: string; pageUrl: string | null },
): Promise<LiveHit | null> {
  const db = env.DB;
  // Live mode only exists for strong ids (see isStrongId): a short id never gets here
  // in waiting/human mode, and must not be answered by silence if it did.
  if (!db || !isStrongId(m.sessionId)) return null;
  try {
    const now = Date.now();
    const row = await db
      .prepare(
        `UPDATE conversations SET updated_at = ?1, msg_count = msg_count + 1, unread = unread + 1, status = 'open'
         WHERE id = ?2 AND mode IN ('waiting', 'human') RETURNING city, country`,
      )
      .bind(now, m.sessionId)
      .first<LiveHit>();
    if (!row) return null;
    try {
      await db
        .prepare('INSERT INTO messages (id, session_id, role, content, created_at, page_url) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(crypto.randomUUID(), m.sessionId, 'user', m.content, now, m.pageUrl)
        .run();
    } catch (e) {
      console.error('d1 takeLiveMessage insert failed:', (e as Error)?.message);
    }
    return { city: row.city, country: row.country };
  } catch (e) {
    console.error('d1 takeLiveMessage failed:', (e as Error)?.message);
    return null;
  }
}

export interface HandoffResult {
  found: boolean;
  mode: Mode;
  // True when this call moved the conversation from 'bot' to 'waiting' (alert once).
  changed: boolean;
  city: string | null;
  country: string | null;
  lang: string | null;
  lastQuestion: string;
}

// The visitor asks to talk to a person. Only bot -> waiting changes anything;
// repeated calls (or a conversation already with the team) are answered with the
// current mode and raise no new alert.
export async function requestHandoff(env: StoreEnv, sessionId: string): Promise<HandoffResult> {
  const db = env.DB!;
  const now = Date.now();
  const row = await db
    .prepare(
      `UPDATE conversations SET mode = 'waiting', status = 'open', updated_at = ?1
       WHERE id = ?2 AND mode = 'bot' RETURNING city, country, lang`,
    )
    .bind(now, sessionId)
    .first<{ city: string | null; country: string | null; lang: string | null }>();
  if (row) {
    const last = await db
      .prepare("SELECT content FROM messages WHERE session_id = ? AND role = 'user' ORDER BY created_at DESC LIMIT 1")
      .bind(sessionId)
      .first<{ content: string }>();
    await db
      .prepare('INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), sessionId, 'system', SYS.waiting, now)
      .run();
    return { found: true, mode: 'waiting', changed: true, city: row.city, country: row.country, lang: row.lang, lastQuestion: last?.content ?? '' };
  }
  const cur = await db.prepare('SELECT mode FROM conversations WHERE id = ?').bind(sessionId).first<{ mode: Mode }>();
  return { found: !!cur, mode: cur?.mode ?? 'bot', changed: false, city: null, country: null, lang: null, lastQuestion: '' };
}

export interface LivePoll {
  mode: Mode;
  status: string;
  messages: Array<{ id: string; role: 'agent' | 'system'; content: string; created_at: number }>;
  // The team asked for a rating and the visitor has not answered yet.
  csat: boolean;
}

// What the widget polls: the team's messages and system lines after `after`, plus
// the state it needs (mode, rating request). Internal notes and tags are never
// part of this. Null when the conversation does not exist.
export async function listLiveMessages(env: StoreEnv, sessionId: string, after: number): Promise<LivePoll | null> {
  const db = env.DB!;
  const res = await db.batch([
    db.prepare('SELECT mode, status, csat, csat_requested FROM conversations WHERE id = ?').bind(sessionId),
    db
      .prepare(
        `SELECT id, role, content, created_at FROM messages
         WHERE session_id = ?1 AND role IN ('agent', 'system') AND created_at > ?2
         ORDER BY created_at ASC LIMIT 50`,
      )
      .bind(sessionId, after),
  ]);
  const conv = (res[0].results ?? [])[0] as { mode: Mode; status: string; csat: number | null; csat_requested: number } | undefined;
  if (!conv) return null;
  return {
    mode: conv.mode,
    status: conv.status,
    messages: (res[1].results ?? []) as LivePoll['messages'],
    csat: conv.csat_requested === 1 && conv.csat === null,
  };
}

// One rating per conversation: the UPDATE only matches while it was requested and
// not answered yet. False = nothing to rate (never requested, or already rated).
export async function saveCsat(env: StoreEnv, sessionId: string, score: number, comment: string): Promise<boolean> {
  const db = env.DB!;
  const res = await db
    .prepare(
      `UPDATE conversations SET csat = ?1, csat_comment = ?2, csat_at = ?3
       WHERE id = ?4 AND csat_requested = 1 AND csat IS NULL`,
    )
    .bind(score, comment || null, Date.now(), sessionId)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}
