// privacy.ts
// GET /privacy — what the chat widget stores and for how long. Every claim
// here mirrors code: store.ts (what is written), index.ts scheduled purge
// (90 days conversations/feedback/page views/notes/tags, 365 days leads), ipHash (secret salt, per day), device.ts
// (country/city/device/OS/browser), POST /api/visit (only after the chat was used), notify.ts and
// announce.ts (Telegram/WhatsApp alerts; the email channel is inactive without ZEPTOMAIL_API_TOKEN —
// if that token is ever set, this page must mention email, see the note in notify.ts),
// inbox.ts / panel-inbox.ts (live replies by the team, internal notes and tags, the 1-5 rating),
// presence.ts + migrations/0004_live.sql (visitors online: in-memory id, GPC/DNT honoured, deleted
// after 15 minutes, messages the team writes first), triggers.ts (proactive rules hold no visitor data).

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
<li><strong>La conversación</strong>: tus mensajes y las respuestas del asistente, la página desde la que escribiste cada mensaje, el idioma y si la respuesta te fue útil (los botones de pulgar).</li>
<li><strong>Datos aproximados de tu visita</strong>: el país y la ciudad aproximados (los calcula Cloudflare a partir de tu conexión), el tipo de dispositivo (móvil, tableta o escritorio), el sistema (por ejemplo iOS o Windows) y el navegador (por ejemplo Chrome o Safari). No guardamos el identificador completo de tu navegador.</li>
<li><strong>Las páginas que visitas después de usar el chat</strong>: la dirección (sin parámetros) y el título de las páginas de Yammbo que abres después de haber escrito en el chat, para que el equipo entienda qué buscabas. Aparte de la señal de presencia que se describe a continuación, no se registra nada de lo que visitas antes de escribir ni de quien no ha usado el chat.</li>
<li><strong>Que estás en línea (presencia)</strong>: mientras tienes abierta una página de Yammbo con el chat, tu navegador avisa cada 30 segundos de la página en la que estás (dirección sin parámetros y título), el idioma, tu país y ciudad aproximados, el tipo de dispositivo, el sistema y el navegador, y el sitio del que llegaste (solo el nombre del dominio, si es externo). El equipo lo ve en su panel como «visitante en línea» y puede escribirte primero; ese mensaje aparece junto a la burbuja del chat y solo se crea una conversación si lo abres. Para esto no se guarda ningún identificador en tu navegador: se genera uno aleatorio que vive solo en la memoria de la pestaña. En sitios de varias páginas cambia al navegar a otra página; en sitios de una sola página sigue siendo el mismo entre secciones, y al cerrar o recargar la pestaña se genera otro. Si en 30 minutos no tocas, pulsas una tecla ni te desplazas por la página, el navegador deja de enviar la señal hasta que vuelvas a interactuar. Si tu navegador envía la señal «Global Privacy Control» o «No rastrear», no se envía presencia, salvo que ya haya una conversación abierta (haber escrito en el chat): en ese caso se asocia a tu conversación. La fila de presencia se borra <strong>como máximo unos 30 minutos después de tu última señal</strong> (se purga a los 15 minutos y el borrado automático corre cada 15 minutos).</li>
<li><strong>Si pides hablar con una persona</strong>: el nombre, email, teléfono, canal preferido y mensaje que escribas en el formulario, junto con la página y la conversación de la que sale.</li>
<li><strong>Si el equipo atiende tu conversación</strong>: el equipo puede leer tus mensajes y responderte desde su panel interno, y verás sus respuestas en el chat. También guarda notas y etiquetas internas sobre la conversación (por ejemplo «cliente de POS»); tú no las ves. Si el equipo ha participado y da la conversación por resuelta, puedes valorarla con de 1 a 5 estrellas y un comentario opcional, y guardamos esa valoración y ese comentario.</li>
<li><strong>Tu IP no se guarda en la base de datos del chat.</strong> Como mucho guardamos una huella (hash con una clave secreta) que cambia cada día, para contar visitantes distintos sin poder seguirte de un día a otro. La IP se usa en el momento para limitar el envío de mensajes en masa, y los registros técnicos de Cloudflare pueden contenerla unos días.</li>
</ul>
<h2>Para qué</h2>
<p>Para responderte, para que el equipo pueda contactarte si lo pediste, para ver qué preguntas no sabe responder el asistente y mejorar la ayuda, para saber desde dónde y con qué dispositivo nos escriben, y para que el equipo vea quién está en línea y pueda ofrecerle ayuda. Además, en algunas páginas el chat puede mostrar un mensaje proactivo (por ejemplo, una ayuda en la página de precios): esas reglas no guardan datos tuyos, solo cuentan cuántas veces se mostraron y se abrieron. No usamos el chat para publicidad ni vendemos estos datos.</p>
<h2>Quién procesa los mensajes</h2>
<p>Las respuestas las genera un modelo de lenguaje de Groq y, si falla, de Google (Gemini); a ellos se envía la conversación para contestar. Cloudflare procesa tu pregunta para buscar en el centro de ayuda y guarda los datos. Si pides contacto, tus datos del formulario y la página se envían al equipo por Telegram y WhatsApp (el resumen de los últimos mensajes, solo por Telegram), y tu nombre y canal preferido por notificación push al panel interno del equipo. Además, cada conversación nueva se avisa al equipo por Telegram con tu primera pregunta, el producto, el país, la ciudad, el dispositivo, el sistema y el navegador, y por notificación push al panel interno del equipo con el producto, la ciudad (con la bandera de su país) y la pregunta. Si pides hablar con una persona, se avisa por Telegram (con tu ubicación aproximada y tu última pregunta) y por notificación push; y mientras el equipo atiende tu conversación, cada mensaje que escribes se avisa al equipo por Telegram y por notificación push con tu ciudad (o tu país) y el texto del mensaje. Además, cuando el equipo pulsa «Proponer artículo», las preguntas de visitantes que el asistente no supo responder (de hasta 30 días) se envían a Groq o, si falla, a Google (Gemini) para redactar un borrador interno; ese borrador no se publica solo.</p>
<h2>Cuánto tiempo</h2>
<ul>
<li>Conversaciones, valoraciones (los pulgares y las estrellas con su comentario), datos aproximados de la visita y páginas visitadas después del chat: se borran solas a los <strong>90 días</strong>.</li>
<li>Notas y etiquetas internas: se borran junto con su conversación, a los <strong>90 días</strong>.</li>
<li>Presencia en línea: <strong>como máximo unos 30 minutos</strong> después de tu última señal. Mensajes del equipo que no llegaste a abrir: <strong>1 hora</strong> desde que se crean o se entregan al navegador.</li>
<li>Datos de contacto del formulario: <strong>365 días</strong>.</li>
</ul>
<p>Estos plazos aplican a lo que guardamos en Cloudflare. Los avisos que recibe el equipo por Telegram, WhatsApp o notificación push se quedan en esas aplicaciones; pide que los borren escribiendo a support@yammbo.com.</p>
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
<li><strong>The conversation</strong>: your messages and the assistant's replies, the page you sent each message from, the language, and whether a reply helped (the thumb buttons).</li>
<li><strong>Approximate details of your visit</strong>: your approximate country and city (worked out by Cloudflare from your connection), the device type (mobile, tablet or desktop), the system (for example iOS or Windows) and the browser (for example Chrome or Safari). We do not keep your browser's full identifier.</li>
<li><strong>The pages you visit after using the chat</strong>: the address (without parameters) and the title of the Yammbo pages you open after you have written in the chat, so the team understands what you were looking for. Apart from the presence signal described next, nothing is recorded about what you visit before writing, or about people who have not used the chat.</li>
<li><strong>That you are online (presence)</strong>: while you have a Yammbo page with the chat open, your browser reports every 30 seconds the page you are on (address without parameters, and title), your language, your approximate country and city, the device type, the system and the browser, and the site you came from (only the domain name, if it is external). The team sees it in its panel as an "online visitor" and may write to you first; that message appears next to the chat bubble and a conversation is only created if you open it. No identifier is stored in your browser for this: a random one is kept only in the tab's memory. On multi-page sites it changes when you go to another page; on single-page sites it stays the same between sections, and when you close or reload the tab another one is generated. If you do not click, press a key or scroll for 30 minutes, your browser stops sending the signal until you interact again. If your browser sends the Global Privacy Control or Do Not Track signal, no presence is sent, unless a conversation is already open (you have written in the chat): then it is tied to your conversation. The presence row is deleted <strong>at most about 30 minutes after your last signal</strong> (it is purged 15 minutes after it, and the automatic cleanup runs every 15 minutes).</li>
<li><strong>If you ask to talk to a person</strong>: the name, email, phone, preferred channel and message you enter in the form, plus the page and the conversation it came from.</li>
<li><strong>If the team handles your conversation</strong>: the team can read your messages and reply from its internal panel, and you will see its replies in the chat. It also keeps internal notes and tags about the conversation (for example "POS customer"); you do not see them. If the team took part and marks the conversation as resolved, you can rate it from 1 to 5 stars with an optional comment, and we keep that rating and comment.</li>
<li><strong>Your IP address is not stored in the chat database.</strong> At most we keep a fingerprint (a hash with a secret key) that changes every day, to count distinct visitors without following you from one day to the next. The IP is used at that moment to limit bulk messaging, and Cloudflare's technical logs may hold it for a few days.</li>
</ul>
<h2>Why</h2>
<p>To answer you, to let the team contact you if you asked, to see which questions the assistant cannot answer so we can improve the help center, to know where and on what device people write to us, and so the team can see who is online and offer help. On some pages the chat may also show a proactive message (for example, help on the pricing page): those rules store nothing about you, they only count how many times they were shown and opened. We don't use the chat for advertising and we don't sell this data.</p>
<h2>Who processes messages</h2>
<p>Replies are generated by a language model from Groq and, if that fails, from Google (Gemini); they receive the conversation in order to answer. Cloudflare processes your question to search the help center and stores the data. If you ask for contact, your form details and the page are sent to the team by Telegram and WhatsApp (the summary of the last messages, by Telegram only), and your name and preferred channel by push notification to the team's internal panel. In addition, every new conversation is announced to the team on Telegram with your first question, the product, the country, the city, the device, the system and the browser, and by push notification to the team's internal panel with the product, the city (with its country's flag) and the question. If you ask to talk to a person, the team is alerted on Telegram (with your approximate location and your last question) and by push notification; and while the team handles your conversation, every message you write is announced to the team on Telegram and by push notification with your city (or country) and the text of the message. Also, when the team presses "Propose article", visitor questions the assistant could not answer (up to 30 days old) are sent to Groq or, if that fails, to Google (Gemini) to write an internal draft; that draft is not published automatically.</p>
<h2>How long</h2>
<ul>
<li>Conversations, ratings (the thumbs, and the stars with their comment), approximate visit details and pages visited after the chat: deleted automatically after <strong>90 days</strong>.</li>
<li>Internal notes and tags: deleted together with their conversation, after <strong>90 days</strong>.</li>
<li>Online presence: <strong>at most about 30 minutes</strong> after your last signal. Team messages you did not open: <strong>1 hour</strong> from when they are created or delivered to the browser.</li>
<li>Contact details from the form: <strong>365 days</strong>.</li>
</ul>
<p>These periods apply to what we keep on Cloudflare. The alerts the team receives by Telegram, WhatsApp or push notification stay in those apps; ask support@yammbo.com to have them deleted.</p>
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
