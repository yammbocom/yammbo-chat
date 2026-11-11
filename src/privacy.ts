// privacy.ts
// GET /privacy — what the chat widget stores and for how long. Every claim
// here mirrors code: store.ts (what is written), index.ts scheduled purge
// (90 days conversations/feedback, 365 days leads), ipHash (secret salt, per day), notify.ts (lead channels).

const CSS = `
:root{color-scheme:light dark;--bg:#fff;--fg:#000;--muted:#525252;--line:#e5e5e5;--accent:#1160d8}
@media (prefers-color-scheme:dark){:root{--bg:#000;--fg:#fff;--muted:#a3a3a3;--line:#262626;--accent:#6da4ff}}
@font-face{font-family:"YC Geist";font-weight:300 800;font-display:swap;src:url(/fonts/geist-latin.woff2) format("woff2")}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 "YC Geist",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:680px;margin:0 auto;padding:56px 20px 80px}
h1{font-size:30px;line-height:1.15;letter-spacing:-.02em;margin:0 0 6px;font-weight:650}
h2{font-size:18px;margin:32px 0 8px;font-weight:600}
p,li{color:var(--fg)}.muted{color:var(--muted);font-size:14px}
ul{padding-left:20px}a{color:var(--accent)}
hr{border:0;border-top:1px solid var(--line);margin:48px 0}
nav{font-size:14px}nav a{margin-right:14px}
`;

const ES = `
<section id="es" lang="es">
<h1>Privacidad del chat de Yammbo</h1>
<p class="muted">Última actualización: 11 de noviembre de 2026</p>
<p>Este aviso cubre solo el chat que aparece en las páginas de Yammbo (yammbo.com, help, music, tv, web y link). Cada producto tiene su propia política para lo que haces dentro de él.</p>
<h2>Qué guardamos</h2>
<ul>
<li><strong>La conversación</strong>: tus mensajes y las respuestas del asistente, la página desde la que escribiste, el idioma y si la respuesta te fue útil (los botones de pulgar).</li>
<li><strong>Si pides hablar con una persona</strong>: el nombre, email, teléfono, canal preferido y mensaje que escribas en el formulario, junto con la página y la conversación de la que sale.</li>
<li><strong>Tu IP no se guarda en la base de datos del chat.</strong> Como mucho guardamos una huella (hash con una clave secreta) que cambia cada día, para contar visitantes distintos sin poder seguirte de un día a otro. La IP se usa en el momento para limitar el envío de mensajes en masa, y los registros técnicos de Cloudflare pueden contenerla unos días.</li>
</ul>
<h2>Para qué</h2>
<p>Para responderte, para que el equipo pueda contactarte si lo pediste, y para ver qué preguntas no sabe responder el asistente y mejorar la ayuda. No usamos el chat para publicidad ni vendemos estos datos.</p>
<h2>Quién procesa los mensajes</h2>
<p>Las respuestas las genera un modelo de lenguaje de Groq y, si falla, de Google (Gemini); a ellos se envía la conversación para contestar. Cloudflare procesa tu pregunta para buscar en el centro de ayuda y guarda los datos. Si pides contacto, tus datos del formulario y la página se envían al equipo por Telegram, WhatsApp y email (ZeptoMail); por Telegram y email va además un resumen de los últimos mensajes.</p>
<h2>Cuánto tiempo</h2>
<ul>
<li>Conversaciones y valoraciones: se borran solas a los <strong>90 días</strong>.</li>
<li>Datos de contacto del formulario: <strong>365 días</strong>.</li>
</ul>
<p>Estos plazos aplican a lo que guardamos en Cloudflare. El aviso de contacto que recibe el equipo por Telegram, WhatsApp o email se queda en esos buzones; bórralo pidiéndolo a support@yammbo.com.</p>
<p>El historial que ves en el chat se guarda también en tu navegador; el botón «Nueva conversación» lo borra.</p>
<h2>Tus derechos</h2>
<p>Para pedir una copia o el borrado de tus datos antes de esos plazos, escribe a <a href="mailto:support@yammbo.com">support@yammbo.com</a>.</p>
</section>`;

const EN = `
<section id="en" lang="en">
<h1>Yammbo chat privacy</h1>
<p class="muted">Last updated: November 11, 2026</p>
<p>This notice covers only the chat shown on Yammbo pages (yammbo.com, help, music, tv, web and link). Each product has its own policy for what you do inside it.</p>
<h2>What we keep</h2>
<ul>
<li><strong>The conversation</strong>: your messages and the assistant's replies, the page you wrote from, the language, and whether a reply helped (the thumb buttons).</li>
<li><strong>If you ask to talk to a person</strong>: the name, email, phone, preferred channel and message you enter in the form, plus the page and the conversation it came from.</li>
<li><strong>Your IP address is not stored in the chat database.</strong> At most we keep a fingerprint (a hash with a secret key) that changes every day, to count distinct visitors without following you from one day to the next. The IP is used at that moment to limit bulk messaging, and Cloudflare's technical logs may hold it for a few days.</li>
</ul>
<h2>Why</h2>
<p>To answer you, to let the team contact you if you asked, and to see which questions the assistant cannot answer so we can improve the help center. We don't use the chat for advertising and we don't sell this data.</p>
<h2>Who processes messages</h2>
<p>Replies are generated by a language model from Groq and, if that fails, from Google (Gemini); they receive the conversation in order to answer. Cloudflare processes your question to search the help center and stores the data. If you ask for contact, your form details and the page are sent to the team by Telegram, WhatsApp and email (ZeptoMail); Telegram and email also get a summary of the last messages.</p>
<h2>How long</h2>
<ul>
<li>Conversations and ratings: deleted automatically after <strong>90 days</strong>.</li>
<li>Contact details from the form: <strong>365 days</strong>.</li>
</ul>
<p>These periods apply to what we keep on Cloudflare. The contact notice the team receives by Telegram, WhatsApp or email stays in those inboxes; ask support@yammbo.com to delete it.</p>
<p>The history you see in the chat is also kept in your browser; the "New conversation" button clears it.</p>
<h2>Your rights</h2>
<p>To request a copy or deletion of your data before then, write to <a href="mailto:support@yammbo.com">support@yammbo.com</a>.</p>
</section>`;

export const PRIVACY_HTML = `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Privacidad del chat · Yammbo</title>
<meta name="description" content="Qué guarda el chat de Yammbo, para qué y cuánto tiempo.">
<style>${CSS}</style></head>
<body><main>
<nav><a href="#es">Español</a><a href="#en">English</a></nav>
${ES}
<hr>
${EN}
</main></body></html>`;
