// brain.ts
// Calls Groq's chat completions API with the assembled prompt + KB + history.
// Streams the response back as Server-Sent Events.

import { BRAIN_CORE, buildKbSection } from './system-prompt';
import kbBundle from './kb-bundle.json';

type Lang = 'en' | 'es';
type KbDoc = { slug: string; title: string; description: string; product: string; body: string };
type KbBundle = Record<Lang, KbDoc[]>;

const KB = kbBundle as KbBundle;

export type ChatMessage = { role: 'user' | 'assistant'; content: string };

export function detectLanguage(messages: ChatMessage[]): Lang {
  // Look at the latest user message. Crude heuristic — good enough for v1.
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
  MAX_HISTORY_MESSAGES: string;
}

export async function streamGroq(
  env: BrainEnv,
  systemPrompt: string,
  history: ChatMessage[],
): Promise<Response> {
  const max = Math.max(2, Math.min(40, parseInt(env.MAX_HISTORY_MESSAGES, 10) || 12));
  const trimmed = history.slice(-max);

  const body = {
    model: env.GROQ_MODEL,
    temperature: 0.5,
    max_tokens: 600,
    stream: true,
    messages: [
      { role: 'system', content: systemPrompt },
      ...trimmed,
    ],
  };

  const upstream = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${env.GROQ_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!upstream.ok || !upstream.body) {
    const err = await upstream.text();
    return new Response(`Groq error: ${upstream.status} ${err.slice(0, 500)}`, {
      status: 502,
      headers: { 'content-type': 'text/plain' },
    });
  }

  // Pass-through SSE stream from Groq to client. Groq emits OpenAI-style
  // "data: {...}\n\n" frames terminated by "data: [DONE]\n\n".
  return new Response(upstream.body, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no',
    },
  });
}
