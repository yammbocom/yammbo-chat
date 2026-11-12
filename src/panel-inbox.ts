// panel-inbox.ts
// Team-facing half of the shared inbox (the visitor-facing half is inbox.ts):
// replies, takeover mode, status, tags, internal notes, canned replies and the
// AI draft. Authentication and the anti-CSRF header are enforced by panel.ts before
// any of these run. Handlers return { status, data }; panel.ts turns that into a
// Response. Every query uses bound parameters.

import { detectLanguage, buildDraftPrompt, completeReply, type BrainEnv, type ChatMessage } from './brain';
import { hit } from './limit';
import { sendVisitorEmail, type NotifyEnv } from './notify';
import { PRODUCT_NAMES, type Product } from './page';
import { retrieve, type KbChunk, type RagEnv } from './rag';
import { SYS, isStrongId, type Mode } from './inbox';
import { isValidId, type StoreEnv } from './store';

export interface InboxEnv extends StoreEnv, NotifyEnv, BrainEnv, RagEnv {}
export interface Out {
  status: number;
  data: unknown;
}

const ok = (data: unknown, status = 200): Out => ({ status, data });
const fail = (error: string, status: number): Out => ({ status, data: { error } });

const MAX_TEXT = 2000;
const MAX_TAGS = 8;
const MAX_TAG_LEN = 24;
const MAX_CANNED = 200;
const DRAFTS_PER_HOUR = 60;
const HOUR_MS = 3600_000;
const MAX_EMAIL_REPLIES = 10;
// Wait before deciding on the email copy, so a burst of replies becomes one email (the last one sends it).
// waitUntil() keeps the Worker alive about 30 s after the response, so this must stay well under that.
const EMAIL_DEBOUNCE_MS = 15_000;

function str(v: unknown): string {
  return typeof v === 'string' ? v.replace(/\r\n?/g, '\n').trim() : '';
}

// Replies -----------------------------------------------------------------------------

// The team writes to the visitor. Writing in bot (or waiting) mode takes the
// conversation over: mode -> 'human' plus a "the team joined" line. Also reopens a
// resolved conversation and clears its unread counter (the agent is looking at it).
// Whether the visitor should get the email copy of the team reply written at `agentAt`:
// no when a newer team message exists (the last reply of a burst sends the email), and no when an
// open chat already showed that reply (conversations.visitor_seen_at, set by GET /api/messages?open=1).
export async function shouldEmailVisitor(db: D1Database, id: string, agentAt: number): Promise<boolean> {
  const newer = await db
    .prepare("SELECT 1 AS x FROM messages WHERE session_id = ? AND role = 'agent' AND created_at > ? LIMIT 1")
    .bind(id, agentAt)
    .first();
  if (newer) return false;
  const conv = await db.prepare('SELECT visitor_seen_at FROM conversations WHERE id = ?').bind(id).first<{ visitor_seen_at: number | null }>();
  return !conv || (conv.visitor_seen_at ?? 0) < agentAt;
}

// The team replies the visitor has not seen: after their last message and after what an open chat
// last showed them, oldest first, at most MAX_EMAIL_REPLIES (the newest ones).
export async function unseenReplies(db: D1Database, id: string): Promise<string[]> {
  const r = await db
    .prepare(
      `SELECT content FROM messages
       WHERE session_id = ?1 AND role = 'agent'
         AND created_at > MAX(
           COALESCE((SELECT MAX(created_at) FROM messages WHERE session_id = ?1 AND role = 'user'), 0),
           COALESCE((SELECT visitor_seen_at FROM conversations WHERE id = ?1), 0))
       ORDER BY created_at DESC LIMIT ${MAX_EMAIL_REPLIES}`,
    )
    .bind(id)
    .all<{ content: string }>();
  return (r.results ?? []).map((x) => x.content).reverse();
}

export async function postReply(env: InboxEnv, ctx: ExecutionContext | undefined, id: string, body: { text?: unknown }): Promise<Out> {
  const db = env.DB!;
  const text = str(body.text);
  if (!text || text.length > MAX_TEXT) return fail('invalid_text', 400);
  const conv = await db
    .prepare('SELECT mode, lang, page_url FROM conversations WHERE id = ?')
    .bind(id)
    .first<{ mode: Mode; lang: string | null; page_url: string | null }>();
  if (!conv) return fail('not_found', 404);
  // Short (legacy) ids cannot go live: the widget would never see the answer.
  if (!isStrongId(id)) return fail('legacy_session', 409);

  const now = Date.now();
  const joined = conv.mode !== 'human';
  const joinedId = crypto.randomUUID();
  const agentId = crypto.randomUUID();
  const agentAt = joined ? now + 1 : now;
  const stmts: D1PreparedStatement[] = [];
  if (joined) {
    stmts.push(
      db.prepare('INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)').bind(joinedId, id, 'system', SYS.joined, now),
    );
  }
  stmts.push(
    db.prepare('INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)').bind(agentId, id, 'agent', text, agentAt),
    db
      .prepare(
        `UPDATE conversations SET mode = 'human', status = 'open', last_agent_at = ?1, updated_at = ?1, unread = 0, msg_count = msg_count + 1
         WHERE id = ?2`,
      )
      .bind(agentAt, id),
  );
  await db.batch(stmts);

  // Email copy for visitors who left an address, only for what an open chat did not show them:
  // 15 s after the reply (a burst of replies sends one email, from the last one) the visitor must
  // not have seen it (the widget reports what its open chat showed through GET /api/messages?open=1;
  // presence alone is not enough: with the chat closed the widget does not show anything). The
  // email lists only the replies not seen yet. Inactive without ZEPTOMAIL_API_TOKEN.
  if (env.ZEPTOMAIL_API_TOKEN && ctx) {
    ctx.waitUntil(
      (async () => {
        try {
          const lead = await db
            .prepare('SELECT email FROM leads WHERE session_id = ? AND email IS NOT NULL AND email != \'\' ORDER BY created_at DESC LIMIT 1')
            .bind(id)
            .first<{ email: string }>();
          if (!lead?.email) return;
          await new Promise((r) => setTimeout(r, EMAIL_DEBOUNCE_MS));
          if (!(await shouldEmailVisitor(db, id, agentAt))) return;
          const replies = await unseenReplies(db, id);
          if (!replies.length) return; // the visitor wrote after it, or saw everything: nothing to email
          await sendVisitorEmail(env, lead.email, conv.lang === 'en' ? 'en' : 'es', replies, conv.page_url);
        } catch (e) {
          console.error('visitor email failed:', (e as Error)?.message);
        }
      })(),
    );
  }
  return ok({
    mode: 'human',
    status: 'open',
    messages: [
      ...(joined ? [{ id: joinedId, role: 'system', content: SYS.joined, createdAt: now }] : []),
      { id: agentId, role: 'agent', content: text, createdAt: agentAt },
    ],
  });
}

// Take over / hand back. 'waiting' is only ever set by the visitor.
export async function setMode(env: InboxEnv, id: string, body: { mode?: unknown }): Promise<Out> {
  const db = env.DB!;
  const mode = body.mode;
  if (mode !== 'human' && mode !== 'bot') return fail('invalid_mode', 400);
  const cur = await db.prepare('SELECT mode FROM conversations WHERE id = ?').bind(id).first<{ mode: Mode }>();
  if (!cur) return fail('not_found', 404);
  // Taking over needs a strong id (see postReply). Handing back stays possible.
  if (mode === 'human' && !isStrongId(id)) return fail('legacy_session', 409);
  if (cur.mode === mode) return ok({ mode, changed: false });
  const now = Date.now();
  await db.batch([
    db
      .prepare(
        mode === 'human'
          ? "UPDATE conversations SET mode = 'human', status = 'open', last_agent_at = ?1, updated_at = ?1, unread = 0 WHERE id = ?2"
          : "UPDATE conversations SET mode = 'bot', updated_at = ?1 WHERE id = ?2",
      )
      .bind(now, id),
    db
      .prepare('INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), id, 'system', mode === 'human' ? SYS.joined : SYS.returned, now),
  ]);
  return ok({ mode, changed: true });
}

// Resolve / reopen. Resolving hands the conversation back to the assistant (the
// visitor's next message reopens it) and, when the team took part, asks the visitor
// for a rating (csat_requested; answered at most once, see saveCsat).
export async function setStatus(env: InboxEnv, id: string, body: { status?: unknown }): Promise<Out> {
  const db = env.DB!;
  const status = body.status;
  if (status !== 'open' && status !== 'resolved') return fail('invalid_status', 400);
  const cur = await db.prepare('SELECT status FROM conversations WHERE id = ?').bind(id).first<{ status: string }>();
  if (!cur) return fail('not_found', 404);
  if (cur.status === status) return ok({ status, changed: false });
  const now = Date.now();
  if (status === 'open') {
    await db.prepare("UPDATE conversations SET status = 'open', updated_at = ?1 WHERE id = ?2 AND status = 'resolved'").bind(now, id).run();
    return ok({ status, changed: true });
  }
  // Order matters inside the batch: the system line is decided on the state BEFORE
  // the UPDATE flips mode and status. It is only written when the team took part
  // (a purely bot conversation resolved by an agent shows the visitor nothing).
  await db.batch([
    db
      .prepare(
        `INSERT INTO messages (id, session_id, role, content, created_at)
         SELECT ?1, ?2, 'system', ?3, ?4
         WHERE EXISTS (SELECT 1 FROM conversations WHERE id = ?2 AND status != 'resolved'
                       AND (mode != 'bot' OR EXISTS (SELECT 1 FROM messages WHERE session_id = ?2 AND role = 'agent')))`,
      )
      .bind(crypto.randomUUID(), id, SYS.resolved, now),
    db
      .prepare(
        `UPDATE conversations SET status = 'resolved', mode = 'bot', updated_at = ?1,
           csat_requested = CASE WHEN csat IS NULL AND EXISTS (SELECT 1 FROM messages WHERE session_id = ?2 AND role = 'agent') THEN 1 ELSE csat_requested END
         WHERE id = ?2 AND status != 'resolved'`,
      )
      .bind(now, id),
  ]);
  return ok({ status, changed: true });
}

// Tags ----------------------------------------------------------------------------------

// Lower case, letters/digits/hyphen/underscore, spaces become hyphens, <= 24 chars.
export function normalizeTag(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}_-]/gu, '')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, MAX_TAG_LEN)
    .replace(/[-_]+$/g, '');
  return t || null;
}

async function tagsOf(db: D1Database, id: string): Promise<string[]> {
  const r = await db.prepare('SELECT tag FROM conversation_tags WHERE session_id = ? ORDER BY created_at ASC, tag ASC').bind(id).all<{ tag: string }>();
  return (r.results ?? []).map((x) => x.tag);
}

export async function addTag(env: InboxEnv, id: string, body: { tag?: unknown }): Promise<Out> {
  const db = env.DB!;
  const tag = normalizeTag(body.tag);
  if (!tag) return fail('invalid_tag', 400);
  // The cap and the insert are one statement, so parallel requests cannot pass it.
  const res = await db
    .prepare(
      `INSERT OR IGNORE INTO conversation_tags (session_id, tag, created_at)
       SELECT ?1, ?2, ?3
       WHERE EXISTS (SELECT 1 FROM conversations WHERE id = ?1)
         AND (SELECT COUNT(*) FROM conversation_tags WHERE session_id = ?1) < ${MAX_TAGS}`,
    )
    .bind(id, tag, Date.now())
    .run();
  const tags = await tagsOf(db, id);
  if ((res.meta?.changes ?? 0) === 0 && !tags.includes(tag)) {
    const exists = await db.prepare('SELECT 1 AS x FROM conversations WHERE id = ?').bind(id).first();
    return exists ? fail('too_many_tags', 409) : fail('not_found', 404);
  }
  return ok({ tags });
}

export async function removeTag(env: InboxEnv, id: string, rawTag: string): Promise<Out> {
  const db = env.DB!;
  const tag = normalizeTag(rawTag);
  if (!tag) return fail('invalid_tag', 400);
  await db.prepare('DELETE FROM conversation_tags WHERE session_id = ? AND tag = ?').bind(id, tag).run();
  return ok({ tags: await tagsOf(db, id) });
}

// Tags already in use (most used first): suggestions for the tag input and filter.
export async function listTagSuggestions(env: InboxEnv): Promise<Out> {
  const r = await env
    .DB!.prepare('SELECT tag, COUNT(*) AS n FROM conversation_tags GROUP BY tag ORDER BY n DESC, tag ASC LIMIT 100')
    .all<{ tag: string; n: number }>();
  return ok({ tags: r.results ?? [] });
}

// Notes ---------------------------------------------------------------------------------

export async function listNotes(env: InboxEnv, id: string): Promise<Out> {
  return ok({ notes: await notesOf(env.DB!, id) });
}

export async function notesOf(db: D1Database, id: string): Promise<Array<{ id: string; body: string; createdAt: number }>> {
  const r = await db
    .prepare('SELECT id, body, created_at FROM notes WHERE session_id = ? ORDER BY created_at ASC LIMIT 200')
    .bind(id)
    .all<{ id: string; body: string; created_at: number }>();
  return (r.results ?? []).map((n) => ({ id: n.id, body: n.body, createdAt: n.created_at }));
}

export async function addNote(env: InboxEnv, id: string, body: { body?: unknown }): Promise<Out> {
  const db = env.DB!;
  const text = str(body.body);
  if (!text || text.length > MAX_TEXT) return fail('invalid_note', 400);
  const noteId = crypto.randomUUID();
  const now = Date.now();
  const res = await db
    .prepare('INSERT INTO notes (id, session_id, body, created_at) SELECT ?1, ?2, ?3, ?4 WHERE EXISTS (SELECT 1 FROM conversations WHERE id = ?2)')
    .bind(noteId, id, text, now)
    .run();
  if ((res.meta?.changes ?? 0) === 0) return fail('not_found', 404);
  return ok({ note: { id: noteId, body: text, createdAt: now } }, 201);
}

export async function deleteNote(env: InboxEnv, id: string, noteId: string): Promise<Out> {
  if (!isValidId(noteId)) return fail('not_found', 404);
  await env.DB!.prepare('DELETE FROM notes WHERE id = ? AND session_id = ?').bind(noteId, id).run();
  return ok({ ok: true });
}

// Canned replies -------------------------------------------------------------------------

interface CannedRow {
  id: string;
  shortcut: string;
  title: string;
  body: string;
  created_at: number;
  updated_at: number;
}

function cannedOut(r: CannedRow) {
  return { id: r.id, shortcut: r.shortcut, title: r.title, body: r.body, updatedAt: r.updated_at };
}

export async function listCanned(env: InboxEnv): Promise<Out> {
  const r = await env.DB!.prepare('SELECT id, shortcut, title, body, created_at, updated_at FROM canned ORDER BY shortcut ASC LIMIT 500').all<CannedRow>();
  return ok({ items: (r.results ?? []).map(cannedOut) });
}

function parseCanned(body: { shortcut?: unknown; title?: unknown; body?: unknown }): { shortcut: string; title: string; body: string } | string {
  const shortcut = str(body.shortcut).replace(/^\//, '').toLowerCase();
  if (!/^[a-z0-9-]{1,24}$/.test(shortcut)) return 'invalid_shortcut';
  const title = str(body.title);
  if (!title || title.length > 80) return 'invalid_title';
  const text = str(body.body);
  if (!text || text.length > MAX_TEXT) return 'invalid_body';
  return { shortcut, title, body: text };
}

// id = null creates, otherwise updates that row.
export async function saveCanned(env: InboxEnv, id: string | null, body: { shortcut?: unknown; title?: unknown; body?: unknown }): Promise<Out> {
  const db = env.DB!;
  const v = parseCanned(body);
  if (typeof v === 'string') return fail(v, 400);
  const now = Date.now();
  try {
    if (id === null) {
      const n = await db.prepare('SELECT COUNT(*) AS n FROM canned').first<{ n: number }>();
      if ((n?.n ?? 0) >= MAX_CANNED) return fail('too_many_canned', 409);
      const newId = crypto.randomUUID();
      await db.prepare('INSERT INTO canned (id, shortcut, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').bind(newId, v.shortcut, v.title, v.body, now, now).run();
      return ok({ item: { id: newId, ...v, updatedAt: now } }, 201);
    }
    const res = await db
      .prepare('UPDATE canned SET shortcut = ?1, title = ?2, body = ?3, updated_at = ?4 WHERE id = ?5')
      .bind(v.shortcut, v.title, v.body, now, id)
      .run();
    if ((res.meta?.changes ?? 0) === 0) return fail('not_found', 404);
    return ok({ item: { id, ...v, updatedAt: now } });
  } catch (e) {
    if (/UNIQUE/i.test((e as Error)?.message || '')) return fail('shortcut_taken', 409);
    throw e;
  }
}

export async function deleteCanned(env: InboxEnv, id: string): Promise<Out> {
  await env.DB!.prepare('DELETE FROM canned WHERE id = ?').bind(id).run();
  return ok({ ok: true });
}

// AI draft ---------------------------------------------------------------------------------

// Drafts a reply for the agent to edit. Never sent anywhere: the text only goes
// back to the compositor. Same RAG as the bot, same providers (Groq, then Gemini),
// no streaming. Capped globally (60 per hour) because every call spends LLM quota.
export async function makeDraft(env: InboxEnv, id: string): Promise<Out> {
  const db = env.DB!;
  const conv = await db.prepare('SELECT lang, product FROM conversations WHERE id = ?').bind(id).first<{ lang: string | null; product: string | null }>();
  if (!conv) return fail('not_found', 404);
  const rows = (
    await db
      .prepare("SELECT role, content FROM messages WHERE session_id = ? AND role != 'system' ORDER BY created_at DESC LIMIT 14")
      .bind(id)
      .all<{ role: string; content: string }>()
  ).results ?? [];
  rows.reverse();
  const lastUser = [...rows].reverse().find((m) => m.role === 'user');
  if (!lastUser) return fail('no_question', 400);

  if ((await hit(db, 'drafts', HOUR_MS)) > DRAFTS_PER_HOUR) return fail('rate_limited', 429);

  const asChat: ChatMessage[] = rows.map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content }));
  const lang: 'en' | 'es' = conv.lang === 'es' || conv.lang === 'en' ? conv.lang : detectLanguage(asChat);
  const product = conv.product && Object.prototype.hasOwnProperty.call(PRODUCT_NAMES, conv.product) ? (conv.product as Product) : null;
  const pageLine = product ? `The visitor is on the ${PRODUCT_NAMES[product]} pages. When a question is ambiguous, assume it is about that product.` : '';

  let chunks: KbChunk[] | null = null;
  try {
    chunks = await retrieve(env, product ? `${PRODUCT_NAMES[product]} ${lastUser.content}` : lastUser.content, lang, 6);
  } catch (e) {
    console.error('draft retrieve failed, falling back to the KB index:', (e as Error)?.message);
  }

  const label = (r: string) => (r === 'user' ? 'Visitor' : r === 'agent' ? 'Team' : 'Assistant');
  const transcript = rows.map((m) => `${label(m.role)}: ${m.content.slice(0, MAX_TEXT)}`).join('\n\n');
  const out = await completeReply(env, buildDraftPrompt(chunks, lang, pageLine), [
    { role: 'user', content: `Conversation so far:\n\n${transcript}\n\nWrite the team's next reply to the visitor's latest message.` },
  ]);
  if (!out) return fail('draft_failed', 502);
  const text = out.text.replace(/\[\[HANDOFF\]\]/g, '').trim().slice(0, MAX_TEXT);
  if (!text) return fail('draft_failed', 502);
  return ok({ text, provider: out.provider, ragHits: chunks ? chunks.length : 0 });
}
