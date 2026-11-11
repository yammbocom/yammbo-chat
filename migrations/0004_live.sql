-- 0004_live.sql
-- Live visitors ("En linea"), team-first messages and proactive rules.
-- Timestamps are epoch milliseconds.
-- Retention (see purgeLive() in src/presence.ts): presence rows are deleted 15 minutes
-- after their last heartbeat (opportunistically when the panel lists them, and in the
-- cron every 15 minutes: at most about 30 minutes after the last signal); proactive_inbox
-- rows are kept 1 hour after their creation or delivery, independent of the presence row.
-- triggers holds team-authored rules plus two aggregate counters; no visitor data.

-- One row per page load of a visitor whose browser did not send Global Privacy Control
-- or Do Not Track (or who already uses the chat). presence_id is 128 random bits made
-- in memory by the widget: it is never stored in the browser (it lives in the tab's
-- memory: it changes on reload or when the tab is closed).
CREATE TABLE presence (
  presence_id TEXT PRIMARY KEY,
  session_id TEXT,                -- only when the visitor already has a conversation
  url TEXT NOT NULL,              -- origin + pathname of a yammbo.com page, no query
  title TEXT,
  lang TEXT,
  country TEXT,
  city TEXT,
  device TEXT,
  os TEXT,
  browser TEXT,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  referrer_host TEXT              -- hostname of an external document.referrer, else NULL
);
-- No index on last_seen: it changes on every heartbeat (an index would double the writes)
-- and the table is small (online visitors only), so the purge and the listing scan it.

-- Messages the team wrote to an online visitor before any conversation existed.
-- The widget collects them with its heartbeat (delivered_at) and, only if the visitor
-- opens the teaser, POST /api/proactive/accept moves them into `messages` (role
-- 'agent') and deletes them from here.
CREATE TABLE proactive_inbox (
  id TEXT PRIMARY KEY,
  presence_id TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  delivered_at INTEGER
);
CREATE INDEX idx_proactive_presence ON proactive_inbox (presence_id, created_at);

-- Proactive message rules. path_pattern syntax: see src/triggers.ts.
CREATE TABLE triggers (
  id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1,
  name TEXT NOT NULL,
  path_pattern TEXT NOT NULL,
  delay_s INTEGER NOT NULL DEFAULT 10 CHECK (delay_s BETWEEN 0 AND 300),
  message_es TEXT NOT NULL DEFAULT '',
  message_en TEXT NOT NULL DEFAULT '',
  max_per_visit INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  shown INTEGER NOT NULL DEFAULT 0,
  opened INTEGER NOT NULL DEFAULT 0
);
