-- 0002_panel.sql
-- Team panel (/panel): richer conversation metadata, per-message page, post-chat
-- page views and Web Push subscriptions. Timestamps are epoch milliseconds.
-- Retention (see scheduled() in src/index.ts): page_views 90 days with the chat data.

-- Approximate location (Cloudflare request.cf) and a coarse client summary parsed
-- from the User-Agent. The full User-Agent and the IP are never stored.
ALTER TABLE conversations ADD COLUMN country TEXT;      -- ISO 3166-1 alpha-2
ALTER TABLE conversations ADD COLUMN city TEXT;
ALTER TABLE conversations ADD COLUMN device TEXT;       -- 'mobile' | 'tablet' | 'desktop'
ALTER TABLE conversations ADD COLUMN os TEXT;           -- iOS | Android | Windows | macOS | Linux | Otro
ALTER TABLE conversations ADD COLUMN browser TEXT;      -- Chrome | Safari | Firefox | Edge | Samsung | Otro
CREATE INDEX idx_conversations_updated ON conversations (updated_at);

-- Page a user message was sent from.
ALTER TABLE messages ADD COLUMN page_url TEXT;

-- Pages visited AFTER the visitor started a conversation (POST /api/visit).
CREATE TABLE page_views (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_page_views_session ON page_views (session_id, created_at);

-- Web Push subscriptions of the team's devices.
CREATE TABLE push_subs (
  endpoint TEXT PRIMARY KEY,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Panel login (/panel). D1 serialises writes, so these two tables give atomic
-- one-time codes and atomic counters (KV is not atomic and let parallel guesses
-- past the attempt cap).
-- Pending one-time login codes (SHA-256 of the normalised code). Several can be
-- valid at once; a code is spent by a DELETE ... RETURNING.
CREATE TABLE panel_codes (
  code_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

-- Fixed-window counters: global 'start' and 'verify' buckets plus a per-IP start bucket.
CREATE TABLE panel_throttle (
  bucket TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);

-- Small key/value store for server-generated config (the VAPID key pair).
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
