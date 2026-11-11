-- 0003_inbox.sql
-- Shared inbox: live replies from the team (takeover), conversation status, tags,
-- internal notes, canned replies and a post-resolution rating (CSAT).
-- Timestamps are epoch milliseconds.
-- Retention (see purgeOld() in src/store.ts): notes and tags go with their
-- conversation (90 days after its last activity). canned is never purged.

-- Who answers: 'bot' (the assistant), 'waiting' (the visitor asked for a person and
-- nobody answered yet) or 'human' (the team took over; the LLM is not called).
ALTER TABLE conversations ADD COLUMN mode TEXT NOT NULL DEFAULT 'bot';
-- 'open' | 'resolved'. A new visitor message reopens a resolved conversation.
ALTER TABLE conversations ADD COLUMN status TEXT NOT NULL DEFAULT 'open';
ALTER TABLE conversations ADD COLUMN last_agent_at INTEGER;
-- Visitor messages the team has not seen yet (reset when the panel opens the conversation).
ALTER TABLE conversations ADD COLUMN unread INTEGER NOT NULL DEFAULT 0;
-- Rating asked once when the team resolves a conversation it took part in.
ALTER TABLE conversations ADD COLUMN csat_requested INTEGER NOT NULL DEFAULT 0;
ALTER TABLE conversations ADD COLUMN csat INTEGER;            -- 1..5
ALTER TABLE conversations ADD COLUMN csat_comment TEXT;       -- <= 500 chars
ALTER TABLE conversations ADD COLUMN csat_at INTEGER;
CREATE INDEX idx_conversations_mode ON conversations (mode, updated_at);

-- messages.role gains two values (no schema change, the column has no CHECK):
--   'agent'  text written by the team
--   'system' event line; content is a code the clients translate:
--            sys:waiting | sys:joined | sys:returned | sys:resolved
CREATE INDEX idx_messages_session_created ON messages (session_id, created_at);

CREATE TABLE conversation_tags (
  session_id TEXT NOT NULL,
  tag TEXT NOT NULL,              -- normalised: lower case, <= 24 chars
  created_at INTEGER NOT NULL,
  PRIMARY KEY (session_id, tag)
);
CREATE INDEX idx_conversation_tags_tag ON conversation_tags (tag);

-- Internal notes: never returned by any public (/api/*) endpoint.
CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_notes_session ON notes (session_id, created_at);

CREATE TABLE canned (
  id TEXT PRIMARY KEY,
  shortcut TEXT NOT NULL UNIQUE,  -- ^[a-z0-9-]{1,24}$ (validated in code)
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
