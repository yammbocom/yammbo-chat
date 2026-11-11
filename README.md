# yammbo-chat

Cloudflare Worker chat brain + embeddable widget for Yammbo sites.

## Architecture

```
help.yammbo.com docs (MDX)
        ↓ build-time ingest
   src/kb-bundle.json   (≈30-50 KB)
        ↓ bundled into Worker
   chat.yammbo.com/api/chat   ← CF Worker (Groq Llama 3.3 70B)
        ↑
   widget.js (next session)   ← embedded on yammbo.com sites
```

Brain is intentionally separate from `yammbo-agent` (the social IG/FB/WA
channel). Same knowledge base, different channels, different prompts.

## Local dev

Prereqs: `pnpm install` (or `npm install`), Cloudflare account with `wrangler login`, `help.yammbo.com` cloned somewhere readable.

```bash
# 1. Build the KB bundle from help.yammbo.com
HELP_REPO=/root/repos/help.yammbo.com npm run build-kb

# 2. Set local secret
echo 'GROQ_API_KEY="..."' > .dev.vars

# 3. Run locally
npm run dev
# Worker on http://localhost:8787

# 4. Test
curl -X POST http://localhost:8787/api/chat \
  -H 'content-type: application/json' \
  -H 'origin: https://yammbo.com' \
  -d '{"messages":[{"role":"user","content":"What is Yammbo Music?"}]}'
```

## Deploy

```bash
# 1. Create KV namespace (first time only)
wrangler kv:namespace create CHAT_SESSIONS
# Paste the returned id into wrangler.toml under [[kv_namespaces]]

# 2. Set production secret
wrangler secret put GROQ_API_KEY

# 3. Build KB + deploy
npm run deploy
```

## Team panel (`/panel`)

PWA for the team: stats, conversations (country, device, pages visited after the chat), contacts,
unanswered questions and Web Push alerts. Login is an 8-character one-time code (alphabet
`23456789ABCDEFGHJKMNPQRSTUVWXYZ`, valid 10 minutes) sent to the Telegram chat
(`TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID`); sessions live in KV for 30 days. Pending codes and the
global attempt caps (6 `start`/h, 30 failed `verify`/h) live in D1, because KV is not atomic. The VAPID
key pair is generated once and stored in the D1 `settings` table. Needs migration
`migrations/0002_panel.sql` (`wrangler d1 migrations apply yammbo-chat --remote`) applied BEFORE
deploying: the new code writes the new columns, and without them every chat turn fails to persist
(the chat keeps answering, so the failure is silent).

### Shared inbox (live replies)

The team can take a conversation over from the panel (reply, return it to the assistant, resolve it),
tag it, leave internal notes, use canned replies (`/` in the composer), ask the AI for a draft and, after
resolving a conversation it took part in, collect a 1-5 rating. Visitor side: `POST /api/handoff`,
`GET /api/messages` (polling), `POST /api/csat`. Needs migration `migrations/0003_inbox.sql`
(`wrangler d1 migrations apply yammbo-chat --remote`) applied BEFORE deploying: the chat upsert now
writes `conversations.status`, so without the migration every chat turn fails to persist.
The widget mints 192-bit session ids; `/api/handoff`, `/api/messages` and `/api/csat` only accept ids of
32+ chars (the session id is their credential), so older short ids keep chatting but cannot be taken over.
Replies are also emailed to visitors who left an address, but only once `ZEPTOMAIL_API_TOKEN` exists
(inactive today; if it is ever set, update `src/privacy.ts`).

### Live visitors, proactive messages and Help Center gaps

- **Online now** (panel «En línea»): the widget sends `POST /api/presence` every 30 s while the tab is
  visible (and a `sendBeacon` to `/api/presence/leave` on exit); it stops after 30 minutes without
  pointerdown/keydown/scroll/touchstart until the next input. The presence id is 128 random bits kept in
  the tab's memory (nothing is stored in the browser): on single-page sites it survives route changes, and
  closing or reloading the tab makes another. A browser that sends Global Privacy Control or Do Not Track
  sends nothing, unless the visitor already uses the chat. Rows older than 15 minutes are purged by the
  panel list endpoint and by the 15-minute cron, so a row lives at most about 30 minutes after the last
  signal (`last_seen` is deliberately not indexed: it changes on every heartbeat). Heartbeats and leave
  beacons use their own `PRESENCE_LIMITER` (60/min per IP); the global cap of new presence rows is
  600/min and only degrades presence. The team can write first
  (`POST /panel/api/presence/:id/message`): the text waits in `proactive_inbox`, the next heartbeat hands
  it to the widget, and a conversation (role `agent`, mode `human`) is only created when the visitor opens
  the teaser (`POST /api/proactive/accept`, which validates against `proactive_inbox` + presence id and
  works even if the presence row is gone). Unopened team messages are kept 1 h after creation or
  delivery, independent of the presence row. The widget shows no teaser while the site hides the bubble.
- **Proactive rules** (panel Ajustes -> Mensajes proactivos): table `triggers`; pattern syntax
  `[host][/path-prefix]` documented in `src/triggers.ts` and in the panel. The widget reads
  `GET /api/triggers` (cached 300 s), shows one teaser per page load and reports `shown`/`opened` with
  `POST /api/triggers/:id/event`.
- **Gaps** (panel Sin respuesta -> Huecos): questions of the last 30 days that got a thumbs down, a handoff,
  no KB hit or asked for a person are embedded with the same Workers AI model as the RAG, grouped
  greedily by cosine similarity (default 0.82) and cached in KV for 1 h. «Proponer artículo»
  (`POST /panel/api/gaps/draft`, 20/h) sends the unanswered visitor questions (up to 30 days) to Groq or
  Gemini for an MDX draft for help.yammbo.com; nothing is published automatically (disclosed in
  `src/privacy.ts`).
- Needs migration `migrations/0004_live.sql` (`wrangler d1 migrations apply yammbo-chat --remote`)
  applied BEFORE deploying: without it the panel Inicio fails (its stats query `presence`) and the new
  endpoints answer 503/500 (the chat itself keeps working). Update `src/privacy.ts` if what is stored changes.

Local testing without Telegram: put `PANEL_DEV_CODE="K7M2Q9XA"` (8 characters of the alphabet above)
in `.dev.vars` (gitignored). It is only honoured for requests to localhost/127.0.0.1. Never set it as
a production secret.

```bash
node scripts/push-selftest.mjs        # Web Push encryption vs an independent node:crypto decryptor
node scripts/live-selftest.mjs        # gaps, rule matcher, presence accept/purge against an in-memory D1 stub
node scripts/make-panel-icons.mjs     # regenerates src/panel-icons/*.png
```

## Files

- `wrangler.toml` — Worker config, bindings, vars
- `src/index.ts` — Worker entry point and routing
- `src/brain.ts` — Groq call, streaming, language detection
- `src/system-prompt.ts` — master prompt + KB section builder
- `src/cors.ts` — origin allow-list CORS
- `src/panel*.ts`, `src/push.ts`, `src/announce.ts`, `src/device.ts` — team panel, Web Push (VAPID + RFC 8291), alerts, UA summary
- `src/kb-bundle.json` — generated by `scripts/build-kb.mjs`, committed
- `scripts/build-kb.mjs` — ingests `help.yammbo.com` MDX docs

## Knowledge base

Generated from [`yammbocom/help.yammbo.com`](https://github.com/yammbocom/help.yammbo.com)
at build time. Rebuild whenever help.yammbo.com is updated:

```bash
git -C /root/repos/help.yammbo.com pull
npm run build-kb
git add src/kb-bundle.json
git commit -m "Refresh KB from help.yammbo.com"
```

## Brain policy

The system prompt explicitly forbids:
- Inventing pricing, features, or roadmap not in the KB
- Mentioning underlying tech (`n8n`, VPS, infra)
- Disparaging competitors
- Handling account-specific changes (escalates to support@yammbo.com)
