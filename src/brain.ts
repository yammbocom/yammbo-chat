// brain.ts
// Calls Groq's chat completions API with the assembled prompt + KB + history.
// Streams the response back as Server-Sent Events.
//
// If Groq is rate-limited (429) or unavailable (5xx), falls back to Gemini
// (gemini-3.6-flash). The Gemini stream is repackaged into OpenAI-style SSE frames
// so the widget client doesn't need to know which provider answered.

import { BRAIN_CORE, DRAFT_CORE, buildKbSection, buildKbSectionFromChunks } from './system-prompt';
import kbBundle from './kb-bundle.json';
import type { KbChunk } from './rag';

type Lang = 'en' | 'es';
type KbDoc = { slug: string; url: string; title: string; description: string; product: string; body: string };
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

// RAG path: prompt carries only the retrieved excerpts.
export function buildSystemPrompt(chunks: KbChunk[], pageLine = ''): string {
  return BRAIN_CORE + (pageLine ? `\n\n${pageLine}` : '') + buildKbSectionFromChunks(chunks);
}

// Fallback: retrieval unavailable → send an index (title, summary, URL) of the
// language's docs; full bodies would blow Groq's TPM limit.
export function buildSystemPromptFull(lang: Lang, pageLine = ''): string {
  return BRAIN_CORE + (pageLine ? `\n\n${pageLine}` : '') + buildKbSection(KB[lang] || []);
}

// Prompt for the panel's "suggest a reply" draft: same KB sections as the bot.
// `chunks` null = retrieval failed, fall back to the title/URL index.
export function buildDraftPrompt(chunks: KbChunk[] | null, lang: Lang, pageLine = ''): string {
  return DRAFT_CORE + (pageLine ? `\n\n${pageLine}` : '') + (chunks ? buildKbSectionFromChunks(chunks) : buildKbSection(KB[lang] || []));
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
    // Reasoning tokens count against max_tokens (500 truncated a JSON answer in
    // another worker), so keep headroom. include_reasoning:false stops Groq
    // streaming delta.reasoning chunks to the browser.
    max_tokens: 1000,
    include_reasoning: false,
    reasoning_effort: 'low',
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

function buildGeminiBody(systemPrompt: string, history: ChatMessage[], maxOutputTokens = 600) {
  const contents = history.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));
  // A proactive teaser puts an assistant line before the visitor's first message;
  // Gemini wants the conversation to open with a user turn.
  if (contents.length && contents[0].role === 'model') contents.unshift({ role: 'user', parts: [{ text: '(The visitor opened the chat.)' }] });
  return {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents,
    generationConfig: {
      temperature: 0.5,
      maxOutputTokens,
    },
  };
}

async function callGemini(
  env: BrainEnv,
  systemPrompt: string,
  history: ChatMessage[],
  maxOutputTokens?: number,
): Promise<Response> {
  // Use the non-streaming endpoint and wrap the full response as a single
  // SSE frame. Simpler than re-streaming and avoids quirks of Gemini's SSE
  // alt mode when called from inside a Worker.
  const body = buildGeminiBody(systemPrompt, history, maxOutputTokens);
  const url =
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent' +
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
        model: 'gemini-3.6-flash',
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
  // A retired model answers 404 model_not_found on every single call. Treating
  // that as permanent is what kept this chat serving 502s for five days after
  // Groq shut down llama-3.3-70b-versatile on 2026-08-16: the Gemini fallback
  // was configured and healthy, and never got asked.
  const modelGone =
    groqStatus === 404 && /model_not_found|does not exist|no longer/i.test(groqErrBody);
  // 400 too: a request Groq rejects (a parameter it stops accepting, a prompt
  // over its limit) is still a question Gemini can answer.
  const shouldFallback =
    groqStatus === 400 || groqStatus === 429 || modelGone || (groqStatus >= 500 && groqStatus < 600);

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

// ─── Non-streaming completion (panel draft) ─────────────────────────────────

// One complete answer, Groq first and Gemini when Groq fails for any reason (a
// human is waiting for the draft, so the permanent-error short-circuit of
// streamReply is not worth it here). Null when neither provider answered.
export async function completeReply(
  env: BrainEnv,
  systemPrompt: string,
  history: ChatMessage[],
  opts: { maxTokens?: number } = {},
): Promise<{ text: string; provider: 'groq' | 'gemini' } | null> {
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'authorization': `Bearer ${env.GROQ_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: env.GROQ_MODEL,
        temperature: 0.4,
        max_tokens: opts.maxTokens ?? 1000,
        include_reasoning: false,
        reasoning_effort: 'low',
        stream: false,
        messages: [{ role: 'system', content: systemPrompt }, ...history],
      }),
    });
    if (res.ok) {
      const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const text = j.choices?.[0]?.message?.content?.trim();
      if (text) return { text, provider: 'groq' };
    } else {
      await res.body?.cancel().catch(() => {});
    }
  } catch (e) {
    console.error('draft groq failed:', (e as Error)?.message);
  }
  if (!env.GEMINI_API_KEY) return null;
  try {
    const res = await callGemini(env, systemPrompt, history, opts.maxTokens);
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return null;
    }
    const j = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const text = j.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('').trim();
    return text ? { text, provider: 'gemini' } : null;
  } catch (e) {
    console.error('draft gemini failed:', (e as Error)?.message);
    return null;
  }
}
