// index.ts — Worker entry point.
// Routes:
//   GET  /                healthcheck
//   GET  /widget.js       embeddable chat widget (vanilla JS)
//   GET  /demo            standalone demo page
//   GET  /api/docs        Help Center index (?lang=en|es)
//   GET  /api/docs?slug=X single doc with body
//   GET  /api/blog        recent blog posts
//   POST /api/chat        chat endpoint, streams response
//   POST /api/lead        human handoff — captures lead + notifies Yambo
//   OPTIONS *             CORS preflight

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
import { WIDGET_JS } from './widget';
import { DEMO_HTML } from './demo';

interface Env extends BrainEnv, NotifyEnv, RagEnv {
  ALLOWED_ORIGINS: string;
  CHAT_SESSIONS?: KVNamespace;
  SESSION_TTL_SECONDS: string;
  ADMIN_KEY?: string;
}

interface ChatRequestBody {
  messages?: ChatMessage[];
  sessionId?: string;
}

interface LeadRequestBody {
  name?: string;
  email?: string;
  phone?: string;
  channel?: string;
  message?: string;
  transcript?: ChatMessage[];
  lang?: string;
}

function jsonResponse(data: unknown, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', ...extra },
  });
}

function validateMessages(input: unknown): ChatMessage[] | null {
  if (!Array.isArray(input)) return null;
  if (input.length === 0 || input.length > 40) return null;
  const out: ChatMessage[] = [];
  for (const m of input) {
    if (!m || typeof m !== 'object') return null;
    const msg = m as { role?: unknown; content?: unknown };
    if (msg.role !== 'user' && msg.role !== 'assistant') return null;
    if (typeof msg.content !== 'string') return null;
    if (msg.content.length === 0 || msg.content.length > 4000) return null;
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const cors = buildCorsHeaders(request, env.ALLOWED_ORIGINS);

    if (request.method === 'OPTIONS') {
      return handlePreflight(request, env.ALLOWED_ORIGINS);
    }

    // Healthcheck
    if (request.method === 'GET' && url.pathname === '/') {
      return jsonResponse({ status: 'ok', service: 'yammbo-chat', version: '0.3.0' }, 200, cors);
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

    // Standalone demo page
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

      const lang = detectLanguage(messages);

      // RAG: retrieve only the chunks relevant to the latest question. If
      // retrieval fails (Vectorize/Workers AI hiccup) fall back to the full KB
      // so the assistant always has grounding.
      const lastUser = messages[messages.length - 1].content;
      let systemPrompt: string;
      try {
        const chunks = await retrieve(env, lastUser, lang, 6);
        systemPrompt = buildSystemPrompt(chunks);
      } catch (e) {
        console.error('retrieve failed, falling back to full KB:', (e as Error)?.message);
        systemPrompt = buildSystemPromptFull(lang);
      }

      const { response: upstream } = await streamReply(env, systemPrompt, messages);

      const headers = new Headers(upstream.headers);
      for (const [k, v] of Object.entries(cors)) headers.set(k, v);
      return new Response(upstream.body, { status: upstream.status, headers });
    }

    // Admin: (re)build the KB vector index from the bundled docs. Guarded by a
    // shared secret. Run after editing kb-bundle.json or on first setup.
    if (request.method === 'POST' && url.pathname === '/admin/reindex') {
      if (!env.ADMIN_KEY || request.headers.get('x-admin-key') !== env.ADMIN_KEY) {
        return jsonResponse({ error: 'Forbidden' }, 403, cors);
      }
      try {
        const result = await reindexKb(env);
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

      const fields: Record<string, string> = {
        Nombre: name,
        Email: email,
        'Teléfono / WhatsApp': phone || 'no proporcionado',
        'Canal preferido': channel || '—',
        Mensaje: message || '—',
        Resumen: summary,
      };

      const results = await alertLead(env, { title: 'Nuevo lead desde el chat web', fields });
      const anyOk = Object.values(results).some((r) => r.ok);

      return jsonResponse(
        { ok: anyOk, channels: results },
        anyOk ? 200 : 502,
        cors,
      );
    }

    return jsonResponse({ error: 'Not found' }, 404, cors);
  },
};
