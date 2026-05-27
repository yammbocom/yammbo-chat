// index.ts — Worker entry point.
// Routes:
//   GET  /             healthcheck
//   GET  /widget.js    embeddable chat widget (vanilla JS)
//   GET  /demo         standalone demo page that loads the widget
//   POST /api/chat     chat endpoint, streams response
//   OPTIONS *          CORS preflight

import { buildCorsHeaders, handlePreflight } from './cors';
import {
  detectLanguage,
  buildSystemPrompt,
  streamReply,
  type ChatMessage,
  type BrainEnv,
} from './brain';
import { WIDGET_JS } from './widget';
import { DEMO_HTML } from './demo';

interface Env extends BrainEnv {
  ALLOWED_ORIGINS: string;
  CHAT_SESSIONS?: KVNamespace;
  SESSION_TTL_SECONDS: string;
}

interface ChatRequestBody {
  messages?: ChatMessage[];
  sessionId?: string;
}

function jsonResponse(data: unknown, status: number, corsHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', ...corsHeaders },
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const cors = buildCorsHeaders(request, env.ALLOWED_ORIGINS);

    if (request.method === 'OPTIONS') {
      return handlePreflight(request, env.ALLOWED_ORIGINS);
    }

    // Healthcheck
    if (request.method === 'GET' && url.pathname === '/') {
      return jsonResponse({ status: 'ok', service: 'yammbo-chat', version: '0.2.0' }, 200, cors);
    }

    // Embeddable widget — public, cacheable, CORS-open so any allowed site can <script src=...>
    if (request.method === 'GET' && url.pathname === '/widget.js') {
      return new Response(WIDGET_JS, {
        headers: {
          'content-type': 'application/javascript; charset=utf-8',
          'cache-control': 'public, max-age=300',
          'access-control-allow-origin': '*',
        },
      });
    }

    // Standalone demo page (so we can validate UI without integrating into a site)
    if (request.method === 'GET' && url.pathname === '/demo') {
      return new Response(DEMO_HTML, {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-cache',
        },
      });
    }

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
      if (!messages) {
        return jsonResponse({ error: 'Invalid messages array' }, 400, cors);
      }

      const lang = detectLanguage(messages);
      const systemPrompt = buildSystemPrompt(lang);

      const { response: upstream } = await streamReply(env, systemPrompt, messages);

      const headers = new Headers(upstream.headers);
      for (const [k, v] of Object.entries(cors)) headers.set(k, v);
      return new Response(upstream.body, { status: upstream.status, headers });
    }

    return jsonResponse({ error: 'Not found' }, 404, cors);
  },
};
