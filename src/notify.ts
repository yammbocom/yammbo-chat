// notify.ts
// Outbound lead notifications from the Worker. HTTP-only (no SMTP — Workers
// can't open raw TCP), so email uses the ZeptoMail HTTP API when a token is
// present; Telegram and WhatsApp use their REST APIs.
//
// Mirrors the alert() shape from /opt/yammbo-agent/agent/tools/notify.js so
// the lead format Yambo receives is consistent across the social and web
// channels. Each sender returns { ok, info } and never throws.

export interface NotifyEnv {
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  WHATSAPP_ACCESS_TOKEN?: string;
  WHATSAPP_PHONE_ID?: string;
  WHATSAPP_ALERT_TEMPLATE_NAME?: string;
  WHATSAPP_ALERT_TEMPLATE_LANG?: string;
  YAMMBO_PERSONAL_WHATSAPP?: string;
  ZEPTOMAIL_API_TOKEN?: string;
  ZEPTOMAIL_FROM_EMAIL?: string;
  ZEPTOMAIL_FROM_NAME?: string;
  AGENT_ALERT_EMAIL?: string;
}

export type SendResult = { ok: boolean; info: string };

export function escapeHtml(s: unknown): string {
  return String(s ?? '—').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderValue(v: unknown, mode: 'email' | 'telegram'): string {
  const s = String(v ?? '—');
  if (/^https?:\/\/[^\s<>"']+$/i.test(s)) {
    const href = escapeHtml(s);
    return mode === 'telegram' ? `<a href="${href}">${href}</a>` : `<a href="${href}" style="color:#0a66c2">${href}</a>`;
  }
  return escapeHtml(s);
}

export async function sendTelegram(env: NotifyEnv, text: string): Promise<SendResult> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return { ok: false, info: 'telegram_not_configured' };
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: env.TELEGRAM_CHAT_ID,
      text: text.slice(0, 4000),
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  });
  if (res.status === 200) return { ok: true, info: 'sent' };
  const body = await res.text().catch(() => '');
  return { ok: false, info: `telegram_${res.status}: ${body.slice(0, 200)}` };
}

// ZEPTOMAIL_API_TOKEN is set (since 12-nov-2026): lead details are emailed to the team
// (AGENT_ALERT_EMAIL) and the team's live replies to visitors who left an email
// (sendVisitorEmail). src/privacy.ts says so; if the token is removed, update it.
async function sendEmail(env: NotifyEnv, subject: string, html: string, to?: string): Promise<SendResult> {
  if (!env.ZEPTOMAIL_API_TOKEN) return { ok: false, info: 'zeptomail_api_token_missing' };
  const res = await fetch('https://api.zeptomail.com/v1.1/email', {
    method: 'POST',
    headers: {
      'authorization': env.ZEPTOMAIL_API_TOKEN, // ZeptoMail expects "Zoho-enczapikey <token>"
      'content-type': 'application/json',
      'accept': 'application/json',
    },
    body: JSON.stringify({
      from: { address: env.ZEPTOMAIL_FROM_EMAIL || 'support@yammbo.com', name: env.ZEPTOMAIL_FROM_NAME || 'Yammbo' },
      to: [{ email_address: { address: to || env.AGENT_ALERT_EMAIL || 'support@yammbo.com' } }],
      subject: subject.slice(0, 200),
      htmlbody: html,
    }),
  });
  if (res.status >= 200 && res.status < 300) return { ok: true, info: 'sent' };
  const body = await res.text().catch(() => '');
  return { ok: false, info: `zeptomail_${res.status}: ${body.slice(0, 200)}` };
}

// Sends the team's reply to a visitor who left an email. Inactive (no-op) while
// there is no ZEPTOMAIL_API_TOKEN. The reply text is untrusted-by-construction
// (typed in the panel) and is escaped like every other value here.
export async function sendVisitorEmail(env: NotifyEnv, to: string, lang: 'es' | 'en', reply: string): Promise<SendResult> {
  if (!env.ZEPTOMAIL_API_TOKEN) return { ok: false, info: 'zeptomail_api_token_missing' };
  const es = lang === 'es';
  const html =
    `<p style="margin:0 0 12px">${es ? 'El equipo de Yammbo te respondió en el chat:' : 'The Yammbo team replied to you in the chat:'}</p>` +
    `<blockquote style="margin:0 0 16px;padding:8px 14px;border-left:3px solid #1160d8;white-space:pre-wrap">${escapeHtml(reply)}</blockquote>` +
    `<p style="color:#666;font-size:13px">${es ? 'Puedes seguir la conversación en el chat del sitio o escribir a' : 'You can continue in the site chat or write to'} support@yammbo.com</p>`;
  return sendEmail(env, es ? 'Respuesta del equipo de Yammbo' : 'Reply from the Yammbo team', html, to);
}

async function sendWhatsApp(env: NotifyEnv, vars: string[]): Promise<SendResult> {
  const to = env.YAMMBO_PERSONAL_WHATSAPP;
  const tpl = env.WHATSAPP_ALERT_TEMPLATE_NAME;
  if (!to || !tpl || !env.WHATSAPP_ACCESS_TOKEN || !env.WHATSAPP_PHONE_ID) {
    return { ok: false, info: 'whatsapp_not_configured' };
  }
  const res = await fetch(`https://graph.facebook.com/v21.0/${env.WHATSAPP_PHONE_ID}/messages`, {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: tpl,
        language: { code: env.WHATSAPP_ALERT_TEMPLATE_LANG || 'es' },
        components: [
          {
            type: 'body',
            parameters: vars.map((v) => ({ type: 'text', text: String(v || '—').slice(0, 1000) })),
          },
        ],
      },
    }),
  });
  if (res.status >= 200 && res.status < 300) return { ok: true, info: 'sent' };
  const body = await res.text().catch(() => '');
  return { ok: false, info: `whatsapp_${res.status}: ${body.slice(0, 200)}` };
}

export interface LeadAlert {
  title: string;
  fields: Record<string, string>;
}

// Fires all three channels in parallel. Best-effort: a failure in one does
// not block the others. Returns per-channel results for logging.
export async function alertLead(env: NotifyEnv, { title, fields }: LeadAlert): Promise<Record<string, SendResult>> {
  const tgLines = [
    `<b>🟢 ${escapeHtml(title)}</b>`,
    ...Object.entries(fields).map(([k, v]) => `<b>${escapeHtml(k)}:</b> ${renderValue(v, 'telegram')}`),
  ];

  const emailHtml =
    `<h2 style="margin:0">${escapeHtml(title)}</h2>` +
    `<table style="border-collapse:collapse;margin-top:8px">` +
    Object.entries(fields)
      .map(
        ([k, v]) =>
          `<tr><td style="padding:4px 12px 4px 0;color:#666;vertical-align:top">${escapeHtml(k)}</td><td style="padding:4px 0"><strong>${renderValue(v, 'email')}</strong></td></tr>`,
      )
      .join('') +
    `</table><p style="color:#888;font-size:12px;margin-top:24px">Yammbo Chat · ${new Date().toISOString()}</p>`;

  // WhatsApp template yammbo_agent_alert positional vars:
  // {{1}}=title {{2}}=platform {{3}}=cliente {{4}}=datos {{5}}=link
  const datos = Object.entries(fields)
    .filter(([k]) => !['Canal', 'Nombre', 'Resumen'].includes(k))
    .map(([k, v]) => `${k}: ${v}`)
    .join(' · ')
    .slice(0, 900);
  const waVars = [title, 'Chat Web (yammbo.com)', fields['Nombre'] || '—', datos || 'sin datos', fields['Email'] || '—'];

  const [telegram, email, whatsapp] = await Promise.all([
    sendTelegram(env, tgLines.join('\n')),
    sendEmail(env, `[Yammbo Chat] ${title}`, emailHtml),
    sendWhatsApp(env, waVars),
  ]);

  return { telegram, email, whatsapp };
}
