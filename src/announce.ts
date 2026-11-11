// announce.ts
// Team alerts that are not lead handoffs: a "new conversation" message on
// Telegram (reusing notify.ts's sender) plus a Web Push to the panel devices.
// Best-effort and silent on failure: callers run it in ctx.waitUntil.

import { flagEmoji } from './device';
import { hit } from './limit';
import { escapeHtml, sendTelegram, type NotifyEnv } from './notify';
import { PRODUCT_NAMES, type Product } from './page';
import { sendPushToAll, type PushEnv } from './push';

export const PANEL_ORIGIN = 'https://chat.yammbo.com';

// At most this many conversation alerts per hour; the rest are dropped silently
// so a script opening sessions in a loop cannot flood Telegram or the phones.
const MAX_CONVERSATION_ALERTS_PER_HOUR = 30;
const FIRST_QUESTION_MAX = 300;

export interface AnnounceEnv extends NotifyEnv, PushEnv {}

export interface NewConversation {
  sessionId: string;
  product: Product | null;
  country: string | null;
  city: string | null;
  device: string | null;
  os: string | null;
  browser: string | null;
  firstQuestion: string;
}

// Counts one alert in the current hour (atomic D1 counter shared with the
// panel throttle). False when the hourly budget is spent. Without D1 there is
// no way to enforce the cap, so nothing is sent.
async function takeConversationAlertSlot(db: D1Database | undefined): Promise<boolean> {
  if (!db) return false;
  return (await hit(db, 'conv_alerts', 3600_000)) <= MAX_CONVERSATION_ALERTS_PER_HOUR;
}

function where(c: NewConversation): string {
  const flag = flagEmoji(c.country);
  return [flag && c.country ? `${flag} ${c.country}` : c.country, c.city].filter(Boolean).join(' · ') || '—';
}

function client(c: NewConversation): string {
  return [c.device, c.os, c.browser].filter(Boolean).join(' · ') || '—';
}

// Telegram parse_mode is HTML (see notify.ts), so the visitor's text is escaped.
export function conversationTelegramText(c: NewConversation): string {
  const question = c.firstQuestion.replace(/\s+/g, ' ').trim().slice(0, FIRST_QUESTION_MAX);
  return [
    '<b>💬 Nueva conversación</b>',
    `<b>Producto:</b> ${escapeHtml(c.product ? PRODUCT_NAMES[c.product] : '—')}`,
    `<b>Desde:</b> ${escapeHtml(where(c))}`,
    `<b>Dispositivo:</b> ${escapeHtml(client(c))}`,
    `<b>Pregunta:</b> ${escapeHtml(question)}`,
    `<a href="${PANEL_ORIGIN}/panel/#/c/${encodeURIComponent(c.sessionId)}">Abrir en el panel</a>`,
  ].join('\n');
}

export async function announceNewConversation(env: AnnounceEnv, c: NewConversation): Promise<void> {
  try {
    if (!(await takeConversationAlertSlot(env.DB))) return;
    const question = c.firstQuestion.replace(/\s+/g, ' ').trim();
    const place = [flagEmoji(c.country), c.city].filter(Boolean).join(' ');
    await Promise.all([
      sendTelegram(env, conversationTelegramText(c)).catch((e) => console.error('telegram conversation alert failed:', (e as Error)?.message)),
      sendPushToAll(env, {
        title: `💬 Nueva conversación${c.product ? ` · ${PRODUCT_NAMES[c.product]}` : ''}`,
        body: `${place ? place + ' · ' : ''}${question}`,
        url: `/panel/#/c/${encodeURIComponent(c.sessionId)}`,
      }),
    ]);
  } catch (e) {
    console.error('announceNewConversation failed:', (e as Error)?.message);
  }
}

// Web Push for a new lead. The Telegram/WhatsApp alert is sent by alertLead.
export async function pushNewLead(env: PushEnv, name: string, channel: string): Promise<void> {
  await sendPushToAll(env, {
    title: '🟢 Nuevo contacto',
    body: channel ? `${name} · prefiere ${channel}` : name,
    url: '/panel/#/leads',
  });
}
