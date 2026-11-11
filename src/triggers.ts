// triggers.ts
// Proactive message rules: "on this page, after N seconds, show a teaser next to the
// chat bubble". The team manages them in the panel (Ajustes); the widget reads the
// active ones from GET /api/triggers and reports `shown` / `opened` with
// POST /api/triggers/:id/event. Rules hold no visitor data, only two counters.
//
// path_pattern syntax (deliberately tiny, so it is easy to type and cannot hide a regex):
//
//     [host][/path-prefix]
//
//   host         `yammbo.com`, any `<name>.yammbo.com`, or `*` (any host). Left out
//                (pattern starts with `/`) it means `*`. A leading `www.` is ignored.
//                `*` is only allowed as the whole host: it is the leading-segment wildcard
//                and nothing else is a wildcard (no `*` inside a host or a path).
//   path-prefix  matched on whole segments, case-insensitively: `/pos` matches `/pos`,
//                `/pos/` and `/pos/precios` but not `/posts`. Left out it means every page.
//                Allowed characters per segment: letters, digits and . _ ~ % -
//
//   yammbo.com/pos/   the POS pages of the main site        (same as yammbo.com/pos)
//   */precios         /precios on any Yammbo host
//   /precios          same as the line above
//   web.yammbo.com    the whole of web.yammbo.com
//
// Patterns are stored in their canonical form (lower case, `*` for "any host", no
// trailing slash except the bare root). The widget carries the same matcher.

import type { Out } from './panel-inbox';
import { isValidId, type StoreEnv } from './store';

const MAX_TRIGGERS = 50;
const MAX_PATTERN = 120;
export const MAX_TEASER = 240;

const HOST_RE = /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)*yammbo\.com$/;
const PATH_RE = /^(\/[a-z0-9._~%-]+)*\/?$/;

export function normalizePattern(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().toLowerCase();
  if (!s || s.length > MAX_PATTERN) return null;
  const slash = s.indexOf('/');
  let host = slash === -1 ? s : s.slice(0, slash);
  const path = slash === -1 ? '' : s.slice(slash);
  if (host === '') host = '*';
  if (host !== '*') {
    if (host.startsWith('www.')) host = host.slice(4);
    if (!HOST_RE.test(host)) return null;
  }
  if (!PATH_RE.test(path)) return null;
  // Dot segments are never meaningful in a pathname prefix.
  if (path.split('/').some((seg) => seg === '.' || seg === '..')) return null;
  const clean = path.replace(/\/+$/, '');
  return host + (clean || '/');
}

// True when `rawUrl` (an absolute https URL) falls under the canonical pattern.
export function matchPattern(pattern: string, rawUrl: string): boolean {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return false;
  }
  const slash = pattern.indexOf('/');
  const pHost = pattern.slice(0, slash);
  const pSegs = pattern.slice(slash).split('/').filter(Boolean);
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  if (pHost !== '*' && pHost !== host) return false;
  const segs = u.pathname.toLowerCase().split('/').filter(Boolean);
  if (pSegs.length > segs.length) return false;
  return pSegs.every((p, i) => p === segs[i]);
}

// Visitor-facing -------------------------------------------------------------------------

export interface PublicTrigger {
  id: string;
  path: string;
  delay: number;
  es: string;
  en: string;
}

// Active rules, only the fields the widget needs.
export async function listPublicTriggers(env: StoreEnv): Promise<PublicTrigger[]> {
  if (!env.DB) return [];
  const r = await env.DB
    .prepare(
      `SELECT id, path_pattern, delay_s, message_es, message_en FROM triggers
       WHERE enabled = 1 AND (message_es != '' OR message_en != '') ORDER BY created_at ASC LIMIT ${MAX_TRIGGERS}`,
    )
    .all<{ id: string; path_pattern: string; delay_s: number; message_es: string; message_en: string }>();
  return (r.results ?? []).map((t) => ({ id: t.id, path: t.path_pattern, delay: t.delay_s, es: t.message_es, en: t.message_en }));
}

// Atomic counter bump. `opened` can never pass `shown` (a rule cannot be opened
// more often than it was shown), which also blunts inflating the rate by hand.
// Returns false for an unknown/disabled rule or a bad type.
export async function recordTriggerEvent(env: StoreEnv, id: unknown, type: unknown): Promise<boolean> {
  if (!env.DB || !isValidId(id)) return false;
  let sql: string;
  if (type === 'shown') sql = 'UPDATE triggers SET shown = shown + 1 WHERE id = ?1 AND enabled = 1';
  else if (type === 'opened') sql = 'UPDATE triggers SET opened = opened + 1 WHERE id = ?1 AND enabled = 1 AND opened < shown';
  else return false;
  const res = await env.DB.prepare(sql).bind(id).run();
  return (res.meta?.changes ?? 0) > 0;
}

// Panel (CRUD) ---------------------------------------------------------------------------------

interface TriggerRow {
  id: string;
  enabled: number;
  name: string;
  path_pattern: string;
  delay_s: number;
  message_es: string;
  message_en: string;
  created_at: number;
  updated_at: number;
  shown: number;
  opened: number;
}

const ok = (data: unknown, status = 200): Out => ({ status, data });
const fail = (error: string, status: number): Out => ({ status, data: { error } });

function out(r: TriggerRow) {
  return {
    id: r.id,
    enabled: r.enabled === 1,
    name: r.name,
    pattern: r.path_pattern,
    delay: r.delay_s,
    es: r.message_es,
    en: r.message_en,
    shown: r.shown,
    opened: r.opened,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// Plain one-line text: control characters become spaces, runs of whitespace collapse.
function oneLine(v: unknown, max: number): string {
  return typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

const COLS = 'id, enabled, name, path_pattern, delay_s, message_es, message_en, created_at, updated_at, shown, opened';

export async function listTriggers(env: StoreEnv): Promise<Out> {
  const r = await env.DB!.prepare(`SELECT ${COLS} FROM triggers ORDER BY created_at ASC LIMIT ${MAX_TRIGGERS}`).all<TriggerRow>();
  return ok({ items: (r.results ?? []).map(out), max: MAX_TRIGGERS });
}

interface Parsed {
  enabled: number;
  name: string;
  pattern: string;
  delay: number;
  es: string;
  en: string;
}

function parse(body: Record<string, unknown>): Parsed | string {
  const name = oneLine(body.name, 80);
  if (!name) return 'invalid_name';
  const pattern = normalizePattern(body.pattern);
  if (!pattern) return 'invalid_pattern';
  const delay = typeof body.delay === 'number' ? body.delay : parseInt(String(body.delay ?? ''), 10);
  if (!Number.isInteger(delay) || delay < 0 || delay > 300) return 'invalid_delay';
  const es = oneLine(body.es, MAX_TEASER);
  const en = oneLine(body.en, MAX_TEASER);
  if (!es && !en) return 'invalid_message';
  return { enabled: body.enabled === false ? 0 : 1, name, pattern, delay, es, en };
}

// id = null creates; otherwise updates. A body with only `enabled` just flips the switch.
export async function saveTrigger(env: StoreEnv, id: string | null, body: Record<string, unknown>): Promise<Out> {
  const db = env.DB!;
  const now = Date.now();
  if (id !== null && Object.keys(body).length === 1 && typeof body.enabled === 'boolean') {
    const res = await db.prepare('UPDATE triggers SET enabled = ?1, updated_at = ?2 WHERE id = ?3').bind(body.enabled ? 1 : 0, now, id).run();
    return (res.meta?.changes ?? 0) > 0 ? ok({ ok: true }) : fail('not_found', 404);
  }
  const v = parse(body);
  if (typeof v === 'string') return fail(v, 400);
  if (id === null) {
    const newId = crypto.randomUUID();
    // The cap and the insert are one statement, so parallel requests cannot pass it.
    const res = await db
      .prepare(
        `INSERT INTO triggers (id, enabled, name, path_pattern, delay_s, message_es, message_en, max_per_visit, created_at, updated_at)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, 1, ?8, ?8 WHERE (SELECT COUNT(*) FROM triggers) < ${MAX_TRIGGERS}`,
      )
      .bind(newId, v.enabled, v.name, v.pattern, v.delay, v.es, v.en, now)
      .run();
    if ((res.meta?.changes ?? 0) === 0) return fail('too_many_triggers', 409);
    const row = await db.prepare(`SELECT ${COLS} FROM triggers WHERE id = ?`).bind(newId).first<TriggerRow>();
    return ok({ item: row ? out(row) : null }, 201);
  }
  const res = await db
    .prepare('UPDATE triggers SET enabled = ?1, name = ?2, path_pattern = ?3, delay_s = ?4, message_es = ?5, message_en = ?6, updated_at = ?7 WHERE id = ?8')
    .bind(v.enabled, v.name, v.pattern, v.delay, v.es, v.en, now, id)
    .run();
  if ((res.meta?.changes ?? 0) === 0) return fail('not_found', 404);
  const row = await db.prepare(`SELECT ${COLS} FROM triggers WHERE id = ?`).bind(id).first<TriggerRow>();
  return ok({ item: row ? out(row) : null });
}

export async function deleteTrigger(env: StoreEnv, id: string): Promise<Out> {
  await env.DB!.prepare('DELETE FROM triggers WHERE id = ?').bind(id).run();
  return ok({ ok: true });
}
