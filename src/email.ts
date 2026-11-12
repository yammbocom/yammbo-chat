// email.ts
// Noir email templates (black, white, greys and one blue #1160d8). Table layout and
// inline styles only: email clients drop <style> blocks and flexbox. The dark palette
// is declared with color-scheme so clients in dark mode do not invert it.
// Every value that comes from a visitor or the team goes through esc().

const BLUE = '#1160d8';
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";
const PANEL_URL = 'https://chat.yammbo.com/panel/';
const PRIVACY_URL = 'https://chat.yammbo.com/privacy';

// Plain address only (no ?, &, =, quotes): used for mailto links and Reply-To, so a
// visitor cannot smuggle mailto parameters (bcc=, body=) into the team's mail client.
export const SAFE_EMAIL_RE = /^[A-Za-z0-9._+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24}$/;

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Only plain http(s) URLs become links; anything else is shown as text.
function safeUrl(s: string): string | null {
  return /^https?:\/\/[^\s<>"']+$/i.test(s) ? s : null;
}

function button(href: string, label: string, primary: boolean): string {
  const bg = primary ? '#ffffff' : '#000000';
  const fg = primary ? '#000000' : '#ffffff';
  const border = primary ? '#ffffff' : '#3a3a3a';
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="display:inline-table;margin:0 8px 8px 0"><tr>
<td bgcolor="${bg}" style="background:${bg};border:1px solid ${border};border-radius:999px">
<a href="${esc(href)}" style="display:inline-block;padding:12px 22px;font:600 14px/1 ${FONT};color:${fg};text-decoration:none;border-radius:999px">${esc(label)}</a>
</td></tr></table>`;
}

interface LayoutOpts {
  lang: 'es' | 'en';
  preheader: string;
  eyebrow: string;
  title: string;
  body: string; // already-escaped HTML
  buttons?: string;
  footer: string; // already-escaped HTML
}

function layout(o: LayoutOpts): string {
  return `<!doctype html>
<html lang="${o.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"><title>${esc(o.title)}</title></head>
<body bgcolor="#000000" style="margin:0;padding:0;background:#000000;color:#f2f2f2;-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#000000">${esc(o.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#000000" style="background:#000000">
<tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px">
<tr><td style="padding:0 4px 20px;font:800 13px/1 ${FONT};letter-spacing:.32em;color:#ffffff">YAMMBO</td></tr>
<tr><td bgcolor="#0b0b0b" style="background:#0b0b0b;border:1px solid #232323;border-radius:18px;padding:32px 28px">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td height="3" width="40" bgcolor="${BLUE}" style="background:${BLUE};height:3px;width:40px;font-size:0;line-height:0;border-radius:2px">&nbsp;</td></tr></table>
<p style="margin:20px 0 8px;font:600 11px/1.4 ${FONT};letter-spacing:.16em;text-transform:uppercase;color:#8a8a8a">${esc(o.eyebrow)}</p>
<h1 style="margin:0 0 24px;font:700 24px/1.25 ${FONT};letter-spacing:-.01em;color:#ffffff">${esc(o.title)}</h1>
${o.body}
${o.buttons ? `<div style="margin-top:28px">${o.buttons}</div>` : ''}
</td></tr>
<tr><td style="padding:20px 4px 0;font:400 12px/1.6 ${FONT};color:#6b6b6b">${o.footer}</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

// Lead alert to the team ------------------------------------------------------------

export interface LeadEmailInput {
  fields: Record<string, string>;
  sessionId?: string | null;
}

const SPEAKER: Record<string, string> = { U: 'Visitante', A: 'Asistente' };

function fieldValue(key: string, value: string): string {
  const v = value || '—';
  if (key === 'Email' && SAFE_EMAIL_RE.test(v)) {
    return `<a href="mailto:${esc(v)}" style="color:${BLUE};text-decoration:none">${esc(v)}</a>`;
  }
  const url = safeUrl(v);
  if (url) return `<a href="${esc(url)}" style="color:${BLUE};text-decoration:none;word-break:break-all">${esc(url)}</a>`;
  return esc(v).replace(/\n/g, '<br>');
}

function summaryBlock(summary: string): string {
  const lines = summary
    .split('\n')
    .map((l) => {
      const m = /^([UA]): ?(.*)$/.exec(l);
      if (!m) return `<div style="margin:0 0 8px">${esc(l)}</div>`;
      return `<div style="margin:0 0 10px"><span style="font:600 10px/1.4 ${FONT};letter-spacing:.14em;text-transform:uppercase;color:${m[1] === 'U' ? '#ffffff' : '#8a8a8a'}">${SPEAKER[m[1]]}</span><br>${esc(m[2])}</div>`;
    })
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:8px"><tr>
<td bgcolor="#050505" style="background:#050505;border:1px solid #1f1f1f;border-left:3px solid ${BLUE};border-radius:10px;padding:14px 16px;font:400 14px/1.55 ${FONT};color:#d6d6d6">${lines}</td></tr></table>`;
}

export function leadEmail({ fields, sessionId }: LeadEmailInput): RenderedEmail {
  const name = (fields['Nombre'] || '').trim() || 'Visitante';
  const email = (fields['Email'] || '').trim();
  const rows = Object.entries(fields)
    .filter(([k]) => k !== 'Resumen')
    .map(
      ([k, v]) => `<tr><td style="padding:12px 0;border-top:1px solid #1f1f1f">
<div style="font:600 11px/1.4 ${FONT};letter-spacing:.14em;text-transform:uppercase;color:#8a8a8a">${esc(k)}</div>
<div style="margin-top:4px;font:500 16px/1.45 ${FONT};color:#f2f2f2">${fieldValue(k, v)}</div></td></tr>`,
    )
    .join('');
  const summary = (fields['Resumen'] || '').trim();
  const hasSummary = summary && summary !== '—';
  const body =
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>` +
    (hasSummary
      ? `<div style="margin-top:20px;font:600 11px/1.4 ${FONT};letter-spacing:.14em;text-transform:uppercase;color:#8a8a8a">Últimos mensajes</div>${summaryBlock(summary)}`
      : '');
  const panelHref = sessionId ? `${PANEL_URL}#/c/${encodeURIComponent(sessionId)}` : PANEL_URL;
  const buttons =
    (SAFE_EMAIL_RE.test(email) ? button(`mailto:${encodeURIComponent(email)}`, `Responder a ${name.slice(0, 40)}`, true) : '') +
    button(panelHref, sessionId ? 'Ver conversación' : 'Abrir el panel', false);
  const html = layout({
    lang: 'es',
    preheader: `${name} pidió contacto desde el chat${email ? ` · ${email}` : ''}`,
    eyebrow: 'Yammbo Chat · Nuevo contacto',
    title: `${name} quiere hablar con el equipo`,
    body,
    buttons,
    footer: `Responder a este correo le escribe directamente a ${esc(name)}.<br>Yammbo Chat · <a href="${PANEL_URL}" style="color:#8a8a8a">chat.yammbo.com/panel</a>`,
  });
  const text =
    `${name} quiere hablar con el equipo\n\n` +
    Object.entries(fields)
      .map(([k, v]) => `${k}: ${v || '—'}`)
      .join('\n') +
    `\n\n${sessionId ? 'Ver conversación' : 'Panel'}: ${panelHref}\n`;
  return { subject: `[Yammbo Chat] Nuevo contacto: ${name}`.slice(0, 200), html, text };
}

// Team reply to a visitor ---------------------------------------------------------

export function visitorReplyEmail(lang: 'es' | 'en', reply: string, pageUrl?: string | null): RenderedEmail {
  const es = lang === 'es';
  const back = (pageUrl && safeUrl(pageUrl)) || 'https://yammbo.com/';
  const quote = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td bgcolor="#050505" style="background:#050505;border:1px solid #1f1f1f;border-left:3px solid ${BLUE};border-radius:10px;padding:16px 18px;font:400 16px/1.6 ${FONT};color:#f2f2f2">${esc(reply).replace(/\n/g, '<br>')}</td></tr></table>`;
  const intro = `<p style="margin:0 0 16px;font:400 16px/1.6 ${FONT};color:#bdbdbd">${
    es ? 'El equipo de Yammbo te escribió en el chat:' : 'The Yammbo team wrote to you in the chat:'
  }</p>`;
  const after = `<p style="margin:20px 0 0;font:400 14px/1.6 ${FONT};color:#8a8a8a">${
    es ? 'Puedes responder a este correo o seguir la conversación en el chat del sitio.' : 'You can reply to this email or continue the conversation in the site chat.'
  }</p>`;
  const html = layout({
    lang,
    preheader: reply.slice(0, 120),
    eyebrow: es ? 'Yammbo · Respuesta del equipo' : 'Yammbo · Team reply',
    title: es ? 'Tienes una respuesta' : 'You have a reply',
    body: intro + quote + after,
    buttons: button(back, es ? 'Volver al chat' : 'Back to the chat', true),
    footer: es
      ? `Recibes este correo porque dejaste tu email en el chat de Yammbo. <a href="${PRIVACY_URL}" style="color:#8a8a8a">Privacidad</a> · support@yammbo.com`
      : `You get this email because you left your address in the Yammbo chat. <a href="${PRIVACY_URL}" style="color:#8a8a8a">Privacy</a> · support@yammbo.com`,
  });
  const text =
    (es ? 'El equipo de Yammbo te escribió en el chat:\n\n' : 'The Yammbo team wrote to you in the chat:\n\n') +
    reply +
    '\n\n' +
    (es ? `Responde a este correo o vuelve al chat: ${back}` : `Reply to this email or go back to the chat: ${back}`) +
    `\n\n${PRIVACY_URL}\n`;
  return { subject: es ? 'Respuesta del equipo de Yammbo' : 'Reply from the Yammbo team', html, text };
}
