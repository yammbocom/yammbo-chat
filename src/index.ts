// index.ts — Worker entry point.
// Routes:
//   GET  /                healthcheck
//   GET  /widget.js       embeddable chat widget (vanilla JS)
//   GET  /demo            standalone demo page
//   GET  /api/docs        Help Center index (?lang=en|es)
//   GET  /api/docs?slug=X single doc with body
//   GET  /api/blog        recent blog posts
//   POST /api/chat        chat endpoint, streams response
//   POST /api/lead        human handoff — stores the lead in D1, then notifies Yambo
//   POST /api/feedback    thumbs up/down on an assistant message
//   POST /api/visit       page the visitor opened after using the chat (always 204)
//   POST /api/handoff     the visitor asks for a person: bot -> waiting, alerts the team
//   GET  /api/messages    the team's messages + state for a session (widget polling)
//   POST /api/csat        the visitor's 1-5 rating of a resolved conversation (once)
//   POST /api/presence    heartbeat of a visitor on a page (online now; returns team messages)
//   POST /api/presence/leave   the page is closing (sendBeacon): drop the presence row
//   POST /api/proactive/accept   the visitor opened a team-first message: it becomes a conversation
//   GET  /api/triggers    active proactive-message rules (cached 300 s)
//   POST /api/triggers/:id/event   {type: 'shown'|'opened'} counter for a rule
//   /panel, /panel/api/*  team panel (PWA): Telegram-code login, stats, conversations, push
//   GET  /fonts/*.woff2   Geist latin / latin-ext for the widget (CORS *)
//   OPTIONS *             CORS preflight
//   scheduled (cron)      reindexes Vectorize when the bundled KB changed;
//                         once a day (03:00 UTC) purges old D1 rows; every tick purges stale presence

import { buildCorsHeaders, handlePreflight } from './cors';
import {
  detectLanguage,
  buildSystemPrompt,
  buildSystemPromptFull,
  streamReply,
  type ChatMessage,
  type BrainEnv,
} from './brain';
import { listDocs, getDoc, getBlogPosts } from './content';
import { retrieve, reindexKb, type RagEnv } from './rag';
import { alertLead, type NotifyEnv } from './notify';
import { announceHandoff, announceHumanMessage, announceNewConversation, pushNewLead } from './announce';
import { isStrongId, listLiveMessages, requestHandoff, saveCsat, takeLiveMessage } from './inbox';
import { cleanCity, cleanCountry, parseUserAgent } from './device';
import { acceptProactive, heartbeat, leave, purgeLive, type PresenceBody } from './presence';
import { listPublicTriggers, recordTriggerEvent } from './triggers';
import { isRateLimited } from './limit';
import { handlePanel, type PanelEnv } from './panel';
import { PRODUCT_NAMES, sanitizePage, type PageContext } from './page';
import {
  isValidId,
  persistChatTurn,
  purgeOld,
  saveFeedback,
  saveLead,
  saveLeadNotify,
  saveVisit,
  type StoreEnv,
} from './store';
import { WIDGET_JS } from './widget';
import { DEMO_HTML } from './demo';
import { PRIVACY_HTML } from './privacy';
import kbVersion from './kb-version.json';
import geistLatin from './fonts/geist-latin.woff2';
import geistLatinExt from './fonts/geist-latin-ext.woff2';

interface Env extends BrainEnv, NotifyEnv, RagEnv, StoreEnv, PanelEnv {
  ALLOWED_ORIGINS: string;
  CHAT_SESSIONS?: KVNamespace;
  SESSION_TTL_SECONDS: string;
  ADMIN_KEY?: string;
  // Workers Rate Limiting bindings; optional so a missing binding never breaks the chat.
  CHAT_LIMITER?: RateLimit;
  LEAD_LIMITER?: RateLimit;
  VISIT_LIMITER?: RateLimit;
  PRESENCE_LIMITER?: RateLimit; // heartbeats + leave beacons only (a 30 s beat per tab must not eat VISIT_LIMITER)
}

// KV key holding the hash of the kb-bundle that was last indexed successfully.
const RAG_HASH_KEY = '__rag_bundle_hash';
const RAG_FAIL_KEY = '__rag_reindex_fail';

const FONT_HEADERS = {
  'content-type': 'font/woff2',
  'access-control-allow-origin': '*',
  'cache-control': 'public, max-age=31536000, immutable',
};

const FONTS: Record<string, ArrayBuffer> = {
  '/fonts/geist-latin.woff2': geistLatin,
  '/fonts/geist-latin-ext.woff2': geistLatinExt,
};

interface ChatRequestBody {
  messages?: ChatMessage[];
  sessionId?: string;
  page?: unknown;
  lang?: unknown;
  // What the visitor just typed, unmerged. The widget merges neighbours of the same
  // role in `messages` for the model, so the stored text must come from here.
  // Absent in older cached widgets (then the last user message is used).
  text?: unknown;
}

interface FeedbackRequestBody {
  sessionId?: unknown;
  messageId?: unknown;
  rating?: unknown;
}

interface VisitRequestBody {
  sessionId?: unknown;
  url?: unknown;
  title?: unknown;
}

interface HandoffRequestBody {
  sessionId?: unknown;
  lang?: unknown;
}

interface AcceptRequestBody {
  presenceId?: unknown;
  sessionId?: unknown;
}

interface CsatRequestBody {
  sessionId?: unknown;
  score?: unknown;
  comment?: unknown;
}

interface LeadRequestBody {
  name?: string;
  email?: string;
  phone?: string;
  channel?: string;
  message?: string;
  transcript?: ChatMessage[];
  lang?: string;
  sessionId?: unknown;
  page?: unknown;
  website?: unknown; // honeypot: real visitors never fill it
}

function jsonResponse(data: unknown, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', ...extra },
  });
}

function validateMessages(input: unknown): ChatMessage[] | null {
  if (!Array.isArray(input)) return null;
  if (input.length === 0 || input.length > 30) return null;
  const out: ChatMessage[] = [];
  for (const m of input) {
    if (!m || typeof m !== 'object') return null;
    const msg = m as { role?: unknown; content?: unknown };
    if (msg.role !== 'user' && msg.role !== 'assistant') return null;
    if (typeof msg.content !== 'string') return null;
    if (msg.content.length === 0 || msg.content.length > 2000) return null;
    out.push({ role: msg.role, content: msg.content });
  }
  if (out[out.length - 1].role !== 'user') return null;
  return out;
}

function pickLang(url: URL, fallback: ChatMessage[] | null = null): 'en' | 'es' {
  const q = url.searchParams.get('lang');
  if (q === 'es' || q === 'en') return q;
  if (fallback) return detectLanguage(fallback);
  return 'en';
}

function safeDecode(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    return '';
  }
}

function clientLang(v: unknown): 'en' | 'es' | null {
  return v === 'es' || v === 'en' ? v : null;
}

const RATE_LIMIT_MSG = {
  es: 'Estás enviando mensajes muy rápido. Espera un momento e inténtalo de nuevo.',
  en: 'You are sending messages too fast. Please wait a moment and try again.',
};

// Shown to a cached widget that cannot handle the live mode (see /api/chat).
const LIVE_NOTICE = {
  es: 'El equipo de Yammbo ya está atendiendo esta conversación; recarga la página para ver sus respuestas.',
  en: 'The Yammbo team is already handling this conversation; reload the page to see their replies.',
};

// A same-origin GET (the /demo page on chat.yammbo.com itself) carries no Origin
// header, so the allow-list sees an empty origin. Treat "no Origin" as same-origin or
// a non-browser caller (the sessionId is the credential), but never when the browser
// says the request is cross-site: cross-origin fetches always add Origin, and a
// no-cors GET (img/script) that omits it is marked by Sec-Fetch-Site.
function sameOriginGet(request: Request): boolean {
  if (request.headers.get('origin')) return false;
  const site = request.headers.get('sec-fetch-site');
  return site === null || site === 'same-origin' || site === 'none';
}

function pageLineFor(page: PageContext | null): string {
  if (!page) return '';
  // Only the hostname: the path is visitor-controlled on SPA hosts and would
  // let a crafted link inject text into the system prompt.
  const base = `The visitor is currently on ${new URL(page.url).hostname}`;
  if (!page.product) return `${base}.`;
  return `${base} (product: ${PRODUCT_NAMES[page.product]}). When a question is ambiguous, assume it is about that product.`;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const startedAt = Date.now();
    const url = new URL(request.url);
    const cors = buildCorsHeaders(request, env.ALLOWED_ORIGINS);

    // Team panel: same origin only, no CORS headers (see panel.ts).
    if (url.pathname === '/panel' || url.pathname.startsWith('/panel/')) {
      return handlePanel(request, env, url, ctx);
    }

    if (request.method === 'OPTIONS') {
      return handlePreflight(request, env.ALLOWED_ORIGINS);
    }

    // Healthcheck
    if (request.method === 'GET' && url.pathname === '/') {
      return jsonResponse({ status: 'ok', service: 'yammbo-chat', version: '0.4.0' }, 200, cors);
    }

    // Embeddable widget — public, cacheable
    if (request.method === 'GET' && url.pathname === '/widget.js') {
      return new Response(WIDGET_JS, {
        headers: {
          'content-type': 'application/javascript; charset=utf-8',
          'cache-control': 'public, max-age=300',
          'access-control-allow-origin': '*',
        },
      });
    }

    // Widget fonts — served from here because the widget loads on other origins.
    if (request.method === 'GET' && FONTS[url.pathname]) {
      return new Response(FONTS[url.pathname], { headers: FONT_HEADERS });
    }

    // Standalone demo page
    if (request.method === 'GET' && url.pathname === '/privacy') {
      return new Response(PRIVACY_HTML, {
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=3600' },
      });
    }

    if (request.method === 'GET' && url.pathname === '/demo') {
      return new Response(DEMO_HTML, {
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' },
      });
    }

    // Help Center: index or single doc
    if (request.method === 'GET' && url.pathname === '/api/docs') {
      const lang = pickLang(url);
      const slug = url.searchParams.get('slug');
      if (slug) {
        const doc = getDoc(lang, slug);
        if (!doc) return jsonResponse({ error: 'Doc not found' }, 404, cors);
        return jsonResponse(doc, 200, { ...cors, 'cache-control': 'public, max-age=600' });
      }
      return jsonResponse({ docs: listDocs(lang) }, 200, { ...cors, 'cache-control': 'public, max-age=600' });
    }

    // Blog recent posts
    if (request.method === 'GET' && url.pathname === '/api/blog') {
      const posts = await getBlogPosts(env.CHAT_SESSIONS, 12);
      return jsonResponse({ posts }, 200, { ...cors, 'cache-control': 'public, max-age=600' });
    }

    // Chat
    if (request.method === 'POST' && url.pathname === '/api/chat') {
      if (cors['access-control-allow-origin'] === 'null') {
        return jsonResponse({ error: 'Origin not allowed' }, 403, cors);
      }
      let body: ChatRequestBody;
      try {
        body = (await request.json()) as ChatRequestBody;
      } catch {
        return jsonResponse({ error: 'Invalid JSON body' }, 400, cors);
      }
      const messages = validateMessages(body.messages);
      if (!messages) return jsonResponse({ error: 'Invalid messages array' }, 400, cors);

      // The client's language wins over the regex guess when it is sent.
      const lang = clientLang(body.lang) ?? detectLanguage(messages);

      if (await isRateLimited(env.CHAT_LIMITER, request)) {
        return jsonResponse({ error: RATE_LIMIT_MSG[lang] }, 429, cors);
      }

      // The visitor's own text: explicit field when sent (1-2000 chars), else the last
      // user message (widgets cached from before the field existed).
      let hasText = false;
      let lastUser = messages[messages.length - 1].content;
      if (body.text !== undefined) {
        if (typeof body.text !== 'string' || body.text.length < 1 || body.text.length > 2000 || !body.text.trim()) {
          return jsonResponse({ error: 'Invalid text' }, 400, cors);
        }
        hasText = true;
        lastUser = body.text;
      }

      const page = sanitizePage(body.page);

      // The team is in charge of this conversation (visitor asked for a person, or an
      // agent took over): keep the message, count it as unread, alert the team and
      // do NOT call the LLM. The empty stream + x-chat-mode tell the widget not to
      // show "thinking"; it then polls /api/messages for the team's answer.
      if (env.DB && isValidId(body.sessionId)) {
        const live = await takeLiveMessage(env, { sessionId: body.sessionId, content: lastUser.slice(0, 4000), pageUrl: page?.url ?? null });
        if (live) {
          ctx.waitUntil(announceHumanMessage(env, { sessionId: body.sessionId, city: live.city, country: live.country, text: lastUser }));
          // A cached widget without the `text` field does not know the live mode and would
          // print "no reply" for an empty stream: give it a fixed assistant line instead.
          const frame = hasText ? '' : `data: ${JSON.stringify({ choices: [{ delta: { content: LIVE_NOTICE[lang] } }] })}\n\n`;
          return new Response(frame + 'data: [DONE]\n\n', {
            status: 200,
            headers: { ...cors, 'content-type': 'text/event-stream', 'cache-control': 'no-store', 'x-chat-mode': 'human' },
          });
        }
      }

      // RAG: retrieve only the chunks relevant to the latest question. If
      // retrieval fails (Vectorize/Workers AI hiccup) fall back to the full KB
      // so the assistant always has grounding. On a product page the product
      // name is prepended to the query so ambiguous questions hit that product.
      const ragQuery = page?.product ? `${PRODUCT_NAMES[page.product]} ${lastUser}` : lastUser;
      const pageLine = pageLineFor(page);
      let systemPrompt: string;
      let ragHits = 0;
      try {
        const chunks = await retrieve(env, ragQuery, lang, 6);
        ragHits = chunks.length;
        systemPrompt = buildSystemPrompt(chunks, pageLine);
      } catch (e) {
        console.error('retrieve failed, falling back to full KB:', (e as Error)?.message);
        systemPrompt = buildSystemPromptFull(lang, pageLine);
      }

      const { response: upstream, provider } = await streamReply(env, systemPrompt, messages);

      const headers = new Headers(upstream.headers);
      for (const [k, v] of Object.entries(cors)) headers.set(k, v);

      // Persist the turn off the critical path: one tee() branch goes to the
      // client, the other is parsed in waitUntil. The message id is only
      // announced when a write is going to be attempted (feedback needs it).
      let outBody = upstream.body;
      if (env.DB && upstream.ok && upstream.body && isValidId(body.sessionId)) {
        const assistantId = crypto.randomUUID();
        const [toClient, toStore] = upstream.body.tee();
        outBody = toClient;
        headers.set('x-chat-msg-id', assistantId);
        // Country/city come from Cloudflare; the User-Agent is reduced to three
        // labels (device, OS, browser) and never stored.
        const country = cleanCountry(request.cf?.country);
        const city = cleanCity(request.cf?.city);
        const client = parseUserAgent(request.headers.get('user-agent'));
        const sessionId = body.sessionId;
        ctx.waitUntil(
          persistChatTurn(env, {
            sessionId,
            userContent: lastUser,
            assistantId,
            stream: toStore,
            page,
            lang,
            ip: request.headers.get('cf-connecting-ip') || 'unknown',
            ragHits,
            provider,
            startedAt,
            country,
            city,
            ...client,
          }).then((stored) =>
            stored?.isNew
              ? announceNewConversation(env, {
                  sessionId,
                  product: page?.product ?? null,
                  country,
                  city,
                  device: client.device,
                  os: client.os,
                  browser: client.browser,
                  firstQuestion: lastUser,
                })
              : undefined,
          ),
        );
      }
      return new Response(outBody, { status: upstream.status, headers });
    }

    // Feedback: thumbs up/down on an assistant message
    if (request.method === 'POST' && url.pathname === '/api/feedback') {
      if (cors['access-control-allow-origin'] === 'null') {
        return jsonResponse({ error: 'Origin not allowed' }, 403, cors);
      }
      let body: FeedbackRequestBody;
      try {
        body = (await request.json()) as FeedbackRequestBody;
      } catch {
        return jsonResponse({ error: 'Invalid JSON body' }, 400, cors);
      }
      if (await isRateLimited(env.CHAT_LIMITER, request)) {
        return jsonResponse({ error: RATE_LIMIT_MSG.en }, 429, cors);
      }
      if (!isValidId(body.sessionId) || !isValidId(body.messageId) || (body.rating !== 1 && body.rating !== -1)) {
        return jsonResponse({ error: 'Invalid feedback' }, 400, cors);
      }
      const stored = await saveFeedback(env, body.sessionId, body.messageId, body.rating);
      return stored ? jsonResponse({ ok: true }, 200, cors) : jsonResponse({ ok: false }, 404, cors);
    }

    // Page visit after the visitor used the chat. Always 204: the answer must not
    // reveal whether a session exists (and rate-limited calls are dropped quietly).
    if (request.method === 'POST' && url.pathname === '/api/visit') {
      if (cors['access-control-allow-origin'] === 'null') {
        return jsonResponse({ error: 'Origin not allowed' }, 403, cors);
      }
      const done = new Response(null, { status: 204, headers: cors });
      let body: VisitRequestBody;
      try {
        body = (await request.json()) as VisitRequestBody;
      } catch {
        return done;
      }
      if (!isValidId(body.sessionId) || (await isRateLimited(env.VISIT_LIMITER, request))) return done;
      const page = sanitizePage({ url: body.url, title: body.title });
      if (page) await saveVisit(env, body.sessionId, page.url, page.title);
      return done;
    }

    // The visitor asks to talk to a person: bot -> waiting. The alert goes out once
    // per conversation (only the call that changes the mode alerts).
    if (request.method === 'POST' && url.pathname === '/api/handoff') {
      if (cors['access-control-allow-origin'] === 'null') {
        return jsonResponse({ error: 'Origin not allowed' }, 403, cors);
      }
      let body: HandoffRequestBody;
      try {
        body = (await request.json()) as HandoffRequestBody;
      } catch {
        return jsonResponse({ error: 'Invalid JSON body' }, 400, cors);
      }
      const lang = clientLang(body.lang) ?? 'en';
      if (await isRateLimited(env.CHAT_LIMITER, request)) {
        return jsonResponse({ error: RATE_LIMIT_MSG[lang] }, 429, cors);
      }
      if (!env.DB || !isStrongId(body.sessionId)) return jsonResponse({ error: 'Invalid session' }, 400, cors);
      try {
        const r = await requestHandoff(env, body.sessionId);
        if (!r.found) return jsonResponse({ error: 'Unknown conversation' }, 404, cors);
        if (r.changed) {
          ctx.waitUntil(announceHandoff(env, { sessionId: body.sessionId, city: r.city, country: r.country, text: r.lastQuestion }));
        }
        return jsonResponse({ ok: true, mode: r.mode }, 200, { ...cors, 'cache-control': 'no-store' });
      } catch (e) {
        console.error('handoff failed:', (e as Error)?.message);
        return jsonResponse({ ok: false }, 502, cors);
      }
    }

    // Widget polling: what the team wrote after `after` (ms), the conversation's
    // mode and whether a rating is pending. The sessionId (>= 128 random bits) is
    // the credential; unknown sessions are a plain 404.
    if (request.method === 'GET' && url.pathname === '/api/messages') {
      if (cors['access-control-allow-origin'] === 'null' && !sameOriginGet(request)) {
        return jsonResponse({ error: 'Origin not allowed' }, 403, cors);
      }
      const sid = url.searchParams.get('sessionId');
      if (!env.DB || !isStrongId(sid)) return jsonResponse({ error: 'Invalid session' }, 400, cors);
      if (await isRateLimited(env.VISIT_LIMITER, request)) return jsonResponse({ error: RATE_LIMIT_MSG.en }, 429, cors);
      const after = Math.max(0, parseInt(url.searchParams.get('after') || '', 10) || 0);
      try {
        const poll = await listLiveMessages(env, sid, after);
        if (!poll) return jsonResponse({ error: 'Unknown conversation' }, 404, cors);
        return jsonResponse(poll, 200, { ...cors, 'cache-control': 'no-store' });
      } catch (e) {
        console.error('messages poll failed:', (e as Error)?.message);
        return jsonResponse({ error: 'Unavailable' }, 503, cors);
      }
    }

    // Rating after the team resolved a conversation it took part in. Once only.
    if (request.method === 'POST' && url.pathname === '/api/csat') {
      if (cors['access-control-allow-origin'] === 'null') {
        return jsonResponse({ error: 'Origin not allowed' }, 403, cors);
      }
      let body: CsatRequestBody;
      try {
        body = (await request.json()) as CsatRequestBody;
      } catch {
        return jsonResponse({ error: 'Invalid JSON body' }, 400, cors);
      }
      if (await isRateLimited(env.LEAD_LIMITER, request)) return jsonResponse({ error: RATE_LIMIT_MSG.en }, 429, cors);
      const score = body.score;
      if (!env.DB || !isStrongId(body.sessionId) || typeof score !== 'number' || !Number.isInteger(score) || score < 1 || score > 5) {
        return jsonResponse({ error: 'Invalid rating' }, 400, cors);
      }
      const comment = typeof body.comment === 'string' ? body.comment.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim().slice(0, 500) : '';
      try {
        const saved = await saveCsat(env, body.sessionId, score, comment);
        return saved ? jsonResponse({ ok: true }, 200, cors) : jsonResponse({ ok: false }, 409, cors);
      } catch (e) {
        console.error('csat failed:', (e as Error)?.message);
        return jsonResponse({ ok: false }, 502, cors);
      }
    }

    // Visitors online: heartbeat from the widget (every 30 s while the page is visible).
    // Answers the team messages waiting for this presence id. A beacon sends text/plain,
    // which request.json() parses the same way.
    if (request.method === 'POST' && url.pathname === '/api/presence') {
      if (cors['access-control-allow-origin'] === 'null') {
        return jsonResponse({ error: 'Origin not allowed' }, 403, cors);
      }
      if (!env.DB) return new Response(null, { status: 204, headers: cors });
      let body: PresenceBody;
      try {
        body = (await request.json()) as PresenceBody;
      } catch {
        return jsonResponse({ error: 'Invalid JSON body' }, 400, cors);
      }
      if (await isRateLimited(env.PRESENCE_LIMITER, request)) return jsonResponse({ error: RATE_LIMIT_MSG.en }, 429, cors);
      try {
        const hb = await heartbeat(env, request, body);
        return jsonResponse(hb, hb.ok ? 200 : 400, { ...cors, 'cache-control': 'no-store' });
      } catch (e) {
        console.error('presence failed:', (e as Error)?.message);
        return jsonResponse({ ok: false, messages: [] }, 503, cors);
      }
    }

    if (request.method === 'POST' && url.pathname === '/api/presence/leave') {
      if (cors['access-control-allow-origin'] === 'null') {
        return jsonResponse({ error: 'Origin not allowed' }, 403, cors);
      }
      const done = new Response(null, { status: 204, headers: cors });
      let body: PresenceBody;
      try {
        body = (await request.json()) as PresenceBody;
      } catch {
        return done;
      }
      if (await isRateLimited(env.PRESENCE_LIMITER, request)) return done;
      try {
        await leave(env, body.presenceId);
      } catch (e) {
        console.error('presence leave failed:', (e as Error)?.message);
      }
      return done;
    }

    // The visitor opened a message the team wrote first: it becomes a conversation
    // (role 'agent', mode 'human'). Nothing exists before this call.
    if (request.method === 'POST' && url.pathname === '/api/proactive/accept') {
      if (cors['access-control-allow-origin'] === 'null') {
        return jsonResponse({ error: 'Origin not allowed' }, 403, cors);
      }
      let body: AcceptRequestBody;
      try {
        body = (await request.json()) as AcceptRequestBody;
      } catch {
        return jsonResponse({ error: 'Invalid JSON body' }, 400, cors);
      }
      if (!env.DB) return jsonResponse({ error: 'Unavailable' }, 503, cors);
      if (await isRateLimited(env.VISIT_LIMITER, request)) return jsonResponse({ error: RATE_LIMIT_MSG.en }, 429, cors);
      try {
        const r = await acceptProactive(env, request, body.presenceId, body.sessionId);
        return jsonResponse(r.data, r.status, { ...cors, 'cache-control': 'no-store' });
      } catch (e) {
        console.error('proactive accept failed:', (e as Error)?.message);
        return jsonResponse({ error: 'Unavailable' }, 503, cors);
      }
    }

    // Proactive-message rules for the widget (public fields only).
    if (request.method === 'GET' && url.pathname === '/api/triggers') {
      try {
        return jsonResponse({ triggers: await listPublicTriggers(env) }, 200, { ...cors, 'cache-control': 'public, max-age=300' });
      } catch (e) {
        console.error('triggers list failed:', (e as Error)?.message);
        return jsonResponse({ triggers: [] }, 200, { ...cors, 'cache-control': 'no-store' });
      }
    }

    const triggerEvent = /^\/api\/triggers\/([^/]+)\/event$/.exec(url.pathname);
    if (request.method === 'POST' && triggerEvent) {
      if (cors['access-control-allow-origin'] === 'null') {
        return jsonResponse({ error: 'Origin not allowed' }, 403, cors);
      }
      const done = new Response(null, { status: 204, headers: cors });
      let body: { type?: unknown };
      try {
        body = (await request.json()) as { type?: unknown };
      } catch {
        return done;
      }
      if (await isRateLimited(env.VISIT_LIMITER, request)) return done;
      try {
        await recordTriggerEvent(env, safeDecode(triggerEvent[1]), body.type);
      } catch (e) {
        console.error('trigger event failed:', (e as Error)?.message);
      }
      return done;
    }

    // Admin: (re)build the KB vector index from the bundled docs. Guarded by a
    // shared secret. Run after editing kb-bundle.json or on first setup.
    if (request.method === 'POST' && url.pathname === '/admin/reindex') {
      if (!env.ADMIN_KEY || request.headers.get('x-admin-key') !== env.ADMIN_KEY) {
        return jsonResponse({ error: 'Forbidden' }, 403, cors);
      }
      try {
        const result = await reindexKb(env);
        // Remember what was indexed so the cron doesn't redo it.
        await env.CHAT_SESSIONS?.put(RAG_HASH_KEY, kbVersion.hash);
        return jsonResponse({ ok: true, ...result }, 200, cors);
      } catch (e) {
        return jsonResponse({ ok: false, error: String((e as Error)?.message || e).slice(0, 300) }, 500, cors);
      }
    }

    // Admin: inspect what RAG retrieves for a query (diagnostics, same guard).
    // Lets us confirm the index + lang filter without exposing the chat flow.
    if (request.method === 'GET' && url.pathname === '/admin/retrieve') {
      if (!env.ADMIN_KEY || request.headers.get('x-admin-key') !== env.ADMIN_KEY) {
        return jsonResponse({ error: 'Forbidden' }, 403, cors);
      }
      const q = url.searchParams.get('q') || '';
      const lang = url.searchParams.get('lang') === 'es' ? 'es' : 'en';
      try {
        const chunks = await retrieve(env, q, lang, 6);
        return jsonResponse({
          ok: true, q, lang, count: chunks.length,
          chunks: chunks.map((c) => ({ slug: c.slug, title: c.title, score: c.score, preview: c.text.slice(0, 100) })),
        }, 200, cors);
      } catch (e) {
        return jsonResponse({ ok: false, error: String((e as Error)?.message || e).slice(0, 300) }, 500, cors);
      }
    }

    // Lead capture / human handoff
    if (request.method === 'POST' && url.pathname === '/api/lead') {
      if (cors['access-control-allow-origin'] === 'null') {
        return jsonResponse({ error: 'Origin not allowed' }, 403, cors);
      }
      let body: LeadRequestBody;
      try {
        body = (await request.json()) as LeadRequestBody;
      } catch {
        return jsonResponse({ error: 'Invalid JSON body' }, 400, cors);
      }

      // Honeypot: bots fill the hidden field. Answer as if it worked, keep nothing.
      if (typeof body.website === 'string' && body.website.trim() !== '') {
        return jsonResponse({ ok: true }, 200, cors);
      }

      const lang = clientLang(body.lang) ?? 'en';
      if (await isRateLimited(env.LEAD_LIMITER, request)) {
        return jsonResponse({ error: RATE_LIMIT_MSG[lang] }, 429, cors);
      }

      const name = (body.name || '').trim().slice(0, 120);
      const email = (body.email || '').trim().slice(0, 160);
      if (!name || !email) {
        return jsonResponse({ error: 'Name and email are required' }, 400, cors);
      }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return jsonResponse({ error: 'Invalid email' }, 400, cors);
      }

      const phone = (body.phone || '').trim().slice(0, 40);
      const channel = (body.channel || '').trim().slice(0, 40);
      const message = (body.message || '').trim().slice(0, 1000);

      // Build a short transcript summary for context.
      let summary = '—';
      if (Array.isArray(body.transcript) && body.transcript.length) {
        summary = body.transcript
          .slice(-6)
          .map((m) => `${m.role === 'user' ? 'U' : 'A'}: ${String(m.content).slice(0, 160)}`)
          .join('\n')
          .slice(0, 1500);
      }

      // Save first: a failing notification channel must not lose the lead.
      const leadId = crypto.randomUUID();
      const page = sanitizePage(body.page);
      const saved = await saveLead(env, {
        id: leadId,
        sessionId: isValidId(body.sessionId) ? body.sessionId : null,
        name,
        email,
        phone,
        channel,
        message,
        lang,
        pageUrl: page?.url ?? null,
      });

      const fields: Record<string, string> = {
        Nombre: name,
        Email: email,
        'Teléfono / WhatsApp': phone || 'no proporcionado',
        'Canal preferido': channel || '—',
        Mensaje: message || '—',
        Resumen: summary,
      };
      if (page) fields['Página'] = page.url;

      const results = await alertLead(env, {
        title: 'Nuevo lead desde el chat web',
        fields,
        sessionId: isValidId(body.sessionId) ? body.sessionId : null,
      });
      const anyOk = Object.values(results).some((r) => r.ok);
      if (saved) await saveLeadNotify(env, leadId, results);
      ctx.waitUntil(pushNewLead(env, name, channel));

      // The per-channel results stay server-side (D1 + logs): they carry provider error text.
      if (!anyOk) console.error('lead notify failed on every channel', JSON.stringify(results));
      // Saved-but-unnotified is a failure: nobody reads the leads table, so the
      // visitor must see the error and use the direct WhatsApp/email buttons.
      const ok = anyOk;
      return jsonResponse({ ok }, ok ? 200 : 502, cors);
    }

    return jsonResponse({ error: 'Not found' }, 404, cors);
  },

  // Cron (every 15 min): stale presence, retention purge once a day, then the KB reindex check.
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    // Once a day: only the 03:00 UTC tick (minute < 15) runs the purge.
    const at = new Date(controller.scheduledTime);
    if (at.getUTCHours() === 3 && at.getUTCMinutes() < 15) await purgeOld(env, controller.scheduledTime);
    // Every tick: presence rows older than 15 minutes (and the team messages that went with them).
    await purgeLive(env, controller.scheduledTime);
    await reindexIfChanged(env);
  },
};

// Reindex Vectorize when kb-bundle.json changed since the last successful
// reindex. The hash is stored only after a clean run, so a failed run is
// retried on the next tick (reindexKb is idempotent).
async function reindexIfChanged(env: Env): Promise<void> {
  if (!env.CHAT_SESSIONS) {
    console.log('rag cron: CHAT_SESSIONS not bound, skipping');
    return;
  }
  try {
    const indexed = await env.CHAT_SESSIONS.get(RAG_HASH_KEY);
    if (indexed === kbVersion.hash) return;
    // Back off after failures (15 min, 30, 60 ... capped at 24 h) so a
    // deterministic error doesn't re-embed ~2k chunks 96 times a day.
    const fail = JSON.parse((await env.CHAT_SESSIONS.get(RAG_FAIL_KEY)) || 'null') as { hash: string; count: number; at: number } | null;
    if (fail && fail.hash === kbVersion.hash) {
      const waitMs = Math.min(15 * 60_000 * 2 ** (fail.count - 1), 24 * 3600_000);
      if (Date.now() - fail.at < waitMs) return;
    }
    console.log(`rag cron: KB changed (${(indexed || 'none').slice(0, 12)} -> ${kbVersion.hash.slice(0, 12)}), reindexing`);
    const result = await reindexKb(env);
    await env.CHAT_SESSIONS.put(RAG_HASH_KEY, kbVersion.hash);
    await env.CHAT_SESSIONS.delete(RAG_FAIL_KEY);
    console.log('rag cron: reindex ok', JSON.stringify({ upserted: result.upserted, deletedOrphans: result.deletedOrphans, chunks: result.chunks }));
  } catch (e) {
    console.log('rag cron: reindex failed', String((e as Error)?.message || e).slice(0, 300));
    try {
      const prev = JSON.parse((await env.CHAT_SESSIONS.get(RAG_FAIL_KEY)) || 'null') as { hash: string; count: number } | null;
      const count = prev && prev.hash === kbVersion.hash ? prev.count + 1 : 1;
      await env.CHAT_SESSIONS.put(RAG_FAIL_KEY, JSON.stringify({ hash: kbVersion.hash, count, at: Date.now() }));
    } catch {}
  }
}
