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

function where(c: { country: string | null; city: string | null }): string {
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

// Live inbox alerts ------------------------------------------------------------------
// Visitor messages while the team is in charge, and "talk to a person" requests.
// Same shape as announceNewConversation: best-effort, silent on failure, capped
// with an atomic D1 counter so a script cannot flood Telegram or the phones.
const MAX_HUMAN_MSG_ALERTS_PER_HOUR = 120;
const MAX_HANDOFF_ALERTS_PER_HOUR = 60;

export interface LiveAlert {
  sessionId: string;
  city: string | null;
  country: string | null;
  text: string;
}

function placeOf(a: { city: string | null; country: string | null }): string {
  return a.city || a.country || 'Visitante';
}
function panelLink(sessionId: string): string {
  return `${PANEL_ORIGIN}/panel/#/c/${encodeURIComponent(sessionId)}`;
}

export async function announceHumanMessage(env: AnnounceEnv, a: LiveAlert): Promise<void> {
  try {
    if (!env.DB || (await hit(env.DB, 'human_msgs', 3600_000)) > MAX_HUMAN_MSG_ALERTS_PER_HOUR) return;
    const text = a.text.replace(/\s+/g, ' ').trim().slice(0, FIRST_QUESTION_MAX);
    await Promise.all([
      sendTelegram(env, `<b>💬 ${escapeHtml(placeOf(a))}:</b> ${escapeHtml(text)}\n<a href="${panelLink(a.sessionId)}">Abrir en el panel</a>`).catch((e) =>
        console.error('telegram live alert failed:', (e as Error)?.message),
      ),
      sendPushToAll(env, { title: `💬 ${placeOf(a)}`, body: text, url: `/panel/#/c/${encodeURIComponent(a.sessionId)}` }),
    ]);
  } catch (e) {
    console.error('announceHumanMessage failed:', (e as Error)?.message);
  }
}

export async function announceHandoff(env: AnnounceEnv, a: LiveAlert): Promise<void> {
  try {
    if (!env.DB || (await hit(env.DB, 'handoff_alerts', 3600_000)) > MAX_HANDOFF_ALERTS_PER_HOUR) return;
    const text = a.text.replace(/\s+/g, ' ').trim().slice(0, FIRST_QUESTION_MAX);
    await Promise.all([
      sendTelegram(
        env,
        [
          '<b>🙋 Pide hablar con una persona</b>',
          `<b>Desde:</b> ${escapeHtml(where(a))}`,
          `<b>Última pregunta:</b> ${escapeHtml(text || '—')}`,
          `<a href="${panelLink(a.sessionId)}">Responder en el panel</a>`,
        ].join('\n'),
      ).catch((e) => console.error('telegram handoff alert failed:', (e as Error)?.message)),
      sendPushToAll(env, {
        title: '🙋 Pide hablar con una persona',
        body: `${placeOf(a)}${text ? ' · ' + text : ''}`,
        url: `/panel/#/c/${encodeURIComponent(a.sessionId)}`,
        urgency: 'high',
      }),
    ]);
  } catch (e) {
    console.error('announceHandoff failed:', (e as Error)?.message);
  }
}
