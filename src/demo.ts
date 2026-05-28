// demo.ts
// Standalone demo page served at GET /demo. Lets us validate the widget UX
// (mobile + desktop) without integrating into a real Yammbo site yet.

export const DEMO_HTML = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<title>Yammbo chat — demo</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#f7f7f7;color:#111;line-height:1.55;min-height:100vh;padding:48px 24px}
  main{max-width:680px;margin:0 auto}
  h1{font-size:32px;font-weight:700;letter-spacing:-.02em;margin-bottom:8px}
  .lead{color:#666;font-size:16px;margin-bottom:32px}
  h2{font-size:18px;font-weight:600;margin:28px 0 8px}
  p{margin-bottom:12px;color:#333}
  code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:#fff;border:1px solid #e5e5e5;padding:2px 6px;border-radius:4px;font-size:13px}
  pre{background:#111;color:#fff;padding:14px 16px;border-radius:8px;overflow-x:auto;font-size:13px;line-height:1.5;margin:12px 0 20px}
  ul{padding-left:22px;margin-bottom:16px;color:#333}
  li{margin-bottom:6px}
  .pill{display:inline-block;font-size:11px;font-weight:600;background:#111;color:#fff;padding:3px 8px;border-radius:99px;letter-spacing:.04em;text-transform:uppercase;margin-bottom:16px}
  .note{background:#fff;border:1px solid #e5e5e5;border-radius:8px;padding:14px 16px;font-size:14px;color:#555;margin:18px 0}
</style>
</head>
<body>
<main>
  <span class="pill">demo</span>
  <h1>Yammbo chat — embeddable widget</h1>
  <p class="lead">Página de prueba aislada. El bubble negro abajo a la derecha abre el chat. Probalo en móvil y desktop.</p>

  <h2>Preguntas para probar</h2>
  <ul>
    <li>What is Yammbo Music and how do I get started?</li>
    <li>Quiero abrir una tienda online, qué necesito?</li>
    <li>Cuánto cuesta Yammbo POS?</li>
    <li>No puedo iniciar sesión, qué hago?</li>
    <li>How is Yammbo Flow different from Zapier?</li>
  </ul>

  <h2>Cómo embeber en otros sitios</h2>
  <p>Una línea antes del cierre de <code>&lt;/body&gt;</code>:</p>
  <pre>&lt;script src="https://chat.yammbo.com/widget.js" defer&gt;&lt;/script&gt;</pre>
  <div class="note">El widget solo se conecta a <code>chat.yammbo.com/api/chat</code> y el endpoint tiene CORS allow-list — solo sitios <code>*.yammbo.com</code> pueden usar el endpoint, así que el snippet es seguro de pegar en cualquier landing/sitio Yammbo.</div>

  <h2>Estado</h2>
  <ul>
    <li>Home con Centro de ayuda (búsqueda + artículos inline) y Blog (posts recientes)</li>
    <li>Handoff a humano: el bot ofrece contacto y abre formulario (nombre/email/teléfono/canal)</li>
    <li>Brain: Groq Llama 3.3 70B → fallback Gemini 2.0 Flash en 429</li>
    <li>Base de conocimiento: 28 docs (EN+ES) de help.yammbo.com</li>
    <li>Idioma: detección automática EN/ES</li>
    <li>Streaming SSE; historial en localStorage</li>
  </ul>
</main>

<script src="/widget.js" defer></script>
</body>
</html>`;
