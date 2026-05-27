// brain.ts
// Calls Groq's chat completions API with the assembled prompt + KB + history.
// Streams the response back as Server-Sent Events.
//
// If Groq is rate-limited (429) or unavailable (5xx), falls back to Gemini
// 2.0 Flash. The Gemini stream is repackaged into OpenAI-style SSE frames
// so the widget client doesn't need to know which provider answered.

import { BRAIN_CORE, buildKbSection } from './system-prompt';
import kbBundle from './kb-bundle.json';

type Lang = 'en' | 'es';
type KbDoc = { slug: string; title: string; description: string; product: string; body: string };
type KbBundle = Record<Lang, KbDoc[]>;

const KB = kbBundle as KbBundle;

export type ChatMessage = { role: 'user' | 'assistant'; content: string };

export function detectLanguage(messages: ChatMessage[]): Lang {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  if (!lastUser) return 'en';
  const text = lastUser.content.toLowerCase();
  const esMarkers = /[áéíóúñ¿¡]| el | la | los | las | una | qué | cómo | dónde | cuándo | por qué | gracias | hola | quiero | necesito /;
  return esMarkers.test(` ${text} `) ? 'es' : 'en';
}

export function buildSystemPrompt(lang: Lang): string {
  return BRAIN_CORE + buildKbSection(KB[lang] || []);
}

export interface BrainEnv {
  GROQ_API_KEY: string;
  GROQ_MODEL: string;
  GEMINI_API_KEY: string;
  MAX_HISTORY_MESSAGES: string;
}

function clampHistory(env: BrainEnv, history: ChatMessage[]): ChatMessage[] {
  const max = Math.max(2, Math.min(40, parseInt(env.MAX_HISTORY_MESSAGES, 10) || 12));
  return history.slice(-max);
}

// ─── Groq path ──────────────────────────────────────────────────────────────

async function callGroq(
  env: BrainEnv,
  systemPrompt: string,
  history: ChatMessage[],
): Promise<Response> {
  const body = {
    model: env.GROQ_MODEL,
    temperature: 0.5,
    max_tokens: 600,
    stream: true,
    messages: [
      { role: 'system', content: systemPrompt },
      ...history,
    ],
  };

  return fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${env.GROQ_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

// ─── Gemini fallback ────────────────────────────────────────────────────────

function buildGeminiBody(systemPrompt: string, history: ChatMessage[]) {
  return {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: history.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    })),
    generationConfig: {
      temperature: 0.5,
      maxOutputTokens: 600,
    },
  };
}

async function callGemini(
  env: BrainEnv,
  systemPrompt: string,
  history: ChatMessage[],
): Promise<Response> {
  // Use the non-streaming endpoint and wrap the full response as a single
  // SSE frame. Simpler than re-streaming and avoids quirks of Gemini's SSE
  // alt mode when called from inside a Worker.
  const body = buildGeminiBody(systemPrompt, history);
  const url =
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent' +
    `?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// Takes a complete Gemini response object and returns a single-frame SSE
// stream in OpenAI/Groq shape so the widget client can use one parser.
function geminiToSSE(geminiJson: unknown): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const id = 'chatcmpl-gemini-' + crypto.randomUUID();
  const created = Math.floor(Date.now() / 1000);

  // Extract text from Gemini's response shape.
  const j = geminiJson as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text =
    j?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') ||
    '';

  function frame(content: string): string {
    return (
      'data: ' +
      JSON.stringify({
        id,
        object: 'chat.completion.chunk',
        created,
        model: 'gemini-2.0-flash',
        choices: [{ index: 0, delta: { content }, finish_reason: null }],
      }) +
      '\n\n'
    );
  }

  return new ReadableStream({
    start(controller) {
      // Emit as a few chunks to feel slightly streamed in the widget UI.
      if (text) {
        const chunkSize = 40;
        for (let i = 0; i < text.length; i += chunkSize) {
          controller.enqueue(encoder.encode(frame(text.slice(i, i + chunkSize))));
        }
      } else {
        controller.enqueue(
          encoder.encode(frame('Sorry, I could not generate a response. Please try again in a moment.')),
        );
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
}

// ─── Public entry ───────────────────────────────────────────────────────────

export async function streamReply(
  env: BrainEnv,
  systemPrompt: string,
  history: ChatMessage[],
): Promise<{ response: Response; provider: 'groq' | 'gemini' | 'none' }> {
  const trimmed = clampHistory(env, history);

  // Try Groq first.
  const groqRes = await callGroq(env, systemPrompt, trimmed);
  if (groqRes.ok && groqRes.body) {
    return {
      provider: 'groq',
      response: new Response(groqRes.body, {
        headers: {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache, no-transform',
          'x-accel-buffering': 'no',
          'x-chat-provider': 'groq',
        },
      }),
    };
  }

  const groqStatus = groqRes.status;
  const groqErrBody = await groqRes.text().catch(() => '');
  const shouldFallback = groqStatus === 429 || (groqStatus >= 500 && groqStatus < 600);

  if (!shouldFallback) {
    // Permanent error — surface it.
    return {
      provider: 'none',
      response: new Response(
        `Groq error ${groqStatus}: ${groqErrBody.slice(0, 400)}`,
        { status: 502, headers: { 'content-type': 'text/plain' } },
      ),
    };
  }

  // Fallback to Gemini.
  if (!env.GEMINI_API_KEY) {
    return {
      provider: 'none',
      response: new Response('Upstream rate-limited and no fallback configured', {
        status: 502,
        headers: { 'content-type': 'text/plain' },
      }),
    };
  }

  const geminiRes = await callGemini(env, systemPrompt, trimmed);
  if (!geminiRes.ok) {
    const geminiErr = await geminiRes.text().catch(() => '');
    return {
      provider: 'none',
      response: new Response(
        `Both upstreams failed. Groq ${groqStatus}; Gemini ${geminiRes.status}: ${geminiErr.slice(0, 300)}`,
        { status: 502, headers: { 'content-type': 'text/plain' } },
      ),
    };
  }

  let geminiJson: unknown;
  try {
    geminiJson = await geminiRes.json();
  } catch (e) {
    return {
      provider: 'none',
      response: new Response('Gemini returned non-JSON response', {
        status: 502,
        headers: { 'content-type': 'text/plain' },
      }),
    };
  }

  const streamed = geminiToSSE(geminiJson);
  return {
    provider: 'gemini',
    response: new Response(streamed, {
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache, no-transform',
        'x-accel-buffering': 'no',
        'x-chat-provider': 'gemini',
      },
    }),
  };
}
